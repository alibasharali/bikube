import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpawnResult, TerminalApi, TerminalExit } from '../shared/api'
import {
  CardSessions,
  MAX_TYPEAHEAD_CHARS,
  type CardScreen,
  type StartingCard
} from './card-sessions'
import { READY_MARKER } from './ssh-command'
import type { StartupCommand } from './startup-command'

/** A screen that keeps written text as lines; the cursor sits on the last line. */
class FakeScreen implements CardScreen {
  cols = 80
  rows = 24
  text = ''
  readOnly = false
  disposed = false
  inputListener: ((data: string) => void) | null = null
  resizeListener: ((size: { cols: number; rows: number }) => void) | null = null
  /** Set: write callbacks wait in `parsing` until the test runs them, like a busy xterm. */
  slow = false
  parsing: (() => void)[] = []
  write(data: string, done?: () => void): void {
    this.text += data
    if (this.slow) this.parsing.push(done ?? (() => {}))
    else done?.()
  }
  onInput(listener: (data: string) => void): void {
    this.inputListener = listener
  }
  onResize(listener: (size: { cols: number; rows: number }) => void): void {
    this.resizeListener = listener
  }
  screen(): { lines: string[]; cursorRow: number } {
    const lines = this.text.split(/\r?\n/)
    return { lines, cursorRow: lines.length - 1 }
  }
  setReadOnly(): void {
    this.readOnly = true
  }
  dispose(): void {
    this.disposed = true
  }
  type(data: string): void {
    this.inputListener?.(data)
  }
  resize(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
    this.resizeListener?.({ cols, rows })
  }
}

class FakeApi implements TerminalApi {
  spawns: {
    cols: number
    rows: number
    cwd: string
    cardId?: string
    host?: string | null
    resolve: (r: SpawnResult) => void
  }[] = []
  writes: [string, string][] = []
  resizes: [string, number, number][] = []
  kills: string[] = []
  dataListeners = new Set<(id: string, data: string) => void>()
  exitListeners = new Set<(exit: TerminalExit) => void>()
  spawn(
    cols: number,
    rows: number,
    cwd: string,
    cardId?: string,
    host?: string | null
  ): Promise<SpawnResult> {
    return new Promise((resolve) => this.spawns.push({ cols, rows, cwd, cardId, host, resolve }))
  }
  write(id: string, data: string): void {
    this.writes.push([id, data])
  }
  resize(id: string, cols: number, rows: number): void {
    this.resizes.push([id, cols, rows])
  }
  kill(id: string): void {
    this.kills.push(id)
  }
  acks: [string, number][] = []
  ack(id: string, chars: number): void {
    this.acks.push([id, chars])
  }
  onData(listener: (id: string, data: string) => void): () => void {
    this.dataListeners.add(listener)
    return () => this.dataListeners.delete(listener)
  }
  onExit(listener: (exit: TerminalExit) => void): () => void {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }
  emitData(id: string, data: string): void {
    this.dataListeners.forEach((l) => l(id, data))
  }
  emitExit(exit: TerminalExit): void {
    this.exitListeners.forEach((l) => l(exit))
  }
}

let api: FakeApi
let screens: Map<string, FakeScreen>
let sessions: CardSessions<FakeScreen>

beforeEach(() => {
  vi.useFakeTimers()
  api = new FakeApi()
  screens = new Map()
  sessions = new CardSessions(api, (cardId) => {
    const screen = new FakeScreen()
    screens.set(cardId, screen)
    return screen
  })
})

afterEach(() => {
  vi.useRealTimers()
})

const UUID = '0b6f2c1e-4a5d-4e8f-9a1b-2c3d4e5f6a7b'

/** A Shell card unless `startup` says otherwise. */
function card(
  id: string,
  directory = '/tmp/a',
  startup: StartupCommand = { kind: 'shell' },
  claudeStarted = false
): StartingCard {
  return { id, directory, startup, agentSessionId: UUID, claudeStarted }
}

/** Starts a card and resolves its spawn with `result`. */
async function started(cardId: string, result: SpawnResult, directory = '/tmp/a'): Promise<void> {
  sessions.start(card(cardId, directory))
  api.spawns[api.spawns.length - 1].resolve(result)
  await vi.advanceTimersByTimeAsync(0)
}

