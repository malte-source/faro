import { createTRPCRouter } from '@/lib/trpc/server'
import { projectsRouter } from './projects'
import { tasksRouter } from './tasks'
import { teamRouter } from './team'
import { auditRouter } from './audit'

export const appRouter = createTRPCRouter({
  projects: projectsRouter,
  tasks: tasksRouter,
  team: teamRouter,
  audit: auditRouter,
})

export type AppRouter = typeof appRouter
