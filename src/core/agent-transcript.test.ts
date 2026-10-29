import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readAgentSummary, transcriptPath, type TranscriptFs } from './agent-transcript'
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
      expect(await readAgentSummary({ folder: spelled, sessionId: SESSION }, { home, fs })).toEqual(
        { state: 'conversation' }
      )
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