describe('CardSessions', () => {
  it('starts the shell in the card directory at the screen size', () => {
    sessions.start(card('c1', '/tmp/alpha'))
    expect(api.spawns).toHaveLength(1)
    expect(api.spawns[0]).toMatchObject({ cols: 80, rows: 24, cwd: '/tmp/alpha' })
    expect(sessions.screen('c1')).toBe(screens.get('c1'))
    expect(sessions.status('c1')).toEqual({ label: 'Running', lastLine: '' })
  })

  it("sends the card's id with the spawn, so its shell knows its card (#9 D3)", () => {
    sessions.start(card('c1', '/tmp/alpha'))
    expect(api.spawns[0].cardId).toBe('c1')
  })

  it('routes output by session to its own card and keeps it while no view is open', async () => {
    await started('c1', { ok: true, id: 's1' })
    await started('c2', { ok: true, id: 's2' })
    api.emitData('s1', 'one\r\n$ ')
    api.emitData('s2', 'two')
    api.emitData('other', 'stray')
    expect(screens.get('c1')!.text).toBe('one\r\n$ ')
    expect(screens.get('c2')!.text).toBe('two')
  })

  it('updates the status with the last output line at most every 250 ms', async () => {
    await started('c1', { ok: true, id: 's1' })
    const seen: string[] = []
    sessions.subscribe('c1', () => seen.push(sessions.status('c1')!.lastLine))
    api.emitData('s1', 'first')
    expect(sessions.status('c1')).toEqual({ label: 'Running', lastLine: 'first' })
    api.emitData('s1', '\r\nsecond')
    api.emitData('s1', '\r\nthird')
    expect(seen).toEqual(['first'])
    await vi.advanceTimersByTimeAsync(249)
    expect(seen).toEqual(['first'])
    await vi.advanceTimersByTimeAsync(1)
    expect(seen).toEqual(['first', 'third'])
    expect(sessions.status('c1')!.lastLine).toBe('third')
    await vi.advanceTimersByTimeAsync(1000)
    expect(seen).toEqual(['first', 'third'])
  })

  it('sends typing and resizes to the session', async () => {
    await started('c1', { ok: true, id: 's1' })
    screens.get('c1')!.type('ls\r')
    screens.get('c1')!.resize(120, 40)
    expect(api.writes).toEqual([['s1', 'ls\r']])
    expect(api.resizes).toContainEqual(['s1', 120, 40])
  })

  it('resizes the session to a size that changed while the shell was starting', async () => {
    sessions.start(card('c1', '/tmp/a'))
    screens.get('c1')!.resize(100, 30)
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.resizes).toEqual([['s1', 100, 30]])
  })

  it('on exit is Stopped at once with no last line, and its screen is gone (#5 D6)', async () => {
    await started('c1', { ok: true, id: 's1' })
    api.emitData('s1', 'bye')
    const listener = vi.fn()
    sessions.subscribe('c1', listener)
    const screen = screens.get('c1')!
    api.emitExit({ id: 's1', exitCode: 3 })
    expect(sessions.status('c1')).toEqual({ label: 'Stopped', lastLine: '' })
    expect(sessions.runState('c1')).toEqual({ kind: 'stopped' })
    expect(listener).toHaveBeenCalled()
    expect(screen.disposed).toBe(true)
    expect(sessions.screen('c1')).toBeUndefined()
    screen.type('echo hi\r')
    api.emitData('s1', 'late')
    expect(api.writes).toEqual([])
    expect(screen.text).toBe('bye')
  })

  it('starts a Stopped card again: a new, empty screen and a new shell (#5 D7)', async () => {
    await started('c1', { ok: true, id: 's1' })
    api.emitData('s1', 'old output')
    api.emitExit({ id: 's1', exitCode: 0 })
    const listener = vi.fn()
    sessions.subscribe('c1', listener)
    await started('c1', { ok: true, id: 's2' }, '/tmp/alpha')
    const screen = sessions.screen('c1')!
    expect(screen).toBe(screens.get('c1'))
    expect(screen.disposed).toBe(false)
    expect(screen.text).toBe('')
    expect(api.spawns).toHaveLength(2)
    expect(api.spawns[1].cwd).toBe('/tmp/alpha')
    expect(sessions.runState('c1')).toEqual({ kind: 'running' })
    expect(sessions.status('c1')).toEqual({ label: 'Running', lastLine: '' })
    expect(listener).toHaveBeenCalled()
    api.emitData('s2', 'new')
    api.emitData('s1', 'stale')
    screen.type('ls\r')
    expect(screen.text).toBe('new')
    expect(api.writes).toEqual([['s2', 'ls\r']])
  })

  it('leaves a running card as it is (#4 D10, #5 D7)', async () => {
    await started('c1', { ok: true, id: 's1' })
    api.emitData('s1', 'kept')
    sessions.start(card('c1', '/tmp/a'))
    expect(api.spawns).toHaveLength(1)
    expect(sessions.screen('c1')!.text).toBe('kept')
  })

  it('types claude --session-id right after the spawn, before any keystroke (#5 D3, D5)', async () => {
    const claudeStarted = vi.fn()
    sessions.start(card('c1', '/tmp/a', { kind: 'claude' }), claudeStarted)
    screens.get('c1')!.type('x')
    expect(api.writes).toEqual([])
    expect(claudeStarted).not.toHaveBeenCalled()
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await vi.advanceTimersByTimeAsync(0)
    screens.get('c1')!.type('y')
    expect(api.writes).toEqual([
      ['s1', `claude --session-id ${UUID}\r`],
      ['s1', 'x'],
      ['s1', 'y']
    ])
    expect(claudeStarted).toHaveBeenCalledTimes(1)
  })

  it('types the resume line on later Claude Code starts without marking again (#5 D5)', async () => {
    const claudeStarted = vi.fn()
    sessions.start(card('c1', '/tmp/a', { kind: 'claude' }, true), claudeStarted)
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.writes).toEqual([['s1', `claude --resume ${UUID} || claude --session-id ${UUID}\r`]])
    expect(claudeStarted).not.toHaveBeenCalled()
  })

  it("types a preset's plain command and reports its first start with its kind (#21 D2, D3)", async () => {
    const firstStart = vi.fn()
    sessions.start(card('c1', '/tmp/a', { kind: 'codex' }), firstStart)
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.writes).toEqual([['s1', 'codex\r']])
    expect(firstStart).toHaveBeenCalledExactlyOnceWith('codex')
  })

  it('resumes a started preset without reporting a first start again (#21 D2, D3)', async () => {
    const firstStart = vi.fn()
    sessions.start(
      { ...card('c1', '/tmp/a', { kind: 'gemini' }), startedAgents: ['gemini'] },
      firstStart
    )
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.writes).toEqual([['s1', 'gemini --resume latest || gemini\r']])
    expect(firstStart).not.toHaveBeenCalled()
  })

  it('types a Custom command as written, and nothing for Shell (#5 D2, D3)', async () => {
    const claudeStarted = vi.fn()
    sessions.start(
      card('c1', '/tmp/a', { kind: 'custom', command: 'codex resume --last' }),
      claudeStarted
    )
    sessions.start(card('c2'), claudeStarted)
    api.spawns[0].resolve({ ok: true, id: 's1' })
    api.spawns[1].resolve({ ok: true, id: 's2' })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.writes).toEqual([['s1', 'codex resume --last\r']])
    expect(claudeStarted).not.toHaveBeenCalled()
  })

  it('types nothing and marks nothing when the start fails (#5 D8)', async () => {
    const claudeStarted = vi.fn()
    sessions.start(card('c1', '/gone', { kind: 'claude' }), claudeStarted)
    api.spawns[0].resolve({ ok: false, reason: 'working directory not found' })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.writes).toEqual([])
    expect(claudeStarted).not.toHaveBeenCalled()
  })

  it("shows Couldn't start with the reason when main refuses the spawn", async () => {
    const listener = vi.fn()
    sessions.start(card('c1', '/gone'))
    sessions.subscribe('c1', listener)
    api.spawns[0].resolve({ ok: false, reason: 'working directory not found' })
    await vi.advanceTimersByTimeAsync(0)
    expect(sessions.status('c1')).toEqual({
      label: "Couldn't start: working directory not found",
      lastLine: ''
    })
    expect(sessions.runState('c1')).toEqual({
      kind: 'failed',
      reason: 'working directory not found'
    })
    expect(listener).toHaveBeenCalled()
    expect(screens.get('c1')!.readOnly).toBe(true)
  })

  it("shows Couldn't start when the spawn call itself fails", async () => {
    api.spawn = () => Promise.reject(new Error('boom'))
    sessions.start(card('c1', '/tmp/a'))
    await vi.advanceTimersByTimeAsync(0)
    expect(sessions.status('c1')!.label).toBe("Couldn't start: boom")
  })

  it("retries a card that couldn't start on a new screen, and only when started (#5 D8)", async () => {
    await started('c1', { ok: false, reason: 'working directory not found' }, '/gone')
    const failedScreen = screens.get('c1')!
    await vi.advanceTimersByTimeAsync(5000)
    expect(api.spawns).toHaveLength(1)

    await started('c1', { ok: false, reason: 'working directory not found' }, '/gone')
    expect(failedScreen.disposed).toBe(true)
    expect(sessions.screen('c1')!.text).toBe("Couldn't start: working directory not found\r\n")
    expect(sessions.status('c1')!.label).toBe("Couldn't start: working directory not found")

    await started('c1', { ok: true, id: 's1' }, '/gone')
    expect(api.spawns).toHaveLength(3)
    expect(sessions.runState('c1')).toEqual({ kind: 'running' })
    expect(sessions.screen('c1')!.text).toBe('')
    expect(sessions.screen('c1')!.readOnly).toBe(false)
  })

  it('keeps output that arrives before the spawn reply for the card that gets that session', async () => {
    sessions.start(card('c1', '/tmp/a'))
    api.emitData('s1', 'early ')
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await vi.advanceTimersByTimeAsync(0)
    api.emitData('s1', 'late')
    expect(screens.get('c1')!.text).toBe('early late')
  })

  it('types nothing and marks nothing when the shell exits before the spawn reply', async () => {
    const claudeStarted = vi.fn()
    sessions.start(card('c1', '/tmp/a', { kind: 'claude' }), claudeStarted)
    api.emitExit({ id: 's1', exitCode: 1 })
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.writes).toEqual([])
    expect(claudeStarted).not.toHaveBeenCalled()
    expect(sessions.runState('c1')).toEqual({ kind: 'stopped' })
  })

  it('dispose stops a running process, frees the screen and forgets the card', async () => {
    await started('c1', { ok: true, id: 's1' })
    sessions.dispose('c1')
    expect(api.kills).toEqual(['s1'])
    expect(screens.get('c1')!.disposed).toBe(true)
    expect(sessions.status('c1')).toBeUndefined()
    api.emitData('s1', 'late')
    expect(screens.get('c1')!.text).toBe('')
  })

  it('dispose while the shell is starting kills it once it has started', async () => {
    sessions.start(card('c1', '/tmp/a'))
    sessions.dispose('c1')
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.kills).toEqual(['s1'])
  })
  it('close kills the session and stays Running until the shell exits, then Stopped (#7 D1, D2)', async () => {
    await started('c1', { ok: true, id: 's1' })
    const listener = vi.fn()
    sessions.subscribe('c1', listener)
    sessions.close('c1')
    expect(api.kills).toEqual(['s1'])
    expect(sessions.runState('c1')).toEqual({ kind: 'running' })
    expect(sessions.screen('c1')).toBe(screens.get('c1'))
    api.emitExit({ id: 's1', exitCode: 0 })
    expect(sessions.runState('c1')).toEqual({ kind: 'stopped' })
    expect(sessions.status('c1')).toEqual({ label: 'Stopped', lastLine: '' })
    expect(listener).toHaveBeenCalled()
  })
  it('close leaves an unknown, Stopped or failed card as it is (#7 D1)', async () => {
    sessions.close('nope')
    await started('c1', { ok: true, id: 's1' })
    api.emitExit({ id: 's1', exitCode: 0 })
    sessions.close('c1')
    expect(sessions.runState('c1')).toEqual({ kind: 'stopped' })
    await started('c2', { ok: false, reason: 'no such directory' })
    sessions.close('c2')
    expect(sessions.runState('c2')).toEqual({ kind: 'failed', reason: 'no such directory' })
    expect(screens.get('c2')!.disposed).toBe(false)
    expect(api.kills).toEqual([])
  })

  it('a closed card started again gets a new screen and a new session (#7 D1, #5 D7)', async () => {
    await started('c1', { ok: true, id: 's1' })
    const first = screens.get('c1')!
    sessions.close('c1')
    api.emitExit({ id: 's1', exitCode: 129 })
    await started('c1', { ok: true, id: 's2' })
    const screen = sessions.screen('c1')!
    expect(screen).not.toBe(first)
    expect(first.disposed).toBe(true)
    expect(sessions.runState('c1')).toEqual({ kind: 'running' })
    api.emitData('s2', 'new')
    screen.type('ls\r')
    expect(screen.text).toBe('new')
    expect(api.writes).toEqual([['s2', 'ls\r']])
    expect(api.kills).toEqual(['s1'])
  })

  it('close while the shell is starting kills it once it has started, typing nothing (#7 D2)', async () => {
    const claudeStarted = vi.fn()
    sessions.start(card('c1', '/tmp/a', { kind: 'claude' }), claudeStarted)
    sessions.close('c1')
    sessions.close('c1')
    expect(api.kills).toEqual([])
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.kills).toEqual(['s1'])
    expect(api.writes).toEqual([])
    expect(claudeStarted).not.toHaveBeenCalled()
    expect(sessions.runState('c1')).toEqual({ kind: 'running' })
    api.emitExit({ id: 's1', exitCode: 129 })
    expect(sessions.runState('c1')).toEqual({ kind: 'stopped' })
    await started('c1', { ok: true, id: 's2' })
    expect(api.kills).toEqual(['s1'])
    expect(sessions.runState('c1')).toEqual({ kind: 'running' })
  })
})

