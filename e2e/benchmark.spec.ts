import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { HIGH_WATERMARK } from '../src/core/flow-control'
import { backToBoard, expectCardOpen } from './card-view'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// D8 benchmark, on cards (#4 D17): 10 cards in one workspace, each running a continuous-output
// command, one open at full size. Not part of the default smoke run (see playwright.config.ts);
// run with `npm run benchmark` (on Linux: `xvfb-run -a npm run benchmark`).

const TERMINALS = 10
const MEASURE_MS = 8_000
const ECHO_SAMPLES = 20
// sustained: bursts of 200 lines every 50 ms per terminal (about 4000 lines/s each).
// firehose: unthrottled `yes`, a worst case kept bounded by flow control (#16) (BENCH_PROFILE=firehose).
const PROFILE = process.env.BENCH_PROFILE === 'firehose' ? 'firehose' : 'sustained'
const flood = (i: number): string =>
  PROFILE === 'firehose'
    ? `yes drovr-bench-${i} | cat -n`
    : `while :; do yes drovr-bench-${i} | head -n 200; sleep 0.05; done`
const BUDGET = { fps: 30, echoMs: 100, mainLagMs: 100 }
// #16 D7: sustained keeps the full D8 budget; firehose asserts no dropped echoes, live sessions
// and main lag, and reports fps and echo max as info.
const FULL_BUDGET = PROFILE === 'sustained'

type FlowPeak = { __drovrFlowPeak: { read(): number; reset(): void } }

type DrovrWindow = Window & { drovr: import('../src/shared/api').DrovrApi }
type XtermHost = HTMLElement & { __xterm: { input(data: string, wasUserInput?: boolean): void } }

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

/** The open card's terminal host, the one element with `__xterm` in the full-size view. */
const OPEN_TERMINAL = '[data-testid=card-view] [data-testid=terminal]'

/** True once the open card's shell has printed something (its prompt). */
function openShellReady(page: Page): Promise<boolean> {
  return page.evaluate((sel) => {
    const host = document.querySelector(sel) as
      | (HTMLElement & {
          __xterm?: {
            buffer: {
              active: {
                length: number
                getLine(i: number): { translateToString(t: boolean): string } | undefined
              }
            }
          }
        })
      | null
    const buf = host?.__xterm?.buffer.active
    if (!buf) return false
    for (let y = 0; y < buf.length; y++) {
      if ((buf.getLine(y)?.translateToString(true) ?? '').trim().length > 0) return true
    }
    return false
  }, OPEN_TERMINAL)
}

