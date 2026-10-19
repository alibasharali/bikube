/**
 * A workspace's automatic move rules (#42 D1, D2, D7). Plain TS: no Electron, Node or DOM
 * imports. Each rule names one of the workspace's columns by id; a rule with no key is off.
 */

/** The three triggers (D1): `waiting` covers both the `waiting` and `question` activities. */
export const AUTO_MOVE_TRIGGERS = ['working', 'waiting', 'stopped'] as const
export type AutoMoveTrigger = (typeof AUTO_MOVE_TRIGGERS)[number]

/** A key only for a rule that is on, its value a column id of the workspace (D2). */
export type AutoMove = Partial<Record<AutoMoveTrigger, string>>

/**
 * The rules with every one naming a column not in `columnIds` turned off, or null when none is
 * left on (the workspace then has no `autoMove` key, D2).
 */
export function keepKnownRules(
  autoMove: AutoMove | undefined,
  columnIds: readonly string[]
): AutoMove | null {
  const kept: AutoMove = {}
  for (const trigger of AUTO_MOVE_TRIGGERS) {
    const columnId = autoMove?.[trigger]
    if (columnId !== undefined && columnIds.includes(columnId)) kept[trigger] = columnId
  }
  return Object.keys(kept).length > 0 ? kept : null
}

/** True when every rule of `autoMove` names one of `columnIds` (D9's store check). */
export function rulesNameKnownColumns(autoMove: AutoMove, columnIds: readonly string[]): boolean {
  return AUTO_MOVE_TRIGGERS.every(
    (t) => autoMove[t] === undefined || columnIds.includes(autoMove[t])
  )
}

/**
 * Reads `autoMove` from a saved or synced workspace (D7): missing is every rule off (null); not
 * an object, or a rule whose value isn't a string, is 'bad'; a rule naming a column the workspace
 * doesn't have reads as off; unknown keys are ignored.
 */
export function readAutoMove(raw: unknown, columnIds: readonly string[]): AutoMove | null | 'bad' {
  if (raw === undefined) return null
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'bad'
  const rules = raw as Record<string, unknown>
  for (const trigger of AUTO_MOVE_TRIGGERS) {
    if (rules[trigger] !== undefined && typeof rules[trigger] !== 'string') return 'bad'
  }
  return keepKnownRules(rules as AutoMove, columnIds)
}