describe('deferred spawns (#22)', () => {
  let deferred: (() => void)[]

  beforeEach(() => {
    deferred = []
    sessions = new CardSessions(
      api,
      (cardId) => {
        const screen = new FakeScreen()
        screens.set(cardId, screen)
        return screen
      },
      undefined,
      (spawn) => deferred.push(spawn)
    )
  })

  /** Runs the spawns waiting in the deferral. */
  function runDeferred(): void {
    deferred.splice(0).forEach((spawn) => spawn())
  }

  it('is Running with its screen at once, and spawns only when the deferral ends', () => {
    sessions.start(card('c1'))
    expect(sessions.runState('c1')).toEqual({ kind: 'running' })
    expect(sessions.screen('c1')).toBe(screens.get('c1'))
    expect(api.spawns).toEqual([])
    runDeferred()
    expect(api.spawns).toHaveLength(1)
  })

  it('spawns at the size the screen was fitted to meanwhile, with no resize after (AC1)', async () => {
    sessions.start(card('c1', '/tmp/a', { kind: 'custom', command: 'echo hi' }))
    screens.get('c1')!.resize(103, 31)
    runDeferred()
    expect(api.spawns[0]).toMatchObject({ cols: 103, rows: 31 })
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.resizes).toEqual([])
    expect(api.writes).toEqual([['s1', 'echo hi\r']])
  })

  it('still resizes for a fit that lands while the shell is starting (D1)', async () => {
    sessions.start(card('c1'))
    runDeferred()
    screens.get('c1')!.resize(103, 31)
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.resizes).toEqual([['s1', 103, 31]])
  })

  it('a card closed during the deferral is killed as soon as it arrives, typing nothing (AC2)', async () => {
    const firstStarted = vi.fn()
    sessions.start(card('c1', '/tmp/a', { kind: 'claude' }), firstStarted)
    sessions.close('c1')
    runDeferred()
    expect(api.kills).toEqual([])
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.kills).toEqual(['s1'])
    expect(api.writes).toEqual([])
    expect(firstStarted).not.toHaveBeenCalled()
    api.emitExit({ id: 's1', exitCode: 129 })
    expect(sessions.runState('c1')).toEqual({ kind: 'stopped' })
  })

  it("a card deleted during the deferral has its spawn's session killed (AC2)", async () => {
    sessions.start(card('c1', '/tmp/a', { kind: 'custom', command: 'echo hi' }))
    sessions.dispose('c1')
    runDeferred()
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.kills).toEqual(['s1'])
    expect(api.writes).toEqual([])
    expect(sessions.runState('c1')).toBeUndefined()
  })

  it('starting a card again during the deferral spawns it once (D2)', () => {
    sessions.start(card('c1'))
    sessions.start(card('c1'))
    runDeferred()
    expect(api.spawns).toHaveLength(1)
  })
})

