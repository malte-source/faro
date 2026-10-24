import { ErrorScreen } from '@/components/common/error-screen'

/** 404 — a page that does not exist (or a link to something you can no longer see). */
export default function NotFound() {
  return (
    <ErrorScreen
      title="No encontramos esa página"
      description="Puede que el enlace esté incompleto o que ya no tengas acceso a ese contenido."
      homeHref="/dashboard"
    />
  )
}
