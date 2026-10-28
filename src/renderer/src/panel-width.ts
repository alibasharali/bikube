import { useEffect, useState, useSyncExternalStore } from 'react'
import { shownPanelWidth } from '../../core/side-panel'
import { useSettings } from './settings'

/**
 * The side panel's width while its edge is dragged, shared with the title bar's panel section so
 * both follow each move; null when no drag runs (the saved width applies).
 */
let dragWidth: number | null = null
const listeners = new Set<() => void>()

export function setPanelDragWidth(width: number | null): void {
  if (width === dragWidth) return
  dragWidth = width
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
  const dragging = useSyncExternalStore(subscribe, () => dragWidth)
  return dragging ?? shownPanelWidth(sidePanelWidth, windowWidth)
}