describe('onEnded (#11 D1, D6)', () => {
  it("tells the listener with the card's id when its shell stops, however it stopped", async () => {
    const stopped: string[] = []
    sessions.onEnded((cardId) => stopped.push(cardId))
    await started('c1', { ok: true, id: 's1' })
    await started('c2', { ok: true, id: 's2' })
    api.emitExit({ id: 's1', exitCode: 0 })
    expect(stopped).toEqual(['c1'])
    sessions.close('c2')
    api.emitExit({ id: 's2', exitCode: 0 })
    expect(stopped).toEqual(['c1', 'c2'])
  })

  it('tells it of a shell that exited before its spawn reply, not of a dispose', async () => {
    const stopped: string[] = []
    sessions.onEnded((cardId) => stopped.push(cardId))
    sessions.start(card('c1'))
    api.emitExit({ id: 's1', exitCode: 1 })
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(stopped).toEqual(['c1'])
    await started('c2', { ok: true, id: 's2' })
    sessions.dispose('c2')
    expect(stopped).toEqual(['c1'])
  })

  it("tells it of a start that couldn't start: a failed reply or a rejected spawn (#11 D1)", async () => {
    const ended: string[] = []
    sessions.onEnded((cardId) => ended.push(cardId))
    await started('c1', { ok: false, reason: 'working directory not found' })
    expect(sessions.runState('c1')?.kind).toBe('failed')
    expect(ended).toEqual(['c1'])
    api.spawn = () => Promise.reject(new Error('boom'))
    sessions.start(card('c2'))
    await vi.advanceTimersByTimeAsync(0)
    expect(sessions.runState('c2')?.kind).toBe('failed')
    expect(ended).toEqual(['c1', 'c2'])
  })
})

