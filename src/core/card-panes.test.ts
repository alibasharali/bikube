import { beforeEach, describe, expect, it } from 'vitest'
import type { SpawnResult, TerminalApi, TerminalExit } from '../shared/api'
import { CardPanes } from './card-panes'
import { CardSessions, type CardScreen } from './card-sessions'
import { SessionRouter } from './session-router'
import { MAIN_PANE, paneIds } from './split-tree'

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
}

class FakeApi implements TerminalApi {
  spawns: {
    cols: number
    rows: number
    cwd: string
    cardId: string
    resolve: (r: SpawnResult) => void
  }[] = []
  writes: [string, string][] = []
  resizes: [string, number, number][] = []
  kills: string[] = []
  dataListeners = new Set<(id: string, data: string) => void>()
  exitListeners = new Set<(exit: TerminalExit) => void>()
  spawn(cols: number, rows: number, cwd: string, cardId: string): Promise<SpawnResult> {
    return new Promise((resolve) => this.spawns.push({ cols, rows, cwd, cardId, resolve }))
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
let screens: FakeScreen[]
let panes: CardPanes<FakeScreen>

const API = { id: 'card-1', directory: '/tmp/drovr-alpha' }

beforeEach(() => {
  api = new FakeApi()
  screens = []
  panes = new CardPanes(api, new SessionRouter(api), () => {
    const screen = new FakeScreen()
    screens.push(screen)
    return screen
  })
})

/** Lets pending spawn replies settle. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('CardPanes.split', () => {
  it('starts a plain shell for the card in its directory on a new, focused pane', async () => {
    const id = panes.split(API, 'right')!
    expect(paneIds(panes.layout(API.id).tree)).toEqual([MAIN_PANE, id])
    expect(panes.layout(API.id).focused).toBe(id)
    expect(panes.screen(API.id, id)).toBe(screens[0])
    expect(api.spawns).toMatchObject([{ cols: 80, rows: 24, cwd: API.directory, cardId: API.id }])

    api.spawns[0].resolve({ ok: true, id: 's1' })
    await flush()
    // No startup line is typed into an extra pane (D1).
    expect(api.writes).toEqual([])
    api.emitData('s1', 'hello')
    expect(screens[0].text).toBe('hello')
    screens[0].inputListener?.('ls\r')
    expect(api.writes).toEqual([['s1', 'ls\r']])
  })
})

describe('CardPanes with CardSessions on one router', () => {
  it('keeps output that arrives before the spawn reply, with one listener for both', async () => {
    api = new FakeApi()
    const router = new SessionRouter(api)
    const main: FakeScreen[] = []
    const sessions = new CardSessions(
      api,
      () => {
        const screen = new FakeScreen()
        main.push(screen)
        return screen
      },
      router
    )
    panes = new CardPanes(api, router, () => {
      const screen = new FakeScreen()
      screens.push(screen)
      return screen
    })
    sessions.start({
      ...API,
      startup: { kind: 'shell' },
      agentSessionId: 'x',
      claudeStarted: false
    })
    const id = panes.split(API, 'right')!
    expect(api.dataListeners.size).toBe(1)
    expect(api.exitListeners.size).toBe(1)

    // The pane's shell prints before either reply arrives.
    api.emitData('s2', 'pane-prompt$ ')
    api.emitData('s1', 'main-prompt$ ')
    api.spawns[1].resolve({ ok: true, id: 's2' })
    await flush()
    expect(panes.screen(API.id, id)!.text).toBe('pane-prompt$ ')
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await flush()
    expect(main[0].text).toBe('main-prompt$ ')
    api.emitData('s2', 'more')
    expect(screens[0].text).toBe('pane-prompt$ more')
    expect(main[0].text).toBe('main-prompt$ ')
  })
})

describe('CardPanes removing panes', () => {
  /** Main | (first over second), second focused, both shells started as s1 and s2. */
  async function threePanes(): Promise<[string, string]> {
    const first = panes.split(API, 'right')!
    const second = panes.split(API, 'down')!
    api.spawns[0].resolve({ ok: true, id: 's1' })
    api.spawns[1].resolve({ ok: true, id: 's2' })
    await flush()
    return [first, second]
  }

  it('removes a pane whose shell exits, its sibling taking its place', async () => {
    const [first, second] = await threePanes()
    const changes: number[] = []
    panes.subscribe(API.id, () => changes.push(1))
    api.emitExit({ id: 's1', exitCode: 0 })
    expect(paneIds(panes.layout(API.id).tree)).toEqual([MAIN_PANE, second])
    expect(panes.layout(API.id).focused).toBe(second)
    expect(screens[0].disposed).toBe(true)
    expect(panes.screen(API.id, first)).toBeUndefined()
    expect(changes).toHaveLength(1)
    // Its session is forgotten: later output for it goes nowhere.
    api.emitData('s1', 'late')
    expect(screens[0].text).toBe('')
  })
  it('closes a pane: kills its shell, removes it at once and focuses the main pane', async () => {
    const [first, second] = await threePanes()
    panes.close(API.id, second)
    expect(api.kills).toEqual(['s2'])
    expect(paneIds(panes.layout(API.id).tree)).toEqual([MAIN_PANE, first])
    expect(panes.layout(API.id).focused).toBe(MAIN_PANE)
    expect(screens[1].disposed).toBe(true)
    // The exit main reports later changes nothing more.
    api.emitExit({ id: 's2', exitCode: 0 })
    expect(paneIds(panes.layout(API.id).tree)).toEqual([MAIN_PANE, first])
  })

  it('kills the shell of a pane closed while it was starting once its session arrives', async () => {
    const id = panes.split(API, 'right')!
    panes.close(API.id, id)
    expect(panes.layout(API.id).tree).toEqual({ kind: 'leaf', id: MAIN_PANE })
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await flush()
    expect(api.kills).toEqual(['s1'])
  })

  it('never closes the main pane', () => {
    panes.split(API, 'right')
    const layout = panes.layout(API.id)
    panes.close(API.id, MAIN_PANE)
    expect(panes.layout(API.id)).toBe(layout)
    expect(api.kills).toEqual([])
  })
})

