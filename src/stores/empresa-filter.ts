import { create } from 'zustand'

/**
 * Empresa filter ("Todo" + one chip per empresa). Pure UI state — it filters
 * Hoy, Proyectos and Personas and never changes the account or the grupo.
 * `null` means "Todo".
 */
interface EmpresaFilterState {
  workspaceId: string | null
  setWorkspaceId: (id: string | null) => void
}

export const useEmpresaFilter = create<EmpresaFilterState>(set => ({
  workspaceId: null,
  setWorkspaceId: id => set({ workspaceId: id }),
}))
