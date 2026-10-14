/**
 * Routes main's terminal events to whoever owns each shell session: a card's own terminal or one
 * of its extra panes (#11 D1). One `onData`/`onExit` subscription for the whole renderer, so
 * output that arrives before a session's spawn reply is kept for its owner instead of racing
 * between listeners. It also acknowledges every chunk to main exactly once (#16 D4): when the
 * screen it went to has parsed it, or at once when nobody ever will.
 */
import type { SpawnResult, TerminalApi, TerminalExit } from '../shared/api'
import { AckBatcher } from './ack-batcher'

/** Where one session's events go. */
export interface SessionRoute {
  /** `parsed` must run once the chunk is on the screen: it acknowledges it (#16 D4). */
  output(data: string, parsed: () => void): void
  /** The session is forgotten before this runs. */
  exited(exit: TerminalExit): void
}

/** A routed session's chunks handed to its screen and not parsed yet (#16 D4). */
interface InFlight {
  chars: number
  /** False once the session is released or exited: later callbacks acknowledge nothing. */
  live: boolean
}

const noop = (): void => {}

/** Events a session got before its owner adopted it. */
export interface EarlyEvents {
  data: string[]
  exit?: TerminalExit
}

export class SessionRouter {
  private readonly routes = new Map<string, SessionRoute>()
  /** Spawns awaiting their reply; while any are, events for unknown sessions are kept. */
  private starting = 0
  private readonly early = new Map<string, EarlyEvents>()
  private readonly inFlight = new Map<string, InFlight>()
  private readonly acks: AckBatcher

  constructor(private readonly api: TerminalApi) {
    this.acks = new AckBatcher((id, chars) => api.ack(id, chars))
    api.onData((id, data) => {
      const route = this.routes.get(id)
      if (route) route.output(data, this.ackWhenParsed(id, data))
      else if (this.starting > 0) this.earlyFor(id).data.push(data)
      // Nobody will ever parse it (#16 D4).
      else this.acks.discarded(id, data.length)
    })
    api.onExit((exit) => {
      this.ended(exit.id)
      const route = this.routes.get(exit.id)
      if (route) {
        this.routes.delete(exit.id)
        route.exited(exit)
      } else if (this.starting > 0) this.earlyFor(exit.id).exit = exit
    })
  }

  /**
   * Spawns a shell through `terminal:spawn`; `settle` gets the reply (a rejection as a failed
   * one) and, on success, should `adopt` the session at once to receive what it printed so far.
   * `host` is an SSH card's host (#12 D5), null for a local card.
   */
  spawn(
    cols: number,
    rows: number,
    cwd: string,
    cardId: string,
    settle: (result: SpawnResult) => void,
    host: string | null = null
  ): void {
    this.starting++
    void this.api
      .spawn(cols, rows, cwd, cardId, host)
      .then(settle, (error: unknown) =>
        settle({ ok: false, reason: error instanceof Error ? error.message : String(error) })
      )
      .finally(() => {
        if (--this.starting === 0) this.discardEarly()
      })
  }

  /**
   * Sends session `id`'s events to `route` from now on; returns what it got before, for the
   * owner to replay (an early exit is not routed again).
   */
  adopt(id: string, route: SessionRoute): EarlyEvents {
    const early = this.early.get(id) ?? { data: [] }
    this.early.delete(id)
    if (!early.exit) {
      this.routes.set(id, route)
      this.inFlight.set(id, { chars: 0, live: true })
    }
    return early
  }

  /**
   * The write callback for a chunk of session `id` handed to its screen, e.g. an early chunk
   * replayed on adoption: it acknowledges the chunk once, when it runs (#16 D4). A no-op for a
   * session that isn't routed (it ended).
   */
  ackWhenParsed(id: string, data: string): () => void {
    const flight = this.inFlight.get(id)
    if (!flight) return noop
    const chars = data.length
    flight.chars += chars
    let done = false
    return () => {
      if (done || !flight.live) return
      done = true
      flight.chars -= chars
      this.acks.parsed(id, chars)
    }
  }

  /**
   * Stops routing session `id`'s events. What its screen hasn't parsed yet is acknowledged at
   * once: a released screen may never run its write callbacks (#16 D4).
   */
  release(id: string): void {
    this.routes.delete(id)
    const flight = this.inFlight.get(id)
    // Also flushes what was parsed and is still batched; sends nothing when both are 0.
    if (flight) this.acks.discarded(id, flight.chars)
    this.ended(id)
  }

  /** Session `id` is no longer routed: nothing of it is held back any more (#16 D4). */
  private ended(id: string): void {
    const flight = this.inFlight.get(id)
    if (flight) flight.live = false
    this.inFlight.delete(id)
    this.acks.forget(id)
  }

  /** The last pending spawn settled: early chunks nobody adopted are acknowledged (#16 D4). */
  private discardEarly(): void {
    for (const [id, { data, exit }] of this.early) {
      if (!exit)
        this.acks.discarded(
          id,
          data.reduce((sum, chunk) => sum + chunk.length, 0)
        )
    }
    this.early.clear()
  }

  private earlyFor(id: string): EarlyEvents {
    let early = this.early.get(id)
    if (!early) this.early.set(id, (early = { data: [] }))
    return early
  }
}
