import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { encodeProjectFolder, readClaudeStats, statsFolders, statsWindow } from './claude-stats'
import { worktreeFolders } from './claude-stats-types'

// The Agent setup page's Stats (#68 D14) from real temporary transcripts, with fixed dates.

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bikube-stats-'))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

/** Noon UTC on 2026-03-15: "now" in these tests. */
const NOW = Date.parse('2026-03-15T12:00:00Z')
/** Local dates as UTC's, so the tests never depend on the machine's zone. */
const utcDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

interface Line {
  at?: string | null
  input?: number
  output?: number
  cacheWrite?: number
  cacheRead?: number
  model?: string
  id?: string
  requestId?: string
  tools?: { name: string; input?: Record<string, unknown>; id?: string }[]
}

const assistant = (l: Line): string =>
  JSON.stringify({
    type: 'assistant',
    ...(l.at === null ? {} : { timestamp: l.at ?? '2026-03-15T10:00:00Z' }),
    ...(l.requestId === undefined ? {} : { requestId: l.requestId }),
    message: {
      ...(l.id === undefined ? {} : { id: l.id }),
      model: l.model ?? 'claude-x',
      content: (l.tools ?? []).map((t) => ({
        type: 'tool_use',
        ...(t.id === undefined ? {} : { id: t.id }),
        name: t.name,
        input: t.input ?? {}
      })),
      usage: {
        input_tokens: l.input ?? 0,
        output_tokens: l.output ?? 0,
        cache_creation_input_tokens: l.cacheWrite ?? 0,
        cache_read_input_tokens: l.cacheRead ?? 0
      }
    }
  })

const user = (at: string | null): string =>
  JSON.stringify({ type: 'user', ...(at === null ? {} : { timestamp: at }), message: {} })

