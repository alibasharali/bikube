import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  // --no-sandbox: CI and containers have no setuid chrome-sandbox.
  app = await electron.launch({ args: ['.', '--no-sandbox'] })
  page = await app.firstWindow()
  await page.waitForSelector('[data-testid=terminal] .xterm')
})

test.afterAll(async () => {
  await app?.close()
})

/** Plain text of the active xterm buffer. */
function bufferText(): Promise<string> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid=terminal]') as HTMLElement & {
      __xterm: {
        buffer: {
          active: {
            length: number
            getLine(i: number): { translateToString(trim: boolean): string } | undefined
          }
        }
      }
    }
    const buf = host.__xterm.buffer.active
    const lines: string[] = []
    for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? '')
    return lines.join('\n')
  })
}

function size(): Promise<{ cols: number; rows: number }> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid=terminal]') as HTMLElement & {
      __xterm: { cols: number; rows: number }
    }
    return { cols: host.__xterm.cols, rows: host.__xterm.rows }
  })
}

async function resizeContainer(width: number, height: number): Promise<void> {
  await page.evaluate(
    ([w, h]) => {
      const el = document.querySelector('[data-testid=terminal]') as HTMLElement
      el.style.setProperty('width', `${w}px`, 'important')
      el.style.setProperty('height', `${h}px`, 'important')
    },
    [width, height]
  )
}

test('AC3: opens a window with one terminal and the toolbar says "1 terminal"', async () => {
  expect(await page.title()).toBe('Drovr')
  await expect(page.getByTestId('toolbar')).toHaveText('1 terminal')
  await expect(page.locator('[data-testid=terminal]')).toHaveCount(1)
  // The shell is up once it has printed a prompt.
  await expect.poll(bufferText, { timeout: 15_000 }).toMatch(/\S/)
})

test('AC4: typing echo hello shows hello in the output', async () => {
  await page.locator('[data-testid=terminal] .xterm-helper-textarea').focus()
  await page.keyboard.type('echo hello')
  await page.keyboard.press('Enter')
  // The command line itself also contains "hello"; the output is a line that is exactly "hello".
  await expect.poll(async () => (await bufferText()).split('\n').includes('hello')).toBe(true)
})

test('AC5: resizing the container resizes xterm and the PTY', async () => {
  await resizeContainer(800, 400)
  await expect.poll(async () => (await size()).cols).toBeGreaterThan(0)
  await page.waitForTimeout(300)
  const big = await size()

  await resizeContainer(400, 200)
  await expect
    .poll(async () => {
      const s = await size()
      return s.cols < big.cols && s.rows < big.rows
    })
    .toBe(true)
  const small = await size()

  await page.locator('[data-testid=terminal] .xterm-helper-textarea').focus()
  await page.keyboard.type('stty size')
  await page.keyboard.press('Enter')
  await expect
    .poll(async () => (await bufferText()).split('\n').includes(`${small.rows} ${small.cols}`))
    .toBe(true)
})

type Cell = { fg: number; bg: number; palette: boolean; rgb: boolean; mode: string }

/** Writes data to the xterm directly, resolving once it has been parsed. */
function printToTerm(data: string): Promise<void> {
  return page.evaluate(
    (d) =>
      new Promise<void>((resolve) => {
        const host = document.querySelector('[data-testid=terminal]') as HTMLElement & {
          __xterm: { write(data: string, cb: () => void): void }
        }
        host.__xterm.write(d, resolve)
      }),
    data
  )
}

/** Foreground attributes of the first `count` cells of the line that starts with `marker`. */
function fgCells(marker: string, count: number): Promise<Cell[]> {
  return page.evaluate(
    ([m, n]) => {
      const host = document.querySelector('[data-testid=terminal]') as HTMLElement & {
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
        if (!line || !line.translateToString(true).startsWith(m as string)) continue
        const cells: Cell[] = []
        // Skip the marker cell itself; the coloured cells follow it.
        for (let x = 1; x <= (n as number); x++) {
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
    [marker, count] as const
  )
}

test('AC6: 16 ANSI, 256-colour and truecolor sequences give matching cell colours', async () => {
  await resizeContainer(800, 400)
  await page.waitForTimeout(300)
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

async function selectLineContaining(text: string): Promise<void> {
  await page.evaluate((t) => {
    const host = document.querySelector('[data-testid=terminal]') as HTMLElement & {
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
  }, text)
}

const mod = process.platform === 'darwin' ? 'Meta' : 'Control+Shift'

test('AC7: copy puts the selection on the clipboard; paste with a newline reaches the shell', async () => {
  await printToTerm('\r\ncopy-me  spaced\r\n')
  await selectLineContaining('copy-me  spaced')
  await page.locator('[data-testid=terminal] .xterm-helper-textarea').focus()
  await app.evaluate(({ clipboard }) => clipboard.writeText('stale'))
  await page.keyboard.press(`${mod}+C`)
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe('copy-me  spaced')

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
