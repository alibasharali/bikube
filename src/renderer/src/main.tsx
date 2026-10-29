import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { followAppFont } from './app-font'
import { applyLaunchAppTheme, followAppTheme } from './app-theme'
import { startAttention } from './attention'
import { startAutoMoves } from './auto-move'
import { startTemporaryShells } from './temporary-shells'
import { startInstalledAgents } from './installed-agents'
import { startInstalledEditors } from './installed-editors'
import { listenForBoardRequests } from './board-requests'
import { loadGhosttyConfig } from './ghostty'
import { loadHomeDir } from './home'
import { loadSettingsStore, settingsStore } from './settings'
import { loadSymbolsFont } from './symbols-font'
import { loadWorkspaceStore } from './store'
import { listenForSyncBoards, loadSyncStatus, receiveSyncBoards } from './sync'

// The App theme before anything else, so the first paint already shows it (#64 D7).
applyLaunchAppTheme()

// Boards from the sync folder are received from the start, so one sent while loading isn't lost.
receiveSyncBoards()

// The saved board, the settings and the sync status are loaded before the first render, so the
// app opens on them (#8 D5, D10; #10 D6; #13 D13).
// The Ghostty colours (when used) and the symbols font are ready before any terminal draws, since
// xterm caches the glyphs it draws first.
void Promise.all([
  loadWorkspaceStore(),
  loadSettingsStore().then(() => loadGhosttyConfig(settingsStore.get())),
  loadSyncStatus(),
  loadSymbolsFont(),
  loadHomeDir()
]).then(() => {
  followAppTheme()
  followAppFont()
  listenForBoardRequests()
  listenForSyncBoards()
  startAttention()
  startInstalledAgents()
  startInstalledEditors()
  startAutoMoves()
  startTemporaryShells()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
})
