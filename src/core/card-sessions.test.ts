import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpawnResult, TerminalApi, TerminalExit } from '../shared/api'
import { CardSessions, type CardScreen, type StartingCard } from './card-sessions'
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
  write(data: string, done?: () => void): void {
    this.text += data
    done?.()
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
  spawns: { cols: number; rows: number; cwd: string; resolve: (r: SpawnResult) => void }[] = []
  writes: [string, string][] = []
  resizes: [string, number, number][] = []
  kills: string[] = []
  dataListeners = new Set<(id: string, data: string) => void>()
  exitListeners = new Set<(exit: TerminalExit) => void>()
  spawn(cols: number, rows: number, cwd: string): Promise<SpawnResult> {
    return new Promise((resolve) => this.spawns.push({ cols, rows, cwd, resolve }))
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
})
