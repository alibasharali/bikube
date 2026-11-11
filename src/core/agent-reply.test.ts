import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cutReply, MAX_REPLY_LENGTH, readLastReply } from './agent-reply'
import { transcriptPath } from './agent-transcript'

const SESSION = '11111111-2222-4333-8444-555555555555'
let home: string
let folder: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'bikube-reply-home-'))
  folder = await mkdtemp(join(tmpdir(), 'bikube-reply-folder-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
  await rm(folder, { recursive: true, force: true })
})

const assistant = (
  id: string,
  content: unknown[],
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  type: 'assistant',
  message: { id, role: 'assistant', model: 'claude-x', content },
  ...extra
})
const text = (value: string): unknown => ({ type: 'text', text: value })
const tool = (id: string): unknown => ({ type: 'tool_use', id, name: 'Bash', input: {} })
const user = (content: unknown): Record<string, unknown> => ({
  type: 'user',
  message: { role: 'user', content }
})

async function transcript(entries: unknown[], tail = '\n'): Promise<void> {
  const path = transcriptPath(home, folder, SESSION)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, entries.map((e) => JSON.stringify(e)).join('\n') + tail)
}

const read = (chunk?: number): ReturnType<typeof readLastReply> =>
  readLastReply({ folder, sessionId: SESSION }, { home, ...(chunk && { chunk }) })

describe('readLastReply (#81 D21)', () => {
  it("prints the last main-agent message's text blocks, joined by blank lines", async () => {
    await transcript([
      user('review it'),
      assistant('m1', [text('Looking.'), tool('t1')]),
      user([{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
      assistant('m2', [text('Found 2 issues.'), text('Both in a.ts.')]),
      assistant('m3', [text('a subagent')], { isSidechain: true }),
      assistant('m4', [tool('t2')])
    ])
    expect(await read()).toEqual({ state: 'reply', text: 'Found 2 issues.\n\nBoth in a.ts.' })
  })

  it("joins one message's streamed entries, each block once", async () => {
    await transcript([
      assistant('m1', [text('Old.')]),
      user('go on'),
      assistant('m2', [text('First.')]),
      assistant('m2', [tool('t1')]),
      assistant('m2', [text('Second.')]),
      assistant('m2', [text('First.'), text('Second.')])
    ])
    expect(await read()).toEqual({ state: 'reply', text: 'First.\n\nSecond.' })
  })

  it('reads lines across small chunks and multi-byte text, ignoring a half-written last line', async () => {
    await transcript(
      [assistant('m1', [text('Fünf 🎉 Probleme.')]), user('next')],
      '\n{"type":"assi'
    )
    expect(await read(7)).toEqual({ state: 'reply', text: 'Fünf 🎉 Probleme.' })
  })

  it('is none with no transcript, or no assistant text in it', async () => {
    expect(await read()).toEqual({ state: 'none' })
    await transcript([user('hello'), assistant('m1', [tool('t1')]), 'not json'])
    expect(await read()).toEqual({ state: 'none' })
  })

  it('refuses a session that is not a UUID or a folder that is not an absolute existing one', async () => {
    const refused = { state: 'error' }
    expect(await readLastReply({ folder, sessionId: '../x' }, { home })).toMatchObject(refused)
    expect(await readLastReply({ folder: 'rel', sessionId: SESSION }, { home })).toMatchObject(
      refused
    )
    expect(
      await readLastReply({ folder: join(folder, 'gone'), sessionId: SESSION }, { home })
    ).toMatchObject(refused)
  })

  it('keeps the end of a reply over 100,000 characters, with … first', async () => {
    const long = `${'a'.repeat(10)}${'b'.repeat(MAX_REPLY_LENGTH)}`
    await transcript([assistant('m1', [text(long)])])
    const reply = await read()
    expect(reply).toEqual({ state: 'reply', text: `…${'b'.repeat(MAX_REPLY_LENGTH - 1)}` })
  })
})

describe('cutReply', () => {
  it('leaves a reply of 100,000 characters, and never splits a surrogate pair', () => {
    const most = 'x'.repeat(MAX_REPLY_LENGTH)
    expect(cutReply(most)).toBe(most)
    const cut = cutReply(`a${'🎉'.repeat(MAX_REPLY_LENGTH)}`)
    expect(cut.startsWith('…🎉')).toBe(true)
    expect(cut.length).toBeLessThanOrEqual(MAX_REPLY_LENGTH)
  })
})
