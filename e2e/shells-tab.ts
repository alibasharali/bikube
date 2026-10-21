import type { Page } from '@playwright/test'

/**
 * Shows the side panel's Shells tab, where a workspace's shells are listed (the panel opens on
 * Files). The choice is saved, so it stays for the rest of the test.
 */
export async function showShells(page: Page): Promise<void> {
  const tab = page.getByTestId('side-panel-tab-shells')
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
}
