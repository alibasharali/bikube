import { describe, expect, it } from 'vitest'
import { outputRows } from './agent-outputs-view'
import type { AgentOutput } from './agent-summary'

const HOME = '/Users/me'

describe("Files and artifacts' rows (#79 D3, D4, D11)", () => {
  it('lists the outputs newest first', () => {
    const outputs: AgentOutput[] = [
      { kind: 'file', path: '/Users/me/Downloads/a.pdf', at: 1 },
      { kind: 'artifact', url: 'https://claude.ai/artifact/x', title: 'Plan', type: 'doc', at: 2 },
      { kind: 'file', path: '~/Reports/b.xlsx', at: 3 }
    ]
    expect(outputRows(outputs, HOME).map((row) => row.key)).toEqual([
      '~/Reports/b.xlsx',
      'https://claude.ai/artifact/x',
      '/Users/me/Downloads/a.pdf'
    ])
  })

  it("shows a file's name and its folder with `~` for the home", () => {
    const rows = outputRows(
      [
        { kind: 'file', path: '/Users/me/Downloads/Cost report - v2.pdf', at: null },
        { kind: 'file', path: '~/b.xlsx', at: null },
        { kind: 'file', path: '/srv/out/c.png', at: null },
        { kind: 'file', path: '/d.zip', at: null },
        { kind: 'file', path: '/Users/me/e.csv', at: null }
      ],
      HOME
    )
    expect(rows.map((row) => (row.kind === 'file' ? [row.name, row.folder] : []))).toEqual([
      ['e.csv', '~'],
      ['d.zip', '/'],
      ['c.png', '/srv/out'],
      ['b.xlsx', '~'],
      ['Cost report - v2.pdf', '~/Downloads']
    ])
    expect(rows[4]).toMatchObject({ path: '/Users/me/Downloads/Cost report - v2.pdf' })
  })

  it("shows an artifact's title else its link, with its type when known", () => {
    const rows = outputRows(
      [
        {
          kind: 'artifact',
          url: 'https://claude.ai/artifact/a',
          title: 'Report',
          type: 'page',
          at: 1
        },
        { kind: 'artifact', url: 'https://claude.ai/code/artifact/b', at: 2 }
      ],
      HOME
    )
    expect(rows).toEqual([
      {
        kind: 'artifact',
        key: 'https://claude.ai/code/artifact/b',
        url: 'https://claude.ai/code/artifact/b',
        title: 'https://claude.ai/code/artifact/b',
        badge: null
      },
      {
        kind: 'artifact',
        key: 'https://claude.ai/artifact/a',
        url: 'https://claude.ai/artifact/a',
        title: 'Report',
        badge: 'Page'
      }
    ])
  })

  it('is empty without outputs', () => {
    expect(outputRows(undefined, HOME)).toEqual([])
  })
})
