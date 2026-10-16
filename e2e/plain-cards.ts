import type { Locator, Page } from '@playwright/test'

/**
 * Cards are agent sessions, and a new workspace defaults to Claude Code, which a test must never
 * start for real. With the New workspace dialog open, this sets its default for new cards to a
 * Custom command that does nothing (`:`), so a test's cards are plain shell prompts, as Shell
 * cards were. A test choosing its own default does so after this.
 */
export async function plainCards(scope: Page | Locator): Promise<void> {
  await scope.getByTestId('workspace-startup').selectOption('custom')
  await scope.getByTestId('workspace-command').fill(':')
}
