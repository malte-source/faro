import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import { generateFlash } from '@/lib/gemini'
import { enforceRateLimit } from '@/lib/rate-limit'
import { requireFeature } from '@/lib/plan-limits'
import { notify } from '@/server/notify'
import {
  METHOD_LABEL,
  allocate,
  chargesToCsv,
  currencyDecimals,
  type CostPool,
  type EmpresaMetrics,
  type PoolMethod,
} from '@/lib/costing'
import { isDirection, type EmpresaCtx } from '@/server/multiempresa'
import type { createAdminSupabaseClient } from '@/lib/supabase'

/**
 * Costos intercompany (plan estructural §7). Todo es solo para Dirección y se
 * acota al grupo activo. El Holding es el PROVEEDOR de los servicios: nunca
 * recibe cargos; las empresas cargadas son todas las demás.
 */

const HOLDING_NAME = 'La Trinchera · Holding'
const PERIOD = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Periodo inválido (AAAA-MM).')
const CURRENCY = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Moneda inválida (código de 3 letras).')

type Db = ReturnType<typeof createAdminSupabaseClient>
type Ctx = EmpresaCtx & { session: { user: { email?: string | null; name?: string | null } } }

function requireDirection(ctx: Ctx): { orgId: string } {
  if (!isDirection(ctx)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Los costos intercompany son para Dirección.' })
  }
  if (!ctx.activeOrg) throw new TRPCError({ code: 'NOT_FOUND' })
  return { orgId: ctx.activeOrg.id }
}

interface Charged { id: string; name: string; color: string }

/** Empresas that receive charges: every workspace of the active grupo except the Holding. */
async function chargedEmpresas(ctx: Ctx): Promise<Charged[]> {
  if (!ctx.workspaceIds.length) return []
  const { data, error } = await ctx.supabase.from('workspaces').select('id, name, color').in('id', ctx.workspaceIds).order('name')
  if (error) throw error
  return (data ?? []).filter(w => w.name !== HOLDING_NAME)
}

async function usersById(db: Db, ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((x): x is string => !!x)))
  const map = new Map<string, string>()
  if (!unique.length) return map
  const { data } = await db.from('users').select('id, name').in('id', unique)
  for (const u of data ?? []) map.set(u.id, u.name)
  return map
}

function toPool(r: {
  id: string; name: string; layer: CostPool['layer']; method: PoolMethod; monthly_amount: number; currency: string; variable_pct: number
}): CostPool {
  return { id: r.id, name: r.name, layer: r.layer, method: r.method, monthlyAmount: Number(r.monthly_amount), currency: r.currency, variablePct: Number(r.variable_pct) }
}

async function loadMetrics(ctx: Ctx, orgId: string, period: string, empresas: Charged[]): Promise<EmpresaMetrics[]> {
  if (!empresas.length) return []
  const { data, error } = await ctx.supabase
    .from('empresa_period_metrics')
    .select('workspace_id, revenue, headcount, attributed_sales')
    .eq('org_id', orgId)
    .eq('period', period)
    .in('workspace_id', empresas.map(e => e.id))
  if (error) throw error
  const byWs = new Map((data ?? []).map(m => [m.workspace_id, m]))
  return empresas.map(e => {
    const m = byWs.get(e.id)
    return { workspaceId: e.id, name: e.name, revenue: Number(m?.revenue ?? 0), headcount: Number(m?.headcount ?? 0), attributedSales: Number(m?.attributed_sales ?? 0) }
  })
}

async function computePreview(ctx: Ctx, orgId: string, period: string) {
  const [empresas, { data: poolRows, error }] = await Promise.all([
    chargedEmpresas(ctx),
    ctx.supabase.from('cost_pools').select('id, name, layer, method, monthly_amount, currency, variable_pct').eq('org_id', orgId).eq('is_active', true).order('layer').order('name'),
  ])
  if (error) throw error
  const metrics = await loadMetrics(ctx, orgId, period, empresas)
  const result = allocate((poolRows ?? []).map(toPool), metrics)
  return { empresas, metrics, result }
}

async function loadRun(ctx: Ctx, orgId: string, runId: string) {
  const { data: run } = await ctx.supabase.from('charge_runs').select('*').eq('id', runId).eq('org_id', orgId).maybeSingle()
  if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'La corrida de cargos no existe.' })
  return run
}

