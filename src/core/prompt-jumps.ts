/**
 * Previous prompt and Next prompt (#45 D5), free of DOM imports: the buffer row a jump makes the
 * viewport's top row. Rows are absolute buffer lines; prompts may come in any order, and two on
 * one row (fish 4 sends its own marks beside Drovr's) count as one.
 */
export type PromptJump = 'previous' | 'next'

/**
 * The row to scroll to, or null to do nothing. Previous: the last prompt above `top`, the
 * viewport's top row, none without one. Next: the first prompt below `top`, else `bottom` (the
 * buffer's last scroll position, where the view also ends when the prompt is on the last screen).
 */
export function promptJumpTarget(
  jump: PromptJump,
  prompts: readonly number[],
  top: number,
  bottom: number
): number | null {
  // A loop, not Math.max(...rows): a long scrollback may hold more prompts than arguments fit.
  let found: number | null = null
  for (const row of prompts) {
    if (
      jump === 'previous'
        ? row < top && (found === null || row > found)
        : row > top && (found === null || row < found)
    ) {
      found = row
    }
  }
  if (jump === 'previous') return found
  return found === null ? bottom : Math.min(found, bottom)
}
