import { useEffect } from 'react'
import { keymapAction, workspaceShortcut } from '../../core/keymap'
import { cardWindowTitle } from '../../core/window-title'
import { findShellCard } from '../../core/workspace-shells'
import { isCardViewAction } from './card-view-actions'
import CardView from './CardView'
import { currentKeymap, settingsStore } from './settings'
import { useWorkspaceState } from './store'
import { dialogOpenIn, ViewWindowContext } from './view-window'

/** The native window title follows its page's. */
function setTitle(view: Window, title: string): void {
  view.document.title = title
}

/**
 * What a card's own window shows (#53 D4): only its card view, as at full size in the main window,
 * titled `<title> · <workspace>` as either is renamed. `onBack` closes the window: Back, or the
 * card's shell stopping (D8). The card view's actions and Toggle panel work there; the app's own
 * shortcuts (Settings, the palette, Next waiting card, the Default shell, Mod+1…9) do nothing and,
 * as everywhere, never reach the shell (D5).
 */
function CardWindow({
  view,
  workspaceId,
  cardId,
  onBack
}: {
  view: Window
  workspaceId: string
  cardId: string
  onBack: () => void
}): React.JSX.Element | null {
  const { workspaces } = useWorkspaceState()
  const workspace = workspaces.find((w) => w.id === workspaceId)
  const card =
    workspace && (workspace.cards.find((c) => c.id === cardId) ?? findShellCard(workspace, cardId))
  const title = workspace && card ? cardWindowTitle(workspace, card) : null

  useEffect(() => {
    if (title !== null) setTitle(view, title)
  }, [view, title])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const action = keymapAction(event, currentKeymap())
      // The card view's own actions are its listener's.
      if (isCardViewAction(action)) return
      if (action === null && workspaceShortcut(event, window.drovr.platform) === null) return
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
        <main className="main">
          <CardView key={card.id} card={card} onBack={onBack} />
        </main>
      </div>
    </ViewWindowContext.Provider>
  )
}

export default CardWindow