async function runLines(ctx: Ctx, runId: string) {
  const { data, error } = await ctx.supabase.from('charge_lines').select('*').eq('run_id', runId).order('pool_name')
  if (error) throw error
  return data ?? []
}

const money = (n: number, currency: string) =>
  `${new Intl.NumberFormat('es-PY', { maximumFractionDigits: currencyDecimals(currency) }).format(n)} ${currency}`

export const costosRouter = createTRPCRouter({
  // ── Pools (lo que cuesta cada servicio / capa) ──────────────────────────
  pools: createTRPCRouter({
    list: protectedProcedure.query(async ({ ctx }) => {
      const { orgId } = requireDirection(ctx)
      const { data, error } = await ctx.supabase.from('cost_pools').select('*').eq('org_id', orgId).order('layer').order('name')
      if (error) throw error
      return (data ?? []).map(p => ({
        id: p.id, name: p.name, layer: p.layer, method: p.method, monthlyAmount: Number(p.monthly_amount),
        currency: p.currency, variablePct: Number(p.variable_pct), notes: p.notes, isActive: p.is_active,
      }))
    }),

    upsert: protectedProcedure
      .input(z.object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(2).max(80),
        layer: z.enum(['gobierno', 'coe', 'sso']),
        method: z.enum(['revenue', 'headcount', 'central', 'base_plus_variable']),
        monthlyAmount: z.number().min(0).max(1e15),
        currency: CURRENCY.default('PYG'),
        variablePct: z.number().min(0).max(100).default(0),
        notes: z.string().trim().max(500).nullish(),
        isActive: z.boolean().default(true),
      }))
      .mutation(async ({ ctx, input }) => {
        const { orgId } = requireDirection(ctx)
        const row = {
          name: input.name, layer: input.layer, method: input.method, monthly_amount: input.monthlyAmount,
          currency: input.currency, variable_pct: input.method === 'base_plus_variable' ? input.variablePct : 0,
          notes: input.notes ?? null, is_active: input.isActive,
        }
        if (input.id) {
          const { data, error } = await ctx.supabase.from('cost_pools').update(row).eq('id', input.id).eq('org_id', orgId).select('id').maybeSingle()
          if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
          if (!data) throw new TRPCError({ code: 'NOT_FOUND', message: 'Ese costo no existe.' })
          return { id: data.id }
        }
        const { data, error } = await ctx.supabase.from('cost_pools').insert({ ...row, org_id: orgId, created_by: ctx.me.id }).select('id').single()
        if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
        return { id: data.id }
      }),

    remove: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const { orgId } = requireDirection(ctx)
        const { error } = await ctx.supabase.from('cost_pools').delete().eq('id', input.id).eq('org_id', orgId)
        if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
        return { ok: true }
      }),
  }),

  // ── Datos del mes por empresa ───────────────────────────────────────────
  metrics: createTRPCRouter({
    get: protectedProcedure
      .input(z.object({ period: PERIOD }))
      .query(async ({ ctx, input }) => {
        const { orgId } = requireDirection(ctx)
        const empresas = await chargedEmpresas(ctx)
        const metrics = await loadMetrics(ctx, orgId, input.period, empresas)
        const { data: approved } = await ctx.supabase.from('charge_runs').select('id').eq('org_id', orgId).eq('period', input.period).eq('status', 'aprobado').maybeSingle()
        return {
          locked: !!approved,
          rows: empresas.map((e, i) => ({ workspaceId: e.id, name: e.name, color: e.color, revenue: metrics[i].revenue, headcount: metrics[i].headcount, attributedSales: metrics[i].attributedSales })),
        }
      }),

    set: protectedProcedure
      .input(z.object({
        period: PERIOD,
        rows: z.array(z.object({
          workspaceId: z.string().uuid(),
          revenue: z.number().min(0).max(1e15),
          headcount: z.number().int().min(0).max(100000),
          attributedSales: z.number().min(0).max(1e15),
        })).max(100),
      }))
      .mutation(async ({ ctx, input }) => {
        const { orgId } = requireDirection(ctx)
        const allowed = new Set((await chargedEmpresas(ctx)).map(e => e.id))
        const bad = input.rows.find(r => !allowed.has(r.workspaceId))
        if (bad) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Una de las empresas no es parte del grupo.' })
        const { data: approved } = await ctx.supabase.from('charge_runs').select('id').eq('org_id', orgId).eq('period', input.period).eq('status', 'aprobado').maybeSingle()
        if (approved) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Este mes ya tiene cargos aprobados. Anula la corrida para cambiar los datos.' })

        const now = new Date().toISOString()
        const { error } = await ctx.supabase.from('empresa_period_metrics').upsert(
          input.rows.map(r => ({
            org_id: orgId, workspace_id: r.workspaceId, period: input.period,
            revenue: r.revenue, headcount: r.headcount, attributed_sales: r.attributedSales,
            updated_by: ctx.me.id, updated_at: now,
          })),
          { onConflict: 'workspace_id,period' },
        )
        if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
        return { saved: input.rows.length }
      }),
  }),

  /** Reparto del mes con los costos activos y los datos cargados (no guarda nada). */
  preview: protectedProcedure
    .input(z.object({ period: PERIOD }))
    .query(async ({ ctx, input }) => {
      const { orgId } = requireDirection(ctx)
      const { empresas, result } = await computePreview(ctx, orgId, input.period)
      return {
        empresas: empresas.map(e => ({ id: e.id, name: e.name, color: e.color })),
        pools: result.pools,
        totalsByEmpresa: result.totalsByEmpresa,
        totalsByCurrency: result.totalsByCurrency,
        centralByCurrency: result.centralByCurrency,
        empresasWithoutMetrics: result.empresasWithoutMetrics,
        warnings: result.warnings,
      }
    }),

  // ── Corridas de cargos ──────────────────────────────────────────────────
  runs: createTRPCRouter({
    list: protectedProcedure.query(async ({ ctx }) => {
      const { orgId } = requireDirection(ctx)
      const { data, error } = await ctx.supabase.from('charge_runs').select('*').eq('org_id', orgId).order('period', { ascending: false }).order('created_at', { ascending: false }).limit(60)
      if (error) throw error
      const rows = data ?? []
      const names = await usersById(ctx.supabase, rows.flatMap(r => [r.prepared_by, r.approved_by]))
      return rows.map(r => ({
        id: r.id, period: r.period, status: r.status, total: r.total === null ? null : Number(r.total), note: r.note,
        preparedBy: r.prepared_by, preparedByName: r.prepared_by ? (names.get(r.prepared_by) ?? null) : null,
        approvedByName: r.approved_by ? (names.get(r.approved_by) ?? null) : null,
        approvedAt: r.approved_at, createdAt: r.created_at,
        /** The caller prepared it, so someone else must approve. */
        mine: r.prepared_by === ctx.me.id,
      }))
    }),

    get: protectedProcedure
      .input(z.object({ runId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const { orgId } = requireDirection(ctx)
        const run = await loadRun(ctx, orgId, input.runId)
        const [lines, empresas, names] = await Promise.all([
          runLines(ctx, run.id),
          chargedEmpresas(ctx),
          usersById(ctx.supabase, [run.prepared_by, run.approved_by]),
        ])
        const byId = new Map(empresas.map(e => [e.id, e]))
        const totals: Record<string, number> = {}
        for (const l of lines) totals[l.currency] = (totals[l.currency] ?? 0) + Number(l.amount)
        return {
          run: {
            id: run.id, period: run.period, status: run.status, note: run.note,
            preparedByName: run.prepared_by ? (names.get(run.prepared_by) ?? null) : null,
            approvedByName: run.approved_by ? (names.get(run.approved_by) ?? null) : null,
            approvedAt: run.approved_at, mine: run.prepared_by === ctx.me.id,
          },
          lines: lines.map(l => ({
            id: l.id, poolName: l.pool_name, method: l.method, workspaceId: l.workspace_id,
            empresaName: byId.get(l.workspace_id)?.name ?? 'Empresa', empresaColor: byId.get(l.workspace_id)?.color ?? '#55636B',
            amount: Number(l.amount), driverShare: Number(l.driver_share), currency: l.currency, explanation: l.explanation,
          })),
          totalsByCurrency: totals,
        }
      }),

    /** Snapshot the preview of the month as a draft. Fails if the month already has an active run. */
    prepare: protectedProcedure
      .input(z.object({ period: PERIOD, note: z.string().trim().max(500).optional() }))
      .mutation(async ({ ctx, input }) => {
        const { orgId } = requireDirection(ctx)
        const { data: existing } = await ctx.supabase.from('charge_runs').select('id, status').eq('org_id', orgId).eq('period', input.period).neq('status', 'anulado').maybeSingle()
        if (existing) {
          throw new TRPCError({ code: 'CONFLICT', message: `Este mes ya tiene una corrida ${existing.status}. Anúlala para preparar otra.` })
        }
        const { result } = await computePreview(ctx, orgId, input.period)
        const lines = result.pools.flatMap(p => p.lines)
        if (lines.length === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'No hay nada que repartir: revisa los costos y los datos del mes.' })
        }
        const currencies = Object.keys(result.totalsByCurrency)
        const total = currencies.length === 1 ? result.totalsByCurrency[currencies[0]] : null

        const { data: run, error } = await ctx.supabase
          .from('charge_runs')
          .insert({ org_id: orgId, period: input.period, status: 'borrador', prepared_by: ctx.me.id, note: input.note ?? null, total })
          .select('id')
          .single()
        if (error) {
          if (error.code === '23505') throw new TRPCError({ code: 'CONFLICT', message: 'Este mes ya tiene una corrida vigente.' })
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
        }
        const { error: linesErr } = await ctx.supabase.from('charge_lines').insert(
          lines.map(l => ({
            run_id: run.id, pool_id: l.poolId, pool_name: l.poolName, method: l.method, workspace_id: l.workspaceId,
            amount: l.amount, driver_value: l.driverValue, driver_share: l.driverShare, currency: l.currency, explanation: l.explanation,
          })),
        )
        if (linesErr) {
          await ctx.supabase.from('charge_runs').delete().eq('id', run.id)
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: linesErr.message })
        }

        // Segregation of duties: the preparer can't approve, so tell the OTHER people in Dirección there is one waiting.
        const { data: direction } = await ctx.supabase.from('org_memberships').select('user_id').eq('org_id', orgId).in('role', ['owner', 'admin'])
        await notify({
          supabase: ctx.supabase,
          orgId,
          userIds: (direction ?? []).map(d => d.user_id),
          kind: 'cost_run',
          title: 'Hay un reparto de costos por aprobar',
          body: `Período ${input.period}: lo preparó ${ctx.session.user.name ?? 'alguien de Dirección'}.`,
          url: '/dashboard/costos',
          entity: { type: 'cost_run', id: run.id },
          actorId: ctx.me.id,
        })
        return { runId: run.id, lines: lines.length, warnings: result.warnings }
      }),

    /** Segregación de funciones (regla 3): quien prepara nunca aprueba. */
    approve: protectedProcedure
      .input(z.object({ runId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const { orgId } = requireDirection(ctx)
        const run = await loadRun(ctx, orgId, input.runId)
        if (run.status !== 'borrador') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Solo se puede aprobar un borrador.' })
        if (run.prepared_by === ctx.me.id) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Quien prepara no aprueba: necesita otra persona de Dirección.' })
        }
        const { data, error } = await ctx.supabase
          .from('charge_runs')
          .update({ status: 'aprobado', approved_by: ctx.me.id, approved_at: new Date().toISOString() })
          .eq('id', run.id)
          .eq('status', 'borrador')
          .select('id')
          .maybeSingle()
        if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
        if (!data) throw new TRPCError({ code: 'CONFLICT', message: 'La corrida cambió mientras la aprobabas. Recarga.' })
        return { ok: true }
      }),

    void: protectedProcedure
      .input(z.object({ runId: z.string().uuid(), reason: z.string().trim().max(300).optional() }))
      .mutation(async ({ ctx, input }) => {
        const { orgId } = requireDirection(ctx)
        const run = await loadRun(ctx, orgId, input.runId)
        if (run.status === 'anulado') throw new TRPCError({ code: 'BAD_REQUEST', message: 'La corrida ya está anulada.' })
        const note = input.reason ? [run.note, `Anulada: ${input.reason}`].filter(Boolean).join(' · ') : run.note
        const { error } = await ctx.supabase.from('charge_runs').update({ status: 'anulado', note }).eq('id', run.id)
        if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
        return { ok: true }
      }),

    exportCsv: protectedProcedure
      .input(z.object({ runId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const { orgId } = requireDirection(ctx)
        const run = await loadRun(ctx, orgId, input.runId)
        const [lines, empresas] = await Promise.all([runLines(ctx, run.id), chargedEmpresas(ctx)])
        const nameOf = new Map(empresas.map(e => [e.id, e.name]))
        const csv = chargesToCsv(run.period, lines.map(l => ({
          empresa: nameOf.get(l.workspace_id) ?? l.workspace_id,
          poolName: l.pool_name,
          method: METHOD_LABEL[l.method as PoolMethod] ?? l.method,
          driverShare: Number(l.driver_share),
          amount: Number(l.amount),
          currency: l.currency,
          explanation: l.explanation ?? '',
        })))
        return { filename: `cargos-intercompany-${run.period}-${run.status}.csv`, csv }
      }),
  }),

  /**
   * Explica en lenguaje llano por qué cada empresa paga lo que paga y marca
   * anomalías. No inventa cifras: solo usa las del reparto. Siempre cierra con
   * la advertencia del plan (precios de transferencia / IVA).
   */
  explain: protectedProcedure
    .input(z.object({ runId: z.string().uuid().optional(), period: PERIOD.optional() }).refine(v => v.runId || v.period, 'Indica la corrida o el periodo.'))
    .mutation(async ({ ctx, input }) => {
      const { orgId } = requireDirection(ctx)
      requireFeature(ctx.activeOrg?.plan, 'ai', 'Explicar los cargos con IA')
      enforceRateLimit(`${ctx.me.id}:costosExplain`)

      let period = input.period ?? ''
      const rows: Array<{ empresa: string; concepto: string; metodo: string; monto: number; moneda: string; explicacion: string }> = []
      let warnings: string[] = []
      let central: string[] = []
      if (input.runId) {
        const run = await loadRun(ctx, orgId, input.runId)
        period = run.period
        const [lines, empresas] = await Promise.all([runLines(ctx, run.id), chargedEmpresas(ctx)])
        const nameOf = new Map(empresas.map(e => [e.id, e.name]))
        for (const l of lines) {
          rows.push({ empresa: nameOf.get(l.workspace_id) ?? 'Empresa', concepto: l.pool_name, metodo: METHOD_LABEL[l.method as PoolMethod] ?? l.method, monto: Number(l.amount), moneda: l.currency, explicacion: l.explanation ?? '' })
        }
      } else {
        const { empresas, result } = await computePreview(ctx, orgId, period)
        const nameOf = new Map(empresas.map(e => [e.id, e.name]))
        for (const p of result.pools) for (const l of p.lines) {
          rows.push({ empresa: nameOf.get(l.workspaceId) ?? 'Empresa', concepto: l.poolName, metodo: METHOD_LABEL[l.method], monto: l.amount, moneda: l.currency, explicacion: l.explanation })
        }
        warnings = result.warnings
        central = result.pools.filter(p => p.central).map(p => `${p.poolName}: ${money(p.monthlyAmount, p.currency)}`)
      }
      if (rows.length === 0) return { text: 'Todavía no hay cargos que explicar: carga los costos y los datos del mes.', disclaimer: DISCLAIMER }

      const table = rows.map(r => `- ${r.empresa} | ${r.concepto} (${r.metodo}) | ${money(r.monto, r.moneda)} | ${r.explicacion}`).join('\n')
      const prompt = `Eres Faro, asistente de finanzas del holding La Trinchera. Explica el reparto de costos intercompany del periodo ${period} en español neutro latinoamericano, claro para alguien que no es contador.

Reglas del modelo (plan estructural): Gobierno se reparte por facturación de cada empresa; los Centros de Excelencia son presupuesto central y no se reparten; los Servicios Compartidos se reparten por headcount; Ventas cobra una base fija más un variable sobre la venta atribuida.

Escribe:
1. **Por qué paga cada empresa lo que paga** — una línea por empresa, citando su participación.
2. **Alertas** — una empresa con una parte muy grande, datos del mes faltantes o conceptos sin repartir. Si no hay nada raro, di que no ves anomalías.

Usa SOLO las cifras de abajo; no inventes montos ni porcentajes. No incluyas advertencias legales ni fiscales (se agregan aparte).

CARGOS:
${table}
${central.length ? `\nPRESUPUESTO CENTRAL (no se reparte): ${central.join('; ')}` : ''}${warnings.length ? `\nAVISOS DEL SISTEMA: ${warnings.join(' ')}` : ''}`
      const text = (await generateFlash(prompt, { temperature: 0.2 })).trim()
      if (!text) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Faro no pudo explicar el reparto. Intenta de nuevo.' })
      return { text, disclaimer: DISCLAIMER }
    }),
})

const DISCLAIMER =
  'Antes de mover un guaraní entre empresas, Tax & Accounting (Andrea) y Legal (Diego) deben validar la estructura: los cargos intercompany en Paraguay tocan precios de transferencia e IVA, y un fee de administración mal documentado es una contingencia fiscal.'
