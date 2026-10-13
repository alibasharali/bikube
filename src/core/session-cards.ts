/**
 * Which card each live terminal session runs (#9 D3). Main records it at spawn and forgets it at
 * exit, so a `board` request is served only for a card with a live session in this app run.
 */
export class SessionCards {
  private readonly cardBySession = new Map<string, string>()
  private readonly sessionByCard = new Map<string, string>()

  add(sessionId: string, cardId: string): void {
    this.cardBySession.set(sessionId, cardId)
    this.sessionByCard.set(cardId, sessionId)
  }

  /** Forgets a session, e.g. when its process exits; a newer session of its card stays. */
  remove(sessionId: string): void {
    const cardId = this.cardBySession.get(sessionId)
    if (cardId === undefined) return
    this.cardBySession.delete(sessionId)
    if (this.sessionByCard.get(cardId) === sessionId) this.sessionByCard.delete(cardId)
  }

  /** The card's latest live session, if it has one. */
  sessionOf(cardId: string): string | undefined {
    return this.sessionByCard.get(cardId)
  }
}
