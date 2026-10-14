/**
 * The renderer's side of flow control (#16 D2, D4): counts, per session, the characters its
 * screen has parsed and acknowledges them to main in batches, so what it holds back always
 * stays below main's low watermark. Plain TS; `SessionRouter` owns one over `TerminalApi.ack`.
 */
import { ACK_BATCH_CHARS } from './flow-control'

export class AckBatcher {
  /** Parsed characters per session not acknowledged yet, always below the batch size. */
  private readonly pending = new Map<string, number>()

  constructor(private readonly ack: (id: string, chars: number) => void) {}

  /** A screen parsed `chars` characters of session `id`. */
  parsed(id: string, chars: number): void {
    const total = (this.pending.get(id) ?? 0) + chars
    if (total < ACK_BATCH_CHARS) {
      if (total > 0) this.pending.set(id, total)
      return
    }
    this.pending.delete(id)
    this.ack(id, total)
  }

  /** `chars` characters of session `id` will never be parsed: acknowledged at once (#16 D4). */
  discarded(id: string, chars: number): void {
    const total = (this.pending.get(id) ?? 0) + chars
    this.pending.delete(id)
    if (total > 0) this.ack(id, total)
  }

  /** Drops session `id`'s pending count: the session ended (#16 D4). */
  forget(id: string): void {
    this.pending.delete(id)
  }
}