describe('agent status (#9 D8)', () => {
  it('shows in place of the last output line while running, even after more output', async () => {
    await started('c1', { ok: true, id: 's1' })
    api.emitData('s1', 'first')
    const listener = vi.fn()
    sessions.subscribe('c1', listener)
    expect(sessions.setAgentStatus('c1', 'running tests')).toBe(true)
    expect(sessions.status('c1')).toEqual({ label: 'Running', lastLine: 'running tests' })
    expect(listener).toHaveBeenCalled()
    api.emitData('s1', '\r\nmore')
    await vi.advanceTimersByTimeAsync(1000)
    expect(sessions.status('c1')).toEqual({ label: 'Running', lastLine: 'running tests' })
  })
  it('empty text clears it, and the last output line shows again', async () => {
    await started('c1', { ok: true, id: 's1' })
    api.emitData('s1', 'first')
    sessions.setAgentStatus('c1', 'running tests')
    expect(sessions.setAgentStatus('c1', '')).toBe(true)
    expect(sessions.status('c1')).toEqual({ label: 'Running', lastLine: 'first' })
  })

  it('cannot be set on a Stopped, failed or unknown card', async () => {
    await started('c1', { ok: true, id: 's1' })
    api.emitExit({ id: 's1', exitCode: 0 })
    await started('c2', { ok: false, reason: 'no such directory' })
    expect(sessions.setAgentStatus('c1', 'hi')).toBe(false)
    expect(sessions.setAgentStatus('c2', 'hi')).toBe(false)
    expect(sessions.setAgentStatus('ghost', 'hi')).toBe(false)
    expect(sessions.status('c1')).toEqual({ label: 'Stopped', lastLine: '' })
  })

  it('is cleared when the process stops, and stays cleared when it starts again', async () => {
    await started('c1', { ok: true, id: 's1' })
    sessions.setAgentStatus('c1', 'running tests')
    api.emitExit({ id: 's1', exitCode: 0 })
    expect(sessions.status('c1')).toEqual({ label: 'Stopped', lastLine: '' })
    await started('c1', { ok: true, id: 's2' })
    api.emitData('s2', '$ ')
    expect(sessions.status('c1')).toEqual({ label: 'Running', lastLine: '$' })
  })

  it('is cleared when a start fails', async () => {
    sessions.start(card('c1'))
    sessions.setAgentStatus('c1', 'running tests')
    api.spawns[0].resolve({ ok: false, reason: 'no such directory' })
    await vi.advanceTimersByTimeAsync(0)
    sessions.start(card('c1'))
    expect(sessions.status('c1')).toEqual({ label: 'Running', lastLine: '' })
  })
})

