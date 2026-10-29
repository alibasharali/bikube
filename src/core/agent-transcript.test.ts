import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSummaryRead } from './agent-tab'
import {
  TranscriptTailer,
  findSessionTranscript,
  readAgentSummary,
  readSessionSummary,
  transcriptPath,
  type TailFs,
  type TranscriptFs
} from './agent-transcript'
import { encodeProjectFolder } from './claude-stats'

const SESSION = '0b6f1c1e-5d2a-4c1b-9a8e-3f1d2c4b5a69'

let root: string
let home: string
let folder: string
/** Every path the reader asked about. */
let asked: string[]
const fs: TranscriptFs = {
  stat: (path) => {
    asked.push(path)
    return stat(path)
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bikube-agent-tab-'))
  home = join(root, 'home')
  folder = join(root, 'repo')
  mkdirSync(folder, { recursive: true })
  asked = []
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function writeTranscript(dir = folder, id = SESSION): string {
  const path = join(home, '.claude', 'projects', encodeProjectFolder(dir), `${id}.jsonl`)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '{}\n')
  return path
}

describe("the Agent tab's transcript request (#75 D3, D4)", () => {
  it("names the session's file under the folder's project directory", () => {
    expect(transcriptPath('/h', '/Users/ana/my app', SESSION)).toBe(
      `/h/.claude/projects/-Users-ana-my-app/${SESSION}.jsonl`
    )
  })

  it('reports no conversation while the transcript is missing', async () => {
    expect(await readAgentSummary({ folder, sessionId: SESSION }, { home, fs })).toEqual({
      state: 'none'
    })
  })

  it('reports a conversation once the transcript exists, however the folder is spelled', async () => {
    writeTranscript()
    for (const spelled of [folder, `${folder}/`]) {
      expect(
        await readAgentSummary({ folder: spelled, sessionId: SESSION }, { home, fs })
      ).toMatchObject({ state: 'conversation' })
    }
  })

  it('refuses a session id that is not a UUID, reading nothing', async () => {
    writeTranscript()
    for (const sessionId of ['../../etc/passwd', `../${SESSION}`, '', 7, undefined]) {
      const read = await readAgentSummary({ folder, sessionId }, { home, fs })
      expect(read).toMatchObject({ state: 'error' })
    }
    expect(asked).toEqual([])
  })

  it('refuses a folder that is relative or not an existing directory', async () => {
    for (const bad of ['repo', '../repo', '', 3, null]) {
      expect(await readAgentSummary({ folder: bad, sessionId: SESSION }, { home, fs })).toEqual({
        state: 'error',
        reason: 'not a folder'
      })
    }
    expect(asked).toEqual([])
    const file = join(root, 'file')
    writeFileSync(file, '')
    for (const notDir of [file, join(root, 'missing')]) {
      expect(await readAgentSummary({ folder: notDir, sessionId: SESSION }, { home, fs })).toEqual({
        state: 'error',
        reason: 'not a folder'
      })
    }
    expect(asked).toEqual([file, join(root, 'missing')])
  })
})

/** A Bash tool use and its result as transcript lines. */
const bashUse = (id: string, command: string, description: string): string =>
  `${JSON.stringify({
    type: 'assistant',
    timestamp: '2026-10-29T14:32:00.000Z',
    message: {
      model: 'claude-opus-4-8',
      content: [{ type: 'tool_use', id, name: 'Bash', input: { command, description } }]
    }
  })}\n`
const bashResult = (id: string, content: string): string =>
  `${JSON.stringify({
    type: 'user',
    timestamp: '2026-10-29T14:32:03.000Z',
    message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: false }] }
  })}\n`

const commandsOf = (read: AgentSummaryRead): string[] =>
  read.state === 'conversation'
    ? read.summary.commands.map((c) => `${c.description} ${c.status}`)
    : []

describe("main's transcript tailing (#75 D4, D5)", () => {
  /** Every byte range the tailer read, as `position+length`, and the paths it opened. */
  let reads: string[]
  let tailFs: TailFs
  let path: string

  beforeEach(() => {
    reads = []
    path = writeTranscript()
    writeFileSync(path, bashUse('t1', 'git status', 'Show status'))
    tailFs = {
      stat: (p) => stat(p),
      open: async (p) => {
        const handle = await open(p, 'r')
        return {
          read: async (buffer, offset, length, position) => {
            const done = await handle.read(buffer, offset, length, position)
            reads.push(`${position}+${done.bytesRead}`)
            return done
          },
          close: () => handle.close()
        }
      }
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads the summary, answers unchanged for the same version, then parses only what was appended', async () => {
    const tailer = new TranscriptTailer({ fs: tailFs })
    const first = await tailer.read(path)
    expect(commandsOf(first)).toEqual(['Show status running'])
    const version = first.state === 'conversation' ? first.version : -1
    expect(await tailer.read(path, version)).toEqual({ state: 'unchanged' })
    // Another asker without that version gets the summary.
    expect(commandsOf(await tailer.read(path))).toEqual(['Show status running'])

    const size = Buffer.byteLength(bashUse('t1', 'git status', 'Show status'))
    reads = []
    appendFileSync(path, bashResult('t1', 'ok'))
    const second = await tailer.read(path, version)
    expect(commandsOf(second)).toEqual(['Show status ok'])
    expect(second.state === 'conversation' && second.version).not.toBe(version)
    expect(reads.every((r) => Number(r.split('+')[0]) >= size)).toBe(true)
  })

  it('keeps a partial last line until it is complete', async () => {
    const tailer = new TranscriptTailer({ fs: tailFs })
    const line = bashUse('t2', 'npm test', 'Run tests')
    appendFileSync(path, line.slice(0, 40))
    expect(commandsOf(await tailer.read(path))).toEqual(['Show status running'])
    appendFileSync(path, line.slice(40))
    expect(commandsOf(await tailer.read(path))).toEqual([
      'Show status running',
      'Run tests running'
    ])
  })

  it('reads a file that shrank or was replaced again from the start', async () => {
    const tailer = new TranscriptTailer({ fs: tailFs })
    await tailer.read(path)
    rmSync(path)
    writeFileSync(path, bashUse('b', 'echo B', 'Echo B'))
    expect(commandsOf(await tailer.read(path))).toEqual(['Echo B running'])
    writeFileSync(path, bashUse('c', 'echo C', 'C'))
    expect(commandsOf(await tailer.read(path))).toEqual(['C running'])
  })

  it('answers none once the transcript is gone', async () => {
    const tailer = new TranscriptTailer({ fs: tailFs })
    await tailer.read(path)
    rmSync(path)
    expect(await tailer.read(path)).toEqual({ state: 'none' })
  })

  it("drops a transcript's state 60 s after its last request", async () => {
    vi.useFakeTimers()
    const tailer = new TranscriptTailer({ fs: tailFs })
    await tailer.read(path)
    vi.advanceTimersByTime(59_000)
    reads = []
    await tailer.read(path)
    expect(reads).toEqual([])
    vi.advanceTimersByTime(60_000)
    await tailer.read(path)
    expect(reads[0]).toMatch(/^0\+/)
  })

  it('gives the event loop a turn every 200 lines', async () => {
    const lines = Array.from({ length: 450 }, (_, i) => bashUse(`t${i}`, `echo ${i}`, `${i}`))
    writeFileSync(path, lines.join(''))
    let turns = 0
    const tailer = new TranscriptTailer({
      fs: tailFs,
      yieldToLoop: async () => {
        turns++
      }
    })
    const read = await tailer.read(path)
    expect(read.state === 'conversation' && read.summary.commands).toHaveLength(450)
    expect(turns).toBeGreaterThanOrEqual(2)
  })

  it('tails each subagent transcript under <session>/subagents, appended bytes only, new files as they appear (S3)', async () => {
    const taskUse = `${JSON.stringify({
      type: 'assistant',
      timestamp: '2026-10-29T14:32:00.000Z',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'task1',
            name: 'Task',
            input: { subagent_type: 'Explore', description: 'Find', prompt: 'Look' }
          }
        ]
      }
    })}\n`
    appendFileSync(path, taskUse)
    const tailer = new TranscriptTailer({ fs: tailFs })
    const subagents = join(path.replace(/\.jsonl$/, ''), 'subagents')
    const agentsOf = (read: AgentSummaryRead): string[] =>
      read.state === 'conversation'
        ? (read.summary.agents ?? []).map((a) => `${a.name} ${a.status} ${a.toolUses}`)
        : []
    const tagged = (read: AgentSummaryRead): string[] =>
      read.state === 'conversation'
        ? read.summary.commands.map((c) => `${c.description} ${c.agent}`)
        : []
    expect(agentsOf(await tailer.read(path))).toEqual(['Explore running null'])

    mkdirSync(subagents, { recursive: true })
    const subFile = join(subagents, 'agent-a1.jsonl')
    const prompt = `${JSON.stringify({ type: 'user', isSidechain: true, message: { role: 'user', content: 'Look' } })}\n`
    writeFileSync(subFile, prompt + bashUse('s1', 'ls src', 'List src'))
    writeFileSync(join(subagents, 'agent-a1.meta.json'), '{"not":"a transcript line"}\n')
    const first = await tailer.read(path)
    expect(agentsOf(first)).toEqual(['Explore running 1'])
    expect(tagged(first)).toEqual(['Show status null', 'List src Explore'])
    const version = first.state === 'conversation' ? first.version : -1
    expect(await tailer.read(path, version)).toEqual({ state: 'unchanged' })

    reads = []
    const size = Buffer.byteLength(prompt + bashUse('s1', 'ls src', 'List src'))
    appendFileSync(subFile, bashResult('s1', 'a'))
    const second = await tailer.read(path, version)
    expect(commandsOf(second)).toEqual(['Show status running', 'List src ok'])
    expect(reads).toEqual([`${size}+${Buffer.byteLength(bashResult('s1', 'a'))}`])
  })

  it("answers an error with the reason when the transcript can't be read (D12)", async () => {
    const failing: TailFs = {
      stat: tailFs.stat,
      open: () => Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' }))
    }
    expect(await new TranscriptTailer({ fs: failing }).read(path)).toEqual({
      state: 'error',
      reason: 'EACCES'
    })
  })

  it('opens nothing for a refused request (AC16)', async () => {
    const opened: string[] = []
    const tailer = new TranscriptTailer({
      fs: { stat: tailFs.stat, open: (p) => (opened.push(p), tailFs.open(p)) }
    })
    for (const request of [
      { folder, sessionId: '../../etc/passwd' },
      { folder: 'repo', sessionId: SESSION }
    ]) {
      expect(await readAgentSummary(request, { home, fs, tailer })).toMatchObject({
        state: 'error'
      })
    }
    expect(opened).toEqual([])
    expect(asked).toEqual([])
  })

  it("passes the asker's version through readAgentSummary", async () => {
    const tailer = new TranscriptTailer({ fs: tailFs })
    const first = await readAgentSummary({ folder, sessionId: SESSION }, { home, fs, tailer })
    const since = first.state === 'conversation' ? first.version : -1
    expect(
      await readAgentSummary({ folder, sessionId: SESSION, since }, { home, fs, tailer })
    ).toEqual({ state: 'unchanged' })
  })
})

describe("a shell's transcript, found by its session id (#75 D3a, D4)", () => {
  const lookupFs = {
    readdir: (path: string) => {
      asked.push(path)
      return readdir(path)
    },
    stat: (path: string) => {
      asked.push(path)
      return stat(path)
    }
  }

  it('finds the session in any one project folder, the newest file if several match', async () => {
    expect(await findSessionTranscript(home, SESSION, lookupFs)).toBeNull()
    const older = writeTranscript('/some/other/folder')
    expect(await findSessionTranscript(home, SESSION, lookupFs)).toBe(older)
    const newer = writeTranscript('/yet/another')
    utimesSync(older, new Date(1_000_000), new Date(1_000_000))
    expect(await findSessionTranscript(home, SESSION, lookupFs)).toBe(newer)
    utimesSync(newer, new Date(500_000), new Date(500_000))
    expect(await findSessionTranscript(home, SESSION, lookupFs)).toBe(older)
  })

  it('looks one level down only, and takes no folder named like the session', async () => {
    const deep = join(home, '.claude', 'projects', 'a', 'b', `${SESSION}.jsonl`)
    mkdirSync(join(deep, '..'), { recursive: true })
    writeFileSync(deep, '{}\n')
    mkdirSync(join(home, '.claude', 'projects', 'c', `${SESSION}.jsonl`), { recursive: true })
    expect(await findSessionTranscript(home, SESSION, lookupFs)).toBeNull()
  })

  it("reads the found transcript's summary, none while there is none", async () => {
    const tailer = new TranscriptTailer()
    expect(
      await readSessionSummary({ sessionId: SESSION }, { home, fs: lookupFs, tailer })
    ).toEqual({ state: 'none' })
    writeTranscript('/some/other/folder')
    const read = await readSessionSummary({ sessionId: SESSION }, { home, fs: lookupFs, tailer })
    expect(read).toMatchObject({ state: 'conversation' })
    const since = read.state === 'conversation' ? read.version : -1
    expect(
      await readSessionSummary({ sessionId: SESSION, since }, { home, fs: lookupFs, tailer })
    ).toEqual({ state: 'unchanged' })
  })

  it('refuses a session id that is not a UUID, reading nothing', async () => {
    writeTranscript('/some/other/folder')
    for (const sessionId of ['../../etc/passwd', '*', `../${SESSION}`, '', 7, null]) {
      expect(await readSessionSummary({ sessionId }, { home, fs: lookupFs })).toEqual({
        state: 'error',
        reason: 'invalid session id'
      })
    }
    expect(asked).toEqual([])
  })
})
