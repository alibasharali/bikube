import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readClaudeUsage } from './claude-usage'

// Reading a Claude Code session transcript (#50 D2, D3) from real temporary files.

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drovr-usage-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

interface Entry {
  model?: string
  input?: number
  output?: number
  cacheWrite?: number
  cacheRead?: number
  id?: string
  requestId?: string
  isSidechain?: boolean
}

const entry = (e: Entry): string =>
  JSON.stringify({
    type: 'assistant',
    ...(e.requestId === undefined ? {} : { requestId: e.requestId }),
    ...(e.isSidechain === undefined ? {} : { isSidechain: e.isSidechain }),
    message: {
      ...(e.id === undefined ? {} : { id: e.id }),
      model: e.model ?? 'claude-sonnet-4-5',
      usage: {
        input_tokens: e.input ?? 0,
        output_tokens: e.output ?? 0,
        cache_creation_input_tokens: e.cacheWrite ?? 0,
        cache_read_input_tokens: e.cacheRead ?? 0
      }
    }
  })

const transcript = (lines: string[], name = 'session.jsonl'): string => {
  const path = join(dir, name)
  writeFileSync(path, lines.map((l) => l + '\n').join(''))
  return path
}

describe('readClaudeUsage', () => {
  it("sums AC1's two entries, with the latest one's context and model and the priced cost", async () => {
    const path = transcript([
      entry({ input: 1000, output: 500, cacheWrite: 2000, id: 'm1', requestId: 'r1' }),
      entry({ input: 10, output: 200, cacheRead: 3000, id: 'm2', requestId: 'r2' })
    ])
    const usage = await readClaudeUsage(path)
    expect(usage).toEqual({
      input: 1010,
      output: 700,
      cacheWrite: 2000,
      cacheRead: 3000,
      tokens: 6710,
      context: 3010,
      model: 'claude-sonnet-4-5',
      cost: expect.any(Number)
    })
    expect(usage.cost).toBeCloseTo(0.02193, 10)
  })

  it('counts a streamed message once, the last copy read, and entries lacking both ids each', async () => {
    const path = transcript([
      entry({ output: 1, input: 5, id: 'm1', requestId: 'r1' }),
      entry({ output: 2, input: 5, id: 'm1', requestId: 'r1' }),
      entry({ output: 3, input: 5, id: 'm1', requestId: 'r1' }),
      entry({ output: 7, input: 1 }),
      entry({ output: 7, input: 1 })
    ])
    const usage = await readClaudeUsage(path)
    expect(usage.input).toBe(7)
    expect(usage.output).toBe(17)
    expect(usage.tokens).toBe(24)
  })

  it("adds the session's subagent transcripts to the totals and cost but not the context", async () => {
    const path = transcript([
      entry({ input: 100, output: 10, id: 'm1', requestId: 'r1' }),
      entry({ input: 100, output: 20, id: 'm1', requestId: 'r1' }),
      entry({ input: 100, output: 30, id: 'm1', requestId: 'r1' })
    ])
    mkdirSync(join(dir, 'session', 'subagents'), { recursive: true })
    writeFileSync(
      join(dir, 'session', 'subagents', 'agent-1.jsonl'),
      entry({ model: 'claude-haiku-4-5', input: 5000, output: 1000, id: 's1', requestId: 'q1' }) +
        '\n'
    )
    writeFileSync(join(dir, 'session', 'subagents', 'notes.txt'), entry({ input: 9999 }) + '\n')
    const usage = await readClaudeUsage(path)
    expect(usage).toMatchObject({
      input: 5100,
      output: 1030,
      tokens: 6130,
      context: 100,
      model: 'claude-sonnet-4-5'
    })
    expect(usage.cost).toBeCloseTo(0.0003 + 0.00045 + 0.005 + 0.005, 10)
  })

  it('takes the context from the latest entry not on a sidechain', async () => {
    const path = transcript([
      entry({ input: 40, cacheRead: 2, model: 'claude-opus-4-5' }),
      entry({ input: 900, isSidechain: true, model: 'claude-haiku-4-5' })
    ])
    const usage = await readClaudeUsage(path)
    expect(usage.context).toBe(42)
    expect(usage.model).toBe('claude-opus-4-5')
    expect(usage.input).toBe(940)
  })

  it('skips lines that are not JSON, not assistant entries with a usage, or count nothing', async () => {
    const path = transcript([
      'not json {',
      '',
      JSON.stringify({ type: 'user', message: { usage: { input_tokens: 50 } } }),
      JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-4-5' } }),
      JSON.stringify({ type: 'assistant', message: { usage: 'x' } }),
      '[1, 2]',
      'null',
      entry({ input: 3, output: 4 }),
      entry({ model: '<synthetic>' }),
      JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-sonnet-4-5', usage: { input_tokens: '9', output_tokens: 2 } }
      })
    ])
    const usage = await readClaudeUsage(path)
    expect(usage).toMatchObject({ input: 3, output: 6, tokens: 9, context: 0 })
    expect(usage.model).toBe('claude-sonnet-4-5')
  })

  it('leaves the cost unknown when any counted entry has no price, keeping tokens and context', async () => {
    const path = transcript([entry({ model: 'gpt-x', input: 1000, output: 1000 })])
    const usage = await readClaudeUsage(path)
    expect(usage).toEqual({
      input: 1000,
      output: 1000,
      cacheWrite: 0,
      cacheRead: 0,
      tokens: 2000,
      context: 1000,
      model: 'gpt-x'
    })
    expect('cost' in usage).toBe(false)
  })

  it("prices AC4's one opus-4-5 entry of a million output tokens at $25", async () => {
    const path = transcript([entry({ model: 'claude-opus-4-5', output: 1_000_000 })])
    const usage = await readClaudeUsage(path)
    expect(usage).toMatchObject({ tokens: 1_000_000, context: 0, model: 'claude-opus-4-5' })
    expect(usage.cost).toBeCloseTo(25, 10)
  })

  it('reads an empty transcript as zero usage', async () => {
    const path = transcript([])
    expect(await readClaudeUsage(path)).toEqual({
      input: 0,
      output: 0,
      cacheWrite: 0,
      cacheRead: 0,
      tokens: 0,
      context: 0,
      model: null,
      cost: 0
    })
  })

  it("rejects when the transcript can't be read", async () => {
    await expect(readClaudeUsage(join(dir, 'nope.jsonl'))).rejects.toThrow()
    await expect(readClaudeUsage(dir)).rejects.toThrow()
  })
})
