import { describe, expect, it } from 'vitest'
import { outputPaths } from './agent-outputs'

describe('outputPaths (#79 D6)', () => {
  it('finds a quoted $HOME path with spaces in a command, as ~', () => {
    expect(
      outputPaths(
        'F="x"; OUT="$HOME/Downloads/Managed Service Migrator - PostgreSQL cost parameters.pdf"; test -e "$OUT" && echo ok'
      )
    ).toEqual(['~/Downloads/Managed Service Migrator - PostgreSQL cost parameters.pdf'])
  })

  it("ends a reply's path at a sentence's full stop, and matches the extension in any case", () => {
    expect(
      outputPaths(
        "I've saved the PDF to /Users/ali/Downloads/Cost report - v2.pdf. It's 5 A4 pages, about 165 KB."
      )
    ).toEqual(['/Users/ali/Downloads/Cost report - v2.pdf'])
    expect(outputPaths('Saved (/a/b.XLSX), and `~/c.png`; also ${HOME}/d.Docx!')).toEqual([
      '/a/b.XLSX',
      '~/c.png',
      '~/d.Docx'
    ])
  })

  it('needs a word start, an end after the extension, one line and at most 300 characters', () => {
    expect(outputPaths('see https://x.io/a.pdf or a/b.pdf or /a/b.pdfx or /a/b.pdf.bak')).toEqual(
      []
    )
    expect(outputPaths('/a/b\nc.pdf')).toEqual([])
    expect(outputPaths(`/${'a'.repeat(296)}.pdf`)).toEqual([])
    expect(outputPaths(`/${'a'.repeat(295)}.pdf`)).toHaveLength(1)
    expect(outputPaths('/x.ts and /y.json and /z.md')).toEqual([])
  })

  it('finds each path once, and one after a longer candidate across it', () => {
    expect(outputPaths('cp /a/x.txt /b/y.pdf && open /b/y.pdf')).toEqual([
      '/a/x.txt /b/y.pdf',
      '/b/y.pdf'
    ])
  })

  it('leaves out scratch folders, Claude state, node_modules and hidden folders (D7)', () => {
    expect(
      outputPaths(
        '/tmp/c.png /private/tmp/c.png /var/folders/x/c.png /private/var/folders/x/c.png ~/.claude/d.png $HOME/.claude/d.png /p/node_modules/e.pdf /p/.cache/f.pdf'
      )
    ).toEqual([])
    expect(outputPaths('/tmpfiles/a.pdf')).toEqual(['/tmpfiles/a.pdf'])
  })
})

describe('outputPaths on a long line (#79 D6)', () => {
  it('reads a 100 KB line of many starts quickly, with a path at the 300 cut unchanged', () => {
    const path = `/${'a'.repeat(295)}.pdf`
    const line = `${'/x '.repeat(33_000)}${path}. ${path}x`
    const began = performance.now()
    expect(outputPaths(line)).toEqual([path])
    expect(performance.now() - began).toBeLessThan(100)
  })
})
