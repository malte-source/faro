import { ProjectDetail } from '@/components/projects/project-detail'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ProjectPage({ params }: Props) {
  const { id } = await params
  return <ProjectDetail id={id} />
}
