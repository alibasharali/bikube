import { useState } from 'react'
import Terminal from './Terminal'

function App(): React.JSX.Element {
  // Terminal ids only; each Terminal owns its PTY session and kills it on unmount.
  const [ids, setIds] = useState<number[]>([0])
  const [nextId, setNextId] = useState(1)

  const add = (): void => {
    setIds((prev) => [...prev, nextId])
    setNextId((n) => n + 1)
  }

  return (
    <main data-testid="app" className="app">
      <header className="toolbar" data-testid="toolbar">
        <button type="button" data-testid="new-terminal" onClick={add}>
          New terminal
        </button>
        <span data-testid="terminal-count">
          {ids.length} {ids.length === 1 ? 'terminal' : 'terminals'}
        </span>
      </header>
      <section className="terminals">
        {ids.map((id) => (
          <Terminal key={id} />
        ))}
      </section>
    </main>
  )
}

export default App
