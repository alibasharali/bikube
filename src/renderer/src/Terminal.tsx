import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

/** One live terminal: an xterm.js view bound to a PTY session in the main process. */
function Terminal(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current!
    const term = new XTerm({ fontFamily: 'Menlo, Consolas, monospace', fontSize: 13 })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()
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

    void api.spawn(term.cols, term.rows).then((id) => {
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
      term.dispose()
    }
  }, [])

  return <div className="terminal" data-testid="terminal" ref={hostRef} />
}

export default Terminal
