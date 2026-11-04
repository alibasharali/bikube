import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ListedOutputs,
  openListedOutput,
  revealListedOutput,
  type OutputActionDeps
} from './agent-output-open'
import {
  TAIL_DROP_MS,
  TranscriptTailer,
  readAgentSummary,
  readSessionSummary
} from './agent-transcript'
import { encodeProjectFolder } from './claude-stats'

const SESSION = '0b6f1c1e-5d2a-4c1b-9a8e-3f1d2c4b5a69'
const OTHER = '1c7f2d2f-6e3b-4d2c-8b9f-4a2e3d5c6b7a'

let root: string
let home: string
let folder: string
let opened: string[]
let revealed: string[]

beforeEach(() => {
  // Real, so opened paths (by real path) compare with the written ones on macOS's /var link.
  root = realpathSync(mkdtempSync(join(tmpdir(), 'bikube-agent-outputs-')))
  home = join(root, 'home')
  folder = join(root, 'repo')
  mkdirSync(join(home, 'Downloads'), { recursive: true })
  mkdirSync(folder)
  opened = []
  revealed = []
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(root, { recursive: true, force: true })
})

const reply = (text: string): string =>
  `${JSON.stringify({
    type: 'assistant',
    timestamp: '2026-10-29T14:32:00.000Z',
    message: { model: 'claude-opus-4-8', content: [{ type: 'text', text }] }
  })}\n`

function writeTranscript(text: string, dir = folder, id = SESSION): void {
  const path = join(home, '.claude', 'projects', encodeProjectFolder(dir), `${id}.jsonl`)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, reply(text))
}

const deps = (listed: ListedOutputs, failure = ''): OutputActionDeps => ({
  listed,
  openPath: async (path: string) => {
    opened.push(path)
    return failure
  },
  reveal: (path: string) => {
    revealed.push(path)
  }
})