describe('SSH cards (#12 D5, D6, D7)', () => {
  /** An SSH card on `me@devbox`. */
  function sshCard(id: string, startup: StartupCommand = { kind: 'shell' }): StartingCard {
    return { ...card(id, '/srv/api', startup), host: 'me@devbox' }
  }

  async function startedSsh(
    id: string,
    startup: StartupCommand = { kind: 'shell' },
    onClaudeStarted?: (kind: string) => void
  ): Promise<void> {
    sessions.start(sshCard(id, startup), onClaudeStarted)
    api.spawns[api.spawns.length - 1].resolve({ ok: true, id: 's1' })
    await vi.advanceTimersByTimeAsync(0)
  }

  it("sends the card's host with the spawn; a local card sends null", () => {
    sessions.start(sshCard('c1'))
    sessions.start(card('c2'))
    expect(api.spawns.map((s) => [s.cwd, s.host])).toEqual([
      ['/srv/api', 'me@devbox'],
      ['/tmp/a', null]
    ])
  })

  it('types the start line once, when the ready marker first appears (D6)', async () => {
    const claudeStarted = vi.fn()
    await startedSsh('c1', { kind: 'claude' }, claudeStarted)
    api.emitData('s1', 'Password: ')
    api.emitData('s1', '\r\n\x1b]6973;drovr')
    expect(api.writes).toEqual([])
    expect(claudeStarted).not.toHaveBeenCalled()
    api.emitData('s1', '-ready\x07$ ')
    expect(api.writes).toEqual([['s1', `claude --session-id ${UUID}\r`]])
    expect(claudeStarted).toHaveBeenCalledTimes(1)
    api.emitData('s1', READY_MARKER)
    expect(api.writes).toHaveLength(1)
    expect(claudeStarted).toHaveBeenCalledTimes(1)
  })

  it("types a preset's plain command and records its first start only at the marker (#21 D3)", async () => {
    const firstStart = vi.fn()
    await startedSsh('c1', { kind: 'codex' }, firstStart)
    api.emitData('s1', 'Password: ')
    expect(api.writes).toEqual([])
    expect(firstStart).not.toHaveBeenCalled()
    api.emitData('s1', READY_MARKER)
    expect(api.writes).toEqual([['s1', 'codex\r']])
    expect(firstStart).toHaveBeenCalledExactlyOnceWith('codex')
  })

  it('records no preset first start when the marker never comes (#21 D3)', async () => {
    const firstStart = vi.fn()
    await startedSsh('c1', { kind: 'opencode' }, firstStart)
    api.emitData('s1', 'Permission denied\r\n')
    api.emitExit({ id: 's1', exitCode: 255 })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.writes).toEqual([])
    expect(firstStart).not.toHaveBeenCalled()
  })

  it('finds the marker in output that came before the spawn reply', async () => {
    sessions.start(sshCard('c1', { kind: 'custom', command: 'make dev' }))
    api.emitData('s1', `motd${READY_MARKER}`)
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.writes).toEqual([['s1', 'make dev\r']])
  })

  it('types nothing, and records no first start, when the marker never comes', async () => {
    const claudeStarted = vi.fn()
    await startedSsh('c1', { kind: 'claude' }, claudeStarted)
    api.emitData('s1', 'Permission denied\r\n')
    api.emitExit({ id: 's1', exitCode: 255 })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.writes).toEqual([])
    expect(claudeStarted).not.toHaveBeenCalled()
  })

  it("doesn't type the start line once the card is being closed", async () => {
    await startedSsh('c1', { kind: 'custom', command: 'make dev' })
    sessions.close('c1')
    api.emitData('s1', READY_MARKER)
    expect(api.writes).toEqual([])
  })

  it('reads SSH failed with the last output line after an exit with 255 (D7)', async () => {
    await startedSsh('c1')
    api.emitData('s1', 'ssh: Could not resolve hostname x: Name or service not known\r\n')
    api.emitExit({ id: 's1', exitCode: 255 })
    await vi.advanceTimersByTimeAsync(0)
    expect(sessions.runState('c1')).toEqual({
      kind: 'stopped',
      sshFailed: 'ssh: Could not resolve hostname x: Name or service not known'
    })
    expect(sessions.status('c1')).toEqual({
      label: 'SSH failed: ssh: Could not resolve hostname x: Name or service not known',
      lastLine: ''
    })
    expect(sessions.screen('c1')).toBeUndefined()
    // Opening it again starts it again, like a Stopped card.
    sessions.start(sshCard('c1'))
    expect(api.spawns).toHaveLength(2)
    expect(sessions.status('c1')).toEqual({ label: 'Running', lastLine: '' })
  })

  it('reads SSH failed: exit code 255 when nothing was printed', async () => {
    await startedSsh('c1')
    api.emitExit({ id: 's1', exitCode: 255 })
    await vi.advanceTimersByTimeAsync(0)
    expect(sessions.status('c1')?.label).toBe('SSH failed: exit code 255')
  })

  it('is Stopped after any other exit, after Close, and for a local card', async () => {
    await startedSsh('c1')
    api.emitExit({ id: 's1', exitCode: 0 })
    await vi.advanceTimersByTimeAsync(0)
    expect(sessions.runState('c1')).toEqual({ kind: 'stopped' })

    await startedSsh('c2')
    api.emitData('s1', 'Connection closed\r\n')
    sessions.close('c2')
    api.emitExit({ id: 's1', exitCode: 255 })
    await vi.advanceTimersByTimeAsync(0)
    expect(sessions.runState('c2')).toEqual({ kind: 'stopped' })

    await started('c3', { ok: true, id: 's3' })
    api.emitExit({ id: 's3', exitCode: 255 })
    await vi.advanceTimersByTimeAsync(0)
    expect(sessions.runState('c3')).toEqual({ kind: 'stopped' })
  })

  it('tells onEnded once an SSH card failed', async () => {
    const ended = vi.fn()
    sessions.onEnded(ended)
    await startedSsh('c1')
    api.emitExit({ id: 's1', exitCode: 255 })
    await vi.advanceTimersByTimeAsync(0)
    expect(ended).toHaveBeenCalledWith('c1')
  })
})

