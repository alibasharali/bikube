import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expectCardOpen } from './card-view'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Colours, copy and paste in a card's terminal (#19: #1 AC6 and AC7 ported to the board).
// Linux runs drive Ctrl+Shift+C/V; Cmd+C/V on macOS is checked by hand.

let app: ElectronApplication
let page: Page
let root: string

const TERMINAL = '[data-testid=card-view] [data-testid=terminal]'

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'drovr-terminal-'))
  ;({ app, page } = await launchApp())
  await openNewCard()
})

test.afterEach(async () => {
  await app?.close()
  removeDataDirs()
  rmSync(root, { recursive: true, force: true })
})

/** Creates a workspace on `root` and a card in it; the card's full-size view opens on it. */
async function openNewCard(): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(root)
  await page.getByTestId('workspace-name').fill('alpha')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)

  await page
    .getByTestId('column')
    .filter({ has: page.getByRole('heading', { name: 'Backlog', exact: true }) })
    .getByTestId('new-card')
    .click()
  await page.getByTestId('new-card-input').fill('term')
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, 'term')
  await expect.poll(terminalFocused).toBe(true)
  // The shell is up once it has printed a prompt.
  await expect.poll(bufferText, { timeout: 15_000 }).toMatch(/\S/)
}

const terminalFocused = (): Promise<boolean> =>
  page.evaluate((sel) => document.activeElement?.closest(sel) != null, TERMINAL)

/** Plain text of the open card's active xterm buffer. */
function bufferText(): Promise<string> {
  return page.evaluate((sel) => {
    const host = document.querySelector(sel) as
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
    const buf = host?.__xterm?.buffer.active
    if (!buf) return ''
    const lines: string[] = []
    for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? '')
    return lines.join('\n')
  }, TERMINAL)
}

type Cell = { fg: number; bg: number; palette: boolean; rgb: boolean; mode: string }

/** Writes data to the open card's xterm directly, resolving once it has been parsed. */
function printToTerm(data: string): Promise<void> {
  return page.evaluate(
    ([sel, d]) =>
      new Promise<void>((resolve) => {
        const host = document.querySelector(sel) as HTMLElement & {
          __xterm: { write(data: string, cb: () => void): void }
        }
        host.__xterm.write(d, resolve)
      }),
    [TERMINAL, data] as const
  )
}

/** Foreground attributes of the first `count` cells of the line that starts with `marker`. */
function fgCells(marker: string, count: number): Promise<Cell[]> {
  return page.evaluate(
    ([sel, m, n]) => {
      const host = document.querySelector(sel) as HTMLElement & {
        __xterm: {
          buffer: {
            active: {
              length: number
              getLine(i: number):
                | {
                    translateToString(trim: boolean): string
                    getCell(x: number):
                      | {
                          getFgColor(): number
                          getBgColor(): number
                          isFgPalette(): boolean
                          isFgRGB(): boolean
                          isBgPalette(): boolean
                          isBgRGB(): boolean
                        }
                      | undefined
                  }
                | undefined
            }
          }
        }
      }
      const buf = host.__xterm.buffer.active
      for (let y = 0; y < buf.length; y++) {
        const line = buf.getLine(y)
        if (!line || !line.translateToString(true).startsWith(m)) continue
        const cells: Cell[] = []
        // Skip the marker cell itself; the coloured cells follow it.
        for (let x = 1; x <= n; x++) {
          const c = line.getCell(x)!
          cells.push({
            fg: c.getFgColor(),
            bg: c.getBgColor(),
            palette: c.isFgPalette(),
            rgb: c.isFgRGB(),
            mode: c.isBgPalette() ? 'bg-palette' : c.isBgRGB() ? 'bg-rgb' : 'bg-default'
          })
        }
        return cells
      }
      return []
    },
    [TERMINAL, marker, count] as const
  )
}

async function selectLineContaining(text: string): Promise<void> {
  await page.evaluate(
    ([sel, t]) => {
      const host = document.querySelector(sel) as HTMLElement & {
        __xterm: {
          buffer: {
            active: {
              length: number
              getLine(i: number): { translateToString(trim: boolean): string } | undefined
            }
          }
          select(col: number, row: number, length: number): void
        }
      }
      const buf = host.__xterm.buffer.active
      for (let y = 0; y < buf.length; y++) {
        const line = buf.getLine(y)?.translateToString(true) ?? ''
        if (line.includes(t)) {
          host.__xterm.select(line.indexOf(t), y, t.length)
          return
        }
      }
      throw new Error(`no line contains ${t}`)
    },
    [TERMINAL, text] as const
  )
}

const mod = process.platform === 'darwin' ? 'Meta' : 'Control+Shift'

