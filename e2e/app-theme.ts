import { expect, type Page } from '@playwright/test'

/**
 * Picks app theme `name` (#64) in Settings' Appearance section, by its shortcut, a click on the
 * tile and Escape, from the board or an open card.
 */
export async function pickAppTheme(page: Page, name: string): Promise<void> {
  const settings = page.getByTestId('settings-dialog')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Comma' : 'Control+Comma')
  const tile = settings
    .getByRole('radiogroup', { name: 'App theme' })
    .getByRole('radio', { name, exact: true })
  await tile.check()
  await expect(tile).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)
}

/** The body's computed background in `page`. */
export const bodyBackground = (page: Page): Promise<string> =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor)
