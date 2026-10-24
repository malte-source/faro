import { z } from 'zod'

/**
 * Zod schemas for what Gemini is asked to return at each AI call site.
 *
 * They are deliberately forgiving about SHAPE DETAILS the UI already
 * tolerates (a missing optional field becomes null, an unknown priority
 * becomes 'medium', a malformed date becomes null) and strict about what
 * would break the feature (not an object, no title). A reply that fails
 * here throws `AiJsonError` from `parseAiJson`, and each caller keeps its
 * existing deterministic fallback or error message.
 */

const PRIORITIES = ['very_high', 'high', 'medium', 'low', 'very_low'] as const
export type AiPriority = (typeof PRIORITIES)[number]

const priority = z.enum(PRIORITIES).catch('medium')
const nullableText = z.string().nullish().transform(v => (v && v.trim() ? v : null))
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish()
  .transform(v => v ?? null)
  .catch(null)

/** Shared by quick-add (text), audio and image extraction. */
export const parsedTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  projectCode: nullableText,
  priority,
  dueDate: isoDate,
  assigneeName: nullableText,
  description: nullableText,
})
export type ParsedTask = z.infer<typeof parsedTaskSchema>

export const parsedAudioTaskSchema = parsedTaskSchema.extend({ transcript: z.string().catch('') })
export const parsedImageTaskSchema = parsedTaskSchema.extend({ extracted_text: z.string().catch('') })

const meetingItem = z.object({
  title: z.string().trim().min(1),
  description: nullableText,
  project_id: nullableText,
  assignee_id: nullableText,
  priority,
  due_date: isoDate,
  confidence: z.enum(['high', 'medium', 'low']).catch('medium'),
})
export type MeetingTask = z.infer<typeof meetingItem>

/** An array where each bad item is dropped instead of failing the whole extraction. */
export const meetingTasksSchema = z.array(z.unknown()).transform(items =>
  items.flatMap(item => {
    const r = meetingItem.safeParse(item)
    return r.success ? [r.data] : []
  }),
)

export const nextSuggestionSchema = z.object({
  summary: z.string().catch(''),
  ranked: z.array(z.object({ taskId: z.string(), reason: z.string().catch('') })).catch([]),
})

const textList = (max: number) =>
  z
    .array(z.unknown())
    .catch([])
    .transform(a => a.slice(0, max).map(String))
const clipped = (max: number) => z.unknown().transform(v => String(v ?? '').slice(0, max))

export const taskCommentsSummarySchema = z.object({
  tldr: clipped(800),
  decisions: textList(10),
  open_questions: textList(10),
  next_steps: textList(10),
})

export const projectWeekSummarySchema = z.object({
  headline: clipped(400),
  highlights: textList(6),
  risks: textList(6),
  next_week: textList(6),
})

export const projectUpdateDraftSchema = z.object({
  content: clipped(5000),
  suggested_sentiment: z.string().catch('neutral'),
})

export const weeklyDigestSchema = z.object({
  headline: z.string().nullish(),
  highlights: textList(5),
  risks: textList(5),
  asks: textList(5),
  next_week_focus: z.string().nullish(),
})

export const projectInsightSchema = z.object({
  summary: z.string().catch(''),
  status_assessment: z.string().catch(''),
  risks: textList(8),
  recommendations: textList(8),
  next_steps: textList(8),
})
