/**
 * Main's side of a `board` request (#9 D3, D10): main resolves nothing itself. It forwards a
 * valid request to the window whose page owns the calling card's session and relays that
 * window's answer. Plain TS, generic over the window so tests use plain objects.
 */
import type { BoardCommand } from './board-args'
import { NO_ANSWER } from './board-client'
import { NOT_IN_A_CARD } from './board-commands'
import { MAX_REQUEST_LINE_BYTES, type BoardReply, type BoardRequest } from './board-protocol'

export const NO_WINDOW = 'board: Drovr has no open window'
/** How long main waits for the window, under the CLI's 5 s so the CLI hears why (#9 D9). */
export const RELAY_TIMEOUT_MS = 4000

/**
 * The window owning the card's live session; undefined when the card has no live session in
 * this run, null when it has one but its window is gone.
 */
export type CardOwnerLookup<Owner> = (cardId: string) => Owner | null | undefined

/** Sends the request to the window; throws when it can't (e.g. the window is gone). */
export type SendToOwner<Owner> = (
  owner: Owner,
  requestId: string,
  cardId: string,
  command: BoardCommand
) => void

interface Pending<Owner> {
  owner: Owner
  resolve: (reply: BoardReply) => void
  timer: ReturnType<typeof setTimeout>
}

/** A reply as a window may send it: `{ ok: true }` or an error string of bounded length. */
function asReply(value: unknown): BoardReply | null {
  if (typeof value !== 'object' || value === null) return null
  const { ok, error } = value as { ok?: unknown; error?: unknown }
  if (ok === true) return { ok: true }
  if (ok === false && typeof error === 'string' && error.length <= MAX_REQUEST_LINE_BYTES) {
    return { ok: false, error }
  }
  return null
}

/** The command in a request, without its version and calling card. */
function commandOf(request: BoardRequest): BoardCommand {
  switch (request.command) {
    case 'move':
      return { command: 'move', card: request.card, column: request.column }
    case 'status':
      return { command: 'status', card: request.card, text: request.text }
    case 'activity':
      return { command: 'activity', card: request.card, activity: request.activity }
    case 'session':
      return { command: 'session', card: request.card, session: request.session }
    case 'setup':
      return { command: 'setup', card: request.card, result: request.result }
    case 'usage':
      return { command: 'usage', card: request.card, usage: request.usage }
  }
}

export class BoardRelay<Owner> {
  private readonly pending = new Map<string, Pending<Owner>>()
  private nextId = 1

  constructor(
    private readonly ownerOfCard: CardOwnerLookup<Owner>,
    private readonly send: SendToOwner<Owner>,
    private readonly timeoutMs = RELAY_TIMEOUT_MS
  ) {}

  /** The reply for a parsed request; never rejects. */
  handle(request: BoardRequest): Promise<BoardReply> {
    const owner = this.ownerOfCard(request.cardId)
    if (owner === undefined) return Promise.resolve({ ok: false, error: NOT_IN_A_CARD })
    if (owner === null) return Promise.resolve({ ok: false, error: NO_WINDOW })
    const { cardId } = request
    const command = commandOf(request)
    const requestId = String(this.nextId++)
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => this.settle(requestId, { ok: false, error: NO_ANSWER }),
        this.timeoutMs
      )
      this.pending.set(requestId, { owner, resolve, timer })
      try {
        this.send(owner, requestId, cardId, command)
      } catch {
        this.settle(requestId, { ok: false, error: NO_WINDOW })
      }
    })
  }

  /**
   * A window's answer: taken only from the window the request went to, for a request still
   * waiting, and only when it is a well-formed reply. Returns whether it was taken.
   */
  answer(owner: Owner, requestId: unknown, reply: unknown): boolean {
    if (typeof requestId !== 'string') return false
    const pending = this.pending.get(requestId)
    if (!pending || pending.owner !== owner) return false
    const valid = asReply(reply)
    if (!valid) return false
    this.settle(requestId, valid)
    return true
  }

  /** The window is gone: its outstanding requests get `NO_WINDOW` at once. */
  release(owner: Owner): void {
    this.settleAll(owner, NO_WINDOW)
  }

  /**
   * The window's page reloaded or crashed (#9 D9): its outstanding requests get `NO_ANSWER` at
   * once, so the new page can't answer what was sent to the old one.
   */
  releasePage(owner: Owner): void {
    this.settleAll(owner, NO_ANSWER)
  }

  private settleAll(owner: Owner, error: string): void {
    for (const [requestId, pending] of this.pending) {
      if (pending.owner === owner) this.settle(requestId, { ok: false, error })
    }
  }

  private settle(requestId: string, reply: BoardReply): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    clearTimeout(pending.timer)
    pending.resolve(reply)
  }
}