describe('CardPanes failures and the limit', () => {
  it("shows Couldn't start read-only and keeps the pane until it is closed", async () => {
    const id = panes.split(API, 'right')!
    api.spawns[0].resolve({ ok: false, reason: 'working directory not found' })
    await flush()
    expect(screens[0].text).toBe("Couldn't start: working directory not found\r\n")
    expect(screens[0].readOnly).toBe(true)
    expect(paneIds(panes.layout(API.id).tree)).toEqual([MAIN_PANE, id])
    panes.close(API.id, id)
    expect(paneIds(panes.layout(API.id).tree)).toEqual([MAIN_PANE])
    expect(api.kills).toEqual([])
  })

  it('starts nothing at 4 panes', () => {
    for (let i = 0; i < 3; i++) expect(panes.split(API, 'right')).toBeDefined()
    expect(panes.split(API, 'down')).toBeUndefined()
    expect(api.spawns).toHaveLength(3)
    expect(screens).toHaveLength(3)
  })

  it('focuses a pane the user clicks', () => {
    panes.split(API, 'right')
    panes.focus(API.id, MAIN_PANE)
    expect(panes.layout(API.id).focused).toBe(MAIN_PANE)
  })
})

describe('CardPanes.dispose', () => {
  it("kills every extra pane's shell, discards the panes and resets the layout (D6)", async () => {
    const first = panes.split(API, 'right')!
    panes.split(API, 'down')
    const starting = panes.split(API, 'right')!
    api.spawns[0].resolve({ ok: true, id: 's1' })
    api.spawns[1].resolve({ ok: true, id: 's2' })
    await flush()
    const changes: number[] = []
    panes.subscribe(API.id, () => changes.push(1))

    panes.dispose(API.id)
    expect(api.kills.sort()).toEqual(['s1', 's2'])
    expect(screens.every((s) => s.disposed)).toBe(true)
    expect(panes.layout(API.id)).toEqual({
      tree: { kind: 'leaf', id: MAIN_PANE },
      focused: MAIN_PANE
    })
    expect(panes.screen(API.id, first)).toBeUndefined()
    expect(changes.length).toBeGreaterThan(0)
    // A shell still starting is killed once its session arrives.
    api.spawns[2].resolve({ ok: true, id: 's3' })
    await flush()
    expect(api.kills).toContain('s3')
    expect(panes.screen(API.id, starting)).toBeUndefined()
    // A later split starts from the main pane alone.
    const next = panes.split(API, 'right')!
    expect(paneIds(panes.layout(API.id).tree)).toEqual([MAIN_PANE, next])
  })

  it('leaves a card with no extra panes as it is', () => {
    const layout = panes.layout(API.id)
    panes.dispose(API.id)
    expect(panes.layout(API.id)).toBe(layout)
    expect(api.kills).toEqual([])
  })
})
