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
  copyFileSync: (from, to) => {
    copies.push(from)
    fs.copyFileSync(from, to)
  },
  utimesSync: fs.utimesSync,
  renameSync: fs.renameSync,
  rmSync: (path, options) => fs.rmSync(path, options),
  readdirSync: (path) => fs.readdirSync(path)
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
  it('copies the transcript into the card’s folder, 0700 and 0600 (D10)', () => {
    putTranscript('{"a":1}\n')
    expect(backups.backup(CARD, folder, SESSION)).toBe('copied')
    const copy = join(cardDir(), `${SESSION}.jsonl`)
    expect(readFileSync(copy, 'utf8')).toBe('{"a":1}\n')
    expect(mode(dir)).toBe(0o700)
    expect(mode(cardDir())).toBe(0o700)
    expect(mode(copy)).toBe(0o600)
    expect(readdirSync(cardDir())).toEqual([`${SESSION}.jsonl`])
  })

  it('copies again only when the size or mtime changed (D9)', () => {
    putTranscript('{"a":1}\n')
    backups.backup(CARD, folder, SESSION)
    expect(backups.backup(CARD, folder, SESSION)).toBe('unchanged')
    expect(copies).toHaveLength(1)

    appendFileSync(transcript(), '{"b":2}\n')
    expect(backups.backup(CARD, folder, SESSION)).toBe('copied')
    expect(readFileSync(join(cardDir(), `${SESSION}.jsonl`), 'utf8')).toBe('{"a":1}\n{"b":2}\n')

    // Same size, another mtime.
    writeFileSync(transcript(), '{"a":1}\n{"b":3}\n')
    utimesSync(transcript(), new Date(1_000_000), new Date(1_000_000))
    expect(backups.backup(CARD, folder, SESSION)).toBe('copied')
    expect(readFileSync(join(cardDir(), `${SESSION}.jsonl`), 'utf8')).toBe('{"a":1}\n{"b":3}\n')
    expect(backups.backup(CARD, folder, SESSION)).toBe('unchanged')
  })

  it('copies the session’s folder beside the transcript, links left out', () => {
    putTranscript('{}\n')
    const subagents = join(projectDir(), SESSION, 'subagents')
    mkdirSync(subagents, { recursive: true })
    writeFileSync(join(subagents, 'agent-a.jsonl'), 'sub\n')
    symlinkSync('/etc/passwd', join(subagents, 'link'))
    expect(backups.backup(CARD, folder, SESSION)).toBe('copied')
    const copied = join(cardDir(), SESSION, 'subagents')
    expect(readFileSync(join(copied, 'agent-a.jsonl'), 'utf8')).toBe('sub\n')
    expect(readdirSync(copied)).toEqual(['agent-a.jsonl'])
    expect(mode(join(cardDir(), SESSION))).toBe(0o700)
    expect(mode(copied)).toBe(0o700)
    expect(mode(join(copied, 'agent-a.jsonl'))).toBe(0o600)
    expect(readdirSync(cardDir()).sort()).toEqual([SESSION, `${SESSION}.jsonl`])
  })

  it('leaves the backup as it was when the transcript is missing (D9)', () => {
    putTranscript('{}\n')
    backups.backup(CARD, folder, SESSION)
    rmSync(transcript())
    expect(backups.backup(CARD, folder, SESSION)).toBe('missing')
    expect(readFileSync(join(cardDir(), `${SESSION}.jsonl`), 'utf8')).toBe('{}\n')
    expect(backups.backup('card-2', folder, SESSION)).toBe('missing')
    expect(existsSync(cardDir('card-2'))).toBe(false)
  })

  it('keeps only the current session: a new session id removes the old one’s files (D10)', () => {
    putTranscript('{}\n')
    mkdirSync(join(projectDir(), SESSION))
    writeFileSync(join(projectDir(), SESSION, 'x'), 'x')
    backups.backup(CARD, folder, SESSION)
    putTranscript('{"new":1}\n', OTHER)
    expect(backups.backup(CARD, folder, OTHER)).toBe('copied')
    expect(readdirSync(cardDir())).toEqual([`${OTHER}.jsonl`])
  })

  it('refuses a session id that isn’t a UUID, a relative or missing folder, reading nothing', () => {
    putTranscript('{}\n')
    expect(backups.backup(CARD, folder, '../x')).toBe('refused')
    expect(backups.backup(CARD, 'repo', SESSION)).toBe('refused')
    expect(backups.backup(CARD, join(root, 'gone'), SESSION)).toBe('refused')
    expect(backups.backup(CARD, transcript(), SESSION)).toBe('refused')
    expect(backups.backup('', folder, SESSION)).toBe('refused')
    expect(copies).toEqual([])
    expect(existsSync(dir)).toBe(false)
  })
})

describe('delete and prune', () => {
  it('deletes a card’s backups', () => {
    putTranscript('{}\n')
    backups.backup(CARD, folder, SESSION)
    backups.delete(CARD)
    expect(existsSync(cardDir())).toBe(false)
    backups.delete('card-none')
  })

  it('prunes every card not kept, and nothing without a folder', () => {
    backups.prune([CARD])
    putTranscript('{}\n')
    backups.backup(CARD, folder, SESSION)
    backups.backup('card-2', folder, SESSION)
    writeFileSync(join(dir, 'stray.tmp'), '')
    backups.prune([CARD])
    expect(readdirSync(dir)).toEqual([sha(CARD)])
  })
})
