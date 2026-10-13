import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { clipboardShortcut, copySelection, pasteFromClipboard } from '../../core/clipboard'
import { isSoftwareRenderer } from '../../core/webgl-support'
import '@xterm/xterm/css/xterm.css'

/** WebGL is worth using only when a real GPU backs it; software GL loses to the DOM renderer. */
function hardwareWebgl(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (!gl) return false
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return !isSoftwareRenderer(renderer)
  } catch {
    return false
  }
}

/** One live terminal: an xterm.js view bound to a PTY session in the main process, started in `cwd`. */
function Terminal({ cwd }: { cwd: string }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current!
    const term = new XTerm({ fontFamily: 'Menlo, Consolas, monospace', fontSize: 13 })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()

    // WebGL where a real GPU backs it; xterm's DOM renderer stays in place otherwise (D8).
    let webgl: WebglAddon | undefined
    try {
      if (!hardwareWebgl()) throw new Error('no hardware WebGL')
      webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl?.dispose()
        webgl = undefined
      })
      term.loadAddon(webgl)
    } catch {
      webgl?.dispose()
      webgl = undefined
    }

    // Copy and paste go through the main process clipboard; paste uses term.paste for bracketed paste.
    const clipboard = window.drovr.clipboard
    term.attachCustomKeyEventHandler((event) => {
      const action = clipboardShortcut(event, window.drovr.platform)
      if (!action) return true
      // Stop the native paste event too, or xterm would paste twice.
      event.preventDefault()
      if (action === 'copy') void copySelection(term, clipboard)
      else void pasteFromClipboard(term, clipboard)
      return false
    })

    // Handle for the smoke tests, which read the buffer and size.
    ;(host as HTMLDivElement & { __xterm?: XTerm }).__xterm = term

    const api = window.drovr.terminal
    let sessionId: string | undefined
    let disposed = false

    const offData = api.onData((id, data) => {
      if (id === sessionId) term.write(data)
    })
    const offExit = api.onExit(({ id, exitCode }) => {
      if (id === sessionId) term.write(`\r\n[process exited with code ${exitCode}]\r\n`)
    })
    const input = term.onData((data) => {
      if (sessionId) api.write(sessionId, data)
    })
    const resized = term.onResize(({ cols, rows }) => {
      if (sessionId) api.resize(sessionId, cols, rows)
    })

    void api.spawn(term.cols, term.rows, cwd).then((result) => {
      if (!result.ok) {
        if (!disposed) term.write(`Couldn't start: ${result.reason}\r\n`)
        return
      }
      const { id } = result
      if (disposed) {
        api.kill(id)
        return
      }
      sessionId = id
      // The container may have been resized while the shell was starting.
      api.resize(id, term.cols, term.rows)
    })

    const observer = new ResizeObserver(() => fit.fit())
    observer.observe(host)

    return () => {
      disposed = true
      observer.disconnect()
      input.dispose()
      resized.dispose()
      offData()
      offExit()
      if (sessionId) api.kill(sessionId)
      webgl?.dispose()
      term.dispose()
    }
  }, [cwd])

  return <div className="terminal" data-testid="terminal" ref={hostRef} />
}

export default Terminal
