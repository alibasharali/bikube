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
}

class FakeApi implements TerminalApi {
  spawns: {
    cols: number
    rows: number
    cwd: string
    cardId: string
    host: string | null
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
    cardId: string,
    host: string | null
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
let screens: FakeScreen[]
let panes: CardPanes<FakeScreen>
/** Whether the card's main shell runs, as `isRunning` reports it to the panes. */
let mainRunning: boolean

const API = { id: 'card-1', directory: '/tmp/drovr-alpha' }

beforeEach(() => {
  api = new FakeApi()
  screens = []
  mainRunning = true
  panes = new CardPanes(
    api,
    new SessionRouter(api),
    () => {
      const screen = new FakeScreen()
      screens.push(screen)
      return screen
    },
    () => mainRunning
  )
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

describe("CardPanes starting in the focused shell's directory (#45 D8)", () => {
  let asked: [string, string][]
  beforeEach(() => {
    asked = []
    panes = new CardPanes(
      api,
      new SessionRouter(api),
      () => {
        const screen = new FakeScreen()
        screens.push(screen)
        return screen
      },
      () => mainRunning,
      (card, focused) => {
        asked.push([card.id, focused])
        return '/tmp/reported'
      }
    )
  })

  it('spawns in the directory picked for the focused pane', async () => {
    const id = panes.split(API, 'right')!
    expect(asked).toEqual([[API.id, MAIN_PANE]])
    expect(api.spawns).toMatchObject([{ cwd: '/tmp/reported' }])
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await flush()
    panes.split(API, 'down')
    expect(asked[1]).toEqual([API.id, id])
  })

  it("falls back to the card's directory when that one is refused, with no Couldn't start", async () => {
    const id = panes.split(API, 'right')!
    screens[0].inputListener?.('ls\r')
    api.spawns[0].resolve({ ok: false, reason: 'working directory not found' })
    await flush()
    expect(api.spawns.map((s) => s.cwd)).toEqual(['/tmp/reported', API.directory])
    api.spawns[1].resolve({ ok: true, id: 's1' })
    await flush()
    expect(screens[0].text).toBe('')
    expect(api.writes).toEqual([['s1', 'ls\r']])
    expect(paneIds(panes.layout(API.id).tree)).toEqual([MAIN_PANE, id])
  })

  it("shows the card directory's refusal when both are refused", async () => {
    panes.split(API, 'right')
    api.spawns[0].resolve({ ok: false, reason: 'working directory not found' })
    await flush()
    api.spawns[1].resolve({ ok: false, reason: 'invalid working directory' })
    await flush()
    expect(api.spawns).toHaveLength(2)
    expect(screens[0].text).toBe("Couldn't start: invalid working directory\r\n")
  })

  it('tries nothing more for a pane closed while its first spawn was refused', async () => {
    const id = panes.split(API, 'right')!
    panes.close(API.id, id)
    api.spawns[0].resolve({ ok: false, reason: 'working directory not found' })
    await flush()
    expect(api.spawns).toHaveLength(1)
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
    panes = new CardPanes(
      api,
      router,
      () => {
        const screen = new FakeScreen()
        screens.push(screen)
        return screen
      },
      (cardId) => sessions.runState(cardId)?.kind === 'running'
    )
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

  it("starts nothing unless the card's main shell is running (D4)", () => {
    mainRunning = false
    expect(panes.split(API, 'right')).toBeUndefined()
    expect(api.spawns).toEqual([])
    expect(screens).toEqual([])
    expect(panes.layout(API.id).tree).toEqual({ kind: 'leaf', id: MAIN_PANE })
    mainRunning = true
    expect(panes.split(API, 'right')).toBeDefined()
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

describe('CardPanes in an SSH card (#12 D8)', () => {
  const REMOTE = { id: 'card-2', directory: '/tmp/drovr-remote', host: 'me@devbox' }

  it("connects each extra pane to the card's host and directory, with no startup line", async () => {
    panes.split(REMOTE, 'right')
    panes.split(API, 'right')
    expect(api.spawns).toMatchObject([
      { cwd: REMOTE.directory, cardId: REMOTE.id, host: 'me@devbox' },
      { cwd: API.directory, cardId: API.id, host: null }
    ])
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await flush()
    expect(api.writes).toEqual([])
  })

  it('keeps a pane whose ssh exits with 255, showing SSH failed read-only below its screen', async () => {
    const id = panes.split(REMOTE, 'right')!
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await flush()
    api.emitData('s1', 'ssh: connect to host me@devbox port 22: Connection refused\r\n')
    api.emitExit({ id: 's1', exitCode: 255 })
    expect(paneIds(panes.layout(REMOTE.id).tree)).toEqual([MAIN_PANE, id])
    expect(screens[0].disposed).toBe(false)
    expect(screens[0].text).toBe(
      'ssh: connect to host me@devbox port 22: Connection refused\r\n\r\nSSH failed\r\n'
    )
    expect(screens[0].readOnly).toBe(true)
    screens[0].inputListener?.('ls\r')
    expect(api.writes).toEqual([])
    panes.close(REMOTE.id, id)
    expect(paneIds(panes.layout(REMOTE.id).tree)).toEqual([MAIN_PANE])
    expect(api.kills).toEqual([])
  })

  it('keeps it too when ssh exited with 255 before the spawn reply arrived', async () => {
    const id = panes.split(REMOTE, 'right')!
    api.emitData('s1', 'refused\r\n')
    api.emitExit({ id: 's1', exitCode: 255 })
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await flush()
    expect(paneIds(panes.layout(REMOTE.id).tree)).toEqual([MAIN_PANE, id])
    expect(screens[0].text).toBe('refused\r\n\r\nSSH failed\r\n')
    expect(screens[0].readOnly).toBe(true)
  })

  it('removes the pane on any other exit, and a local pane even on 255', async () => {
    panes.split(REMOTE, 'right')
    panes.split(API, 'right')
    api.spawns[0].resolve({ ok: true, id: 's1' })
    api.spawns[1].resolve({ ok: true, id: 's2' })
    await flush()
    api.emitExit({ id: 's1', exitCode: 0 })
    api.emitExit({ id: 's2', exitCode: 255 })
    expect(paneIds(panes.layout(REMOTE.id).tree)).toEqual([MAIN_PANE])
    expect(paneIds(panes.layout(API.id).tree)).toEqual([MAIN_PANE])
    expect(screens.every((s) => s.disposed)).toBe(true)
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

describe('CardPanes acknowledgements (#16 D4)', () => {
  const chunk = (n: number): string => 'x'.repeat(n)

  it("acknowledges an extra pane's output once its screen has parsed it", async () => {
    panes.split(API, 'right')
    screens[0].slow = true
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await flush()
    api.emitData('s1', chunk(5_000))
    expect(api.acks).toEqual([])
    screens[0].parsing.forEach((parsed) => parsed())
    expect(api.acks).toEqual([['s1', 5_000]])
  })

  it('acknowledges output from before the spawn reply once replayed and parsed', async () => {
    panes.split(API, 'right')
    screens[0].slow = true
    api.emitData('s1', chunk(4_000))
    api.emitData('s1', chunk(1_000))
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await flush()
    expect(screens[0].text).toBe(chunk(5_000))
    expect(api.acks).toEqual([])
    screens[0].parsing.forEach((parsed) => parsed())
    expect(api.acks).toEqual([['s1', 5_000]])
  })

  it('acknowledges what a closed pane never parsed at once', async () => {
    const id = panes.split(API, 'right')!
    screens[0].slow = true
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await flush()
    api.emitData('s1', chunk(1_000))
    panes.close(API.id, id)
    expect(api.acks).toEqual([['s1', 1_000]])
  })
})

describe('CardPanes typing while a pane is starting', () => {
  it('writes it once the session arrives, in order', async () => {
    panes.split(API, 'right')
    screens[0].inputListener?.('p')
    screens[0].inputListener?.('wd\r')
    expect(api.writes).toEqual([])
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await flush()
    screens[0].inputListener?.('ls\r')
    expect(api.writes).toEqual([
      ['s1', 'p'],
      ['s1', 'wd\r'],
      ['s1', 'ls\r']
    ])
  })

  it("keeps none for an SSH card's pane, so it never answers ssh prompts (#25 D10)", async () => {
    panes.split({ id: 'card-2', directory: '/tmp/drovr-remote', host: 'me@devbox' }, 'right')
    screens[0].inputListener?.('yes\r')
    api.spawns[0].resolve({ ok: true, id: 's1' })
    await flush()
    expect(api.writes).toEqual([])
  })

  it('drops it when the spawn fails or the pane was closed meanwhile', async () => {
    panes.split(API, 'right')
    const closed = panes.split(API, 'down')!
    screens[0].inputListener?.('ls\r')
    screens[1].inputListener?.('ls\r')
    panes.close(API.id, closed)
    api.spawns[0].resolve({ ok: false, reason: 'working directory not found' })
    api.spawns[1].resolve({ ok: true, id: 's2' })
    await flush()
    expect(api.writes).toEqual([])
  })
})
