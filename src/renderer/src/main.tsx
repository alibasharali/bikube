import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { listenForBoardRequests } from './board-requests'
import { loadSettingsStore } from './settings'
import { loadWorkspaceStore } from './store'
import { listenForSyncBoards, loadSyncStatus, receiveSyncBoards } from './sync'

// Boards from the sync folder are received from the start, so one sent while loading isn't lost.
receiveSyncBoards()

// The saved board, the settings and the sync status are loaded before the first render, so the
// app opens on them (#8 D5, D10; #10 D6; #13 D13).
void Promise.all([loadWorkspaceStore(), loadSettingsStore(), loadSyncStatus()]).then(() => {
  listenForBoardRequests()
  listenForSyncBoards()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
})