describe('acknowledgements (#16 D4)', () => {
  const chunk = (n: number): string => 'x'.repeat(n)

  it("acknowledges the main pane's output once its screen has parsed it", async () => {
    await started('c1', { ok: true, id: 's1' })
    const screen = screens.get('c1')!
    screen.slow = true
    api.emitData('s1', chunk(5_000))
    expect(api.acks).toEqual([])
    screen.parsing.forEach((parsed) => parsed())
    expect(api.acks).toEqual([['s1', 5_000]])
  })

  it('acknowledges output from before the spawn reply once replayed and parsed', async () => {
    sessions.start(card('c1'))
    const screen = screens.get('c1')!
    screen.slow = true
    api.emitData('s1', chunk(3_000))
    api.emitData('s1', chunk(2_000))
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(screen.text).toBe(chunk(5_000))
    expect(api.acks).toEqual([])
    screen.parsing.forEach((parsed) => parsed())
    expect(api.acks).toEqual([['s1', 5_000]])
  })

  it('acknowledges what a deleted card never parsed at once', async () => {
    await started('c1', { ok: true, id: 's1' })
    screens.get('c1')!.slow = true
    api.emitData('s1', chunk(1_000))
    sessions.dispose('c1')
    expect(api.acks).toEqual([['s1', 1_000]])
    // Its shell is still ending: what it prints now is acknowledged at once.
    api.emitData('s1', chunk(10))
    expect(api.acks).toEqual([
      ['s1', 1_000],
      ['s1', 10]
    ])
  })
})

