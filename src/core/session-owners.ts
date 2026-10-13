/**
 * Which owner (a window's web contents) each terminal session belongs to. Plain TS: generic over
 * the owner so main can use WebContents while tests use plain objects.
 */
export class SessionOwners<Owner> {
  private readonly ownerById = new Map<string, Owner>()
  private readonly idsByOwner = new Map<Owner, Set<string>>()

  /** Returns true when this is the owner's first session, so the caller can hook its lifecycle once. */
  add(owner: Owner, id: string): boolean {
    this.ownerById.set(id, owner)
    const ids = this.idsByOwner.get(owner)
    if (ids) {
      ids.add(id)
      return false
    }
    this.idsByOwner.set(owner, new Set([id]))
    return true
  }

  ownerOf(id: string): Owner | undefined {
    return this.ownerById.get(id)
  }

  /** Forgets one session, e.g. when its process exits. */
  remove(id: string): void {
    const owner = this.ownerById.get(id)
    if (owner === undefined) return
    this.ownerById.delete(id)
    this.idsByOwner.get(owner)?.delete(id)
  }

  /** The owner's live session ids, which the caller kills; the owner itself stays hooked. */
  sessionsOf(owner: Owner): string[] {
    return [...(this.idsByOwner.get(owner) ?? [])]
  }

  /** Forgets the owner entirely (it is gone) and returns its session ids. */
  release(owner: Owner): string[] {
    const ids = this.sessionsOf(owner)
    for (const id of ids) this.ownerById.delete(id)
    this.idsByOwner.delete(owner)
    return ids
  }
}
