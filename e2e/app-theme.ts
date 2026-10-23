import type { Page } from '@playwright/test'

/**
 * Picks app theme `id` (#64) as Settings does: through the renderer's settings store, which
 * applies it to every window and saves it. Uses the hook only the development build exposes.
 */
export async function setAppTheme(page: Page, id: string): Promise<void> {
  const ok = await page.evaluate(
    (theme) =>
      (
        window as unknown as {
          __bikubeSettings?: { update(change: { appTheme: string }): boolean }
        }
      ).__bikubeSettings?.update({ appTheme: theme }) ?? false,
    id
  )
  if (!ok) throw new Error(`app theme ${id} not applied`)
}

/** The body's computed background in `page`. */
export const bodyBackground = (page: Page): Promise<string> =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor)
