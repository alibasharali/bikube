/**
 * A Claude Code conversation's usage (#50 D3) and its estimated cost (D4): the built-in price
 * table and an entry's price. Plain TS with no Node imports: the `board` CLI prices what it reads
 * and the renderer formats the result (`usage-format.ts`).
 */

/**
 * A card's usage (D3), as `board usage` sends it: plain JSON. The four token totals, `tokens`
 * their sum, `context` the latest main-transcript entry's input side, `model` that entry's model
 * (null when there is none) and `cost` the estimate in USD, absent when unknown (D4).
 */
export interface ClaudeUsage {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  tokens: number
  context: number
  model: string | null
  cost?: number
}

/** One entry's four counts (D2). */
export interface TokenCounts {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

/** USD per million tokens. */
export interface Price {
  input: number
  output: number
}

/** Cache writes cost 1.25x input, cache reads 0.1x input (D4). */
const CACHE_WRITE_FACTOR = 1.25
const CACHE_READ_FACTOR = 0.1

const price = (input: number, output: number): Price => ({ input, output })

/** The number right after `prefix`, or null when the model doesn't continue with one. */
const generation = (model: string, prefix: string): number | null => {
  if (!model.startsWith(prefix)) return null
  const digits = /^\d+/.exec(model.slice(prefix.length))
  return digits ? Number(digits[0]) : null
}

/** D4's table, by what `message.model` starts with; null when no row matches. */
export function priceFor(model: string): Price | null {
  const opus = generation(model, 'claude-opus-')
  if (opus !== null && opus >= 5) return price(5, 25)
  if (/^claude-opus-4-[5-9]/.test(model)) return price(5, 25)
  if (model.startsWith('claude-opus-4') || model.startsWith('claude-3-opus')) return price(15, 75)
  if (
    model.startsWith('claude-sonnet-') ||
    model.startsWith('claude-3-7-sonnet') ||
    model.startsWith('claude-3-5-sonnet')
  ) {
    return price(3, 15)
  }
  const haiku = generation(model, 'claude-haiku-')
  if ((haiku !== null && haiku >= 5) || model.startsWith('claude-haiku-4-5')) return price(1, 5)
  if (model.startsWith('claude-3-5-haiku')) return price(0.8, 4)
  return null
}

/** One entry's cost in USD at its model's price (D4); null when the model has no price. */
export function entryCost(model: string | null, counts: TokenCounts): number | null {
  const p = model === null ? null : priceFor(model)
  if (!p) return null
  const perToken = p.input / 1_000_000
  return (
    counts.input * perToken +
    counts.cacheWrite * perToken * CACHE_WRITE_FACTOR +
    counts.cacheRead * perToken * CACHE_READ_FACTOR +
    (counts.output * p.output) / 1_000_000
  )
}
