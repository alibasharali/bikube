import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { listenForBoardRequests } from './board-requests'
import { loadWorkspaceStore } from './store'

// The saved board is loaded before the first render, so the app opens on it (#8 D5, D10).
void loadWorkspaceStore().then(() => {
  listenForBoardRequests()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
})
