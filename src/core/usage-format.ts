/**
 * How a card's Claude Code usage reads (#50 D8) and its workspace's total (D9). Plain TS with no
 * DOM or Node imports, so the renderer and Vitest run it. Numbers are grouped the en-US way
 * whatever the locale.
 */
import { contextLevel, contextPercent, contextWindow } from './claude-context'
import type { ClaudeUsage } from './claude-pricing'

const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const dollars = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

/** A full count with thousands grouped (`12,345`), as the tooltips show it (D8). */
export const formatCount = (n: number): string => grouped.format(n)

/**
 * A short token count (D8): below 1,000 as is, below 1,000,000 in rounded thousands (999,500 and
 * up reads `1.0M`), else millions with one decimal.
 */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 999_500) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** An estimated cost (D8): `≈$1.24`, thousands grouped, `<$0.01` below a cent. */
export function formatCost(cost: number): string {
  return cost < 0.01 ? '<$0.01' : `≈$${dollars.format(cost)}`
}

/** Whether a card shows a usage line: it has usage with tokens above 0 (D8). */
export const hasUsage = (u: ClaudeUsage | undefined): u is ClaudeUsage =>
  u !== undefined && u.tokens > 0

/** A card's context bar: how much of its conversation's window is used. */
export interface ContextUse {
  used: number
  window: number
  percent: number
  level: 'ok' | 'high' | 'full'
}

export function contextUse(u: ClaudeUsage): ContextUse {
  const window = contextWindow(u.model, u.context)
  const percent = contextPercent(u.context, window)
  return { used: u.context, window, percent, level: contextLevel(percent) }
}

/** The bar's label: `42% context`. */
export const contextLabel = (use: ContextUse): string => `${use.percent}% context`

/** The bar's tooltip, one line per `\n`: the context, then the token breakdown and the model. */
export function usageTooltip(u: ClaudeUsage): string {
  const use = contextUse(u)
  return [
    `Context ${formatCount(use.used)} of ${formatCount(use.window)} tokens (${use.percent}%)`,
    `Input ${formatCount(u.input)}`,
    `Output ${formatCount(u.output)}`,
    `Cache write ${formatCount(u.cacheWrite)}`,
    `Cache read ${formatCount(u.cacheRead)}`,
    ...(u.model === null ? [] : [`Model ${u.model}`])
  ].join('\n')
}

/** The title bar chip's text and tooltip (D9). */
export interface WorkspaceUsage {
  text: string
  tooltip: string
}

/**
 * A workspace's total over its cards with usage (D9): the sum of the known costs when at least
 * one card has a cost, else of the tokens. Null when no card has usage, so no chip shows.
 */
export function workspaceUsage(usages: (ClaudeUsage | undefined)[]): WorkspaceUsage | null {
  const cards = usages.filter(hasUsage)
  if (cards.length === 0) return null
  const tokens = cards.reduce((sum, u) => sum + u.tokens, 0)
  const costs = cards.flatMap((u) => (u.cost === undefined ? [] : [u.cost]))
  const text =
    costs.length > 0
      ? formatCost(costs.reduce((sum, c) => sum + c, 0))
      : `${formatTokens(tokens)} tokens`
  const tooltip = [
    "Claude Code usage of this workspace's cards (estimate)",
    `Cards ${cards.length}`,
    `Tokens ${formatCount(tokens)}`,
    ...(costs.length < cards.length ? ["Some cards' cost unknown"] : [])
  ].join('\n')
  return { text, tooltip }
}
