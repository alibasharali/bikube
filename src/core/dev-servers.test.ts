import { describe, expect, it } from 'vitest'
import { DevServers, MAIN_PANE, PROBE_INTERVAL_MS } from './dev-servers'

interface Harness {
  servers: DevServers
  listening: Set<number>
  probes: number[][]
  timers: Map<number, { fn: () => void; ms: number }>
  settle: () => Promise<void>
  tick: () => void
  blur: () => void
  focus: () => void
}

/** A registry over a fake clock, a fake probe and a fake window focus. */
function setup(open: Iterable<number> = []): Harness {
  const listening = new Set(open)
  const probes: number[][] = []
  let focused = true
  const focusListeners: (() => void)[] = []
  const timers = new Map<number, { fn: () => void; ms: number }>()
  let nextTimer = 1
  const servers = new DevServers({
    probe: async (ports) => {
      probes.push([...ports])
      return ports.filter((p) => listening.has(p))
    },
    focused: () => focused,
    onFocus: (listener) => focusListeners.push(listener),
    setInterval: (fn, ms) => {
      const id = nextTimer++
      timers.set(id, { fn, ms })
      return id
    },
    clearInterval: (id) => timers.delete(id as number)
  })
  return {
    servers,
    listening,
    probes,
    timers,
    /** Lets the fake probe's answers land. */
    settle: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    /** One interval tick of every running timer. */
    tick: () => [...timers.values()].forEach((t) => t.fn()),
    blur: () => {
      focused = false
    },
    focus: () => {
      focused = true
      focusListeners.forEach((l) => l())
    }
  }
}

const ports = (servers: DevServers, cardId: string): number[] =>
  servers.ports(cardId).map((p) => p.port)

