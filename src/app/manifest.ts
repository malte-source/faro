import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Faro — Gestión de Proyectos',
    short_name: 'Faro',
    description: 'Navigate your projects with clarity.',
    start_url: '/dashboard',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#4f46e5',
    categories: ['productivity', 'business'],
    icons: [
      {
        src: '/icons/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        // @ts-expect-error — 'purpose' not in Next.js types but valid in spec
        purpose: 'any maskable',
      },
      { src: '/icons/icon-72.png',  sizes: '72x72',   type: 'image/png' },
      { src: '/icons/icon-96.png',  sizes: '96x96',   type: 'image/png' },
      { src: '/icons/icon-128.png', sizes: '128x128', type: 'image/png' },
      { src: '/icons/icon-144.png', sizes: '144x144', type: 'image/png' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-384.png', sizes: '384x384', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
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
