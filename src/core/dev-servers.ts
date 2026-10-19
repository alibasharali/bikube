import { urlScanner, type DevServerUrl } from './dev-server-urls'

/**
 * Each card's dev server ports (#49 D3–D5): read from its panes' output, kept per pane in the
 * order first seen, and listed for the card while main's probe finds them listening. Runtime
 * only, never saved. Plain TS: the renderer injects the probe, the window's focus and the clock.
 */

export type { DevServerUrl }

/** The pane id of a card's (or shell's) own terminal; its ports list first (D3). */
export const MAIN_PANE = 'main'

/** How often known ports are probed while the window is focused (D4). */
export const PROBE_INTERVAL_MS = 3000

/** The most ports one probe asks about (main's limit, #49 D9). */
const PROBE_BATCH = 32

export interface DevServersDeps {
  /** The ports among `ports` something listens on (main's probe, D9). */
  probe(ports: number[]): Promise<number[]>
  /** Whether the window has the focus. */
  focused(): boolean
  /** Calls `listener` each time the window regains the focus. */
  onFocus(listener: () => void): void
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

interface Pane {
  scan: (chunk: string) => DevServerUrl[]
  /**
   * Port → its newest URL and when this pane first printed it (a counter); a Map keeps each port
   * where it was first seen.
   */
  ports: Map<number, { url: string; seen: number }>
}

const NONE: readonly DevServerUrl[] = Object.freeze([])

export class DevServers {
  /** Each card's panes, the main pane first when listed, then in the order they were opened. */
  private readonly cards = new Map<string, Map<string, Pane>>()
  private readonly open = new Set<number>()
  /** Each port's latest probe still in flight; an older answer is dropped. */
  private readonly inFlight = new Map<number, number>()
  private probeSeq = 0
  private seenSeq = 0
  private readonly lists = new Map<string, readonly DevServerUrl[]>()
  private readonly listeners = new Map<string, Set<() => void>>()
  private timer: unknown = null

  constructor(private readonly deps: DevServersDeps) {
    deps.onFocus(() => this.probeAll())
  }

  /**
   * Records an extra pane's place in its card's list (D3: extra panes in creation order). Output
   * from a pane not opened yet records it then.
   */
  paneOpened(cardId: string, paneId: string): void {
    this.pane(cardId, paneId)
  }

  /** Reads a chunk of the pane's output (D1, D2): only output of its current start. */
  output(cardId: string, paneId: string, data: string): void {
    const pane = this.pane(cardId, paneId)
    const found = pane.scan(data)
    if (found.length === 0) return
    const known = this.knownPorts()
    const fresh: number[] = []
    let changed = false
    for (const { port, url } of found) {
      const before = pane.ports.get(port)
      if (before?.url === url) continue
      pane.ports.set(port, { url, seen: before?.seen ?? ++this.seenSeq })
      changed = true
      if (!known.has(port) && !fresh.includes(port)) fresh.push(port)
    }
    if (!changed) return
    this.syncTimer()
    // A port first seen is probed at once (D4), while the window is focused.
    if (fresh.length > 0 && this.deps.focused()) this.probe(fresh)
    this.changed()
  }

  /** The pane's shell exited, the pane closed or restarted: its ports are forgotten (D5). */
  paneEnded(cardId: string, paneId: string): void {
    const panes = this.cards.get(cardId)
    if (!panes?.delete(paneId)) return
    if (panes.size === 0) this.cards.delete(cardId)
    this.forgotten()
  }

  /**
   * The card's listening ports (D3, D4): its panes' ports, the main pane first, each port once.
   * The same array until it changes, for `useSyncExternalStore`.
   */
  ports(cardId: string): readonly DevServerUrl[] {
    return this.lists.get(cardId) ?? NONE
  }

  /** Called when the card's listed ports change. Returns an unsubscribe function. */
  subscribe(cardId: string, listener: () => void): () => void {
    const set = this.listeners.get(cardId) ?? new Set()
    set.add(listener)
    this.listeners.set(cardId, set)
    return () => {
      set.delete(listener)
      if (set.size === 0 && this.listeners.get(cardId) === set) this.listeners.delete(cardId)
    }
  }

