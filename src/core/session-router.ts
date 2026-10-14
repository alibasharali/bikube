/**
 * Routes main's terminal events to whoever owns each shell session: a card's own terminal or one
 * of its extra panes (#11 D1). One `onData`/`onExit` subscription for the whole renderer, so
 * output that arrives before a session's spawn reply is kept for its owner instead of racing
 * between listeners.
 */
import type { SpawnResult, TerminalApi, TerminalExit } from '../shared/api'

/** Where one session's events go. */
export interface SessionRoute {
  output(data: string): void
  /** The session is forgotten before this runs. */
  exited(exit: TerminalExit): void
}

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

  constructor(private readonly api: TerminalApi) {
    api.onData((id, data) => {
      const route = this.routes.get(id)
      if (route) route.output(data)
      else if (this.starting > 0) this.earlyFor(id).data.push(data)
    })
    api.onExit((exit) => {
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
        if (--this.starting === 0) this.early.clear()
      })
  }

  /**
   * Sends session `id`'s events to `route` from now on; returns what it got before, for the
   * owner to replay (an early exit is not routed again).
   */
  adopt(id: string, route: SessionRoute): EarlyEvents {
    const early = this.early.get(id) ?? { data: [] }
    this.early.delete(id)
    if (!early.exit) this.routes.set(id, route)
    return early
  }

  /** Stops routing session `id`'s events. */
  release(id: string): void {
    this.routes.delete(id)
  }

  private earlyFor(id: string): EarlyEvents {
    let early = this.early.get(id)
    if (!early) this.early.set(id, (early = { data: [] }))
    return early
  }
}
