import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { encodeProjectFolder } from './claude-stats'
import { TranscriptBackups, type BackupFs } from './transcript-backups'

// A local Claude Code card's transcript backups (#80 D8–D10), on real temp folders.

const CARD = 'card-1'
const SESSION = '0b6f7a52-3c1e-4d7a-9f4e-2a1b3c4d5e6f'
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

let root: string
let home: string
let folder: string
let dir: string
let copies: string[]
let backups: TranscriptBackups

const sha = (id: string): string => createHash('sha256').update(id).digest('hex')
const projectDir = (): string => join(home, '.claude', 'projects', encodeProjectFolder(folder))
const transcript = (id = SESSION): string => join(projectDir(), `${id}.jsonl`)
const cardDir = (id = CARD): string => join(dir, sha(id))
const mode = (path: string): number => statSync(path).mode & 0o777

/** Node's fs, recording each copy's source. */
const recordingFs = (): BackupFs => ({
  mkdirSync: (path, options) => fs.mkdirSync(path, options),
  chmodSync: fs.chmodSync,
  statSync: (path) => fs.statSync(path),
  lstatSync: (path) => fs.lstatSync(path),
  realpathSync: (path) => fs.realpathSync(path),
  copyFileSync: (from, to) => {
    copies.push(from)
    fs.copyFileSync(from, to)
  },
  renameSync: fs.renameSync,
  rmSync: (path, options) => fs.rmSync(path, options),
  readdirSync: (path) => fs.readdirSync(path),
  linkSync: fs.linkSync,
  promises: {
    mkdir: (path, options) => fs.promises.mkdir(path, options),
    chmod: (path, mode) => fs.promises.chmod(path, mode),
    stat: (path) => fs.promises.stat(path),
    lstat: (path) => fs.promises.lstat(path),
    realpath: (path) => fs.promises.realpath(path),
    copyFile: async (from, to) => {
      copies.push(from)
      await fs.promises.copyFile(from, to)
    },
    utimes: (path, atime, mtime) => fs.promises.utimes(path, atime, mtime),
    rename: (from, to) => fs.promises.rename(from, to),
    rm: (path, options) => fs.promises.rm(path, options),
    readdir: (path) => fs.promises.readdir(path)
  }
})

