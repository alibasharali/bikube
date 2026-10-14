/**
 * Terminal output flow control (#16 D1, D2): main counts, per PTY session, the characters it
 * sent to the renderer that the renderer hasn't acknowledged yet, pauses the PTY above the high
 * watermark and resumes it below the low one. Plain TS, shared with the renderer for the
 * constants; characters are JavaScript string length (UTF-16 code units) on both sides.
 */

/** Above this many unacknowledged characters a session's PTY is paused (#16 D2). */
export const HIGH_WATERMARK = 100_000
/** Below this many unacknowledged characters a paused PTY is resumed (#16 D2). */
export const LOW_WATERMARK = 5_000
/**
 * The renderer acknowledges a session's parsed characters once it holds this many, so what it
 * holds back always stays below the low watermark (#16 D2).
 */
export const ACK_BATCH_CHARS = 5_000

/** What flow control does to the PTYs: `SessionManager` in main, a fake in tests. */
export interface FlowTarget {
  pause(id: string): void
  resume(id: string): void
  kill(id: string): void
}

interface SessionFlow {
  unacked: number
  paused: boolean
  /** Killed: never paused again, so the shell reads to its hangup and exits (#16 D5). */
  ending: boolean
}

export class FlowControl {
  private readonly sessions = new Map<string, SessionFlow>()
  private peak = 0

  constructor(private readonly target: FlowTarget) {}

  /** Characters of session `id` not acknowledged yet; 0 for an unknown session. */
  unacked(id: string): number {
    return this.sessions.get(id)?.unacked ?? 0
  }

  /**
   * The most characters any session had unacknowledged since the last `resetPeak` (the
   * benchmark's backlog reading, #16 D7).
   */
  peakUnacked(): number {
    return this.peak
  }

  /** Starts a new peak window from what the sessions have unacknowledged now. */
  resetPeak(): void {
    this.peak = 0
    for (const flow of this.sessions.values()) this.peak = Math.max(this.peak, flow.unacked)
  }

  /** Counts a chunk of `chars` characters sent to the renderer; pauses above the high mark. */
  sent(id: string, chars: number): void {
    let flow = this.sessions.get(id)
    if (!flow) this.sessions.set(id, (flow = { unacked: 0, paused: false, ending: false }))
    flow.unacked += chars
    if (flow.unacked > this.peak) this.peak = flow.unacked
    if (!flow.paused && !flow.ending && flow.unacked > HIGH_WATERMARK) {
      flow.paused = true
      this.target.pause(id)
    }
  }

  /**
   * The renderer parsed `chars` characters of session `id` (#16 D3): `unacked` never goes below
   * 0, and a paused PTY resumes once it is below the low mark.
   */
  acknowledged(id: string, chars: number): void {
    const flow = this.sessions.get(id)
    if (!flow) return
    flow.unacked = Math.max(0, flow.unacked - chars)
    if (flow.paused && flow.unacked < LOW_WATERMARK) {
      flow.paused = false
      this.target.resume(id)
    }
  }

  /** Kills session `id`, resuming its PTY first if paused, and never pauses it again (#16 D5). */
  kill(id: string): void {
    const flow = this.sessions.get(id)
    if (flow) {
      flow.ending = true
      if (flow.paused) {
        flow.paused = false
        this.target.resume(id)
      }
    }
    this.target.kill(id)
  }

  /** Drops session `id`'s count once it has exited. */
  forget(id: string): void {
    this.sessions.delete(id)
  }
}
