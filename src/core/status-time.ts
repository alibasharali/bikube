/**
 * How long each running card or shell has been in its Split sidebar group (#79 D5, D6): the
 * runtime stamps of each one's last group change, its start counting as one, and the compact age
 * an agent row shows. Plain TS with no DOM imports: the renderer runs it.
 */
import type { Activity } from './activity'
import { agentGroupOf, type AgentGroupId } from './sidebar-sections'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** An age in whole units, rounded down: `now` under a minute, then `4m`, `2h`, `3d`. */
export function formatAge(ms: number): string {
  if (ms < MINUTE) return 'now'
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`
  return `${Math.floor(ms / DAY)}d`
}

/** What a stamp needs of a running card or shell. */
export interface StampedRow {
  cardId: string
  activity?: Activity
}

/**
 * Each running card's or shell's group and when it last changed, by card id. Runtime only: a row
 * missing from an update has stopped and is forgotten.
 */
export class GroupStamps {
  private stamps = new Map<string, { group: AgentGroupId; since: number }>()
  private snapshot: ReadonlyMap<string, number> = new Map()

  /**
   * Takes every running row at time `now`, stamping a new one and one whose group changed, and
   * returns each row's stamp by card id (the same map while nothing changed).
   */
  update(rows: readonly StampedRow[], now: number): ReadonlyMap<string, number> {
    let changed = rows.length !== this.stamps.size
    const next = new Map<string, { group: AgentGroupId; since: number }>()
    for (const row of rows) {
      const group = agentGroupOf(row.activity)
      const old = this.stamps.get(row.cardId)
      if (old?.group === group) next.set(row.cardId, old)
      else {
        next.set(row.cardId, { group, since: now })
        changed = true
      }
    }
    this.stamps = next
    if (changed) this.snapshot = new Map([...next].map(([id, s]) => [id, s.since]))
    return this.snapshot
  }
}
