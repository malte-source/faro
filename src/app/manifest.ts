import type { MetadataRoute } from 'next'

/**
 * PWA manifest.
 *
 * Bumping the `id` (`?pwa=v7`) forces Android/Chrome to treat the next install
 * as a NEW PWA — only reliable way to refresh the OS-level icon cache and
 * have new shortcuts / new artwork show up after a manifest change.
 *
 * v7 changes: brand overhaul — new lighthouse symbol (Noche + Señal), name
 * cased "Faro" (was "FARO"), description in neutral Spanish, tagline "Luz
 * sobre el proyecto." Icons bumped to ?v=10 to bust OS-level icon cache.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/?pwa=v7',
    name: 'Faro — Gestión de Proyectos',
    short_name: 'Faro',
    description:
      'Gestión de proyectos en español para equipos que trabajan con Google Workspace. Luz sobre el proyecto.',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    // Prefer Window-Controls-Overlay on desktop (Chrome/Edge) for more vertical
    // space; fall back to standard standalone on Android/iOS.
    display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
    orientation: 'portrait',
    // Faro brand — Noche background, Señal accent
    background_color: '#0A1A26',
    theme_color: '#0A1A26',
    categories: ['productivity', 'business'],
    lang: 'es-AR',
    dir: 'ltr',
    prefer_related_applications: false,
    // Focus existing window instead of spawning duplicates when the user
    // clicks an OS launcher / shortcut while FARO is already running.
    launch_handler: { client_mode: ['focus-existing', 'auto'] },

    icons: [
      // SVG must NOT have 'maskable' purpose — keep as 'any' only.
      { src: '/icons/icon.svg?v=10',           sizes: 'any',     type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/icon-72.png?v=10',        sizes: '72x72',   type: 'image/png',     purpose: 'any' },
      { src: '/icons/icon-96.png?v=10',        sizes: '96x96',   type: 'image/png',     purpose: 'any' },
      { src: '/icons/icon-128.png?v=10',       sizes: '128x128', type: 'image/png',     purpose: 'any' },
      { src: '/icons/icon-144.png?v=10',       sizes: '144x144', type: 'image/png',     purpose: 'any' },
      { src: '/icons/icon-192.png?v=10',       sizes: '192x192', type: 'image/png',     purpose: 'any' },
      { src: '/icons/icon-384.png?v=10',       sizes: '384x384', type: 'image/png',     purpose: 'any' },
      { src: '/icons/icon-512.png?v=10',       sizes: '512x512', type: 'image/png',     purpose: 'any' },
      // Maskable variants — circular logo on a solid navy square so the OS
      // adaptive-icon mask (circle/squircle) never reveals white/grey corners.
      { src: '/icons/icon-maskable-192.png?v=10', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png?v=10', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],

    // App launcher shortcuts (long-press the icon on Android / right-click on
    // desktop). The OS shows up to 4 — order them by daily-frequency. We
    // surface Mi día + Semana + Mes + Tareas to make FARO compete with native
    // calendar apps as the daily driver, given Sprint 3 added /week + /month.
    shortcuts: [
      {
        name: 'Mi día',
        short_name: 'Mi día',
        description: 'Lo que tengo que hacer hoy',
        url: '/dashboard/today',
        icons: [{ src: '/icons/icon-96.png?v=10', sizes: '96x96' }],
      },
      {
        name: 'Semana',
        short_name: 'Semana',
        description: 'Distribución semanal de tus tareas',
        url: '/dashboard/week',
        icons: [{ src: '/icons/icon-96.png?v=10', sizes: '96x96' }],
      },
      {
        name: 'Mes',
        short_name: 'Mes',
        description: 'Grilla mensual de tareas con fecha',
        url: '/dashboard/month',
        icons: [{ src: '/icons/icon-96.png?v=10', sizes: '96x96' }],
      },
      {
        name: 'Tareas',
        short_name: 'Tareas',
        description: 'Vista global de tareas',
        url: '/dashboard/tasks',
        icons: [{ src: '/icons/icon-96.png?v=10', sizes: '96x96' }],
      },
    ],

    // "Compartir → Faro" from any Android app: text, links, voice notes, photos and
    // video go straight to Captura (POST multipart; the route creates the capture and
    // redirects to the review screen). Android Chrome only: iOS has no share_target.
    // Changing share_target does not need a new `id`: installed apps pick it up when
    // Chrome refreshes the manifest (within about a day).
    share_target: {
      action: '/dashboard/capturar/compartir',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: {
        title: 'title',
        text: 'text',
        url: 'url',
        files: [{ name: 'media', accept: ['audio/*', 'image/*', 'video/*'] }],
      },
    },

    // Screenshots show in the Android install dialog (since Chrome 102) and
    // make the prompt feel like a real app store listing.  Form factor 'wide'
    // is for tablets/desktop, 'narrow' for phones.
    screenshots: [
      {
        src: '/icons/icon-512.png?v=10',
        sizes: '512x512',
        type: 'image/png',
        form_factor: 'narrow',
        label: 'Faro — Dashboard',
      },
    ],
  }
}
