import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { backToBoard, closeCard, expectCardOpen, splitRight } from './card-view'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Inline images (#52): sixel and iTerm2 images printed in any terminal (a card's main pane, an
// extra pane, the Default shell) are held at the cell where they were printed, also while the
// card's view isn't open; kept output (#46) stays text only.

let app: ElectronApplication
let page: Page
let root: string

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'drovr-images-'))
  const dir = join(root, 'alpha')
  mkdirSync(dir)
  ;({ app, page } = await launchApp())
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill('alpha')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
})

test.afterEach(async () => {
  await app?.close()
  removeDataDirs()
  rmSync(root, { recursive: true, force: true })
})

/**
 * A 20×20 px red sixel image, as printf format text: `\033` and `\\` escapes only, so the typed
 * line holds no raw ESC (dash's printf has no `\e`). Three full sixel rows and one of 2 px.
 */
const SIXEL = String.raw`\033Pq"1;1;20;20#0;2;100;0;0#0!20~-!20~-!20~-!20B\033\\`

/** CRC-32 of `bytes`, for the PNG's chunks. */
function crc32(bytes: Buffer): number {
  let crc = ~0
  for (const byte of bytes) {
    crc ^= byte
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return ~crc >>> 0
}

/** A 4×4 px opaque red PNG. */
function redPng(): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(4, 0)
  header.writeUInt32BE(4, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // RGB
  const row = Buffer.from([0, ...Array.from({ length: 4 }, () => [255, 0, 0]).flat()])
  const pixels = deflateSync(Buffer.concat([row, row, row, row]))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const PNG = redPng()
/** iTerm2's inline image (OSC 1337 `File=`, BEL-terminated), as printf format text. */
const IIP = String.raw`\033]1337;File=inline=1;size=${PNG.length}:${PNG.toString('base64')}\007`

function card(title: string): Locator {
  return page
    .getByTestId('card')
    .filter({ has: page.getByTestId('card-title').getByText(title, { exact: true }) })
}

async function newCard(title: string): Promise<void> {
  const column = page
    .getByTestId('column')
    .filter({ has: page.getByRole('heading', { name: 'In Progress', exact: true }) })
  await column.getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
}

async function openCard(title: string): Promise<void> {
  await card(title).getByTestId('card-open').click()
  await expectCardOpen(page, title)
}

const focusedPane = (): Promise<number> =>
  page.evaluate(() => {
    const pane = document.activeElement?.closest('[data-testid=card-view] [data-testid=pane]')
    return pane
      ? [...document.querySelectorAll('[data-testid=card-view] [data-testid=pane]')].indexOf(pane)
      : -1
  })

/** Types `command` into pane `index` (focused) and presses Enter. */
async function run(command: string, index = 0): Promise<void> {
  await expect.poll(focusedPane).toBe(index)
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

/** What pane `index` of the open view holds: each buffer row's text, and its image cells. */
type Screen = {
  /** Each buffer row's trimmed text (rows, not joined lines: an image sits on rows). */
  rows: string[]
  /** For each buffer row, the columns holding an image. */
  imageCols: number[][]
  /** The image at the first image cell: its size and its top-left pixel's RGBA; null when none. */
  first: { width: number; height: number; pixel: number[] } | null
}

function screen(index = 0): Promise<Screen> {
  return page
    .getByTestId('card-view')
    .locator('[data-testid=terminal]')
    .nth(index)
    .evaluate((host) => {
      type Line = { translateToString(trim: boolean): string }
      const { __xterm: term, __images: images } = host as HTMLElement & {
        __xterm?: {
          cols: number
          buffer: { active: { length: number; getLine(i: number): Line | undefined } }
        }
        __images?: { getImageAtBufferCell(x: number, y: number): HTMLCanvasElement | undefined }
      }
      const result: Screen = { rows: [], imageCols: [], first: null }
      if (!term) return result
      const buffer = term.buffer.active
      for (let y = 0; y < buffer.length; y++) {
        result.rows.push(buffer.getLine(y)?.translateToString(true).trim() ?? '')
        const cols: number[] = []
        for (let x = 0; x < term.cols; x++) {
          const image = images?.getImageAtBufferCell(x, y)
          if (!image || !image.width || !image.height) continue
          cols.push(x)
          if (!result.first) {
            const pixel = image.getContext('2d')?.getImageData(0, 0, 1, 1).data
            result.first = {
              width: image.width,
              height: image.height,
              pixel: pixel ? [...pixel] : []
            }
          }
        }
        result.imageCols.push(cols)
      }
      return result
    })
}

/** The rows holding an image. */
const imageRows = (s: Screen): number[] =>
  s.imageCols.flatMap((cols, y) => (cols.length > 0 ? [y] : []))

/**
 * Pane `index` holds an image printed right after the row reading `before`: its first rows start
 * at column 0 of the next row, and the row reading `after` follows below the image's last row.
 */
async function expectImageBetween(
  before: string,
  after: string,
  size: { width: number; height: number },
  index = 0
): Promise<void> {
  await expect
    .poll(async () => {
      const s = await screen(index)
      return s.rows.includes(after) && imageRows(s).length > 0
    })
    .toBe(true)
  const s = await screen(index)
  const top = s.rows.lastIndexOf(before) + 1
  const rows = imageRows(s)
  expect(top).toBeGreaterThan(0)
  expect(rows[0]).toBe(top)
  expect(s.imageCols[top][0]).toBe(0)
  // Contiguous rows, then the text printed after on the row below the last.
  expect(rows).toEqual(Array.from({ length: rows.length }, (_, i) => top + i))
  expect(s.rows.lastIndexOf(after)).toBe(rows[rows.length - 1] + 1)
  expect(s.first).toEqual({ ...size, pixel: [255, 0, 0, 255] })
}

test('AC2: a sixel image printed in a card is held where it was printed, the text below it', async () => {
  await newCard('api')
  await run(`printf 'sixel-before\\n${SIXEL}\\nsixel-after\\n'`)
  await expectImageBetween('sixel-before', 'sixel-after', { width: 20, height: 20 })
})

test('AC3: an iTerm2 inline image printed in a card is held where it was printed', async () => {
  await newCard('api')
  await run(`printf 'iip-before\\n${IIP}\\niip-after\\n'`)
  await expectImageBetween('iip-before', 'iip-after', { width: 4, height: 4 })
})

test('AC4: an image printed while the board shows is there when the card is opened', async () => {
  await newCard('api')
  await run(`sleep 2; printf 'away-before\\n${SIXEL}\\naway-after\\n'; sleep 30`)
  await backToBoard(page)
  // Printed while the view is not open: the card's status line reads its last text.
  await expect(card('api').getByTestId('card-status-line')).toHaveText('away-after', {
    timeout: 15_000
  })
  await openCard('api')
  await expectImageBetween('away-before', 'away-after', { width: 20, height: 20 })
})

test('AC5: an extra pane and the Default shell hold the images they print', async () => {
  await newCard('api')
  await splitRight(page)
  await expect(page.getByTestId('card-view').getByTestId('pane')).toHaveCount(2)
  await run(`printf 'pane-before\\n${SIXEL}\\npane-after\\n'`, 1)
  await expectImageBetween('pane-before', 'pane-after', { width: 20, height: 20 }, 1)
  // The main pane printed none.
  expect(imageRows(await screen(0))).toEqual([])
  await backToBoard(page)

  const defaultShell = page.locator('[data-testid="shell"][data-shell-name="Default"]')
  await defaultShell.getByTestId('shell-open').click()
  await expectCardOpen(page, 'Default')
  await run(`printf 'shell-before\\n${SIXEL}\\nshell-after\\n'`)
  await expectImageBetween('shell-before', 'shell-after', { width: 20, height: 20 })
})

test('AC8: kept output shows the text printed after an image, and no image', async () => {
  await newCard('api')
  await run(`printf 'kept-before\\n${SIXEL}\\nkept-after\\n'`)
  await expectImageBetween('kept-before', 'kept-after', { width: 20, height: 20 })
  await closeCard(page)
  await page.getByTestId('confirm-close').click()
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Stopped')

  await openCard('api')
  const separator = (s: Screen): number =>
    s.rows.findLastIndex((r) => r.startsWith('── Previous output ·'))
  await expect.poll(async () => separator(await screen())).toBeGreaterThan(0)
  const s = await screen()
  const above = s.rows.slice(0, separator(s))
  expect(above).toContain('kept-before')
  expect(above).toContain('kept-after')
  expect(imageRows(s)).toEqual([])
})