describe('typing while the shell is starting', () => {
  it("writes it once the session arrives, after a local card's start line, in order", async () => {
    sessions.start(card('c1', '/tmp/a', { kind: 'custom', command: 'make dev' }))
    screens.get('c1')!.type('p')
    screens.get('c1')!.type('wd\r')
    expect(api.writes).toEqual([])
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await vi.advanceTimersByTimeAsync(0)
    screens.get('c1')!.type('ls\r')
    expect(api.writes).toEqual([
      ['s1', 'make dev\r'],
      ['s1', 'p'],
      ['s1', 'wd\r'],
      ['s1', 'ls\r']
    ])
  })
})

describe('typing while an SSH shell is starting', () => {
  it('keeps none of it, so it never answers ssh prompts (#25 D10)', async () => {
    sessions.start({
      ...card('c1', '/srv/api', { kind: 'custom', command: 'make dev' }),
      host: 'h'
    })
    screens.get('c1')!.type('yes\r')
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.writes).toEqual([])
    api.emitData('s1', READY_MARKER)
    expect(api.writes).toEqual([['s1', 'make dev\r']])
  })

  it('drops it when the spawn fails, the card is closed or deleted, or the shell already exited', async () => {
    sessions.start(card('c1'))
    sessions.start(card('c2'))
    sessions.start(card('c3'))
    sessions.start(card('c4'))
    for (const id of ['c1', 'c2', 'c3', 'c4']) screens.get(id)!.type('ls\r')
    sessions.close('c2')
    sessions.dispose('c3')
    api.emitExit({ id: 's4', exitCode: 1 })
    api.spawns[0].resolve({ ok: false, reason: 'working directory not found' })
    api.spawns[1].resolve({ ok: true, id: 's2' })
    api.spawns[2].resolve({ ok: true, id: 's3' })
    api.spawns[3].resolve({ ok: true, id: 's4' })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.writes).toEqual([])
  })

  it('drops it on a screen replaced by a newer start', async () => {
    sessions.start(card('c1'))
    const old = screens.get('c1')!
    old.type('old\r')
    sessions.dispose('c1')
    sessions.start(card('c1'))
    old.type('older\r')
    api.spawns[1].resolve({ ok: true, id: 's2' })
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.writes).toEqual([])
  })

  it(`keeps at most ${MAX_TYPEAHEAD_CHARS} characters, dropping what comes after`, async () => {
    sessions.start(card('c1'))
    const screen = screens.get('c1')!
    screen.type('a'.repeat(MAX_TYPEAHEAD_CHARS - 1))
    screen.type('bb')
    screen.type('c')
    screen.type('d')
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.writes.map(([, data]) => data)).toEqual(['a'.repeat(MAX_TYPEAHEAD_CHARS - 1), 'c'])
  })
})
