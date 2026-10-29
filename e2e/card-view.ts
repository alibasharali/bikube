import { expect, type Locator, type Page } from '@playwright/test'

// The open card has no bar (#31 D1): every card action is a shortcut (D5, D6), and going back is
// the Back shortcut or a click on the active workspace in the sidebar (D2). Shared by the specs
// that open cards.

const darwin = process.platform === 'darwin'

/** The default shortcuts of the card view (#31 D6), as Playwright key combinations. */
export const SHORTCUTS = {
  back: darwin ? 'Meta+Shift+B' : 'Control+Shift+B',
  splitRight: darwin ? 'Meta+D' : 'Control+Shift+D',
  splitDown: darwin ? 'Meta+Shift+D' : 'Control+Shift+E',
  closePane: darwin ? 'Meta+W' : 'Control+Shift+W',
  closeCard: darwin ? 'Meta+Shift+W' : 'Control+Shift+Q',
  zoomPane: darwin ? 'Meta+Shift+Enter' : 'Control+Shift+Enter',
  focusNextPane: darwin ? 'Meta+]' : 'Control+Meta+]',
  focusPreviousPane: darwin ? 'Meta+[' : 'Control+Meta+[',
  equalizePanes: 'Control+Meta+=',
  resizePaneRight: darwin ? 'Control+Meta+ArrowRight' : 'Control+Shift+Meta+ArrowRight',
  renameCard: darwin ? 'Alt+Meta+r' : 'Control+Shift+F2'
} as const

/** The full-size card view. */
export const cardView = (page: Page): Locator => page.getByTestId('card-view')

/** Waits until card `title` is open at full size (the view is named after its card). */
export async function expectCardOpen(page: Page, title: string): Promise<void> {
  await expect(cardView(page)).toHaveAttribute('aria-label', title)
}

/** Goes back to the board (or a grid view workspace's grid) with the Back shortcut. */
export async function backToBoard(page: Page): Promise<void> {
  await page.keyboard.press(SHORTCUTS.back)
  await expect(page.getByTestId('board').or(page.getByTestId('grid-view'))).toBeVisible()
}

/** Splits the focused pane of the open card to the right (the Split right shortcut). */
export async function splitRight(page: Page): Promise<void> {
  await page.keyboard.press(SHORTCUTS.splitRight)
}

/** Splits the focused pane of the open card downwards (the Split down shortcut). */
export async function splitDown(page: Page): Promise<void> {
  await page.keyboard.press(SHORTCUTS.splitDown)
}

/** Zooms the open view's focused pane, or ends its zoom (the Zoom pane shortcut, #48 D3). */
export async function zoomPane(page: Page): Promise<void> {
  await page.keyboard.press(SHORTCUTS.zoomPane)
}

/** Presses the Close card shortcut: a running card's Close confirmation opens. */
export async function closeCard(page: Page): Promise<void> {
  await page.keyboard.press(SHORTCUTS.closeCard)
}

/** Card `title` on the active workspace's board. */
export const boardCard = (page: Page, title: string): Locator =>
  page
    .getByTestId('card')
    .filter({ has: page.getByTestId('card-title').getByText(title, { exact: true }) })

/**
 * The open card shows no status (#31 D1): goes back to the board, runs `check` on card `title`
 * there, then opens it again (a running card just shows again, its panes and shells as they were).
 */
export async function checkOnBoard(
  page: Page,
  title: string,
  check: (card: Locator) => Promise<void>
): Promise<void> {
  await backToBoard(page)
  await check(boardCard(page, title))
  await boardCard(page, title).getByTestId('card-open').click()
  await expectCardOpen(page, title)
  // Opening focuses the pane that had the focus, so typing goes on where it left off.
  await expect
    .poll(() =>
      page.evaluate(
        () => document.activeElement?.closest('[data-testid=card-view] [data-testid=pane]') != null
      )
    )
    .toBe(true)
}

/** The open card `title` reads `status` on the board, and is open again after (`checkOnBoard`). */
export async function expectStatusOnBoard(
  page: Page,
  title: string,
  status: string
): Promise<void> {
  await checkOnBoard(page, title, (card) =>
    expect(card.getByTestId('card-status-label')).toHaveText(status)
  )
}

/**
 * The lines below the newest `── Previous output ·` separator (#46 D5), so a reopened card's new
 * screen can be told from the output restored above it; all of them when there is none.
 */
export function belowSeparator(lines: string[]): string[] {
  const separator = lines.findLastIndex((l) => l.startsWith('── Previous output ·'))
  return lines.slice(separator + 1)
}
