import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

/*
 * Faro typography — Archivo (display, tight tracking), IBM Plex Sans (body,
 * warm humanist grot), IBM Plex Mono (data, kbd, IDs). Geist removed.
 *
 * All three come through next/font/google with a CSS variable so Tailwind
 * v4's @theme inline in globals.css can map them to `--font-sans`,
 * `--font-display`, `--font-mono` classes.
 */
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-archivo",
  display: "swap",
});
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Faro — Gestión de Proyectos",
  description:
    "Gestión de proyectos en español para equipos que trabajan con Google Workspace.",
  applicationName: "Faro",
  appleWebApp: {
    capable: true,
    // black-translucent overlays the status bar on the Noche splash instead
    // of cutting it with a white bar, so the splash feels seamless.
    statusBarStyle: "black-translucent",
    title: "Faro",
    startupImage: [
      { url: "/icons/icon-512.png" },
    ],
  },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    title: "Faro",
    description: "Luz sobre el proyecto.",
  },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    shortcut: "/icons/icon-192.png",
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  // Mist in light mode, Noche in dark — status-bar/UI chrome colour on mobile.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F4EF" },
    { media: "(prefers-color-scheme: dark)", color: "#0A1A26" },
  ],
  width: "device-width",
  initialScale: 1,
  // Draw under the notch / home indicator; the chrome pads with env(safe-area-inset-*).
  viewportFit: "cover",
  // The on-screen keyboard shrinks the layout viewport (composers stay above it).
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable} h-full`}
    >
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        {/* mask-icon uses Señal so the Safari pinned-tab silhouette lights up */}
        <link rel="mask-icon" href="/icons/icon.svg" color="#FFB020" />
      </head>
      <body className="min-h-full bg-background text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