describe('DevServers (#49 D3–D5, AC10)', () => {
  it('lists only probed-open ports, in first-seen order with the newest URL', async () => {
    const { servers, settle } = setup([3000, 5173])
    servers.output('c', MAIN_PANE, 'http://localhost:5173/\nhttp://localhost:4000/\n')
    servers.output('c', MAIN_PANE, 'http://127.0.0.1:3000/x\nhttp://0.0.0.0:5173/new\n')
    expect(servers.ports('c')).toEqual([])
    await settle()
    expect(servers.ports('c')).toEqual([
      { port: 5173, url: 'http://localhost:5173/new' },
      { port: 3000, url: 'http://127.0.0.1:3000/x' }
    ])
    expect(servers.ports('other')).toEqual([])
  })

  it("merges a card's panes, the main pane first, without duplicates", async () => {
    const { servers, settle } = setup([1, 2, 3, 4])
    servers.paneOpened('c', 'p1')
    servers.paneOpened('c', 'p2')
    servers.output('c', 'p2', 'http://localhost:4/\nhttp://localhost:1/two\n')
    servers.output('c', 'p1', 'http://localhost:3/\n')
    servers.output('c', MAIN_PANE, 'http://localhost:2/\n')
    servers.output('c', MAIN_PANE, 'http://localhost:1/main\n')
    await settle()
    // Port 1 was printed by p2 first, so p2 keeps it, with its own URL.
    expect(servers.ports('c')).toEqual([
      { port: 2, url: 'http://localhost:2/' },
      { port: 3, url: 'http://localhost:3/' },
      { port: 4, url: 'http://localhost:4/' },
      { port: 1, url: 'http://localhost:1/two' }
    ])
    // Once p2 is gone, the main pane's print of it lists it.
    servers.paneEnded('c', 'p2')
    expect(servers.ports('c')).toEqual([
      { port: 2, url: 'http://localhost:2/' },
      { port: 1, url: 'http://localhost:1/main' },
      { port: 3, url: 'http://localhost:3/' }
    ])
  })

  it("forgets a pane's ports when it ends, and a card's when the card ends", async () => {
    const { servers, settle, probes } = setup([1, 2])
    servers.output('c', MAIN_PANE, 'http://localhost:1/\n')
    servers.output('c', 'p1', 'http://localhost:2/\n')
    await settle()
    expect(ports(servers, 'c')).toEqual([1, 2])
    servers.paneEnded('c', 'p1')
    expect(ports(servers, 'c')).toEqual([1])
    servers.cardEnded('c')
    expect(ports(servers, 'c')).toEqual([])

    // Printed again: probed again before it shows.
    probes.length = 0
    servers.output('c', MAIN_PANE, 'http://localhost:1/\n')
    expect(ports(servers, 'c')).toEqual([])
    expect(probes).toEqual([[1]])
    await settle()
    expect(ports(servers, 'c')).toEqual([1])
  })

  it('forgets the unfinished line of an ended pane', async () => {
    const { servers, settle } = setup([1])
    servers.output('c', MAIN_PANE, 'http://localhost:')
    servers.paneEnded('c', MAIN_PANE)
    servers.output('c', MAIN_PANE, '1/\n')
    await settle()
    expect(ports(servers, 'c')).toEqual([])
  })

  it('probes a new port at once, every 3 s and on focus while focused, never unfocused', async () => {
    const { servers, settle, probes, tick, timers, blur, focus, listening } = setup()
    expect(timers.size).toBe(0)
    servers.output('c', MAIN_PANE, 'http://localhost:1/\n')
    expect(probes).toEqual([[1]])
    expect([...timers.values()].map((t) => t.ms)).toEqual([PROBE_INTERVAL_MS])
    expect(PROBE_INTERVAL_MS).toBe(3000)
    // A port already known is not probed again when printed.
    servers.output('c', MAIN_PANE, 'http://localhost:1/\n')
    expect(probes).toHaveLength(1)
    await settle()
    expect(ports(servers, 'c')).toEqual([])

    listening.add(1)
    tick()
    expect(probes).toEqual([[1], [1]])
    await settle()
    expect(ports(servers, 'c')).toEqual([1])

    // Unfocused: nothing is probed, the chips keep their last state.
    blur()
    listening.delete(1)
    tick()
    servers.output('c', MAIN_PANE, 'http://localhost:2/\n')
    expect(probes).toHaveLength(2)
    await settle()
    expect(ports(servers, 'c')).toEqual([1])

    // Focus again: everything known is probed at once.
    listening.add(2)
    focus()
    expect(probes[2]).toEqual([1, 2])
    await settle()
    expect(ports(servers, 'c')).toEqual([2])

    // Nothing known: the interval stops.
    servers.cardEnded('c')
    expect(timers.size).toBe(0)
  })

  it('probes at most 32 ports per call', () => {
    const { servers, probes, tick } = setup()
    const lines = Array.from({ length: 40 }, (_, i) => `http://localhost:${1000 + i}/\n`)
    servers.output('c', MAIN_PANE, lines.join(''))
    probes.length = 0
    tick()
    expect(probes.map((p) => p.length)).toEqual([32, 8])
  })

  it('tells subscribers when the listed ports change, keeping the list while it stays', async () => {
    const { servers, settle, tick, listening } = setup([1])
    let calls = 0
    const unsubscribe = servers.subscribe('c', () => calls++)
    servers.output('c', MAIN_PANE, 'http://localhost:1/\n')
    await settle()
    expect(calls).toBe(1)
    const list = servers.ports('c')
    tick()
    await settle()
    expect(calls).toBe(1)
    expect(servers.ports('c')).toBe(list)
    listening.delete(1)
    tick()
    await settle()
    expect(calls).toBe(2)
    unsubscribe()
    servers.cardEnded('c')
    expect(calls).toBe(2)
  })

  it('drops an older probe answer that lands after a newer one', async () => {
    const answers: ((open: number[]) => void)[] = []
    const servers = new DevServers({
      probe: () => new Promise((resolve) => answers.push(resolve)),
      focused: () => true,
      onFocus: () => {},
      setInterval: () => 0,
      clearInterval: () => {}
    })
    servers.output('c', MAIN_PANE, 'http://localhost:1/\n')
    servers.cardEnded('c')
    servers.output('c', MAIN_PANE, 'http://localhost:1/\n')
    answers[1]([])
    answers[0]([1])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(ports(servers, 'c')).toEqual([])
  })
})
