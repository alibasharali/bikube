/**
 * A Claude Code conversation's usage (#50 D3). Plain TS with no Node imports: the `board` CLI
 * reads it and the renderer formats it (`usage-format.ts`).
 */

/**
 * A card's usage (D3), as `board usage` sends it: plain JSON. The four token totals, `tokens`
 * their sum, `context` the latest main-transcript entry's input side and `model` that entry's
 * model (null when there is none).
 */
export interface ClaudeUsage {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  tokens: number
  context: number
  model: string | null
}

/** One entry's four counts (D2). */
export interface TokenCounts {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}
