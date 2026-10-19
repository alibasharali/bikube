import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, boardCard, expectCardOpen } from './card-view'
import { fakeSshHome, removeRemoteForwards, type FakeSshHome } from './fake-ssh'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Dev server chips (#49 S1): a local card's main pane printing a localhost URL shows a
// `localhost:<port>` chip on its board card while something listens there. The servers are Node
// HTTP servers in this test process on free ports; `shell.openExternal` is stubbed. The URLs are
// printed with `printf` and the port as an argument, so the typed command line itself holds none.

let app: ElectronApplication | undefined
let page: Page
let root: string
let fake: FakeSshHome | undefined
const servers: Server[] = []

/** How long a chip may take to follow a server (D4: probed every 3 s while focused). */
const CHIP_MS = 4000

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'drovr-dev-servers-'))
  fake = undefined
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  await Promise.all(servers.splice(0).map(stop))
  removeDataDirs()
  if (fake) removeRemoteForwards(fake.sshLog)
  rmSync(root, { recursive: true, force: true })
})

/** Starts an HTTP server on `127.0.0.1`, on `port` or a free one, and returns its port. */
async function listen(port = 0): Promise<number> {
  const server = createServer((_, res) => res.end('ok'))
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  const address = server.address()
  return typeof address === 'object' && address ? address.port : 0
}

function stop(server: Server): Promise<void> {
  server.closeAllConnections()
  return new Promise((resolve) => server.close(() => resolve()))
}

/** Stops the server listening on `port`. */
async function stopListening(port: number): Promise<void> {
  const i = servers.findIndex((s) => {
    const address = s.address()
    return typeof address === 'object' && address?.port === port
  })
  await stop(servers.splice(i, 1)[0])
}

/** A port nothing listens on (one the OS just handed out and took back). */
async function freePort(): Promise<number> {
  const port = await listen()
  await stopListening(port)
  return port
}

async function launch(env?: Record<string, string>): Promise<void> {
  ;({ app, page } = await launchApp(env ? { env } : {}))
}

async function createWorkspace(ssh = false): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  if (ssh) {
    const remote = join(root, 'remote')
    mkdirSync(remote)
    await page.getByTestId('workspace-location-ssh').check()
    await page.getByTestId('workspace-host').fill('me@devbox')
    await page.getByTestId('workspace-directory').fill(remote)
  } else {
    await page.getByTestId('workspace-directory').fill(root)
  }
  await page.getByTestId('workspace-name').fill('alpha')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

/** Creates card `title` in Backlog; its view opens on it. */
async function newCard(title: string): Promise<void> {
  await page
    .getByTestId('column')
    .filter({ has: page.getByRole('heading', { name: 'Backlog', exact: true }) })
    .getByTestId('new-card')
    .click()
  await page.getByTestId('new-card-input').fill(title)
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
}

/** The open card's terminal buffer, one trimmed string per line, wrapped lines joined. */
function bufferLines(): Promise<string[]> {
  return page.evaluate(() => {
    type Line = { isWrapped: boolean; translateToString(trim: boolean): string }
    const host = document.querySelector('[data-testid=card-view] [data-testid=terminal]') as
      | (HTMLElement & {
          __xterm?: { buffer: { active: { length: number; getLine(i: number): Line | undefined } } }
        })
      | null
    const buffer = host?.__xterm?.buffer.active
    if (!buffer) return []
    const rows: string[] = []
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i)
      const next = buffer.getLine(i + 1)
      const text = line?.translateToString(!next?.isWrapped) ?? ''
      if (line?.isWrapped && rows.length > 0) rows[rows.length - 1] += text
      else rows.push(text)
    }
    return rows.map((r) => r.trim())
  })
}

const terminalFocused = (): Promise<boolean> =>
  page.evaluate(
    () => document.activeElement?.closest('[data-testid=card-view] [data-testid=terminal]') != null
  )

/**
 * Types `command` into the open card's shell until it answers (a shell still starting, or an SSH
 * card before its session, may drop the first keys), then runs it.
 */
async function runWhenReady(command: string): Promise<void> {
  await expect.poll(terminalFocused).toBe(true)
  await expect(async () => {
    await page.keyboard.type('echo ready:$((40+2))')
    await page.keyboard.press('Enter')
    await expect.poll(bufferLines, { timeout: 2000 }).toContain('ready:42')
  }).toPass({ timeout: 20_000 })
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

/** Prints Vite's `Local:` line for `port`, its port in bold, as AC1 gives it. */
const viteLine = (port: number): string =>
  `printf '  Local:   http://localhost:\\033[1m%s\\033[22m/\\n' ${port}`

/** Replaces `shell.openExternal` in main with a recorder, so no browser opens. */
async function recordOpenedLinks(): Promise<() => Promise<string[]>> {
  await app!.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { openedLinks?: string[] }).openedLinks = opened
    shell.openExternal = async (url: string) => {
      opened.push(url)
    }
  })
  return () =>
    app!.evaluate(() => [...((globalThis as { openedLinks?: string[] }).openedLinks ?? [])])
}

