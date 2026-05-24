import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    // 'id' is required for Chrome to use the modern WebAPK minting service,
    // which generates APKs with current targetSdkVersion (avoids Play Protect warning).
    id: '/',
    name: 'Faro — Gestión de Proyectos',
    short_name: 'Faro',
    description: 'Navigate your projects with clarity.',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f172a',
    theme_color: '#4f46e5',
    categories: ['productivity', 'business'],
    prefer_related_applications: false,
    icons: [
      // SVG must NOT have 'maskable' purpose — keep as 'any' only
      {
        src: '/icons/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      { src: '/icons/icon-72.png',  sizes: '72x72',   type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-96.png',  sizes: '96x96',   type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-128.png', sizes: '128x128', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-144.png', sizes: '144x144', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-384.png', sizes: '384x384', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Dedicated maskable entry (512px required for Play Protect compliance)
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: 'Proyectos',
        short_name: 'Proyectos',
        description: 'Ver todos los proyectos',
        url: '/dashboard/projects',
        icons: [{ src: '/icons/icon-96.png', sizes: '96x96' }],
      },
      {
        name: 'Tareas',
        short_name: 'Tareas',
        description: 'Ver mis tareas',
        url: '/dashboard/tasks?view=mine',
        icons: [{ src: '/icons/icon-96.png', sizes: '96x96' }],
      },
    ],
  }
}
