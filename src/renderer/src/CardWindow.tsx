import { PanelLeftOpen } from 'lucide-react'
import { useEffect } from 'react'
import { keymapAction, resolveKeymap, workspaceShortcut } from '../../core/keymap'
import { cardWindowTitle } from '../../core/window-title'
import { DEFAULT_SHELL_TITLE, findShellCard } from '../../core/workspace-shells'
import { defaultShellId } from '../../core/workspace-store'
import { isCardViewAction } from './card-view-actions'
import CardView from './CardView'
import { SMALL_ICON } from './icons'
import ShortcutKeys from './ShortcutKeys'
import { currentKeymap, settingsStore, useSettings } from './settings'
import { useWorkspaceState } from './store'
import { dialogOpenIn, ViewWindowContext } from './view-window'

/** The native window title follows its page's. */
function setTitle(view: Window, title: string): void {
  view.document.title = title
}

/**
 * What a card's own window shows (#53 D4): only its card view, as at full size in the main window,
 * titled `<title> · <workspace>` as either is renamed. `onBack` closes the window: Back, or the
 * card's shell stopping (D8). Open in new window's shortcut, or the bar's Move to main window
 * button, moves the card back to the main window, opened there. The card view's actions and
 * Toggle panel work there; the app's own
 * shortcuts (Settings, the palette, Next waiting card, the Default shell, Mod+1…9) do nothing and,
 * as everywhere, never reach the shell (D5).
 */
function CardWindow({
  view,
  workspaceId,
  cardId,
  onBack,
  onReturn
}: {
  view: Window
  workspaceId: string
  cardId: string
  onBack: () => void
  /** Moves the card back to the main window, opened there. */
  onReturn: () => void
}): React.JSX.Element | null {
  const { workspaces } = useWorkspaceState()
  // Its shortcut on the button, as Settings has it now.
  const { shortcuts } = useSettings()
  const keymap = resolveKeymap(shortcuts, window.drovr.platform)
  const workspace = workspaces.find((w) => w.id === workspaceId)
  const card =
    workspace && (workspace.cards.find((c) => c.id === cardId) ?? findShellCard(workspace, cardId))
  // The Default shell is named as the palette names it (#53 AC9).
  const shown = cardId === defaultShellId(workspaceId) ? { title: DEFAULT_SHELL_TITLE } : card
  const title = workspace && shown ? cardWindowTitle(workspace, shown) : null

  useEffect(() => {
    if (title !== null) setTitle(view, title)
  }, [view, title])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const action = keymapAction(event, currentKeymap())
      // The card view's own actions are its listener's.
      if (isCardViewAction(action)) return
      if (action === null) {
        // Mod+1…9, as in the main window, is left alone while a dialog owns this window's keyboard.
        if (workspaceShortcut(event, window.drovr.platform) === null || dialogOpenIn(view)) return
        event.preventDefault()
        event.stopPropagation()
        return
      }
      // The side panel shows or hides everywhere at once (D5, #55 D3), unless a dialog in this
      // window owns its keyboard.
      if (action === 'togglePanel') {
        if (event.type !== 'keydown' || dialogOpenIn(view)) return
        event.preventDefault()
        event.stopPropagation()
        if (!event.repeat) {
          settingsStore.update({ sidePanelOpen: !settingsStore.get().sidePanelOpen })
        }
        return
      }
      event.preventDefault()
      event.stopPropagation()
    }
    const types = ['keydown', 'keypress', 'keyup'] as const
    for (const type of types) view.addEventListener(type, onKey, true)
    return () => {
      for (const type of types) view.removeEventListener(type, onKey, true)
    }
  }, [view])

  // A card or workspace deleted: the window closes (`card-windows.ts` watches the store).
  if (!card) return null
  return (
    <ViewWindowContext.Provider value={view}>
      <div className="app card-window" data-testid="card-window">
        {/* As in the main window: held to the window's height, so only the panes and the side
            panel's tree scroll, never the window (#53 D4). */}
        {/* Back to the main window by mouse; Open in new window's shortcut does the same here. */}
        <div className="card-window-bar">
          <button
            type="button"
            className="card-window-return"
            data-testid="card-window-return"
            onClick={onReturn}
          >
            <PanelLeftOpen {...SMALL_ICON} />
            <span>Move to main window</span>
            <ShortcutKeys shortcut={keymap.openInWindow} platform={window.drovr.platform} />
          </button>
        </div>
        <div className="app-body">
          <main className="main">
            <CardView key={card.id} card={card} onBack={onBack} onOpenInWindow={onReturn} />
          </main>
        </div>
      </div>
    </ViewWindowContext.Provider>
  )
}

export default CardWindow
