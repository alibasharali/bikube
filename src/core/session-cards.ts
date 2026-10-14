/**
 * Which card each live terminal session runs (#9 D3). Main records it at spawn and forgets it at
 * exit, so a `board` request is served only for a card with a live session in this app run.
 * A card may have several live sessions at once, its main pane and extra panes (#11 D8): it
 * counts as live while any of them is.
 */
export class SessionCards {
  private readonly cardBySession = new Map<string, string>()
  /** Each card's live sessions, oldest first. */
  private readonly sessionsByCard = new Map<string, string[]>()

  add(sessionId: string, cardId: string): void {
    this.cardBySession.set(sessionId, cardId)
    const sessions = this.sessionsByCard.get(cardId)
    if (sessions) sessions.push(sessionId)
    else this.sessionsByCard.set(cardId, [sessionId])
  }

  /** Forgets a session, e.g. when its process exits; the card's other sessions stay. */
  remove(sessionId: string): void {
    const cardId = this.cardBySession.get(sessionId)
    if (cardId === undefined) return
    this.cardBySession.delete(sessionId)
    const sessions = this.sessionsByCard.get(cardId)?.filter((id) => id !== sessionId) ?? []
    if (sessions.length > 0) this.sessionsByCard.set(cardId, sessions)
    else this.sessionsByCard.delete(cardId)
  }

  /** The card's latest live session, if it has one. */
  sessionOf(cardId: string): string | undefined {
    return this.sessionsByCard.get(cardId)?.at(-1)
  }
}