/** Writes transcript `name` of `folder`'s project folder in the fake home; returns its path. */
function transcript(folder: string, name: string, lines: string[]): string {
  const dir = join(home, '.claude', 'projects', encodeProjectFolder(folder))
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${name}.jsonl`)
  writeFileSync(path, lines.map((l) => l + '\n').join(''))
  return path
}

const read = (folders: string[], localDate = utcDate): ReturnType<typeof readClaudeStats> =>
  readClaudeStats({ home, folders, now: NOW, localDate })

const day = (
  stats: Awaited<ReturnType<typeof readClaudeStats>>,
  date: string
): { tokens: number; sessions: number } | undefined => {
  const found = stats.days.find((d) => d.date === date)
  return found && { tokens: found.tokens, sessions: found.sessions }
}

describe('readClaudeStats', () => {
  it("counts AC14's sessions, tokens, models and most used over two folders", async () => {
    transcript('/work/proj', 'a', [
      user('2026-03-14T09:00:00Z'),
      assistant({
        at: '2026-03-14T09:00:01Z',
        input: 1000,
        output: 3000,
        id: 'm1',
        requestId: 'r1',
        tools: [{ name: 'Skill', input: { skill: 'review' }, id: 't1' }]
      })
    ])
    transcript('/work/proj', 'b', [
      assistant({
        input: 200,
        cacheWrite: 300,
        cacheRead: 500,
        id: 'm2',
        requestId: 'r2',
        tools: [
          { name: 'Bash', id: 't2' },
          { name: 'Bash', id: 't3' }
        ]
      })
    ])
    transcript('/data/worktrees/repo/fix', 'c', [assistant({ input: 500, id: 'm3' })])

    const stats = await read(['/work/proj', '/data/worktrees/repo/fix'])
    expect(stats.folders).toEqual(['/work/proj', '/data/worktrees/repo/fix'])
    expect(stats.sessions).toBe(3)
    expect(stats.tokens).toBe(5500)
    expect(day(stats, '2026-03-14')).toEqual({ tokens: 4000, sessions: 1 })
    expect(day(stats, '2026-03-15')).toEqual({ tokens: 1500, sessions: 2 })
    expect(stats.models).toEqual([{ model: 'claude-x', tokens: 5500 }])
    expect(stats.tools).toEqual([
      { name: 'Bash', count: 2 },
      { name: 'Skill', count: 1 }
    ])
    expect(stats.skills).toEqual([{ name: 'review', count: 1 }])
    expect(stats.subagents).toEqual([])
    expect(JSON.stringify(stats)).not.toMatch(/cost/i)
  })

  it('encodes a folder as Claude Code does: every character outside A-Z a-z 0-9 a dash', () => {
    expect(encodeProjectFolder('/Users/ana/my_app.v2/x y')).toBe('-Users-ana-my-app-v2-x-y')
    expect(encodeProjectFolder('/home/æ/proj')).toBe('-home---proj')
  })

  it('covers the 30 days ending today, oldest first, across a month end', async () => {
    expect(statsWindow('2026-03-01')).toHaveLength(30)
    expect(statsWindow('2026-03-01')[0]).toBe('2026-01-31')
    expect(statsWindow('2026-03-01').at(-1)).toBe('2026-03-01')
    const stats = await read([])
    expect(stats.days.map((d) => d.date)[0]).toBe('2026-02-14')
    expect(stats.days.at(-1)?.date).toBe('2026-03-15')
    expect(stats).toMatchObject({ sessions: 0, tokens: 0, models: [], tools: [], folders: [] })
  })

  it('counts entries on the window edges only, by the local date injected', async () => {
    transcript('/p', 'old', [assistant({ at: '2026-02-13T23:00:00Z', input: 7 })])
    transcript('/p', 'first', [assistant({ at: '2026-02-14T00:00:00Z', input: 11 })])
    transcript('/p', 'late', [assistant({ at: '2026-03-15T23:59:59Z', input: 13 })])
    transcript('/p', 'future', [assistant({ at: '2026-03-16T00:00:00Z', input: 17 })])
    const stats = await read(['/p'])
    expect(stats.tokens).toBe(24)
    expect(stats.sessions).toBe(2)
    expect(day(stats, '2026-02-14')).toEqual({ tokens: 11, sessions: 1 })

    // Ten hours ahead of UTC, today is still 03-15 at NOW, so 02-13T23:00Z is 02-14 there.
    const ahead = (ms: number): string => utcDate(ms + 10 * 60 * 60 * 1000)
    const local = await read(['/p'], ahead)
    expect(local.days[0]?.date).toBe('2026-02-14')
    expect(day(local, '2026-02-14')).toEqual({ tokens: 18, sessions: 2 })
    expect(local.tokens).toBe(18)
  })

  it('counts a session on the day of its first timestamped entry, its tokens on their own days', async () => {
    transcript('/p', 'long', [
      user(null),
      user('not a date'),
      user('2026-02-10T08:00:00Z'),
      assistant({ at: '2026-03-01T08:00:00Z', input: 100 }),
      assistant({ at: '2026-03-02T08:00:00Z', output: 50 })
    ])
    transcript('/p', 'nodates', [user(null), assistant({ at: null, input: 999 })])
    const stats = await read(['/p'])
    // Started before the period: its tokens count, the session doesn't.
    expect(stats.sessions).toBe(0)
    expect(stats.tokens).toBe(150)
    expect(day(stats, '2026-03-01')).toEqual({ tokens: 100, sessions: 0 })
    expect(day(stats, '2026-03-02')).toEqual({ tokens: 50, sessions: 0 })
  })

  it('counts a streamed message once (the last copy) and a tool use once by its id', async () => {
    transcript('/p', 's', [
      assistant({
        input: 5,
        output: 1,
        id: 'm1',
        requestId: 'r1',
        tools: [{ name: 'Read', id: 't1' }]
      }),
      assistant({
        input: 5,
        output: 2,
        id: 'm1',
        requestId: 'r1',
        tools: [{ name: 'Read', id: 't1' }]
      }),
      assistant({ input: 5, output: 3, id: 'm1', requestId: 'r1' }),
      assistant({ input: 1, output: 1, tools: [{ name: 'Edit' }] }),
      assistant({ input: 1, output: 1, tools: [{ name: 'Edit' }] })
    ])
    const stats = await read(['/p'])
    expect(stats.tokens).toBe(12)
    expect(stats.tools).toEqual([
      { name: 'Edit', count: 2 },
      { name: 'Read', count: 1 }
    ])
  })

  it("adds each session's subagent transcripts, not as sessions, with their models and tools", async () => {
    const main = transcript('/p', 'sess', [
      assistant({
        input: 100,
        id: 'm1',
        tools: [
          { name: 'Task', input: { subagent_type: 'explorer' }, id: 't1' },
          { name: 'Agent', input: { subagent_type: 'explorer' }, id: 't2' },
          { name: 'Agent', input: { subagent_type: 'reviewer' }, id: 't3' },
          { name: 'Task', input: {}, id: 't4' }
        ]
      })
    ])
    const subs = join(main.replace(/\.jsonl$/, ''), 'subagents')
    mkdirSync(subs, { recursive: true })
    writeFileSync(
      join(subs, 'agent-1.jsonl'),
      assistant({
        model: 'claude-small',
        input: 40,
        id: 's1',
        tools: [{ name: 'Grep', id: 'g1' }]
      }) + '\n'
    )
    writeFileSync(join(subs, 'notes.txt'), assistant({ input: 9999 }) + '\n')
    const stats = await read(['/p'])
    expect(stats.sessions).toBe(1)
    expect(stats.tokens).toBe(140)
    expect(stats.models).toEqual([
      { model: 'claude-x', tokens: 100 },
      { model: 'claude-small', tokens: 40 }
    ])
    expect(stats.subagents).toEqual([
      { name: 'explorer', count: 2 },
      { name: 'reviewer', count: 1 }
    ])
    expect(stats.tools.find((t) => t.name === 'Grep')).toEqual({ name: 'Grep', count: 1 })
  })

  it('keeps the top 10 of each list, most used first, then by name', async () => {
    const tools = Array.from({ length: 12 }, (_, i) =>
      Array.from({ length: i + 1 }, (__, j) => ({
        name: `tool${String(i).padStart(2, '0')}`,
        id: `${i}-${j}`
      }))
    ).flat()
    transcript('/p', 's', [
      assistant({ input: 1, tools }),
      assistant({ input: 1, tools: [{ name: 'tool00', id: 'x' }] })
    ])
    const stats = await read(['/p'])
    expect(stats.tools).toHaveLength(10)
    expect(stats.tools[0]).toEqual({ name: 'tool11', count: 12 })
    expect(stats.tools.at(-1)).toEqual({ name: 'tool02', count: 3 })
    // tool00 and tool01 both used twice: neither makes the cut, the order by name is stable.
  })

  it('reads a repeated folder once, skips transcripts last written before the period, and other files', async () => {
    transcript('/p', 'a', [assistant({ input: 10 })])
    const stale = transcript('/p', 'stale', [assistant({ input: 1000 })])
    const old = (NOW - 40 * 24 * 60 * 60 * 1000) / 1000
    utimesSync(stale, old, old)
    const dir = join(home, '.claude', 'projects', encodeProjectFolder('/p'))
    writeFileSync(join(dir, 'notes.txt'), assistant({ input: 5 }) + '\n')
    mkdirSync(join(dir, 'folder.jsonl'))
    const stats = await read(['/p', '/p'])
    expect(stats.folders).toEqual(['/p'])
    expect(stats.tokens).toBe(10)
    expect(stats.sessions).toBe(1)
  })
})

describe('statsFolders', () => {
  const existing = new Set(['/work/proj', '/wt/a', '/wt/b'])
  const isDir = async (path: unknown): Promise<boolean> =>
    typeof path === 'string' && existing.has(path)

  it('takes the workspace folder and its existing extra folders, resolved, each once', async () => {
    expect(
      await statsFolders('/work/proj/', ['/wt/a', '/wt/gone', '/wt/b/', '/wt/a'], isDir)
    ).toEqual(['/work/proj', '/wt/a', '/wt/b'])
  })

  it('refuses a workspace folder that is no directory, extra folders not absolute, or more than 100', async () => {
    expect(await statsFolders('/nope', [], isDir)).toBeNull()
    expect(await statsFolders(42, [], isDir)).toBeNull()
    expect(await statsFolders('/work/proj', 'x', isDir)).toBeNull()
    expect(await statsFolders('/work/proj', ['relative/wt'], isDir)).toBeNull()
    expect(await statsFolders('/work/proj', [7], isDir)).toBeNull()
    expect(await statsFolders('/work/proj', Array(101).fill('/wt/a'), isDir)).toBeNull()
    expect(await statsFolders('/work/proj', Array(100).fill('/wt/a'), isDir)).toEqual([
      '/work/proj',
      '/wt/a'
    ])
  })
})

describe('worktreeFolders', () => {
  it("lists each local worktree card's worktree folder once, in board order", () => {
    const cards = [
      { directory: '/w/proj' },
      {
        directory: '/data/wt/repo/a/sub',
        worktree: { path: '/data/wt/repo/a', branch: 'a', repo: '/w/proj' }
      },
      {
        directory: '/data/wt/repo/b',
        worktree: { path: '/data/wt/repo/b', branch: 'b', repo: '/w/proj' }
      },
      {
        directory: '/srv/x',
        host: 'box',
        worktree: { path: '/srv/wt', branch: 'c', repo: '/srv' }
      },
      {
        directory: '/data/wt/repo/a',
        worktree: { path: '/data/wt/repo/a', branch: 'a', repo: '/w/proj' }
      }
    ]
    expect(worktreeFolders(cards)).toEqual(['/data/wt/repo/a', '/data/wt/repo/b'])
  })
})
