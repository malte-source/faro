import { createTRPCRouter } from '@/lib/trpc/server'
import { projectsRouter } from './projects'
import { tasksRouter } from './tasks'
import { teamRouter } from './team'

export const appRouter = createTRPCRouter({
  projects: projectsRouter,
  tasks: tasksRouter,
  team: teamRouter,
})

export type AppRouter = typeof appRouter
