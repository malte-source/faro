/**
 * Centralized invalidation helpers.
 *
 * Problem: when a mutation creates/updates/deletes something, the related list
 * queries (Mi día, Prioridades, Tareas, Proyectos, stats, etc.) need to refetch
 * to show the change. Doing this per-component leads to "forgot to invalidate X"
 * bugs — the user makes a change and has to leave + reopen to see it.
 *
 * Fix: instead of cherry-picking which queries to invalidate, just nuke the
 * whole router. `utils.tasks.invalidate()` with no args invalidates EVERY
 * query under the tasks router — slightly more refetch work than strictly
 * needed, but for an 8-30 person org it's a fine trade for guaranteed freshness.
 *
 * Usage:
 *   const invalidate = useInvalidator()
 *   const create = trpc.tasks.create.useMutation({ onSuccess: invalidate.tasks })
 *   const update = trpc.projects.update.useMutation({ onSuccess: invalidate.projects })
 */

import { trpc } from './client'

export function useInvalidator() {
  const utils = trpc.useUtils()
  return {
    /** Invalidate everything that depends on tasks data — covers list, byProject,
     *  myDay, priorityFeed, stats, etc. Use after any task create/update/delete. */
    tasks: () => {
      void utils.tasks.invalidate()
      void utils.inbox.invalidate()
      // Projects rollup depends on task counts (health score, progress)
      void utils.projects.invalidate()
    },
    /** Invalidate everything project-related — covers list, byId, etc. */
    projects: () => {
      void utils.projects.invalidate()
    },
    /** Both — useful for actions that touch both (e.g. delete project deletes tasks too). */
    all: () => {
      void utils.tasks.invalidate()
      void utils.projects.invalidate()
    },
    /** Sprints */
    sprints: () => {
      void utils.sprints.invalidate()
      void utils.tasks.invalidate()  // tasks rollup may include sprint assignment
    },
    /** Decisions */
    decisions: () => {
      void utils.decisions.invalidate()
    },
    /** Comments — invalidate task comments + activity feed */
    comments: () => {
      void utils.comments.invalidate()
      void utils.notifications.invalidate()
    },
    /** Time entries */
    time: () => {
      void utils.time.invalidate()
      void utils.tasks.invalidate()  // actual_hours rolls up
    },
  }
}