const chips = (title: string): Locator => boardCard(page, title).getByTestId('dev-server-chip')

test('AC1: a printed, listening localhost port shows a chip that opens it, not the card', async () => {
  const port = await listen()
  await launch()
  const opened = await recordOpenedLinks()
  await createWorkspace()
  await newCard('web')
  await runWhenReady(viteLine(port))
  await expect.poll(bufferLines).toContain(`Local:   http://localhost:${port}/`)
  await backToBoard(page)

  await expect(chips('web')).toHaveCount(1, { timeout: CHIP_MS })
  await expect(chips('web')).toHaveText(`localhost:${port}`)
  await expect(chips('web')).toHaveAttribute('title', `Open http://localhost:${port}/`)
  await chips('web').click()
  await expect.poll(opened).toEqual([`http://localhost:${port}/`])
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
})

test('AC2: a port nothing listens on shows no chip until a server listens there', async () => {
  const port = await freePort()
  await launch()
  await createWorkspace()
  await newCard('web')
  await runWhenReady(`printf 'http://localhost:%s/\\n' ${port}`)
  await backToBoard(page)
  await page.waitForTimeout(CHIP_MS)
  await expect(chips('web')).toHaveCount(0)

  await listen(port)
  await expect(chips('web')).toHaveText([`localhost:${port}`], { timeout: CHIP_MS })
})

test('AC3: the chip goes when its server stops and comes back when it listens again', async () => {
  const port = await listen()
  await launch()
  await createWorkspace()
  await newCard('web')
  await runWhenReady(viteLine(port))
  await backToBoard(page)
  await expect(chips('web')).toHaveText([`localhost:${port}`], { timeout: CHIP_MS })

  await stopListening(port)
  await expect(chips('web')).toHaveCount(0, { timeout: CHIP_MS })
  await expect(boardCard(page, 'web').getByTestId('card-status-label')).toHaveText('Running')

  await listen(port)
  await expect(chips('web')).toHaveText([`localhost:${port}`], { timeout: CHIP_MS })
})

test('AC4: a pane whose shell exits forgets its ports, even when its output is shown again', async () => {
  const port = await listen()
  await launch()
  await createWorkspace()
  await newCard('web')
  await runWhenReady(viteLine(port))
  await backToBoard(page)
  await expect(chips('web')).toHaveText([`localhost:${port}`], { timeout: CHIP_MS })

  await boardCard(page, 'web').getByTestId('card-open').click()
  await expectCardOpen(page, 'web')
  await expect.poll(terminalFocused).toBe(true)
  await page.keyboard.type('exit')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(boardCard(page, 'web').getByTestId('card-status-label')).toHaveText('Stopped')
  await expect(chips('web')).toHaveCount(0)

  // Opened again: the kept output above the new start still shows the URL, but is never read.
  await boardCard(page, 'web').getByTestId('card-open').click()
  await expectCardOpen(page, 'web')
  await expect
    .poll(bufferLines)
    .toEqual(expect.arrayContaining([`Local:   http://localhost:${port}/`]))
  await backToBoard(page)
  await page.waitForTimeout(CHIP_MS)
  await expect(chips('web')).toHaveCount(0)

  await boardCard(page, 'web').getByTestId('card-open').click()
  await expectCardOpen(page, 'web')
  await runWhenReady(viteLine(port))
  await backToBoard(page)
  await expect(chips('web')).toHaveText([`localhost:${port}`], { timeout: CHIP_MS })
})

test('AC7: an SSH card printing a listening local port shows no chip', async () => {
  const port = await listen()
  fake = fakeSshHome(root)
  await launch(fake.env)
  await createWorkspace(true)
  await newCard('remote')
  await runWhenReady(viteLine(port))
  await expect.poll(bufferLines).toContain(`Local:   http://localhost:${port}/`)
  await backToBoard(page)
  await page.waitForTimeout(CHIP_MS)
  await expect(boardCard(page, 'remote').getByTestId('card-status-label')).toHaveText('Running')
  await expect(boardCard(page, 'remote').getByTestId('dev-servers')).toHaveCount(0)
})

test('AC8: five listening ports show the first three in print order and +2', async () => {
  const ports = [await listen(), await listen(), await listen(), await listen(), await listen()]
  await launch()
  await createWorkspace()
  await newCard('web')
  await runWhenReady(`for p in ${ports.join(' ')}; do printf 'http://127.0.0.1:%s/\\n' $p; done`)
  await backToBoard(page)

  await expect(chips('web')).toHaveText(
    ports.slice(0, 3).map((p) => `localhost:${p}`),
    { timeout: CHIP_MS }
  )
  const more = boardCard(page, 'web').getByTestId('dev-server-more')
  await expect(more).toHaveText('+2')
  await expect(more).toHaveAttribute(
    'title',
    ports
      .slice(3)
      .map((p) => `http://127.0.0.1:${p}/`)
      .join('\n')
  )
})
