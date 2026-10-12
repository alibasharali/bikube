import Terminal from './Terminal'

// S3 shows a single terminal; the grid and "New terminal" button come later.
const terminalCount = 1

function App(): React.JSX.Element {
  return (
    <main data-testid="app" className="app">
      <header className="toolbar" data-testid="toolbar">
        {terminalCount} {terminalCount === 1 ? 'terminal' : 'terminals'}
      </header>
      <section className="terminals">
        <Terminal />
      </section>
    </main>
  )
}

export default App
