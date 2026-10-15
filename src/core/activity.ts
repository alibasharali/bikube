/**
 * A card's activity (#31 D12, D13): what the agent in it says it is doing, set with
 * `board activity`. Runtime only, like the agent status. Plain TS.
 */

/** A card's activity while set. */
export type Activity = 'working' | 'waiting' | 'question'

/** What `board activity` takes: an activity, or `none` to clear it. */
export type ActivityValue = Activity | 'none'

export const ACTIVITY_VALUES: readonly ActivityValue[] = ['working', 'waiting', 'question', 'none']

export function isActivityValue(value: unknown): value is ActivityValue {
  return typeof value === 'string' && (ACTIVITY_VALUES as readonly string[]).includes(value)
}

/** The pill's text for each activity (#31 D13). */
export const ACTIVITY_LABELS: Record<Activity, string> = {
  working: 'Working',
  waiting: 'Waiting for you',
  question: 'Needs your answer'
}
