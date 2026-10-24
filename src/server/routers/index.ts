import { createTRPCRouter } from '@/lib/trpc/server'
import { projectsRouter } from './projects'
import { tasksRouter } from './tasks'
import { teamRouter } from './team'
import { auditRouter } from './audit'
import { searchRouter } from './search'
import { notificationsRouter } from './notifications'
import { emailPrefsRouter } from './email-prefs'
import { commentsRouter } from './comments'
import { decisionsRouter } from './decisions'
import { aiChatRouter } from './ai-chat'
import { digestsRouter } from './digests'
import { chatNotificationsRouter } from './chat-notifications'
import { recurringRouter } from './recurring'
import { attachmentsRouter } from './attachments'
import { templatesRouter } from './templates'
import { timeRouter } from './time'
import { sprintsRouter } from './sprints'
import { sheetImportRouter } from './sheet-import'
import { workspacesRouter } from './workspaces'
import { automationsRouter } from './automations'
import { calendarRouter } from './calendar'
import { goalsRouter } from './goals'
import { formsRouter } from './forms'
import { shareRouter } from './share'
import { aiSummarizeRouter } from './ai-summarize'
import { projectUpdatesRouter } from './project-updates'
import { orgsRouter } from './orgs'
import { membershipRouter } from './membership'
import { inboxRouter } from './inbox'
import { groupRouter } from './group'
import { quickAddRouter } from './quick-add'
import { chatRouter } from './chat'
import { documentsRouter } from './documents'
import { captureRouter } from './capture'
import { costosRouter } from './costos'
import { aiUsageRouter } from './ai-usage'

export const appRouter = createTRPCRouter({
  projects: projectsRouter,
  tasks: tasksRouter,
  team: teamRouter,
  audit: auditRouter,
  search: searchRouter,
  notifications: notificationsRouter,
  emailPrefs: emailPrefsRouter,
  comments: commentsRouter,
  decisions: decisionsRouter,
  aiChat: aiChatRouter,
  digests: digestsRouter,
  chatNotifications: chatNotificationsRouter,
  recurring: recurringRouter,
  attachments: attachmentsRouter,
  templates: templatesRouter,
  time: timeRouter,
  sprints: sprintsRouter,
  sheetImport: sheetImportRouter,
  workspaces: workspacesRouter,
  automations: automationsRouter,
  calendar: calendarRouter,
  goals: goalsRouter,
  forms: formsRouter,
  share: shareRouter,
  aiSummarize: aiSummarizeRouter,
  projectUpdates: projectUpdatesRouter,
  orgs: orgsRouter,
  membership: membershipRouter,
  inbox: inboxRouter,
  group: groupRouter,
  quickAdd: quickAddRouter,
  chat: chatRouter,
  documents: documentsRouter,
  capture: captureRouter,
  costos: costosRouter,
  aiUsage: aiUsageRouter,
})

export type AppRouter = typeof appRouter
