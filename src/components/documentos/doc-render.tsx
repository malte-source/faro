'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { escapeHtml, renderMarkdown } from '@/components/documentos/markdown'

/** Typography for rendered Markdown, expressed as child selectors so no global CSS is needed. */
const PROSE = [
  'text-sm leading-relaxed text-ink-body dark:text-stone',
  '[&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:font-display [&_h1]:text-2xl [&_h1]:font-extrabold [&_h1]:tracking-[-0.02em] [&_h1]:text-night dark:[&_h1]:text-mist',
  '[&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-bold [&_h2]:tracking-[-0.01em] [&_h2]:text-night dark:[&_h2]:text-mist',
  '[&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-night dark:[&_h3]:text-mist',
  '[&_h4]:mb-1 [&_h4]:mt-3 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-night dark:[&_h4]:text-mist',
  '[&_p]:my-2',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-0.5 [&_li>ul]:my-0.5 [&_li>ol]:my-0.5',
  '[&_blockquote]:my-3 [&_blockquote]:rounded-r-lg [&_blockquote]:border-l-4 [&_blockquote]:border-signal [&_blockquote]:bg-signal-wash [&_blockquote]:px-3 [&_blockquote]:py-1 [&_blockquote]:text-signal-ink dark:[&_blockquote]:bg-night-700 dark:[&_blockquote]:text-signal',
  '[&_code]:rounded [&_code]:bg-stone-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] dark:[&_code]:bg-night-700',
  '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-night [&_pre]:p-3 [&_pre]:text-mist [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-mist',
  '[&_.doc-table]:my-3 [&_.doc-table]:overflow-x-auto',
  '[&_table]:w-full [&_table]:border-collapse [&_table]:text-[13px]',
  '[&_th]:border [&_th]:border-stone [&_th]:bg-stone-100 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-night dark:[&_th]:border-night-700 dark:[&_th]:bg-night-700 dark:[&_th]:text-mist',
  '[&_td]:border [&_td]:border-stone [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-top dark:[&_td]:border-night-700',
  '[&_a]:text-signal-ink [&_a]:underline [&_a]:underline-offset-2 dark:[&_a]:text-signal',
  '[&_mark]:rounded [&_mark]:bg-signal-wash [&_mark]:px-1 [&_mark]:text-signal-ink dark:[&_mark]:bg-night-700 dark:[&_mark]:text-signal',
  '[&_hr]:my-5 [&_hr]:border-stone dark:[&_hr]:border-night-700',
].join(' ')

/** Live preview of a Markdown document (the renderer escapes everything; see markdown.ts). */
export function DocPreview({ md, className }: { md: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(md), [md])
  if (!md.trim()) {
    return <p className={cn('text-sm italic text-graphite', className)}>La vista previa aparece aquí cuando empieces a escribir.</p>
  }
  return <div className={cn(PROSE, className)} dangerouslySetInnerHTML={{ __html: html }} />
}

/** Save the Markdown source as a .md file. */
export function downloadMarkdown(title: string, body: string) {
  const name = title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'documento'
  const blob = new Blob([`# ${title}\n\n${body}\n`], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.md`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Print (or "save as PDF") in a clean window: title, meta line and the
 * rendered body with print-friendly typography. Returns false if the browser
 * blocked the popup.
 */
export function printDocument(opts: { title: string; meta: string; body: string }): boolean {
  const w = window.open('', '_blank', 'noopener=no,width=900,height=1000')
  if (!w) return false
  const html = renderMarkdown(opts.body)
  w.document.open()
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(opts.title)}</title>
<style>
  @page { margin: 22mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: "IBM Plex Sans", "Segoe UI", Arial, sans-serif; color: #1c2b36; line-height: 1.55; font-size: 11.5pt; margin: 0; }
  h1.doc-title { font-family: Archivo, "Segoe UI", Arial, sans-serif; font-size: 22pt; margin: 0 0 4px; color: #0A1A26; letter-spacing: -0.02em; }
  .doc-meta { color: #55636B; font-size: 9.5pt; margin: 0 0 18px; padding-bottom: 10px; border-bottom: 2px solid #FFB020; }
  h1, h2, h3, h4 { font-family: Archivo, "Segoe UI", Arial, sans-serif; color: #0A1A26; page-break-after: avoid; }
  h1 { font-size: 17pt; } h2 { font-size: 14pt; margin-top: 18px; } h3 { font-size: 12pt; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 10pt; page-break-inside: avoid; }
  th, td { border: 1px solid #c9ced1; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #F1EFEA; }
  blockquote { margin: 10px 0; padding: 4px 12px; border-left: 4px solid #FFB020; background: #FFF6E0; }
  code { font-family: "IBM Plex Mono", Consolas, monospace; font-size: 0.9em; background: #F1EFEA; padding: 0 3px; border-radius: 3px; }
  pre { background: #0A1A26; color: #F7F4EF; padding: 10px; border-radius: 6px; overflow: auto; } pre code { background: none; color: inherit; }
  mark { background: #FFF1C9; padding: 0 2px; }
  a { color: #8A5A00; }
  hr { border: 0; border-top: 1px solid #c9ced1; margin: 16px 0; }
</style></head><body>
<h1 class="doc-title">${escapeHtml(opts.title)}</h1>
<p class="doc-meta">${escapeHtml(opts.meta)}</p>
${html}
<script>window.addEventListener('load', function () { setTimeout(function () { window.focus(); window.print(); }, 150); });</script>
</body></html>`)
  w.document.close()
  return true
}
