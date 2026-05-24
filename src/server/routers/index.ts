import { createTRPCRouter } from '@/lib/trpc/server'
import { projectsRouter } from './projects'
import { tasksRouter } from './tasks'
import { teamRouter } from './team'
import { auditRouter } from './audit'
import { searchRouter } from './search'
import { notificationsRouter } from './notifications'
import { commentsRouter } from './comments'

export const appRouter = createTRPCRouter({
  projects: projectsRouter,
  tasks: tasksRouter,
  team: teamRouter,
  audit: auditRouter,
  search: searchRouter,
  notifications: notificationsRouter,
  comments: commentsRouter,
})

export type AppRouter = typeof appRouter