test('AC1: 16 ANSI, 256-colour and truecolor sequences give matching cell colours', async () => {
  const esc = '\x1b'
  // Each line: a marker, then one coloured cell per colour, then reset.
  const ansi16 =
    'A' +
    Array.from({ length: 16 }, (_, i) => `${esc}[${i < 8 ? 30 + i : 90 + i - 8}mX`).join('') +
    `${esc}[0m`
  const palette256 = `B${esc}[38;5;196mX${esc}[38;5;21mX${esc}[38;5;244mX${esc}[48;5;82mY${esc}[0m`
  const truecolor = `C${esc}[38;2;18;52;86mX${esc}[38;2;255;0;128mX${esc}[48;2;1;2;3mY${esc}[0m`
  await printToTerm(`\r\n${ansi16}\r\n${palette256}\r\n${truecolor}\r\n`)

  const a = await fgCells('A', 16)
  expect(a.map((c) => c.fg)).toEqual(Array.from({ length: 16 }, (_, i) => i))
  expect(a.every((c) => c.palette && !c.rgb)).toBe(true)

  const b = await fgCells('B', 4)
  expect(b.slice(0, 3).map((c) => c.fg)).toEqual([196, 21, 244])
  expect(b.slice(0, 3).every((c) => c.palette)).toBe(true)
  expect(b[3]).toMatchObject({ bg: 82, mode: 'bg-palette' })

  const c = await fgCells('C', 3)
  expect(c[0]).toMatchObject({ fg: 0x123456, rgb: true, palette: false })
  expect(c[1]).toMatchObject({ fg: 0xff0080, rgb: true })
  expect(c[2]).toMatchObject({ bg: 0x010203, mode: 'bg-rgb' })

  await page.screenshot({ path: 'test-results/colours.png' })
})

test('AC2: copy puts the selection on the clipboard', async () => {
  await printToTerm('\r\ncopy-me  spaced\r\n')
  await selectLineContaining('copy-me  spaced')
  await page.locator(`${TERMINAL} .xterm-helper-textarea`).focus()
  await app.evaluate(({ clipboard }) => clipboard.writeText('stale'))
  await page.keyboard.press(`${mod}+C`)
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe('copy-me  spaced')
})

test('AC3: paste with a newline reaches the shell', async () => {
  await page.locator(`${TERMINAL} .xterm-helper-textarea`).focus()
  await app.evaluate(({ clipboard }) => clipboard.writeText('echo pasteA\necho pasteB'))
  await page.keyboard.press(`${mod}+V`)
  // With bracketed paste the shell holds the lines until Enter; without it they have already run.
  await page.keyboard.press('Enter')
  await expect
    .poll(async () => {
      const lines = (await bufferText()).split('\n')
      return lines.includes('pasteA') && lines.includes('pasteB')
    })
    .toBe(true)
})

test('AC4: Shift+Enter reaches the shell as ESC CR, so Claude Code takes it as a new line', async () => {
  await page.locator(`${TERMINAL} .xterm-helper-textarea`).focus()
  await page.keyboard.type('echo od-ready; od -c')
  await page.keyboard.press('Enter')
  // Only once od reads the tty: typed earlier, the shell's line editor would take the keys.
  await expect.poll(async () => (await bufferText()).split('\n')).toContain('od-ready')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.press('Control+D')
  // The tty turns the CR into a newline; plain Enter would give `\n` alone.
  await expect.poll(bufferText).toMatch(/033\s+\\n/)
})

/** Replaces `shell.openExternal` in main with a recorder, so no browser opens. */
async function recordOpenedLinks(): Promise<() => Promise<string[]>> {
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { openedLinks?: string[] }).openedLinks = opened
    shell.openExternal = async (url: string) => {
      opened.push(url)
    }
  })
  return () =>
    app.evaluate(() => [...((globalThis as { openedLinks?: string[] }).openedLinks ?? [])])
}

/** The middle of `text` on the open card's screen, in page coordinates. */
function screenPoint(text: string): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([sel, t]) => {
      const host = document.querySelector(sel) as HTMLElement & {
        __xterm: {
          cols: number
          rows: number
          buffer: {
            active: {
              viewportY: number
              length: number
              getLine(i: number): { translateToString(trim: boolean): string } | undefined
            }
          }
        }
      }
      const term = host.__xterm
      const buf = term.buffer.active
      const box = host.querySelector('.xterm-screen')!.getBoundingClientRect()
      for (let y = buf.viewportY; y < buf.viewportY + term.rows; y++) {
        const line = buf.getLine(y)?.translateToString(true) ?? ''
        const col = line.indexOf(t)
        if (col < 0) continue
        const cellW = box.width / term.cols
        const cellH = box.height / term.rows
        return {
          x: box.left + (col + t.length / 2) * cellW,
          y: box.top + (y - buf.viewportY + 0.5) * cellH
        }
      }
      throw new Error(`${t} is not on screen`)
    },
    [TERMINAL, text] as const
  )
}

const linkModifier = process.platform === 'darwin' ? 'Meta' : 'Control'

/** Hovers `text` (the link providers act on hover), then clicks it, with the link modifier or not. */
async function clickText(text: string, withModifier: boolean): Promise<void> {
  const { x, y } = await screenPoint(text)
  await page.mouse.move(x - 5, y)
  await page.mouse.move(x, y)
  if (withModifier) await page.keyboard.down(linkModifier)
  await page.mouse.click(x, y)
  if (withModifier) await page.keyboard.up(linkModifier)
}

test('AC5: a URL in the output opens in the browser on Mod+click, not on a plain click', async () => {
  const opened = await recordOpenedLinks()
  await printToTerm('\r\nLocal:   http://localhost:5173/app\r\n')
  await clickText('localhost:5173', false)
  await page.waitForTimeout(300)
  expect(await opened()).toEqual([])
  await expect
    .poll(async () => {
      await clickText('localhost:5173', true)
      return opened()
    })
    .toContain('http://localhost:5173/app')
})

test('AC6: an OSC 8 link opens its target on Mod+click', async () => {
  const opened = await recordOpenedLinks()
  await printToTerm('\r\nsee \x1b]8;;https://example.com/docs\x07the docs\x1b]8;;\x07 here\r\n')
  await expect
    .poll(async () => {
      await clickText('the docs', true)
      return opened()
    })
    .toContain('https://example.com/docs')
})
