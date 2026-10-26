/**
 * The first launch's view prompt: Kanban or Grid as the default view, asked once. Plain TS, no
 * Electron imports.
 */

/**
 * The renderer argument main passes when the prompt must not show: only the development build
 * does, for smoke tests (`BIKUBE_E2E_NO_VIEW_PROMPT=1`, set by `e2e/launch.ts`), whose every launch
 * would otherwise start behind it.
 */
export const NO_VIEW_PROMPT_ARG = '--bikube-no-view-prompt'

/**
 * Whether the prompt shows: not answered yet, and no workspace yet, so a board from before it (or
 * joined through a Sync folder) never asks.
 */
export function showViewPrompt(viewChosen: boolean, workspaces: number, skipped: boolean): boolean {
  return !skipped && !viewChosen && workspaces === 0
}
