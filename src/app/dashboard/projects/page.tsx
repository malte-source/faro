import { Header } from '@/components/layout/header'
import { ProjectsList } from '@/components/projects/projects-list'
import { ExportProjectsButton } from '@/components/projects/export-projects-button'
import Link from 'next/link'
import { Plus } from 'lucide-react'

export default function ProjectsPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header
        title="Proyectos"
        description="Portafolio completo de proyectos"
        actions={
          <>
            <Link
              href="/dashboard/projects/new"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-signal px-4 text-[13px] font-bold text-night active:opacity-90 md:hidden"
            >
              <Plus className="h-4 w-4" strokeWidth={2.6} /> Nuevo
            </Link>
            <ExportProjectsButton />
          </>
        }
      />
      <div className="flex-1 overflow-y-auto px-4 py-3 md:px-6 md:py-6">
        <ProjectsList />
      </div>
    </div>
  )
}
