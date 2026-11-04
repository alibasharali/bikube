import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ListedOutputs,
  openListedOutput,
  revealListedOutput,
  type OutputActionDeps
} from './agent-output-open'
import { TranscriptTailer, readAgentSummary, readSessionSummary } from './agent-transcript'
import { encodeProjectFolder } from './claude-stats'

const SESSION = '0b6f1c1e-5d2a-4c1b-9a8e-3f1d2c4b5a69'
const OTHER = '1c7f2d2f-6e3b-4d2c-8b9f-4a2e3d5c6b7a'

let root: string
let home: string
let folder: string
let opened: string[]
let revealed: string[]

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bikube-agent-outputs-'))
  home = join(root, 'home')
  folder = join(root, 'repo')
  mkdirSync(join(home, 'Downloads'), { recursive: true })
  mkdirSync(folder)
  opened = []
  revealed = []
})

afterEach(() => {
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
})
