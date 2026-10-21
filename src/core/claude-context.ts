/**
 * How full a Claude Code conversation's context window is, for a card's context bar. The window
 * by model, from Anthropic's model table: 1M for Fable, Mythos and the 5 family, Opus and Sonnet
 * 4.6 and later; 200K for the rest (Haiku 4.5, older models, unknown names). A context already
 * past 200K can only be a 1M window. Plain TS.
 */

export const STANDARD_CONTEXT_WINDOW = 200_000
export const LONG_CONTEXT_WINDOW = 1_000_000

/** The number right after `prefix` (a family's generation), or null. */
function generation(model: string, prefix: string): number | null {
  if (!model.startsWith(prefix)) return null
  const digits = /^(\d+)(?:-(\d)(?!\d))?/.exec(model.slice(prefix.length))
  if (!digits) return null
  return Number(digits[1]) + (digits[2] === undefined ? 0 : Number(digits[2]) / 10)
}

/** Whether `model` (a transcript's `message.model`) has a 1M window. */
function hasLongContext(model: string): boolean {
  if (model.includes('[1m]')) return true
  if (model.startsWith('claude-fable-') || model.startsWith('claude-mythos-')) return true
  for (const [family, from] of [
    ['opus', 4.6],
    ['sonnet', 4.6],
    ['haiku', 5]
  ] as const) {
    const g = generation(model, `claude-${family}-`)
    if (g !== null && g >= from) return true
  }
  return false
}

/** The context window, in tokens, of a conversation on `model` that holds `used` tokens. */
export function contextWindow(model: string | null, used: number): number {
  if (used > STANDARD_CONTEXT_WINDOW) return LONG_CONTEXT_WINDOW
  return model !== null && hasLongContext(model) ? LONG_CONTEXT_WINDOW : STANDARD_CONTEXT_WINDOW
}

/** `used` as a whole percentage of `window`, 0 to 100; anything above 0 reads at least 1. */
export function contextPercent(used: number, window: number): number {
  if (used <= 0) return 0
  return Math.min(100, Math.max(1, Math.round((used / window) * 100)))
}

/** How full the bar reads: `ok`, `high` from 70% (compaction nears), `full` from 90%. */
export function contextLevel(percent: number): 'ok' | 'high' | 'full' {
  return percent >= 90 ? 'full' : percent >= 70 ? 'high' : 'ok'
}
