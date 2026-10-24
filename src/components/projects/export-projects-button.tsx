'use client'

import { trpc } from '@/lib/trpc/client'
import { ExportCsvButton } from '@/components/common/export-csv-button'

/** Header action — fetches flattened project rows on click and triggers CSV download. */
export function ExportProjectsButton() {
  const utils = trpc.useUtils()
  return (
    <ExportCsvButton
      filenamePrefix="faro-proyectos"
      fetchRows={() => utils.projects.exportRows.fetch()}
    />
  )
}
