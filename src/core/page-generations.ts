/**
 * Which page load each owner (a window's web contents) is on, so work that awaits can tell whether
 * the page that asked for it is still there (#4 D16). Plain TS: generic over the owner, like
 * SessionOwners.
 */
export class PageGenerations<Owner> {
  // A fresh token per page load: identity, not a count, so a released owner never matches again.
  private readonly tokens = new Map<Owner, object>()

  /** Returns true on first contact with the owner, so the caller can hook its navigation once. */
  track(owner: Owner): boolean {
    if (this.tokens.has(owner)) return false
    this.tokens.set(owner, {})
    return true
  }

  /** The owner started loading a new page: earlier snapshots go stale. */
  bump(owner: Owner): void {
    if (this.tokens.has(owner)) this.tokens.set(owner, {})
  }

  /** A check that stays true while the owner shows the page it shows now. */
  snapshot(owner: Owner): () => boolean {
    const token = this.tokens.get(owner)
    return () => token !== undefined && this.tokens.get(owner) === token
  }

  /** Forgets the owner (it is gone); its snapshots go stale. */
  release(owner: Owner): void {
    this.tokens.delete(owner)
  }
}
