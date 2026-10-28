import { useEffect, useState, useSyncExternalStore } from 'react'
import { shownPanelWidth } from '../../core/side-panel'
import { useSettings } from './settings'

/**
 * The side panel's width while its edge is dragged, and the window it is dragged in, shared with
 * that window's title bar section so both follow each move; null when no drag runs (the saved
 * width applies). Other windows keep the saved width until the drag ends and saves.
 */
let drag: { view: Window; width: number } | null = null
const listeners = new Set<() => void>()

export function setPanelDragWidth(view: Window, width: number | null): void {
  if (width === null ? drag === null : drag?.view === view && drag.width === width) return
  drag = width === null ? null : { view, width }
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** `view`'s inner width, followed as it resizes. */
export function useWindowWidth(view: Window): number {
  const [width, setWidth] = useState(() => view.innerWidth)
  useEffect(() => {
    const onResize = (): void => setWidth(view.innerWidth)
    view.addEventListener('resize', onResize)
    return () => view.removeEventListener('resize', onResize)
  }, [view])
  return width
}

/** The panel's shown width in `view`: a drag's, else the saved one kept within the window's limits. */
export function usePanelWidth(view: Window): number {
  const { sidePanelWidth } = useSettings()
  const windowWidth = useWindowWidth(view)
  const dragging = useSyncExternalStore(subscribe, () => (drag?.view === view ? drag.width : null))
  return dragging ?? shownPanelWidth(sidePanelWidth, windowWidth)
}
