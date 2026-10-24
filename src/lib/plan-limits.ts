/**
 * Plan-based feature gates.
 *
 * Single source of truth for "what can this plan do?". Used by both the server
 * (to throw FORBIDDEN) and the client (to dim/replace buttons with upsell).
 *
 * Tier matrix:
 *   - free       (personal workspace): the personal individual tier
 *   - team       (paid, default team plan)
 *   - team_plus  (paid, future tier with SSO/audit/etc.)
 *   - business   (legacy TPY plan — treat as team_plus equivalent)
 *   - enterprise (custom)
 *
 * When in doubt, gate ONLY at the entry point (the router procedure) so the
 * rule is enforced regardless of how the UI is reached. The client side is a
 * UX improvement, not a security boundary.
 */

import { TRPCError } from '@trpc/server'

export type Plan = 'free' | 'team' | 'team_plus' | 'business' | 'enterprise'

interface PlanLimits {
  /** Hard cap on active project count. null = unlimited. */
  maxProjects: number | null
  /** Hard cap on team members (org_memberships rows). null = unlimited. */
  maxMembers: number | null
  /** AI features: parseMeetingNotes, summarize, generateDraft. */
  ai: boolean
  /** Automations engine. */
  automations: boolean
  /** Public intake forms. */
  forms: boolean
  /** Capability share links. */
  shareLinks: boolean
  /** Inbound email-to-task. */
  inboundEmail: boolean
  /** Goals / OKRs. */
  goals: boolean
}

const FREE: PlanLimits = {
  maxProjects: 5,
  maxMembers: 1,
  ai: false,
  automations: false,
  forms: false,
  shareLinks: false,    // free can share 1 — handled inline
  inboundEmail: false,
  goals: false,
}

const TEAM: PlanLimits = {
  maxProjects: null,
  maxMembers: 30,
  ai: true,
  automations: true,
  forms: true,
  shareLinks: true,
  inboundEmail: true,
  goals: true,
}

const TEAM_PLUS: PlanLimits = {
  ...TEAM,
  maxMembers: null,
}

const PLANS: Record<Plan, PlanLimits> = {
  free: FREE,
  team: TEAM,
  team_plus: TEAM_PLUS,
  business: TEAM_PLUS,    // legacy alias — TPY's existing plan
  enterprise: TEAM_PLUS,
}

export function limitsFor(plan: Plan | string | null | undefined): PlanLimits {
  if (!plan) return FREE
  return PLANS[plan as Plan] ?? FREE
}

/**
 * Throw FORBIDDEN with an upgrade message if the feature isn't in the plan.
 * The thrown message is what the client shows on screen, so phrase it as
 * "buy the upgrade" not "no permission" — different problem.
 */
export function requireFeature(
  plan: Plan | string | null | undefined,
  feature: keyof Omit<PlanLimits, 'maxProjects' | 'maxMembers'>,
  featureLabel: string,
) {
  const limits = limitsFor(plan)
  if (!limits[feature]) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `${featureLabel} requiere un plan de equipo. Crea un workspace de Equipo para habilitarlo.`,
    })
  }
}
