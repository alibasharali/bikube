/**
 * The side panel's width (#55 D4): kept between 200 px and half the window's width. A saved
 * width larger than half the window shows at half and stays saved until the user drags.
 */
import { MAX_SIDE_PANEL_WIDTH, MIN_SIDE_PANEL_WIDTH } from './settings'

/** How far one Left or Right arrow on the panel's edge moves it. */
export const PANEL_KEY_STEP = 16

/** The width in effect for `width` in a window `windowWidth` px wide. */
export function shownPanelWidth(width: number, windowWidth: number): number {
  const half = Math.min(MAX_SIDE_PANEL_WIDTH, Math.floor(windowWidth / 2))
  return Math.max(MIN_SIDE_PANEL_WIDTH, Math.min(Math.round(width), half))
}

/**
 * The width after dragging the left edge `leftBy` px to the left (negative: to the right) from a
 * panel `startWidth` px wide.
 */
export function draggedPanelWidth(startWidth: number, leftBy: number, windowWidth: number): number {
  return shownPanelWidth(startWidth + leftBy, windowWidth)
}

/** A tab's element id and the body's, which the tabs and the panel's tabpanel name each other by. */
export const panelTabId = (tab: string): string => `side-panel-tab-${tab}`
export const PANEL_BODY_ID = 'side-panel-body'
