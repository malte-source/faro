'use client'

import { trpc } from '@/lib/trpc/client'
import { ExportCsvButton } from '@/components/common/export-csv-button'

/** Header action — fetches flattened task rows on click and triggers CSV download. */
export function ExportTasksButton() {
  const utils = trpc.useUtils()
  return (
    <ExportCsvButton
      filenamePrefix="faro-tareas"
      fetchRows={() => utils.tasks.exportRows.fetch()}
    />
  )
}
