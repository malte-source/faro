/**
 * Tiny, dependency-free Markdown → HTML renderer for Documentos.
 *
 * Safety: ALL source text is HTML-escaped before any markup is added, links
 * are limited to http(s) and mailto, and the only tags emitted are the fixed
 * ones below — so the string is safe to use with dangerouslySetInnerHTML
 * (preview) and document.write (print window).
 *
 * Supported: # headings, paragraphs (single newline = <br>), **bold**,
 * *italic*, `code`, fenced code, [links](https://…), bare URLs, > quotes,
 * - / * / 1. lists (nested by indentation), | tables |, --- rules, and
 * [COMPLETAR: …] placeholders highlighted as <mark>.
 */

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ESC[c])

function inline(raw: string): string {
  const codes: string[] = []
  // 1. pull out `code` spans so their content is never formatted
  let s = raw.replace(/`([^`\n]+)`/g, (_, c: string) => {
    codes.push(`<code>${escapeHtml(c)}</code>`)
    return `\u0000${codes.length - 1}\u0000`
  })
  // 2. escape everything else
  s = escapeHtml(s)
  // 3. links [text](url) — http(s)/mailto only
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (_, t: string, u: string) =>
    `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`)
  // 4. [COMPLETAR: …] placeholders
  s = s.replace(/\[COMPLETAR:[^\]]*\]/g, m => `<mark class="doc-placeholder">${m}</mark>`)
  // 5. bare URLs not already inside an href/anchor
  s = s.replace(/(^|[\s(>])(https?:\/\/[^\s<)]+)/g, (_, pre: string, u: string) =>
    `${pre}<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`)
  // 6. emphasis
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*\w])\*([^*\n]+?)\*(?![*\w])/g, '$1<em>$2</em>')
  // 7. restore code spans
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)])
}

const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes('-')
const splitRow = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/

interface ListItem { text: string; ordered: boolean; children: ListItem[] }

function renderList(items: ListItem[]): string {
  if (!items.length) return ''
  const tag = items[0].ordered ? 'ol' : 'ul'
  return `<${tag}>${items.map(i => `<li>${inline(i.text)}${renderList(i.children)}</li>`).join('')}</${tag}>`
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) { i++; continue }

    // fenced code
    const fence = /^\s*```/.exec(line)
    if (fence) {
      const buf: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++])
      i++ // closing fence
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`)
      continue
    }

    // heading
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue }

    // rule
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue }

    // blockquote
    if (/^\s*>/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''))
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`)
      continue
    }

    // table
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]))
      out.push(
        `<div class="doc-table"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows
          .map(r => `<tr>${head.map((_, ci) => `<td>${inline(r[ci] ?? '')}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`,
      )
      continue
    }

    // list (nested by indentation)
    if (LIST_RE.test(line)) {
      const root: ListItem[] = []
      // Each entry is one list level: the indentation of its items and where they go.
      const stack: Array<{ indent: number; items: ListItem[] }> = []
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i])
        if (!m) break
        const indent = m[1].replace(/\t/g, '  ').length
        const item: ListItem = { text: m[3], ordered: /\d/.test(m[2]), children: [] }
        while (stack.length && indent < stack[stack.length - 1].indent) stack.pop()
        if (!stack.length) {
          stack.push({ indent, items: root })
        } else if (indent > stack[stack.length - 1].indent) {
          const parentItems = stack[stack.length - 1].items
          const last = parentItems[parentItems.length - 1]
          stack.push({ indent, items: last ? last.children : root })
        }
        stack[stack.length - 1].items.push(item)
        i++
      }
      out.push(renderList(root))
      continue
    }

    // paragraph
    const buf: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(#{1,6}\s|```|>)/.test(lines[i]) &&
      !LIST_RE.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))
    ) buf.push(lines[i++])
    out.push(`<p>${buf.map(inline).join('<br>')}</p>`)
  }
  return out.join('\n')
}
