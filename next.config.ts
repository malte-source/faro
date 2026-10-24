import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
  fallbacks: {
    document: "/offline",
  },
  // Bumping the cache id forces all clients to discard old SW caches on next
  // load. Bump when the runtime-caching strategy changes meaningfully so
  // returning users don't get stuck on stale assets.
  cacheStartUrl: true,
  dynamicStartUrl: true,
  workboxOptions: {
    disableDevLogs: true,
    cleanupOutdatedCaches: true,                  // delete v1/v2 caches from old SW versions
    skipWaiting: true,                            // new SW activates immediately
    clientsClaim: true,                           // and takes control of open tabs
    runtimeCaching: [
      {
        // Google Fonts — CacheFirst (immutable, long-lived)
        urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
        handler: "CacheFirst",
        options: {
          cacheName: "google-fonts-v2",
          expiration: { maxEntries: 8, maxAgeSeconds: 365 * 24 * 60 * 60 },
        },
      },
      {
        // Google avatars (lh3.googleusercontent.com) — StaleWhileRevalidate
        urlPattern: /^https:\/\/lh3\.googleusercontent\.com\/.*/i,
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "google-avatars-v1",
          expiration: { maxEntries: 64, maxAgeSeconds: 7 * 24 * 60 * 60 },
        },
      },
      {
        // Static images — CacheFirst
        urlPattern: /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
        handler: "CacheFirst",
        options: {
          cacheName: "static-images-v2",
          expiration: { maxEntries: 128, maxAgeSeconds: 30 * 24 * 60 * 60 },
        },
      },
      {
        // tRPC (GET queries) — NetworkOnly. These responses are private, per-user data
        // (tasks, chat, people, costs): they used to be cached for 2 minutes and survived
        // sign-out, so on a shared device the next person could be served the previous
        // user's data. They are never stored now. (The old `trpc-api-v2` cache is never
        // read any more; sign-out also wipes it — see src/lib/sign-out.ts.)
        urlPattern: /\/api\/trpc\/.*/i,
        handler: "NetworkOnly",
      },
      {
        // Next.js hashed assets — CacheFirst (filenames change on rebuild)
        urlPattern: /\/_next\/static\/.*/i,
        handler: "CacheFirst",
        options: {
          cacheName: "next-static-v2",
          expiration: { maxEntries: 512, maxAgeSeconds: 30 * 24 * 60 * 60 },
        },
      },
      {
        // Dashboard pages — NetworkFirst. They were StaleWhileRevalidate, which showed the
        // PREVIOUS deploy's page on first open after every release (the app looked 'not updated').
        // Network first with a short timeout keeps updates immediate and still falls back to the
        // cached copy when offline or on a slow connection. These are authenticated pages, so
        // the offline copy is deliberately short-lived (1 h, 16 entries) and is wiped on
        // sign-out (src/lib/sign-out.ts). v3 drops the old stale 24 h cache.
        urlPattern: /\/dashboard(\/.*)?$/i,
        handler: "NetworkFirst",
        options: {
          cacheName: "dashboard-pages-v3",
          networkTimeoutSeconds: 4,
          expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 },
        },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
  experimental: {
    serverActions: {
      allowedOrigins: [
        "localhost:3000",
        "faro-app-han7ftrrca-rj.a.run.app",
      ],
    },
  },
};

export default withPWA(nextConfig);