/** Writes the session's transcript in the fake home. */
function putTranscript(text: string, id = SESSION): void {
  mkdirSync(projectDir(), { recursive: true })
  writeFileSync(transcript(id), text)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bikube-backups-'))
  home = join(root, 'home')
  folder = join(root, 'repo')
  dir = join(root, 'userData', 'transcripts')
  mkdirSync(home)
  mkdirSync(folder)
  copies = []
  backups = new TranscriptBackups({ dir, home: () => home, fs: recordingFs(), log: () => {} })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('backup', () => {
  it('copies the transcript into the card’s folder, 0700 and 0600 (D10)', async () => {
    putTranscript('{"a":1}\n')
    expect(await backups.backup(CARD, folder, SESSION)).toBe('copied')
    const copy = join(cardDir(), `${SESSION}.jsonl`)
    expect(readFileSync(copy, 'utf8')).toBe('{"a":1}\n')
    expect(mode(dir)).toBe(0o700)
    expect(mode(cardDir())).toBe(0o700)
    expect(mode(copy)).toBe(0o600)
    expect(readdirSync(cardDir())).toEqual([`${SESSION}.jsonl`])
  })

  it('copies again only when the size or mtime changed (D9)', async () => {
    putTranscript('{"a":1}\n')
    await backups.backup(CARD, folder, SESSION)
    expect(await backups.backup(CARD, folder, SESSION)).toBe('unchanged')
    expect(copies).toHaveLength(1)

    appendFileSync(transcript(), '{"b":2}\n')
    expect(await backups.backup(CARD, folder, SESSION)).toBe('copied')
    expect(readFileSync(join(cardDir(), `${SESSION}.jsonl`), 'utf8')).toBe('{"a":1}\n{"b":2}\n')

    // Same size, another mtime.
    writeFileSync(transcript(), '{"a":1}\n{"b":3}\n')
    utimesSync(transcript(), new Date(1_000_000), new Date(1_000_000))
    expect(await backups.backup(CARD, folder, SESSION)).toBe('copied')
    expect(readFileSync(join(cardDir(), `${SESSION}.jsonl`), 'utf8')).toBe('{"a":1}\n{"b":3}\n')
    expect(await backups.backup(CARD, folder, SESSION)).toBe('unchanged')
  })

  it('copies the session’s folder beside the transcript, links left out', async () => {
    putTranscript('{}\n')
    const subagents = join(projectDir(), SESSION, 'subagents')
    mkdirSync(subagents, { recursive: true })
    writeFileSync(join(subagents, 'agent-a.jsonl'), 'sub\n')
    symlinkSync('/etc/passwd', join(subagents, 'link'))
    expect(await backups.backup(CARD, folder, SESSION)).toBe('copied')
    const copied = join(cardDir(), SESSION, 'subagents')
    expect(readFileSync(join(copied, 'agent-a.jsonl'), 'utf8')).toBe('sub\n')
    expect(readdirSync(copied)).toEqual(['agent-a.jsonl'])
    expect(mode(join(cardDir(), SESSION))).toBe(0o700)
    expect(mode(copied)).toBe(0o700)
    expect(mode(join(copied, 'agent-a.jsonl'))).toBe(0o600)
    expect(readdirSync(cardDir()).sort()).toEqual([SESSION, `${SESSION}.jsonl`])
  })

  it('leaves the backup as it was when the transcript is missing (D9)', async () => {
    putTranscript('{}\n')
    await backups.backup(CARD, folder, SESSION)
    rmSync(transcript())
    expect(await backups.backup(CARD, folder, SESSION)).toBe('missing')
    expect(readFileSync(join(cardDir(), `${SESSION}.jsonl`), 'utf8')).toBe('{}\n')
    expect(await backups.backup('card-2', folder, SESSION)).toBe('missing')
    expect(existsSync(cardDir('card-2'))).toBe(false)
  })

  it('keeps only the current session: a new session id removes the old one’s files (D10)', async () => {
    putTranscript('{}\n')
    mkdirSync(join(projectDir(), SESSION))
    writeFileSync(join(projectDir(), SESSION, 'x'), 'x')
    await backups.backup(CARD, folder, SESSION)
    putTranscript('{"new":1}\n', OTHER)
    expect(await backups.backup(CARD, folder, OTHER)).toBe('copied')
    expect(readdirSync(cardDir())).toEqual([`${OTHER}.jsonl`])
  })

  it('keeps a longer backup of the same session over a shorter transcript, logging once', async () => {
    const logged: string[] = []
    backups = new TranscriptBackups({
      dir,
      home: () => home,
      fs: recordingFs(),
      log: (m) => logged.push(m)
    })
    putTranscript('{"a":1}\n{"b":2}\n')
    await backups.backup(CARD, folder, SESSION)
    // Claude Code's cleanup deleted it and a later write made it again with only new entries.
    putTranscript('{"c":3}\n')
    expect(await backups.backup(CARD, folder, SESSION)).toBe('kept')
    expect(await backups.backup(CARD, folder, SESSION)).toBe('kept')
    expect(readFileSync(join(cardDir(), `${SESSION}.jsonl`), 'utf8')).toBe('{"a":1}\n{"b":2}\n')
    expect(logged).toHaveLength(1)
    // A new session id still replaces it.
    putTranscript('{}\n', OTHER)
    expect(await backups.backup(CARD, folder, OTHER)).toBe('copied')
    expect(readdirSync(cardDir())).toEqual([`${OTHER}.jsonl`])
  })

  it('finds the transcript under the folder’s real path when reached through a link', async () => {
    const link = join(root, 'link')
    symlinkSync(folder, link)
    putTranscript('{"real":1}\n')
    expect(await backups.backup(CARD, link, SESSION)).toBe('copied')
    expect(readFileSync(join(cardDir(), `${SESSION}.jsonl`), 'utf8')).toBe('{"real":1}\n')
    expect(await backups.prepare(CARD, link, SESSION)).toBe('present')
    // Gone: restored under the real path's project folder, which exists.
    rmSync(transcript())
    expect(await backups.prepare(CARD, link, SESSION)).toBe('restored')
    expect(readFileSync(transcript(), 'utf8')).toBe('{"real":1}\n')
    // With no project folder for either, restored under the path as given.
    rmSync(join(home, '.claude'), { recursive: true, force: true })
    expect(await backups.prepare(CARD, link, SESSION)).toBe('restored')
    const given = join(home, '.claude', 'projects', encodeProjectFolder(link), `${SESSION}.jsonl`)
    expect(readFileSync(given, 'utf8')).toBe('{"real":1}\n')
  })

  it('copies only the session folder’s changed files, removing those gone', async () => {
    putTranscript('{}\n')
    const sessionDir = join(projectDir(), SESSION)
    mkdirSync(sessionDir)
    writeFileSync(join(sessionDir, 'a.json'), 'a')
    writeFileSync(join(sessionDir, 'b.json'), 'b')
    await backups.backup(CARD, folder, SESSION)
    copies = []
    appendFileSync(transcript(), '{}\n')
    writeFileSync(join(sessionDir, 'b.json'), 'bb')
    rmSync(join(sessionDir, 'a.json'))
    expect(await backups.backup(CARD, folder, SESSION)).toBe('copied')
    expect(copies.sort()).toEqual([join(sessionDir, 'b.json'), transcript()].sort())
    expect(readdirSync(join(cardDir(), SESSION))).toEqual(['b.json'])
    expect(readFileSync(join(cardDir(), SESSION, 'b.json'), 'utf8')).toBe('bb')
  })

  it('runs one card’s backups one at a time, and idle waits for them', async () => {
    putTranscript('{}\n')
    const first = backups.backup(CARD, folder, SESSION)
    const second = backups.backup(CARD, folder, SESSION)
    await backups.idle()
    expect(await first).toBe('copied')
    expect(await second).toBe('unchanged')
  })

  it('goes on with a card’s queue after a task that threw, and is busy only while one runs', async () => {
    putTranscript('{}\n')
    let fail = true
    const base = recordingFs()
    const failing: BackupFs = {
      ...base,
      promises: {
        ...base.promises,
        mkdir: (path, options) =>
          fail ? Promise.reject(new Error('disk full')) : base.promises.mkdir(path, options)
      }
    }
    const throwing = new TranscriptBackups({
      dir,
      home: () => home,
      fs: failing,
      log: () => {
        throw new Error('log broke')
      }
    })
    expect(throwing.busy()).toBe(false)
    const first = throwing.backup(CARD, folder, SESSION)
    expect(throwing.busy()).toBe(true)
    fail = true
    const second = throwing.backup(CARD, folder, SESSION).finally(() => (fail = false))
    await expect(first).rejects.toThrow('log broke')
    await expect(second).rejects.toThrow('log broke')
    expect(await throwing.backup(CARD, folder, SESSION)).toBe('copied')
    await throwing.idle()
    expect(throwing.busy()).toBe(false)
  })

  it('refuses a session id that isn’t a UUID, a relative or missing folder, reading nothing', async () => {
    putTranscript('{}\n')
    expect(await backups.backup(CARD, folder, '../x')).toBe('refused')
    expect(await backups.backup(CARD, 'repo', SESSION)).toBe('refused')
    expect(await backups.backup(CARD, join(root, 'gone'), SESSION)).toBe('refused')
    expect(await backups.backup(CARD, transcript(), SESSION)).toBe('refused')
    expect(await backups.backup('', folder, SESSION)).toBe('refused')
    expect(copies).toEqual([])
    expect(existsSync(dir)).toBe(false)
  })
})

describe('delete and prune', () => {
  it('deletes a card’s backups', async () => {
    putTranscript('{}\n')
    await backups.backup(CARD, folder, SESSION)
    await backups.delete(CARD)
    expect(existsSync(cardDir())).toBe(false)
    await backups.delete('card-none')
  })

  it('prunes every card not kept, and nothing without a folder', async () => {
    backups.prune([CARD])
    putTranscript('{}\n')
    await backups.backup(CARD, folder, SESSION)
    await backups.backup('card-2', folder, SESSION)
    writeFileSync(join(dir, 'stray.tmp'), '')
    backups.prune([CARD])
    expect(readdirSync(dir)).toEqual([sha(CARD)])
  })
})

describe('prepare (D11)', () => {
  it('answers present when the transcript is there, touching nothing', async () => {
    putTranscript('{"a":1}\n')
    expect(await backups.prepare(CARD, folder, SESSION)).toBe('present')
    expect(copies).toEqual([])
  })

  it('restores the backed-up transcript and its folder when the transcript is gone', async () => {
    putTranscript('{"a":1}\n')
    mkdirSync(join(projectDir(), SESSION, 'subagents'), { recursive: true })
    writeFileSync(join(projectDir(), SESSION, 'subagents', 'agent-a.jsonl'), '{"sub":1}\n')
    const old = new Date(Date.now() - 40 * 86_400_000)
    utimesSync(transcript(), old, old)
    utimesSync(join(projectDir(), SESSION, 'subagents', 'agent-a.jsonl'), old, old)
    expect(await backups.backup(CARD, folder, SESSION)).toBe('copied')
    rmSync(join(home, '.claude'), { recursive: true, force: true })

    expect(await backups.prepare(CARD, folder, SESSION)).toBe('restored')
    expect(readFileSync(transcript(), 'utf8')).toBe('{"a":1}\n')
    expect(readFileSync(join(projectDir(), SESSION, 'subagents', 'agent-a.jsonl'), 'utf8')).toBe(
      '{"sub":1}\n'
    )
    expect(readdirSync(projectDir()).sort()).toEqual([SESSION, `${SESSION}.jsonl`])
    // Restored files get the current time, so Claude Code's cleanup at the resuming `claude`'s
    // start doesn't find them old again; the next backup copies the transcript once more.
    const now = Date.now()
    expect(statSync(transcript()).mtimeMs).toBeGreaterThan(now - 60_000)
    const sub = join(projectDir(), SESSION, 'subagents', 'agent-a.jsonl')
    expect(statSync(sub).mtimeMs).toBeGreaterThan(now - 60_000)
    expect(await backups.backup(CARD, folder, SESSION)).toBe('copied')
    expect(await backups.backup(CARD, folder, SESSION)).toBe('unchanged')
  })

  it('answers missing with no transcript and no backup of that session', async () => {
    expect(await backups.prepare(CARD, folder, SESSION)).toBe('missing')
    putTranscript('{}\n', OTHER)
    await backups.backup(CARD, folder, OTHER)
    rmSync(transcript(OTHER))
    expect(await backups.prepare(CARD, folder, SESSION)).toBe('missing')
    expect(existsSync(transcript())).toBe(false)
  })

  it('never overwrites a transcript or folder that appeared meanwhile', async () => {
    putTranscript('{"old":1}\n')
    mkdirSync(join(projectDir(), SESSION))
    writeFileSync(join(projectDir(), SESSION, 'a.json'), 'old')
    await backups.backup(CARD, folder, SESSION)
    rmSync(transcript())
    writeFileSync(join(projectDir(), SESSION, 'a.json'), 'new')
    // The transcript appears between the check and the copy: a link onto it fails.
    const fsWithRace: BackupFs = {
      ...recordingFs(),
      linkSync: (from, to) => {
        writeFileSync(to, '{"new":1}\n')
        fs.linkSync(from, to)
      }
    }
    const racing = new TranscriptBackups({ dir, home: () => home, fs: fsWithRace, log: () => {} })
    expect(await racing.prepare(CARD, folder, SESSION)).toBe('present')
    expect(readFileSync(transcript(), 'utf8')).toBe('{"new":1}\n')
    expect(readFileSync(join(projectDir(), SESSION, 'a.json'), 'utf8')).toBe('new')
    expect(readdirSync(projectDir()).sort()).toEqual([SESSION, `${SESSION}.jsonl`])
  })

  it('refuses what backup refuses, reading nothing', async () => {
    expect(await backups.prepare(CARD, folder, '../x')).toBe('refused')
    expect(await backups.prepare(CARD, 'repo', SESSION)).toBe('refused')
    expect(await backups.prepare(CARD, join(root, 'gone'), SESSION)).toBe('refused')
    expect(await backups.prepare('', folder, SESSION)).toBe('refused')
    expect(existsSync(join(home, '.claude'))).toBe(false)
  })
})
