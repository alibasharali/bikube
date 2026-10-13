import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { loadWorkspaceStore } from './store'

// The saved board is loaded before the first render, so the app opens on it (#8 D5, D10).
void loadWorkspaceStore().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
})
