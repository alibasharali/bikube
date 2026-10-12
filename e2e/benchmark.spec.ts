import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'

// D8 benchmark: 10 terminals, each running a continuous-output command.
// Not part of the default smoke run (see playwright.config.ts); run with `npm run benchmark`
// (on Linux: `xvfb-run -a npm run benchmark`).

const TERMINALS = 10
const MEASURE_MS = 8_000
const ECHO_SAMPLES = 20
// sustained: bursts of 200 lines every 50 ms per terminal (about 4000 lines/s each).
// firehose: unthrottled `yes`, a worst case with no flow control (BENCH_PROFILE=firehose).
const PROFILE = process.env.BENCH_PROFILE === 'firehose' ? 'firehose' : 'sustained'
const flood = (i: number): string =>
  PROFILE === 'firehose'
    ? `yes drovr-bench-${i} | cat -n`
    : `while :; do yes drovr-bench-${i} | head -n 200; sleep 0.05; done`
const BUDGET = { fps: 30, echoMs: 100, mainLagMs: 100 }

type DrovrWindow = Window & { drovr: import('../src/shared/api').DrovrApi }
type XtermHost = HTMLElement & { __xterm: { input(data: string, wasUserInput?: boolean): void } }

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

test('AC8: 10 terminals stream output and the D8 budget holds', async () => {
  const app = await electron.launch({
    args: [
      '.',
      '--no-sandbox',
      ...(process.env.BENCH_ELECTRON_ARGS?.split(' ').filter(Boolean) ?? [])
    ]
  })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('[data-testid=terminal] .xterm')

    for (let i = 1; i < TERMINALS; i++) await page.getByTestId('new-terminal').click()
    await expect(page.getByTestId('terminal-count')).toHaveText(`${TERMINALS} terminals`)
    await expect(page.locator('[data-testid=terminal] .xterm')).toHaveCount(TERMINALS)

    // Wait for every shell to print a prompt, then start the flood in each.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            [...document.querySelectorAll('[data-testid=terminal]')].every((h) => {
              const buf = (
                h as HTMLElement & {
                  __xterm: {
                    buffer: {
                      active: {
                        getLine(i: number): { translateToString(t: boolean): string } | undefined
                      }
                    }
                  }
                }
              ).__xterm.buffer.active
              return (buf.getLine(0)?.translateToString(true) ?? '').trim().length > 0
            })
          ),
        { timeout: 30_000 }
      )
      .toBe(true)

    // Baseline: rAF rate with 10 idle shells, to calibrate the environment.
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

    // Per-session byte counters (renderer side) and the flood commands.
    await page.evaluate(
      (cmds) => {
        const w = window as unknown as { __bytes: Record<string, number> }
        w.__bytes = {}
        ;(window as unknown as DrovrWindow).drovr.terminal.onData((id, data) => {
          w.__bytes[id] = (w.__bytes[id] ?? 0) + data.length
        })
        const hosts = [...document.querySelectorAll('[data-testid=terminal]')] as XtermHost[]
        hosts.forEach((h, i) => h.__xterm.input(cmds[i] + '\r', true))
      },
      Array.from({ length: TERMINALS }, (_, i) => flood(i))
    )

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
    })

    // Renderer fps (requestAnimationFrame) and input echo latency, over the same window.
    const renderer = await page.evaluate(
      async ([durationMs, samples]) => {
        const w = window as unknown as { __bytes: Record<string, number> }
        const bytesBefore = { ...w.__bytes }
        const host = document.querySelector('[data-testid=terminal]') as XtermHost
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
        const canvases = [
          ...document.querySelectorAll('[data-testid=terminal] .xterm-screen canvas')
        ]
        return {
          elapsed,
          frames: frames.length,
          maxFrameGap: Math.max(...intervals),
          arrival,
          rendered,
          bytes,
          terminalsWithCanvas: new Set(canvases.map((c) => c.closest('[data-testid=terminal]')))
            .size
        }
      },
      [MEASURE_MS, ECHO_SAMPLES] as const
    )

    const lag = await app.evaluate(() => {
      const g = globalThis as unknown as { __lag: number[]; __lagTimer: NodeJS.Timeout }
      clearInterval(g.__lagTimer)
      return g.__lag
    })

    // Every session must still be live: each terminal's buffer holds its own marker.
    const live = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid=terminal]')].map((h, i) => {
        const buf = (
          h as unknown as {
            __xterm: {
              buffer: {
                active: {
                  length: number
                  getLine(i: number): { translateToString(t: boolean): string } | undefined
                }
              }
            }
          }
        ).__xterm.buffer.active
        for (let y = buf.length - 1; y >= 0; y--) {
          if ((buf.getLine(y)?.translateToString(true) ?? '').includes(`drovr-bench-${i}`))
            return true
        }
        return false
      })
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
    const echoMax = rendered[rendered.length - 1]
    const md = [
      '# Drovr D8 benchmark',
      '',
      `${TERMINALS} terminals, each running \`${flood(0).replace('-0', '-N')}\` (profile: ${PROFILE}), measured over ${(renderer.elapsed / 1000).toFixed(1)} s after a 2 s warm-up.`,
      '',
      `Environment: ${os.type()} ${os.release()} ${os.arch()}, ${os.cpus().length} x ${os.cpus()[0]?.model ?? 'cpu'}, Electron ${process.versions.electron ?? '(see package.json)'}, ${process.env.DISPLAY ? 'X display ' + process.env.DISPLAY : 'no DISPLAY'}.`,
      '',
      '> Caveat: these numbers come from this environment (on Linux under xvfb with software rendering) and are NOT macOS numbers. Re-run on the beta (`npm run benchmark`) before treating the budget as met on a Mac.',
      '',
      '| Metric | Value | Budget | Result |',
      '|---|---|---|---|',
      `| Renderer fps (rAF) | ${fmt(fps)} | >= ${BUDGET.fps} | ${verdict(fps >= BUDGET.fps)} |`,
      `| Renderer fps, 10 idle shells (baseline) | ${fmt(idleFps)} | n/a | info |`,
      `| Longest frame gap | ${fmt(renderer.maxFrameGap)} ms | n/a | info |`,
      `| Input echo to buffer, p50 | ${fmt(percentile(rendered, 50))} ms | n/a | info |`,
      `| Input echo to buffer, p95 | ${fmt(percentile(rendered, 95))} ms | n/a | info |`,
      `| Input echo to buffer, max (${ECHO_SAMPLES} samples) | ${fmt(echoMax)} ms | <= ${BUDGET.echoMs} ms | ${verdict(echoMax <= BUDGET.echoMs)} |`,
      `| Input echo arrival at renderer, p50 / max | ${fmt(percentile(arrival, 50))} / ${fmt(arrival[arrival.length - 1])} ms | n/a | info |`,
      `| Dropped echoes (never appeared) | ${droppedEchoes} | 0 | ${verdict(droppedEchoes === 0)} |`,
      `| Main event-loop lag, p99 | ${fmt(lagP99)} ms | <= ${BUDGET.mainLagMs} ms | ${verdict(lagP99 <= BUDGET.mainLagMs)} |`,
      `| Main event-loop lag, max (${lag.length} ticks) | ${fmt(lagMax)} ms | n/a | info |`,
      `| Sessions producing output | ${renderer.bytes.filter((b) => b > 0).length} / ${TERMINALS} | ${TERMINALS} / ${TERMINALS} | ${verdict(renderer.bytes.length === TERMINALS && renderer.bytes.every((b) => b > 0))} |`,
      `| Terminals whose buffer holds their own output | ${live.filter(Boolean).length} / ${TERMINALS} | ${TERMINALS} / ${TERMINALS} | ${verdict(live.every(Boolean))} |`,
      `| Output per session (KiB, min / max) | ${fmt(Math.min(...kb))} / ${fmt(Math.max(...kb))} | n/a | info |`,
      `| Terminals with a canvas (WebGL active) | ${renderer.terminalsWithCanvas} / ${TERMINALS} | n/a | info |`,
      ''
    ].join('\n')

    mkdirSync('test-results', { recursive: true })
    writeFileSync(`test-results/benchmark-${PROFILE}.md`, md)
    console.log('\n' + md)

    expect(renderer.bytes.length).toBe(TERMINALS)
    expect(renderer.bytes.every((b) => b > 0)).toBe(true)
    expect(live.every(Boolean)).toBe(true)
    expect(fps).toBeGreaterThanOrEqual(BUDGET.fps)
    expect(droppedEchoes).toBe(0)
    expect(echoMax).toBeLessThanOrEqual(BUDGET.echoMs)
    expect(lagP99).toBeLessThanOrEqual(BUDGET.mainLagMs)
  } finally {
    await app.close()
  }
})
