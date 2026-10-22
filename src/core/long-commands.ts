/**
 * Long command notifications (#45 D7): a command that ran 10 s or more (from its `C` to its `D`)
 * and ended in a terminal the user isn't looking at gets a notification like an agent's. Plain TS.
 */

/** How long a command must run to be told of, in ms. */
export const LONG_COMMAND_MS = 10_000

/** Where the user looks: the window's focus, the card or shell open at full size, its focused pane. */
export interface Viewing {
  windowFocused: boolean
  openId: string | null
  /** The open card's focused pane (`MAIN_PANE` or an extra pane's id). */
  focusedPane: string
}

/**
 * The notification's body for `command`, ended in pane `at.paneId` of card or shell `at.cardId`
 * of `workspace`; null when it ran less than `thresholdMs`, isn't ended, or is in view.
 */
export function longCommandNotice(
  command: { start: number; end?: number; exitCode?: number },
  at: { cardId: string; paneId: string },
  viewing: Viewing,
  workspace: string,
  thresholdMs = LONG_COMMAND_MS
): { body: string } | null {
  if (command.end === undefined || command.end - command.start < thresholdMs) return null
  const inView =
    viewing.windowFocused && viewing.openId === at.cardId && viewing.focusedPane === at.paneId
  if (inView) return null
  const exitCode = command.exitCode ?? 0
  const what = exitCode === 0 ? 'Command finished' : `Command failed (exit ${exitCode})`
  return { body: `${what} · ${workspace}` }
}

const ARG = '--bikube-long-command-ms='

/** The renderer's argument carrying a shortened threshold (the development build's tests only). */
export const longCommandMsArg = (ms: number | string): string => `${ARG}${ms}`

/** The shortened threshold in `argv`, or undefined for none or anything not a positive integer. */
export function parseLongCommandMs(argv: readonly string[]): number | undefined {
  const value = argv.find((a) => a.startsWith(ARG))?.slice(ARG.length)
  if (!value || !/^\d+$/.test(value)) return undefined
  const ms = Number(value)
  return ms > 0 ? ms : undefined
}
