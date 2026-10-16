import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { startAttention } from './attention'
import { listenForBoardRequests } from './board-requests'
import { loadGhosttyTheme } from './ghostty'
import { loadHomeDir } from './home'
import { loadSettingsStore } from './settings'
import { loadSymbolsFont } from './symbols-font'
import { loadWorkspaceStore } from './store'
import { listenForSyncBoards, loadSyncStatus, receiveSyncBoards } from './sync'

// Boards from the sync folder are received from the start, so one sent while loading isn't lost.
receiveSyncBoards()

// The saved board, the settings and the sync status are loaded before the first render, so the
// app opens on them (#8 D5, D10; #10 D6; #13 D13).
// The Ghostty colours (when used) and the symbols font are ready before any terminal draws, since
// xterm caches the glyphs it draws first.
void Promise.all([
  loadWorkspaceStore(),
  loadSettingsStore().then(loadGhosttyTheme),
  loadSyncStatus(),
  loadSymbolsFont(),
  loadHomeDir()
]).then(() => {
  listenForBoardRequests()
  listenForSyncBoards()
  startAttention()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
})
