import { createTRPCRouter } from '@/lib/trpc/server'
import { projectsRouter } from './projects'
import { tasksRouter } from './tasks'
import { teamRouter } from './team'
import { auditRouter } from './audit'
import { searchRouter } from './search'
import { notificationsRouter } from './notifications'

export const appRouter = createTRPCRouter({
  projects: projectsRouter,
  tasks: tasksRouter,
  team: teamRouter,
  audit: auditRouter,
  search: searchRouter,
  notifications: notificationsRouter,
})

export type AppRouter = typeof appRouter
