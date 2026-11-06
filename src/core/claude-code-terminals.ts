/**
 * Which cards and shells run Claude Code in their main pane now, by #58's signal (#79 D2 rule 2),
 * with change notifications for the sidebar. Plain TS with no DOM imports: the renderer runs it.
 */
export class ClaudeCodeTerminals {
  private running: ReadonlySet<string> = new Set()
  private readonly listeners = new Set<() => void>()

  /** The ids running Claude Code; a new set after each change, the same one until then. */
  snapshot(): ReadonlySet<string> {
    return this.running
  }

  /** Sets whether `cardId` runs Claude Code, telling the listeners only when that changes. */
  set(cardId: string, runs: boolean): void {
    if (this.running.has(cardId) === runs) return
    const next = new Set(this.running)
    if (runs) next.add(cardId)
    else next.delete(cardId)
    this.running = next
    for (const listener of this.listeners) listener()
  }

  /** Calls `listener` after each change; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
