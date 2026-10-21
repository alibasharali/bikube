import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expectCardOpen } from './card-view'
import { fakeClaudeHome } from './fake-claude'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Pasting an image (Cmd+V on macOS, Ctrl+Shift+V elsewhere): with only an image on the clipboard,
// a pane running Claude Code gets Ctrl+V, its image paste key (it reads the clipboard itself);
// text pastes as before, and anywhere else an image alone pastes nothing. Main's clipboard is
// stubbed, never the display's shared one.

let app: ElectronApplication
let page: Page
let root: string

const PASTE = process.platform === 'darwin' ? 'Meta+V' : 'Control+Shift+V'

// Like Claude Code: focus reporting on while it runs, the tty raw. Prints each byte it reads; q
// (113) quits.
const FAKE_CLAUDE = `#!/bin/bash
stty -icanon -iexten -echo
printf '\\033[?1004h'
echo claude-ready
# One byte at a time with dd: bash's own read turns literal-next (Ctrl+V) back on.
while c=$(dd bs=1 count=1 2>/dev/null | od -An -tu1); [ -n "$c" ]; do
  [ $c = 113 ] && break
  printf 'got:%d\\n' $c
done
stty sane
printf '\\033[?1004l'
echo claude-done
`

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'drovr-image-paste-'))
  const fake = fakeClaudeHome(root)
  writeFileSync(join(fake.home, 'bin', 'claude'), FAKE_CLAUDE)
  chmodSync(join(fake.home, 'bin', 'claude'), 0o755)
  ;({ app, page } = await launchApp({ env: fake.env }))
})

test.afterEach(async () => {
  await app?.close()
  removeDataDirs()
  rmSync(root, { recursive: true, force: true })
})

/** Main's clipboard holds `text`, and an image when `image`. */
async function clipboardHolds(text: string, image: boolean): Promise<void> {
  await app.evaluate(
    ({ clipboard }, held) => {
      clipboard.readText = () => held.text
      clipboard.readImage = () => ({ isEmpty: () => !held.image }) as Electron.NativeImage
    },
    { text, image }
  )
}

async function addWorkspace(plain: boolean): Promise<void> {
  await page.getByTestId('workspace-add').click()
  if (plain) await plainCards(page)
  await page.getByTestId('workspace-directory').fill(root)
  await page.getByTestId('workspace-name').fill('alpha')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

async function newCard(title: string): Promise<void> {
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
}

/** The open card's terminal, one line per row. */
function lines(): Promise<string[]> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid=card-view] [data-testid=terminal]') as
      | (HTMLElement & {
          __xterm?: {
            buffer: {
              active: {
                length: number
                getLine(i: number): { translateToString(trim: boolean): string } | undefined
              }
            }
          }
        })
      | null
    const buffer = host?.__xterm?.buffer.active
    if (!buffer) return []
    const out: string[] = []
    for (let i = 0; i < buffer.length; i++)
      out.push(buffer.getLine(i)?.translateToString(true) ?? '')
    return out
  })
}

test('an image alone pastes as Ctrl+V while Claude Code runs; text pastes as text', async () => {
  await addWorkspace(false)
  await newCard('agent')
  await expect.poll(lines, { timeout: 15_000 }).toContain('claude-ready')

  await clipboardHolds('', true)
  await page.keyboard.press(PASTE)
  await expect.poll(lines).toContain('got:22')

  // Text (with or without an image) is pasted as text, never Ctrl+V.
  await clipboardHolds('hi', true)
  await page.keyboard.press(PASTE)
  await expect.poll(lines).toContain('got:105')
  expect((await lines()).filter((l) => l === 'got:22')).toHaveLength(1)

  // Once it exits, its shell gets nothing for an image.
  await page.keyboard.press('q')
  await expect.poll(lines).toContain('claude-done')
  await clipboardHolds('', true)
  await page.keyboard.type('cat -v')
  await page.keyboard.press('Enter')
  await page.keyboard.press(PASTE)
  await page.keyboard.type('after')
  await page.keyboard.press('Enter')
  await expect.poll(lines).toContain('after')
  expect((await lines()).some((l) => l.includes('^V'))).toBe(false)
})

test('a card that does not run Claude Code gets nothing for an image alone', async () => {
  await addWorkspace(true)
  await newCard('plain')
  await expect.poll(lines, { timeout: 15_000 }).toContainEqual(expect.stringMatching(/\S/))
  await page.keyboard.type('cat -v')
  await page.keyboard.press('Enter')
  await clipboardHolds('', true)
  await page.keyboard.press(PASTE)
  await page.keyboard.type('after')
  await page.keyboard.press('Enter')
  await expect.poll(lines).toContain('after')
  expect((await lines()).some((l) => l.includes('^V'))).toBe(false)
})
