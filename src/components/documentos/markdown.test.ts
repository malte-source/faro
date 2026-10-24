import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('escapes raw HTML instead of passing it through', () => {
    const html = renderMarkdown('<script>alert(1)</script> y <img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })

  it('only links http(s) and mailto', () => {
    const html = renderMarkdown('[bien](https://faro.app) [mal](javascript:alert(1)) [mail](mailto:a@b.co)')
    expect(html).toContain('href="https://faro.app"')
    expect(html).toContain('href="mailto:a@b.co"')
    expect(html).not.toContain('href="javascript:')
  })

  it('renders headings, bold, italic and code', () => {
    const html = renderMarkdown('## Reglas\n\nUsa **negrita**, *cursiva* y `código <b>`.')
    expect(html).toContain('<h2>Reglas</h2>')
    expect(html).toContain('<strong>negrita</strong>')
    expect(html).toContain('<em>cursiva</em>')
    expect(html).toContain('<code>código &lt;b&gt;</code>')
  })

  it('renders nested and ordered lists', () => {
    const html = renderMarkdown('- uno\n  - interno\n- dos\n\n1. a\n2. b')
    expect(html).toContain('<ul><li>uno<ul><li>interno</li></ul></li><li>dos</li></ul>')
    expect(html).toContain('<ol><li>a</li><li>b</li></ol>')
  })

  it('renders tables with header and padded rows', () => {
    const html = renderMarkdown('| Actividad | R | A |\n|---|---|---|\n| Cierre | CFO | CEO |\n| Pago | COO |')
    expect(html).toContain('<th>Actividad</th>')
    expect(html).toContain('<td>CFO</td>')
    expect(html).toContain('<td>COO</td><td></td></tr>')
  })

  it('renders blockquotes, rules and fenced code', () => {
    const html = renderMarkdown('> Borrador de trabajo\n\n---\n\n```\na < b\n```')
    expect(html).toContain('<blockquote><p>Borrador de trabajo</p></blockquote>')
    expect(html).toContain('<hr>')
    expect(html).toContain('<pre><code>a &lt; b</code></pre>')
  })

  it('highlights [COMPLETAR: …] placeholders', () => {
    expect(renderMarkdown('Plazo: [COMPLETAR: días hábiles]')).toContain('<mark class="doc-placeholder">[COMPLETAR: días hábiles]</mark>')
  })

  it('turns single newlines into line breaks inside a paragraph', () => {
    expect(renderMarkdown('línea 1\nlínea 2')).toBe('<p>línea 1<br>línea 2</p>')
  })
})
