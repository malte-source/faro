import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'

export const teamRouter = createTRPCRouter({
  members: protectedProcedure.query(async ({ ctx }) => {
    const { data: me } = await ctx.supabase
      .from('users')
      .select('org_id')
      .eq('email', ctx.session.user.email!)
      .single()

    if (!me) return []

    const { data, error } = await ctx.supabase
      .from('users')
      .select(`
        *,
        department:departments(id, name, color),
        project_memberships:project_members(
          id, role,
          project:projects(id, code, name, status)
        )
      `)
      .eq('org_id', me.org_id)
      .eq('is_active', true)
      .order('name')

    if (error) throw error
    return data
  }),

  invite: protectedProcedure
    .input(z.object({
      email: z.string().email(),
      name: z.string().min(1),
      role: z.enum(['admin', 'manager', 'member', 'viewer']).default('member'),
      departmentId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { data: me } = await ctx.supabase
        .from('users')
        .select('org_id')
        .eq('email', ctx.session.user.email!)
        .single()

      if (!me) throw new Error('User not found')

      const { data, error } = await ctx.supabase
        .from('users')
        .insert({
          org_id: me.org_id,
          email: input.email,
          name: input.name,
          role: input.role,
          department_id: input.departmentId,
          is_active: false,
        })
        .select()
        .single()

      if (error) throw error
      return data
    }),

  departments: protectedProcedure.query(async ({ ctx }) => {
    const { data: me } = await ctx.supabase
      .from('users')
      .select('org_id')
      .eq('email', ctx.session.user.email!)
      .single()

    if (!me) return []

    const { data, error } = await ctx.supabase
      .from('departments')
      .select(`*, head:users!departments_head_user_id_fkey(id, name, avatar_url)`)
      .eq('org_id', me.org_id)
      .order('name')

    if (error) throw error
    return data
  }),

  updateMember: protectedProcedure
    .input(z.object({
      userId: z.string(),
      name: z.string().min(1).optional(),
      role: z.enum(['admin', 'manager', 'member', 'viewer']).optional(),
      departmentId: z.string().nullable().optional(),
      position: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { userId, ...fields } = input
      const { data, error } = await ctx.supabase
        .from('users')
        .update({
          ...(fields.name && { name: fields.name }),
          ...(fields.role && { role: fields.role }),
          ...(fields.departmentId !== undefined && { department_id: fields.departmentId }),
          ...(fields.position !== undefined && { position: fields.position }),
        })
        .eq('id', userId)
        .select()
        .single()
      if (error) throw error
      return data
    }),

  deactivateMember: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from('users').update({ is_active: false }).eq('id', input.userId)
      if (error) throw error
      return { success: true }
    }),

  workload: protectedProcedure.query(async ({ ctx }) => {
    const { data: me } = await ctx.supabase
      .from('users')
      .select('org_id')
      .eq('email', ctx.session.user.email!)
      .single()

    if (!me) return []

    const { data } = await ctx.supabase
      .from('users')
      .select(`
        id, name, avatar_url,
        project_members(
          role,
          project:projects(id, code, name, status, end_date, progress_pct)
        )
      `)
      .eq('org_id', me.org_id)
      .eq('is_active', true)

    return data?.map(user => ({
      ...user,
      activeProjects: user.project_members?.filter(
        (pm: { project: { status: string } }) => pm.project?.status === 'in_progress'
      ).length ?? 0,
    })) ?? []
  }),
})
