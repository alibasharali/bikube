import { describe, expect, it } from 'vitest'
import { isMarkdownPath, markdownLink, renderMarkdown, resolveRelative } from './markdown-render'

describe('renderMarkdown (#83 D10)', () => {
  it('renders CommonMark headings, tables and strikethrough', () => {
    const html = renderMarkdown(
      '# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~\n',
      'README.md'
    )
    expect(html).toContain('>Title</h1>')
    expect(html).toContain('<table>')
    expect(html).toContain('<td>1</td>')
    expect(html).toContain('<s>gone</s>')
  })

  it('shows raw HTML as text, never as an element', () => {
    const html = renderMarkdown('<b>raw</b>\n\nsome <i>inline</i>\n', 'README.md')
    expect(html).not.toContain('<b>')
    expect(html).not.toContain('<i>')
    expect(html).toContain('&lt;b&gt;raw&lt;/b&gt;')
    expect(html).toContain('&lt;i&gt;inline&lt;/i&gt;')
  })

  it('turns bare URLs into links', () => {
    expect(renderMarkdown('see https://example.com now\n', 'README.md')).toContain(
      '<a href="https://example.com">https://example.com</a>'
    )
  })

  it('blocks javascript: and data: links', () => {
    const html = renderMarkdown('[x](javascript:alert(1)) [y](data:text/html,hi)\n', 'README.md')
    expect(html).not.toContain('href="javascript')
    expect(html).not.toContain('href="data')
  })

  it('renders task list items as disabled checkboxes, checked for [x]', () => {
    const html = renderMarkdown('- [x] done\n- [ ] todo\n- [X] also\n- plain\n', 'README.md')
    expect(html.match(/<input [^>]*>/g)).toEqual([
      '<input type="checkbox" class="markdown-task" disabled checked>',
      '<input type="checkbox" class="markdown-task" disabled>',
      '<input type="checkbox" class="markdown-task" disabled checked>'
    ])
    expect(html).toContain(
      '<li class="markdown-task-item"><input type="checkbox" class="markdown-task" disabled checked> done</li>'
    )
    expect(html).toContain('<li>plain</li>')
    expect(html).not.toContain('[x]')
  })

  it('leaves a bracket that is not a task as text', () => {
    const html = renderMarkdown('- [y] no\n- [x]tight\n\n[x] not in a list\n', 'README.md')
    expect(html).not.toContain('<input')
    expect(html).toContain('[y] no')
    expect(html).toContain('[x] not in a list')
  })

  it('marks fenced code with its language for highlighting', () => {
    const html = renderMarkdown('```ts\nconst a = 1 < 2\n```\n', 'README.md')
    expect(html).toContain('<pre><code class="language-ts">const a = 1 &lt; 2\n</code></pre>')
  })

  it('gives headings prefixed ids, unique within the document', () => {
    const html = renderMarkdown('# My Title!\n\n## My Title\n\n### Ünïcode_x y\n', 'README.md')
    expect(html).toContain('<h1 id="md-my-title">')
    expect(html).toContain('<h2 id="md-my-title-1">')
    expect(html).toContain('<h3 id="md-ünïcode_x-y">')
  })

  it('names a relative image inside the folder by its path, to load through main', () => {
    const html = renderMarkdown('![logo](./img/a.png "Logo")\n', 'docs/README.md')
    expect(html).toContain('<img alt="logo" title="Logo" data-md-src="docs/img/a.png">')
    expect(html).not.toContain(' src=')
  })

  it('shows the alt text for an image outside the folder, remote or with no base', () => {
    for (const [text, base] of [
      ['![up](../../x.png)', 'docs/README.md'],
      ['![web](https://example.com/x.png)', 'README.md'],
      ['![abs](/etc/x.png)', 'README.md'],
      ['![listed](./x.png)', null]
    ] as const) {
      const html = renderMarkdown(`${text}\n`, base)
      expect(html).not.toContain('<img')
      expect(html).toMatch(/<span class="markdown-image-alt">\w+<\/span>/)
    }
  })

  it('escapes an image alt text', () => {
    const html = renderMarkdown('![<b>"x"</b>](https://e.com/x.png)\n', 'README.md')
    expect(html).toContain(
      '<span class="markdown-image-alt">&lt;b&gt;&quot;x&quot;&lt;/b&gt;</span>'
    )
  })
})

describe('resolveRelative', () => {
  it('resolves against the file’s own folder', () => {
    expect(resolveRelative('README.md', './docs/b.md')).toBe('docs/b.md')
    expect(resolveRelative('docs/a.md', 'b.md')).toBe('docs/b.md')
    expect(resolveRelative('docs/a.md', '../c/d.md')).toBe('c/d.md')
    expect(resolveRelative('docs/a.md', 'my%20file.md')).toBe('docs/my file.md')
  })

  it('refuses anything escaping the folder, absolute or with a scheme', () => {
    expect(resolveRelative('README.md', '../x.md')).toBeNull()
    expect(resolveRelative('docs/a.md', '../../x.md')).toBeNull()
    expect(resolveRelative('README.md', '/etc/passwd')).toBeNull()
    expect(resolveRelative('README.md', '//host/x')).toBeNull()
    expect(resolveRelative('README.md', 'file:///etc/passwd')).toBeNull()
    expect(resolveRelative('README.md', 'C:x')).toBeNull()
    expect(resolveRelative('README.md', '')).toBeNull()
    expect(resolveRelative('README.md', './')).toBeNull()
    expect(resolveRelative('README.md', '%zz')).toBeNull()
    expect(resolveRelative('README.md', 'a%2F..%2F..%2Fx')).toBeNull()
  })
})

describe('markdownLink', () => {
  it('opens http and https outside', () => {
    expect(markdownLink('https://example.com', 'README.md')).toEqual({
      kind: 'external',
      url: 'https://example.com/'
    })
    expect(markdownLink('http://a.b/c', null)).toEqual({ kind: 'external', url: 'http://a.b/c' })
  })

  it('opens a relative file inside the folder, its fragment and query dropped', () => {
    expect(markdownLink('./docs/b.md', 'README.md')).toEqual({ kind: 'file', path: 'docs/b.md' })
    expect(markdownLink('b.md#part?x', 'docs/a.md')).toEqual({ kind: 'file', path: 'docs/b.md' })
    expect(markdownLink('b.md?x=1', 'docs/a.md')).toEqual({ kind: 'file', path: 'docs/b.md' })
  })

  it('scrolls to an anchor by its heading id', () => {
    expect(markdownLink('#My%20Title', 'README.md')).toEqual({ kind: 'anchor', id: 'md-my-title' })
    expect(markdownLink('#install', null)).toEqual({ kind: 'anchor', id: 'md-install' })
  })

  it('does nothing for anything else', () => {
    for (const href of [
      'mailto:a@b.c',
      'file:///etc/passwd',
      'javascript:alert(1)',
      '../out.md',
      '/abs.md',
      '#',
      ''
    ]) {
      expect(markdownLink(href, 'README.md')).toEqual({ kind: 'none' })
    }
    // A listed file (Agent setup) opens no relative file.
    expect(markdownLink('./b.md', null)).toEqual({ kind: 'none' })
  })
})

describe('isMarkdownPath', () => {
  it('is .md and .markdown in any case', () => {
    expect(isMarkdownPath('/a/README.md')).toBe(true)
    expect(isMarkdownPath('/a/x.MARKDOWN')).toBe(true)
    expect(isMarkdownPath('/a/x.mdx')).toBe(false)
    expect(isMarkdownPath('/a/md')).toBe(false)
  })
})
