/**
 * The command palette's input for the view the app shows (#40 D5, D6), read live by the palette
 * and at once by the Orchestrator's `board palette` (#81 D23), so both list the same rows.
 */
import { knownRunState, knownStatus, type CardRunState } from '../../core/card-status'
import { hasOrchestrator } from '../../core/orchestrator'
import {
  paletteItems,
  type OpenView,
  type PaletteInput,
  type PaletteItems,
  type RowStatus
} from '../../core/palette'
import type { Settings } from '../../core/settings'
import { MAIN_PANE, paneIds, type PaneLayout } from '../../core/split-tree'
import type { WorkspaceState } from '../../core/workspace-store'
import { waitingQueue } from './attention'
import { cardPanes, cardTerminals, type XtermScreen } from './card-terminals'
import { currentKeymap, settingsStore } from './settings'
import { workspaceStore } from './store'

/** The card or shell open at full size, as App knows it. */
export interface OpenTerminal {
  kind: OpenView['kind']
  workspaceId: string
  cardId: string
}

/** A card's or shell's live status as a palette row shows it (#40 D3). */
export function rowStatus(cardId: string): RowStatus {
  const { label, activity } = knownStatus(cardTerminals().status(cardId))
  return activity ? { label, activity } : { label }
}

/** A pane's screen, as CardView reads it: the card's own terminal for the main pane. */
function paneScreen(cardId: string, paneId: string): XtermScreen | undefined {
  return paneId === MAIN_PANE ? cardTerminals().screen(cardId) : cardPanes().screen(cardId, paneId)
}

/** The open view as the palette's rows read it, from its live run state and panes. */
function openView(
  open: OpenTerminal | null,
  runState: CardRunState,
  layout: PaneLayout
): OpenView | null {
  if (!open) return null
  return {
    ...open,
    running: runState.kind === 'running',
    paneCount: paneIds(layout.tree).length,
    extraPaneFocused: layout.focused !== MAIN_PANE,
    focusedPaneHasScreen: paneScreen(open.cardId, layout.focused) !== undefined,
    zoomed: layout.zoomed === true
  }
}

/** What the palette's rows are built from, read live by the palette and at once by `board`. */
interface PaletteSources {
  state: WorkspaceState
  open: OpenTerminal | null
  agentSetup: boolean
  runState: CardRunState
  layout: PaneLayout
  settings: Pick<Settings, 'theme' | 'appTheme' | 'defaultView' | 'sidebarLayout'>
  waiting: readonly string[]
}

/** The palette's input for the user's current view (#40 D5, D6). */
export function paletteInput({
  state,
  open,
  agentSetup,
  runState,
  layout,
  settings,
  waiting
}: PaletteSources): PaletteInput {
  const active = state.workspaces.find((w) => w.id === state.activeId)
  const activeOrchestrator = active && hasOrchestrator(active) ? active : undefined
  return {
    state,
    status: rowStatus,
    view: openView(open, runState, layout),
    agentSetup,
    theme: settings.theme,
    appTheme: settings.appTheme,
    defaultView: settings.defaultView,
    sidebarLayout: settings.sidebarLayout,
    keymap: currentKeymap(),
    platform: window.bikube?.platform ?? '',
    waiting,
    // The active workspace's Orchestrator, none for an SSH one (#81 D5, D10).
    ...(activeOrchestrator && {
      orchestrator: { conversation: activeOrchestrator.orchestrator !== undefined }
    })
  }
}

/**
 * The palette's rows as it would show them now with an empty query, for the view App shows
 * (`board palette`, #81 D23).
 */
export function currentPaletteItems(open: OpenTerminal | null, agentSetup: boolean): PaletteItems {
  const id = open?.cardId ?? ''
  return paletteItems(
    paletteInput({
      state: workspaceStore.getState(),
      open,
      agentSetup,
      runState: knownRunState(cardTerminals().runState(id)),
      layout: cardPanes().layout(id),
      settings: settingsStore.get(),
      waiting: waitingQueue()
    })
  )
}