describe("opening the Agent tab's files (#79 D2, D10)", () => {
  it('opens and reveals only a file the last summary listed for the session, as the summary gave it', async () => {
    writeFileSync(join(home, 'Downloads', 'a.pdf'), 'pdf')
    writeFileSync(join(home, 'Downloads', 'secret.pdf'), 'pdf')
    writeTranscript('Saved ~/Downloads/a.pdf')
    const listed = new ListedOutputs()
    const tailer = new TranscriptTailer()
    await readAgentSummary({ folder, sessionId: SESSION }, { home, tailer, listed })

    const a = join(home, 'Downloads', 'a.pdf')
    expect(await openListedOutput(SESSION, '~/Downloads/a.pdf', deps(listed))).toEqual({ ok: true })
    expect(await revealListedOutput(SESSION, '~/Downloads/a.pdf', deps(listed))).toBe(true)
    expect(opened).toEqual([a])
    expect(revealed).toEqual([a])

    // Never listed, another spelling, another session, or not a session id: nothing runs.
    for (const [session, path] of [
      [SESSION, '~/Downloads/secret.pdf'],
      [SESSION, a],
      [SESSION, '~/Downloads/../Downloads/a.pdf'],
      [OTHER, '~/Downloads/a.pdf'],
      ['../x', '~/Downloads/a.pdf'],
      [SESSION, 7]
    ] as const) {
      expect(await openListedOutput(session, path, deps(listed))).toEqual({
        ok: false,
        reason: 'refused'
      })
      expect(await revealListedOutput(session, path, deps(listed))).toBe(false)
    }
    expect(opened).toEqual([a])
    expect(revealed).toEqual([a])
  })

  it('refuses a listed file deleted or replaced by a folder since', async () => {
    const a = join(home, 'Downloads', 'a.pdf')
    writeFileSync(a, 'pdf')
    writeTranscript('Saved ~/Downloads/a.pdf')
    const listed = new ListedOutputs()
    await readAgentSummary({ folder, sessionId: SESSION }, { home, listed })
    rmSync(a)
    expect(await openListedOutput(SESSION, '~/Downloads/a.pdf', deps(listed))).toEqual({
      ok: false,
      reason: 'refused'
    })
    mkdirSync(a)
    expect(await revealListedOutput(SESSION, '~/Downloads/a.pdf', deps(listed))).toBe(false)
    expect(opened).toEqual([])
    expect(revealed).toEqual([])
  })

  it("gives the default app's failure", async () => {
    writeFileSync(join(home, 'Downloads', 'a.pdf'), 'pdf')
    writeTranscript('Saved ~/Downloads/a.pdf')
    const listed = new ListedOutputs()
    await readAgentSummary({ folder, sessionId: SESSION }, { home, listed })
    expect(
      await openListedOutput(SESSION, '~/Downloads/a.pdf', deps(listed, 'No application'))
    ).toEqual({ ok: false, reason: 'failed', message: 'No application' })
  })

  it("keeps the set through unchanged answers, drops a file the next summary leaves out, and records a shell's summary", async () => {
    const a = join(home, 'Downloads', 'a.pdf')
    writeFileSync(a, 'pdf')
    writeTranscript('Saved ~/Downloads/a.pdf', '/some/other/folder')
    const listed = new ListedOutputs()
    const tailer = new TranscriptTailer()
    const first = await readSessionSummary({ sessionId: SESSION }, { home, tailer, listed })
    const since = first.state === 'conversation' ? first.version : -1
    expect(
      await readSessionSummary({ sessionId: SESSION, since }, { home, tailer, listed })
    ).toEqual({ state: 'unchanged' })
    expect(await revealListedOutput(SESSION, '~/Downloads/a.pdf', deps(listed))).toBe(true)

    rmSync(a)
    await readSessionSummary({ sessionId: SESSION, since }, { home, tailer, listed })
    writeFileSync(a, 'pdf')
    // The last summary sent didn't list it: refused until a summary lists it again.
    expect(await revealListedOutput(SESSION, '~/Downloads/a.pdf', deps(listed))).toBe(false)
  })

  it("opens a link only by its real path, and only when that file's own extension is a document's", async () => {
    const real = join(root, 'real.pdf')
    writeFileSync(real, 'pdf')
    writeFileSync(join(root, 'x.command'), 'echo hi')
    symlinkSync(real, join(home, 'Downloads', 'a.pdf'))
    symlinkSync(join(root, 'x.command'), join(home, 'Downloads', 'b.pdf'))
    writeTranscript('Saved ~/Downloads/a.pdf and ~/Downloads/b.pdf')
    const listed = new ListedOutputs()
    await readAgentSummary({ folder, sessionId: SESSION }, { home, listed })
    expect(await openListedOutput(SESSION, '~/Downloads/a.pdf', deps(listed))).toEqual({ ok: true })
    expect(await openListedOutput(SESSION, '~/Downloads/b.pdf', deps(listed))).toEqual({
      ok: false,
      reason: 'refused'
    })
    expect(opened).toEqual([real])
    // Reveal takes links as listed.
    expect(await revealListedOutput(SESSION, '~/Downloads/b.pdf', deps(listed))).toBe(true)
    expect(revealed).toEqual([join(home, 'Downloads', 'b.pdf')])
  })

  it("forgets a session's files 60 s after its last summary, as the tailer its state", async () => {
    writeFileSync(join(home, 'Downloads', 'a.pdf'), 'pdf')
    writeTranscript('Saved ~/Downloads/a.pdf')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const listed = new ListedOutputs()
    await readAgentSummary({ folder, sessionId: SESSION }, { home, listed })
    vi.advanceTimersByTime(TAIL_DROP_MS - 1000)
    await readAgentSummary({ folder, sessionId: SESSION }, { home, listed })
    vi.advanceTimersByTime(TAIL_DROP_MS - 1000)
    expect(listed.path(SESSION, '~/Downloads/a.pdf')).toBe(join(home, 'Downloads', 'a.pdf'))
    vi.advanceTimersByTime(1000)
    expect(listed.path(SESSION, '~/Downloads/a.pdf')).toBeNull()
  })
})
