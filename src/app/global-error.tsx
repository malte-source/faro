'use client'

import { useEffect } from 'react'

/**
 * Last-resort boundary: it replaces the ROOT layout, so none of the app's CSS,
 * fonts or providers are loaded here. Everything is therefore inline-styled
 * (Noche/Señal, light and dark via prefers-color-scheme) and uses system fonts.
 * No message or stack is shown — only the opaque server `digest`.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[global error]', { digest: error.digest, name: error.name, message: error.message })
  }, [error])

  return (
    <html lang="es">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>Faro — algo salió mal</title>
        <style>{`
          :root { color-scheme: light dark; --bg:#F7F4EF; --fg:#0A1A26; --muted:#55636B; --line:#E0D9CE; }
          @media (prefers-color-scheme: dark) { :root { --bg:#0A1A26; --fg:#F7F4EF; --muted:#9DB0BC; --line:#1E3A4C; } }
          html, body { margin:0; background:var(--bg); color:var(--fg); }
          body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
          .wrap { min-height:100dvh; display:flex; align-items:center; justify-content:center; padding:max(48px, env(safe-area-inset-top)) 24px max(48px, env(safe-area-inset-bottom)); box-sizing:border-box; }
          .card { width:100%; max-width:384px; text-align:center; }
          .mark { width:44px; height:44px; margin:0 auto; border-radius:12px; background:#0A1A26; display:flex; align-items:center; justify-content:center; border:1px solid var(--line); }
          .dot { width:14px; height:14px; border-radius:999px; background:#FFB020; }
          h1 { margin:24px 0 0; font-size:24px; font-weight:800; letter-spacing:-0.03em; }
          p { margin:8px 0 0; font-size:15px; line-height:1.55; color:var(--muted); }
          .code { margin-top:16px; font-family: ui-monospace, Menlo, monospace; font-size:11px; letter-spacing:.12em; text-transform:uppercase; }
          .actions { margin-top:32px; display:flex; flex-direction:column; gap:8px; }
          .primary { height:48px; border:0; border-radius:12px; background:#FFB020; color:#0A1A26; font-size:15px; font-weight:600; cursor:pointer; }
          .primary:focus-visible, .secondary:focus-visible { outline:2px solid #FFB020; outline-offset:2px; }
          .secondary { height:44px; display:flex; align-items:center; justify-content:center; border-radius:12px; color:var(--muted); font-size:14px; font-weight:500; text-decoration:none; }
        `}</style>
      </head>
      <body>
        <div className="wrap" role="alert">
          <div className="card">
            <div className="mark" aria-hidden><span className="dot" /></div>
            <h1>Faro no pudo arrancar</h1>
            <p>No se perdió nada de lo que ya estaba guardado. Intenta de nuevo; si vuelve a pasar, envíanos el código de abajo.</p>
            {error.digest && <p className="code">Código {error.digest}</p>}
            <div className="actions">
              <button type="button" className="primary" onClick={reset}>Intentar de nuevo</button>
              {/* Plain <a> on purpose: this boundary replaces the root layout, so there is no router context for <Link>. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a className="secondary" href="/">Volver al inicio</a>
            </div>
          </div>
        </div>
      </body>
    </html>
  )
}
