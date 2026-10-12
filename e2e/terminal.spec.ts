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