test('AC13: 10 cards in one workspace stream output and the D8 budget holds', async () => {
  const root = mkdtempSync(join(os.tmpdir(), 'drovr-bench-'))
  const { app, page } = await launchApp({
    args: process.env.BENCH_ELECTRON_ARGS?.split(' ').filter(Boolean) ?? [],
    // Exposes main's peak unacknowledged reading on `globalThis` (#16 D7).
    env: { ...(process.env as Record<string, string>), DROVR_BENCH: '1' }
  })
  try {
    // Per-session byte counters (renderer side), from before the first card exists.
    await page.evaluate(() => {
      const w = window as unknown as { __bytes: Record<string, number> }
      w.__bytes = {}
      ;(window as unknown as DrovrWindow).drovr.terminal.onData((id, data) => {
        w.__bytes[id] = (w.__bytes[id] ?? 0) + data.length
      })
    })

    // One workspace on a temp directory.
    await page.getByTestId('workspace-add').click()
    await plainCards(page)
    await page.getByTestId('workspace-directory').fill(root)
    await page.getByTestId('workspace-name').fill('bench')
    await page.getByTestId('workspace-submit').click()
    await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)

    const backlog = page
      .getByTestId('column')
      .filter({ has: page.getByRole('heading', { name: 'Backlog', exact: true }) })
    const title = (i: number): string => `bench ${i}`
    const card = (i: number): Locator =>
      page
        .getByTestId('card')
        .filter({ has: page.getByTestId('card-title').getByText(title(i), { exact: true }) })
    const back = async (): Promise<void> => {
      await backToBoard(page)
      await expect(page.getByTestId('board')).toBeVisible()
    }
    const open = async (i: number): Promise<void> => {
      await card(i).getByTestId('card-open').click()
      await expectCardOpen(page, title(i))
    }

    // Create the cards; each opens at full size on creation (D6). Wait for every shell's prompt.
    // The last card stays open: it is the one measured.
    for (let i = 0; i < TERMINALS; i++) {
      await backlog.getByTestId('new-card').click()
      await page.getByTestId('new-card-input').fill(title(i))
      await page.getByTestId('new-card-input').press('Enter')
      await expectCardOpen(page, title(i))
      await expect.poll(() => openShellReady(page), { timeout: 30_000 }).toBe(true)
      if (i < TERMINALS - 1) await back()
    }
    const OPEN = TERMINALS - 1

    // Baseline: rAF rate with 10 idle shells and one card open, to calibrate the environment.
    const idleFps = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let n = 0
          const t0 = performance.now()
          const tick = (t: number): void => {
            n++
            if (t - t0 < 2000) requestAnimationFrame(tick)
            else resolve(n / ((t - t0) / 1000))
          }
          requestAnimationFrame(tick)
        })
    )

    // Start the flood in every card: open it, type the command, go back. The measured card last.
    const startFlood = (cmd: string): Promise<void> =>
      page.evaluate(
        ([sel, c]) => (document.querySelector(sel) as XtermHost).__xterm.input(c + '\r', true),
        [OPEN_TERMINAL, cmd] as const
      )
    await back()
    for (let i = 0; i < TERMINALS; i++) {
      if (i === OPEN) continue
      await open(i)
      await startFlood(flood(i))
      await back()
    }
    await open(OPEN)
    await startFlood(flood(OPEN))

    // Let the flood reach steady state.
    await page.waitForTimeout(2_000)

    // Main-process event-loop lag: setInterval drift, sampled in the main process.
    await app.evaluate(() => {
      const g = globalThis as unknown as { __lag: number[]; __lagTimer: NodeJS.Timeout }
      g.__lag = []
      let last = performance.now()
      g.__lagTimer = setInterval(() => {
        const now = performance.now()
        g.__lag.push(Math.max(0, now - last - 10))
        last = now
      }, 10)
      // The peak backlog in main is measured over the same window (#16 D7).
      ;(globalThis as unknown as FlowPeak).__drovrFlowPeak.reset()
    })

    // Renderer fps (requestAnimationFrame) and input echo latency, over the same window.
    const renderer = await page.evaluate(
      async ([durationMs, samples, sel]) => {
        const w = window as unknown as { __bytes: Record<string, number> }
        const bytesBefore = { ...w.__bytes }
        const host = document.querySelector(sel) as XtermHost
        const term = (host as unknown as { __xterm: { write(d: string, cb: () => void): void } })
          .__xterm

        // Frame times
        const frames: number[] = []
        let running = true
        const tick = (t: number): void => {
          frames.push(t)
          if (running) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)

        // Echo: type 'Q' (never in the flood output) into terminal 0, time until the echo is
        // written into the xterm buffer. term.write callbacks fire in order, after earlier data.
        const arrival: number[] = []
        const rendered: number[] = []
        let t0 = 0
        let armed = false
        const off = (window as unknown as DrovrWindow).drovr.terminal.onData((_id, data) => {
          if (!armed || !data.includes('Q')) return
          armed = false
          arrival.push(performance.now() - t0)
          term.write('', () => rendered.push(performance.now() - t0))
        })
        const start = performance.now()
        const gap = durationMs / samples
        for (let i = 0; i < samples; i++) {
          const slot = start + (i + 1) * gap
          armed = true
          t0 = performance.now()
          const seen = rendered.length
          host.__xterm.input('Q', true)
          // Give a starved renderer up to 2 s per echo before calling it dropped.
          while (rendered.length === seen && performance.now() - t0 < 2000) {
            await new Promise((r) => setTimeout(r, 5))
          }
          if (rendered.length === seen) {
            arrival.push(Infinity)
            rendered.push(Infinity)
          }
          armed = false
          const wait = slot - performance.now()
          if (wait > 0) await new Promise((r) => setTimeout(r, wait))
        }
        const elapsed = performance.now() - start
        running = false
        off()

        const bytesAfter = { ...w.__bytes }
        const bytes = Object.keys(bytesAfter).map((id) => bytesAfter[id] - (bytesBefore[id] ?? 0))
        const intervals = frames.slice(1).map((t, i) => t - frames[i])
        return {
          elapsed,
          frames: frames.length,
          maxFrameGap: Math.max(...intervals),
          arrival,
          rendered,
          bytes,
          openCardCanvas: document.querySelector(`${sel} .xterm-screen canvas`) != null
        }
      },
      [MEASURE_MS, ECHO_SAMPLES, OPEN_TERMINAL] as const
    )

    const lag = await app.evaluate(() => {
      const g = globalThis as unknown as { __lag: number[]; __lagTimer: NodeJS.Timeout }
      clearInterval(g.__lagTimer)
      return g.__lag
    })
    const peakUnacked = await app.evaluate(() =>
      (globalThis as unknown as FlowPeak).__drovrFlowPeak.read()
    )

    // Every session must still be live: back on the board, each card's status line (read from
    // its own screen, attached or not) shows its own marker.
    await back()
    // Under firehose the status line mostly shows the cursor's partial line (`1234  drovr-be`),
    // so it is sampled often rather than on the default backing-off intervals.
    const live = await Promise.all(
      Array.from({ length: TERMINALS }, (_, i) =>
        expect
          .poll(async () => (await card(i).getByTestId('card-status-line').textContent()) ?? '', {
            timeout: 10_000,
            intervals: [100]
          })
          .toContain(`drovr-bench-${i}`)
          .then(
            () => true,
            () => false
          )
      )
    )

    const fps = renderer.frames / (renderer.elapsed / 1000)
    const rendered = [...renderer.rendered].sort((a, b) => a - b)
    const arrival = [...renderer.arrival].sort((a, b) => a - b)
    const lagSorted = [...lag].sort((a, b) => a - b)
    const kb = renderer.bytes.map((b) => b / 1024)
    const droppedEchoes = renderer.rendered.filter((v) => !Number.isFinite(v)).length
    const lagMax = Math.max(...lag)
    const lagP99 = percentile(lagSorted, 99)

    const fmt = (n: number): string => (Number.isFinite(n) ? n.toFixed(1) : 'n/a')
    const verdict = (ok: boolean): string => (ok ? 'PASS' : 'FAIL')
    // A metric only asserted for the sustained profile reads `info` under firehose (#16 D7).
    const fullVerdict = (ok: boolean): string => (FULL_BUDGET ? verdict(ok) : 'info')
    const echoMax = rendered[rendered.length - 1]
    const md = [
      '# Drovr D8 benchmark',
      '',
      `${TERMINALS} cards in one workspace, each running \`${flood(0).replace('-0', '-N')}\` (profile: ${PROFILE}), card ${OPEN} open at full size, measured over ${(renderer.elapsed / 1000).toFixed(1)} s after a 2 s warm-up.`,
      '',
      `Environment: ${os.type()} ${os.release()} ${os.arch()}, ${os.cpus().length} x ${os.cpus()[0]?.model ?? 'cpu'}, Electron ${process.versions.electron ?? '(see package.json)'}, ${process.env.DISPLAY ? 'X display ' + process.env.DISPLAY : 'no DISPLAY'}.`,
      '',
      '> Caveat: these numbers come from this environment (on Linux under xvfb with software rendering) and are NOT macOS numbers. Re-run on the beta (`npm run benchmark`) before treating the budget as met on a Mac.',
      '',
      '| Metric | Value | Budget | Result |',
      '|---|---|---|---|',
      `| Renderer fps (rAF) | ${fmt(fps)} | >= ${BUDGET.fps} | ${fullVerdict(fps >= BUDGET.fps)} |`,
      `| Renderer fps, 10 idle shells, one card open (baseline) | ${fmt(idleFps)} | n/a | info |`,
      `| Longest frame gap | ${fmt(renderer.maxFrameGap)} ms | n/a | info |`,
      `| Input echo to buffer, p50 | ${fmt(percentile(rendered, 50))} ms | n/a | info |`,
      `| Input echo to buffer, p95 | ${fmt(percentile(rendered, 95))} ms | n/a | info |`,
      `| Input echo to buffer, max (${ECHO_SAMPLES} samples) | ${fmt(echoMax)} ms | <= ${BUDGET.echoMs} ms | ${fullVerdict(echoMax <= BUDGET.echoMs)} |`,
      `| Input echo arrival at renderer, p50 / max | ${fmt(percentile(arrival, 50))} / ${fmt(arrival[arrival.length - 1])} ms | n/a | info |`,
      `| Dropped echoes (never appeared) | ${droppedEchoes} | 0 | ${verdict(droppedEchoes === 0)} |`,
      `| Main event-loop lag, p99 | ${fmt(lagP99)} ms | <= ${BUDGET.mainLagMs} ms | ${verdict(lagP99 <= BUDGET.mainLagMs)} |`,
      `| Main event-loop lag, max (${lag.length} ticks) | ${fmt(lagMax)} ms | n/a | info |`,
      `| Sessions producing output | ${renderer.bytes.filter((b) => b > 0).length} / ${TERMINALS} | ${TERMINALS} / ${TERMINALS} | ${verdict(renderer.bytes.length === TERMINALS && renderer.bytes.every((b) => b > 0))} |`,
      `| Cards whose status line shows their own output | ${live.filter(Boolean).length} / ${TERMINALS} | ${TERMINALS} / ${TERMINALS} | ${verdict(live.every(Boolean))} |`,
      `| Most characters unacknowledged in main, any session | ${peakUnacked} (high watermark ${HIGH_WATERMARK}) | n/a | info |`,
      `| Output per session (KiB, min / max) | ${fmt(Math.min(...kb))} / ${fmt(Math.max(...kb))} | n/a | info |`,
      `| Open card renders with WebGL (canvas) | ${renderer.openCardCanvas ? 'yes' : 'no (DOM renderer)'} | n/a | info |`,
      ''
    ].join('\n')

    mkdirSync('test-results', { recursive: true })
    writeFileSync(`test-results/benchmark-${PROFILE}.md`, md)
    console.log('\n' + md)

    expect(renderer.bytes.length).toBe(TERMINALS)
    expect(renderer.bytes.every((b) => b > 0)).toBe(true)
    expect(live.every(Boolean)).toBe(true)
    expect(droppedEchoes).toBe(0)
    if (FULL_BUDGET) {
      expect(fps).toBeGreaterThanOrEqual(BUDGET.fps)
      expect(echoMax).toBeLessThanOrEqual(BUDGET.echoMs)
    }
    expect(lagP99).toBeLessThanOrEqual(BUDGET.mainLagMs)
  } finally {
    await app.close()
    removeDataDirs()
  }
})