  private pane(cardId: string, paneId: string): Pane {
    let panes = this.cards.get(cardId)
    if (!panes) {
      panes = new Map()
      this.cards.set(cardId, panes)
    }
    let pane = panes.get(paneId)
    if (!pane) {
      pane = { scan: urlScanner(), ports: new Map() }
      panes.set(paneId, pane)
    }
    return pane
  }

  private knownPorts(): Set<number> {
    const known = new Set<number>()
    for (const panes of this.cards.values()) {
      for (const pane of panes.values()) for (const port of pane.ports.keys()) known.add(port)
    }
    return known
  }

  /** Drops the state of ports no pane knows any more, then updates the lists. */
  private forgotten(): void {
    const known = this.knownPorts()
    for (const port of [...this.open]) if (!known.has(port)) this.open.delete(port)
    for (const port of [...this.inFlight.keys()]) if (!known.has(port)) this.inFlight.delete(port)
    this.syncTimer()
    this.changed()
  }

  /** The interval runs while any port is known (D4). */
  private syncTimer(): void {
    const any = [...this.cards.values()].some((panes) =>
      [...panes.values()].some((pane) => pane.ports.size > 0)
    )
    if (any && this.timer === null) {
      this.timer = this.deps.setInterval(() => {
        if (this.deps.focused()) this.probeAll()
      }, PROBE_INTERVAL_MS)
    } else if (!any && this.timer !== null) {
      this.deps.clearInterval(this.timer)
      this.timer = null
    }
  }

  private probeAll(): void {
    const known = [...this.knownPorts()]
    if (known.length > 0) this.probe(known)
  }

  private probe(ports: number[]): void {
    for (let i = 0; i < ports.length; i += PROBE_BATCH) {
      const batch = ports.slice(i, i + PROBE_BATCH)
      const seq = ++this.probeSeq
      for (const port of batch) this.inFlight.set(port, seq)
      void this.deps.probe(batch).then(
        (open) => this.answered(batch, seq, new Set(open)),
        // A failed probe keeps the chips as they were.
        () => this.answered(batch, seq, null)
      )
    }
  }

  private answered(batch: number[], seq: number, open: Set<number> | null): void {
    for (const port of batch) {
      if (this.inFlight.get(port) !== seq) continue
      this.inFlight.delete(port)
      if (open === null) continue
      if (open.has(port)) this.open.add(port)
      else this.open.delete(port)
    }
    this.changed()
  }

  /** Recomputes every card's list and tells the subscribers of those that changed. */
  private changed(): void {
    const ids = new Set([...this.cards.keys(), ...this.lists.keys()])
    for (const cardId of ids) {
      const next = this.list(cardId)
      const prev = this.ports(cardId)
      if (
        next.length === prev.length &&
        next.every((p, i) => p.port === prev[i].port && p.url === prev[i].url)
      )
        continue
      if (next.length === 0) this.lists.delete(cardId)
      else this.lists.set(cardId, next)
      this.listeners.get(cardId)?.forEach((listener) => listener())
    }
  }

  private list(cardId: string): DevServerUrl[] {
    const panes = this.cards.get(cardId)
    if (!panes) return []
    const main = panes.get(MAIN_PANE)
    const extra = [...panes].filter(([id]) => id !== MAIN_PANE).map(([, pane]) => pane)
    const ordered = main ? [main, ...extra] : extra
    // Printed by several panes, a port is listed once, by the pane that printed it first.
    const owner = new Map<number, number>()
    for (const pane of ordered) {
      for (const [port, { seen }] of pane.ports) {
        owner.set(port, Math.min(seen, owner.get(port) ?? Infinity))
      }
    }
    const list: DevServerUrl[] = []
    for (const pane of ordered) {
      for (const [port, { url, seen }] of pane.ports) {
        if (owner.get(port) === seen && this.open.has(port)) list.push({ port, url })
      }
    }
    return list
  }
}
