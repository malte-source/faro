import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import { createDriveFolder } from '@/lib/google-drive'

/**
 * Task attachments — files uploaded to a project's Drive folder, tagged to
 * a specific task.
 *
 * Upload flow:
 *   1. Client calls `attachments.prepareUpload({taskId})`
 *      → server ensures the project has a linked Drive folder (creates one
 *        if missing) and returns { folderId, accessToken }
 *   2. Client uploads the file DIRECTLY to Drive using multipart upload —
 *      we don't proxy file bytes through tRPC because that's wasteful
 *      (every megabyte transits Cloud Run twice)
 *   3. Client calls `attachments.register({...metadata})` with the resulting
 *      drive_file_id and metadata
 *
 * IDOR guard everywhere via ctx.projectIds.
 */
export const attachmentsRouter = createTRPCRouter({
  listByTask: protectedProcedure
    .input(z.string())
    .query(async ({ ctx, input: taskId }) => {
      // Verify task is in our org via its project.
      const { data: task } = await ctx.supabase
        .from('tasks')
        .select('project_id')
        .eq('id', taskId)
        .single()
      if (!task || !ctx.projectIds.includes(task.project_id)) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }
      const { data, error } = await ctx.supabase
        .from('task_attachments')
        .select('*, uploader:users!task_attachments_uploaded_by_fkey(id, name, avatar_url)')
        .eq('task_id', taskId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    }),

  /**
   * Ensure the task's project has a Drive folder and return the access
   * token + folder id so the client can upload directly to Drive.
   */
  prepareUpload: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const accessToken = ctx.session.accessToken
      if (!accessToken) throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Sin token de Google. Por favor reloguéate.',
      })

      const { data: task } = await ctx.supabase
        .from('tasks')
        .select('project_id, title, project:projects(google_drive_folder_id, code, name)')
        .eq('id', input.taskId)
        .single()
      if (!task || !ctx.projectIds.includes(task.project_id)) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }

      type ProjInfo = { google_drive_folder_id: string | null; code: string; name: string }
      const proj = task.project as ProjInfo | null
      if (!proj) throw new TRPCError({ code: 'NOT_FOUND' })

      // Auto-create the project's Drive folder if it's not yet linked.
      let folderId = proj.google_drive_folder_id
      if (!folderId) {
        const folder = await createDriveFolder(accessToken, `FARO · ${proj.code} ${proj.name}`)
        await ctx.supabase
          .from('projects')
          .update({ google_drive_folder_id: folder.id })
          .eq('id', task.project_id)
        folderId = folder.id
      }

      return { folderId, accessToken }
    }),

  register: protectedProcedure
    .input(z.object({
      taskId: z.string(),
      driveFileId: z.string(),
      fileName: z.string(),
      mimeType: z.string().optional(),
      sizeBytes: z.number().optional(),
      webViewLink: z.string(),
      iconLink: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { data: task } = await ctx.supabase
        .from('tasks')
        .select('project_id')
        .eq('id', input.taskId)
        .single()
      if (!task || !ctx.projectIds.includes(task.project_id)) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }

      const { data, error } = await ctx.supabase
        .from('task_attachments')
        .insert({
          task_id: input.taskId,
          drive_file_id: input.driveFileId,
          file_name: input.fileName,
          mime_type: input.mimeType ?? null,
          size_bytes: input.sizeBytes ?? null,
          web_view_link: input.webViewLink,
          icon_link: input.iconLink ?? null,
          uploaded_by: ctx.me.id,
        })
        .select('*, uploader:users!task_attachments_uploaded_by_fkey(id, name, avatar_url)')
        .single()
      if (error) throw error
      return data
    }),

  delete: protectedProcedure
    .input(z.string())
    .mutation(async ({ ctx, input: id }) => {
      // IDOR: pull the attachment + its task's project to verify ownership.
      const { data: row } = await ctx.supabase
        .from('task_attachments')
        .select('task:tasks(project_id)')
        .eq('id', id)
        .single()
      const projectId = (row?.task as { project_id?: string } | null)?.project_id
      if (!projectId || !ctx.projectIds.includes(projectId)) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }
      // We delete the DB record only — leaving the file in Drive is the
      // safe default (user can clean it up manually if they want).
      const { error } = await ctx.supabase.from('task_attachments').delete().eq('id', id)
      if (error) throw error
      return { success: true }
    }),
})
