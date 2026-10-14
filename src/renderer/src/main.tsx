import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { listenForBoardRequests } from './board-requests'
import { loadSettingsStore } from './settings'
import { loadWorkspaceStore } from './store'

// The saved board and the settings are loaded before the first render, so the app opens on
// them (#8 D5, D10; #10 D6).
void Promise.all([loadWorkspaceStore(), loadSettingsStore()]).then(() => {
  listenForBoardRequests()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
})
