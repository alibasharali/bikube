import { useCallback, useSyncExternalStore } from 'react'
import {
  Terminal as XTerm,
  type IBuffer,
  type IBufferRange,
  type IDisposable,
  type IMarker,
  type ITheme
} from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { ImageAddon } from '@xterm/addon-image'
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { runningCount } from '../../core/card-deletes'
import { keymapAction, workspaceShortcut } from '../../core/keymap'
import { CardPanes } from '../../core/card-panes'
import { CardSessions, type CardScreen, type OutputKeeper } from '../../core/card-sessions'
import { keptRange } from '../../core/kept-output'
import { SessionRouter } from '../../core/session-router'
import { MAIN_PANE, type PaneLayout } from '../../core/split-tree'
import {
  knownRunState,
  knownStatus,
  type CardRunState,
  type CardStatus
} from '../../core/card-status'
import { clipboardShortcut, copySelection, pasteFromClipboard } from '../../core/clipboard'
import { FIND_HIGHLIGHT_LIMIT, isValidRegex, type FindResults } from '../../core/find'
import { terminalAppearance, type TerminalAppearance } from '../../core/terminal-appearance'
import {
  CLAUDE_CODE_PROBE_OSC,
  isShiftEnter,
  SHIFT_ENTER,
  shiftEnterIsNewLine
} from '../../core/terminal-keys'
import { opensLink } from '../../core/terminal-links'
import { promptJumpTarget, type PromptJump } from '../../core/prompt-jumps'
import {
  chooseCommandOutput,
  endedOutputs,
  rangeLength,
  textRange,
  type OutputRange
} from '../../core/command-output'
import {
  parseShellMark,
  SHELL_MARK_OSCS,
  ShellMarks,
  splitDirectory,
  type ShellCommand
} from '../../core/shell-marks'
import { isSoftwareRenderer } from '../../core/webgl-support'
import { ringBell } from './bell'
import { devServers } from './dev-servers'
import { ghosttyStore } from './ghostty'
import { currentKeymap, settingsStore } from './settings'
import { workspaceStore } from './store'
import '@xterm/xterm/css/xterm.css'

let webglWorthIt: boolean | undefined

/** WebGL is worth using only when a real GPU backs it; software GL loses to the DOM renderer. */
function hardwareWebgl(): boolean {
  if (webglWorthIt !== undefined) return webglWorthIt
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (!gl) return (webglWorthIt = false)
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return (webglWorthIt = !isSoftwareRenderer(renderer))
  } catch {
    return (webglWorthIt = false)
  }
}

/** Every screen not yet disposed, so a settings or OS appearance change reaches them all. */
const liveScreens = new Set<XtermScreen>()
let darkQuery: MediaQueryList | undefined
let following = false

/** The OS appearance as the page sees it: main's native theme, which follows the OS under System. */
function osPrefersDark(): boolean {
  darkQuery ??= window.matchMedia('(prefers-color-scheme: dark)')
  return darkQuery.matches
}

/** The terminal look for the current settings and OS appearance (#10 D3, D4). */
function currentAppearance(): TerminalAppearance {
  return terminalAppearance(settingsStore.get(), osPrefersDark(), ghosttyStore.palettes())
}

/**
 * Applies the current look to every screen whenever the settings or the OS appearance change,
 * running or not (D3); set up once, with the first screen.
 */
function followAppearance(): void {
  if (following) return
  following = true
  const apply = (): void => {
    const appearance = currentAppearance()
    for (const screen of liveScreens) screen.applyAppearance(appearance)
  }
  settingsStore.subscribe(apply)
  ghosttyStore.subscribe(apply)
  osPrefersDark()
  darkQuery?.addEventListener('change', apply)
}

/** What the find bar searches for (#35 D4): the query and its two toggles. */
export interface FindQuery {
  query: string
  caseSensitive: boolean
  regex: boolean
}

const AMBER = '#D19A00'

/**
 * Every match outlined in amber, the active one filled with it too, both in the overview ruler
 * (#35 D8). The addon wants #RRGGBB.
 */
const FIND_DECORATIONS: NonNullable<ISearchOptions['decorations']> = {
  matchBorder: AMBER,
  matchOverviewRuler: AMBER,
  activeMatchBackground: AMBER,
  activeMatchBorder: AMBER,
  activeMatchColorOverviewRuler: AMBER
}

/** A failed command's red (#45 D6), in the overview ruler; the bar and badge use `--danger`. */
const FAILED_RED = '#E5484D'

/**
 * The xterm theme for a palette: the overview ruler (#35 D8, #45 D6) draws no outline of its own,
 * so the scrollbar's side looks as it did without it.
 */
const xtermTheme = (theme: TerminalAppearance['theme']): ITheme => ({
  ...theme,
  overviewRulerBorder: '#00000000'
})

/** A row of a terminal, as its marks keep it: undefined where xterm gives no marker (alt screen). */
export type MarkLine = IMarker | undefined

const samePosition = (a: IBufferRange, b: IBufferRange): boolean =>
  a.start.x === b.start.x && a.start.y === b.start.y && a.end.x === b.end.x && a.end.y === b.end.y

/** The element the smoke tests read the buffer and its inline images (#52) from. */
export type TerminalHost = HTMLDivElement & { __xterm?: XTerm; __images?: ImageAddon }

/**
 * Inline images' limits (#52 D4): 32 MB of image data per terminal, oldest dropped; the pixel
 * and sixel limits are the addon's defaults, and size reports stay on so programs can size images.
 */
const IMAGE_OPTIONS = { storageLimit: 32, enableSizeReports: true }

/**
 * A card's xterm.js screen for one start (#5 D6, D7), discarded when the card is Stopped. It
 * parses output while no view shows it; the full-size view attaches its element and fits it. Only an attached screen gets
 * a WebGL context, since Chromium caps them at about 16.
 */
export class XtermScreen implements CardScreen {
  readonly term: XTerm
  private palette: TerminalAppearance['theme']
  private readonly host: TerminalHost = document.createElement('div')
  private readonly fit = new FitAddon()
  private readonly serializer = new SerializeAddon()
  // One more than the bar counts, so it can tell "more than 1,000" from exactly 1,000 (#35 D7).
  private readonly search = new SearchAddon({ highlightLimit: FIND_HIGHLIGHT_LIMIT + 1 })
  /** A find is applied (#35): from its first search until it is cleared. */
  private finding = false
  /** The current selection is one Find made (the active match), not the user's. */
  private findSelected = false
  /** A mouse button is down on the screen: a selection made now is the user's. */
  private pointerSelecting = false
  /** The toggles of the applied find, so a change searches afresh. */
  private findOptions = ''
  /** Where the match Find last selected is, so stepping goes on from it (#35 D6). */
  private activeMatch: IBufferRange | undefined
  /** Copy command output is selecting (#60 D2): the selection is the user's, copied once. */
  private selectingOutput = false
  /** The query of the applied find: a query extending it keeps the active match (D5). */
  private findQuery = ''
  private disposed = false
  private readonly endPointerSelection = (): void => {
    if (this.pointerSelecting) setTimeout(() => (this.pointerSelecting = false), 0)
  }
  private opened = false
  private webgl: WebglAddon | undefined
  /** The line height and letter spacing the screen was last fitted with: either changes its cells. */
  private cell = ''
  /** Claude Code's probe arrived since focus reporting was last turned off (#58 D1). */
  private sawProbe = false
  /**
   * The shell integration marks of this start (#45 D1, D2): its commands, prompts and last
   * directory, gone with the screen. Rows are xterm markers, forgotten as they leave the scrollback.
   */
  readonly marks = new ShellMarks<MarkLine>()
  /** A previous run's output is being written (#46 D5): its marks are not this run's (#45 D7). */
  private restoring = false
  /** The new session's first row, below a restored previous run (#46 D5a); none when none. */
  private sessionStart: IMarker | undefined
  /** What watches the cursor while `sessionStart` is set. */
  private sessionListeners: IDisposable[] = []

  /** `claudeCode`: the main pane of a card whose startup command is Claude Code. */
  constructor(private readonly claudeCode = false) {
    const { fontFamily, fontSize, theme, behaviour } = currentAppearance()
    this.palette = theme
    const { platform, link } = window.drovr
    // Plain URLs (the addon) and OSC 8 links (the handler) open in the browser on Mod+click.
    const openLink = (event: MouseEvent, uri: string): void => {
      if (opensLink(event, platform)) link.open(uri)
    }
    this.term = new XTerm({
      fontFamily,
      fontSize,
      theme: xtermTheme(theme),
      ...behaviour,
      // Width of xterm's own scrollbar, so the fit is unchanged: find matches (#35 D8) and failed
      // commands (#45 D6) show in it.
      overviewRuler: { width: 14 },
      linkHandler: { activate: openLink },
      // The search addon's match highlights are decorations (#35 D8).
      allowProposedApi: true
    })
    this.cell = `${behaviour.lineHeight}/${behaviour.letterSpacing}`
    followAppearance()
    liveScreens.add(this)
    this.host.className = 'terminal'
    this.host.dataset.testid = 'terminal'
    this.host.__xterm = this.term
    this.term.loadAddon(this.fit)
    this.term.loadAddon(new WebLinksAddon(openLink))
    this.term.loadAddon(this.search)
    this.term.loadAddon(this.serializer)
    // Sixel and iTerm2 inline images (#52 D1, D2), decoded while detached too (default cell size
    // until opened), so an image printed while the board shows is there when the card is opened.
    // Read once here (D3): switching the setting never touches an open terminal.
    if (settingsStore.get().inlineImages) {
      const images = new ImageAddon(IMAGE_OPTIONS)
      this.term.loadAddon(images)
      this.host.__images = images
    }
    const clipboard = window.drovr.clipboard
    // While a find is applied, only a selection made with the mouse is the user's (#35 D9). The
    // flag outlasts xterm's own mouseup handler, which reports the finished selection.
    this.host.addEventListener('mousedown', () => (this.pointerSelecting = true), true)
    // Released anywhere, even outside the window (blur) or cancelled: never left stuck. Capture
    // phase, so no handler can stop it; the reset waits for xterm's own mouseup handler.
    window.addEventListener('mouseup', this.endPointerSelection, true)
    window.addEventListener('pointercancel', this.endPointerSelection, true)
    window.addEventListener('blur', this.endPointerSelection)
    // Copy on select: a finished selection goes to the clipboard as it is made, unless Find made
    // it, also when the addon re-searches on new output (#35 D9).
    this.term.onSelectionChange(() => {
      // Copy command output's selection is the user's too, and copies itself (#60 D2).
      const byFind = this.finding && !this.pointerSelecting && !this.selectingOutput
      this.findSelected = byFind && this.term.hasSelection()
      if (byFind) {
        this.activeMatch = this.term.getSelectionPosition()
        return
      }
      if (this.selectingOutput) return
      if (!settingsStore.get().copyOnSelect || !this.term.hasSelection()) return
      void clipboard.write(this.term.getSelection())
    })
    this.term.onBell(() => ringBell(this.host))
    this.host.addEventListener('animationend', () => this.host.classList.remove('terminal-bell'))
    // Claude Code runs here from its probe until focus reporting is next turned off (#58 D1).
    // Both handlers return false, so xterm's own still see the sequence (D3).
    this.term.parser.registerOscHandler(CLAUDE_CODE_PROBE_OSC, () => {
      this.sawProbe = true
      return false
    })
    this.term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => {
      if (params.flat().includes(1004)) this.sawProbe = false
      return false
    })
    // Shell integration marks (#45 D1), watched the same way: never swallowed, never answered.
    for (const family of SHELL_MARK_OSCS) {
      this.term.parser.registerOscHandler(family, (data) => {
        const mark = parseShellMark(family, data)
        // The cursor's column too, so a command's output keeps its C and D positions (#60 D1).
        if (mark && !this.restoring) {
          this.marks.feed(
            mark,
            Date.now(),
            () => this.markRow(),
            () => this.term.buffer.active.cursorX
          )
        }
        return false
      })
    }
    this.marks.onCommandEnded((command) => this.markFailed(command))
    this.term.attachCustomKeyEventHandler((event) => {
      // The configurable shortcuts (#31 D5) are handled by the view and the app; the shell never
      // sees any part of them (D7), nor of Mod+1…9 (D18).
      if (keymapAction(event, currentKeymap())) return false
      if (workspaceShortcut(event, window.drovr.platform) !== null) return false
      if (
        isShiftEnter(event) &&
        shiftEnterIsNewLine(this.claudeCode, this.term.modes.sendFocusMode, this.sawProbe)
      ) {
        event.preventDefault()
        if (event.type === 'keydown' && !this.term.options.disableStdin)
          this.term.input(SHIFT_ENTER)
        return false
      }
      const action = clipboardShortcut(event, window.drovr.platform)
      if (!action) return true
      // Stop the native paste event too, or xterm would paste twice.
      event.preventDefault()
      if (action === 'copy') void copySelection(this.term, clipboard)
      else void pasteFromClipboard(this.term, clipboard)
      return false
    })
  }

  get cols(): number {
    return this.term.cols
  }

  get rows(): number {
    return this.term.rows
  }

  write(data: string, done?: () => void): void {
    this.term.write(data, done)
  }

  restore(data: string, done: () => void): void {
    this.restoring = true
    this.term.write(data, () => {
      this.restoring = false
      done()
    })
  }

  onInput(listener: (data: string) => void): void {
    this.term.onData(listener)
  }

  onResize(listener: (size: { cols: number; rows: number }) => void): void {
    this.term.onResize(listener)
  }

  screen(): { lines: string[]; cursorRow: number } {
    const buffer = this.term.buffer.active
    // Rows above the new session's first are a previous run's (#46 D5a); a marker trimmed off
    // the scrollback or erased (xterm disposes it) has line -1, and one the cursor went above
    // is gone (`markSessionStart`). The alternate screen is all this session's.
    const first = buffer.type === 'normal' ? (this.sessionStart?.line ?? -1) : -1
    const lines: string[] = []
    for (let row = 0; row < this.term.rows; row++) {
      const line = buffer.baseY + row
      lines.push(line < first ? '' : (buffer.getLine(line)?.translateToString(true) ?? ''))
    }
    return { lines, cursorRow: buffer.cursorY }
  }

  /**
   * Marks the cursor's row as the new session's first (#46 D5a). Once this session's cursor goes
   * above it, as a repaint from the top does, it has written there and the mark is dropped: on
   * each cursor move, and on each cursor-positioning sequence going up, since a repaint can come
   * back below the row within one write.
   */
  markSessionStart(): void {
    this.dropSessionStart()
    const marker = this.term.registerMarker(0)
    this.sessionStart = marker
    const buffer = (): IBuffer => this.term.buffer.active
    const goesAbove = (row: number): boolean =>
      buffer().type === 'normal' && buffer().baseY + row < marker.line
    const check = (row: number): void => {
      if (this.sessionStart === marker && goesAbove(row)) this.dropSessionStart()
    }
    const first = (params: (number | number[])[]): number => {
      const value = params[0]
      return (typeof value === 'number' ? value : value?.[0]) || 1
    }
    // Where each cursor-positioning sequence going up takes the cursor's row: CUP and HVP
    // (row, column), VPA (row), CUU and CPL (rows up).
    const targets: [string, (params: (number | number[])[]) => number][] = [
      ['H', (p) => first(p) - 1],
      ['f', (p) => first(p) - 1],
      ['d', (p) => first(p) - 1],
      ['A', (p) => buffer().cursorY - first(p)],
      ['F', (p) => buffer().cursorY - first(p)]
    ]
    this.sessionListeners = [
      // Erased or trimmed off the scrollback: every row is this session's.
      marker.onDispose(() => {
        if (this.sessionStart === marker) this.dropSessionStart()
      }),
      this.term.onCursorMove(() => check(buffer().cursorY)),
      // Run before xterm's own handlers, which still move the cursor since these return false.
      ...targets.map(([final, target]) =>
        this.term.parser.registerCsiHandler({ final }, (params) => {
          check(target(params))
          return false
        })
      )
    ]
  }

  private dropSessionStart(): void {
    this.sessionListeners.forEach((listener) => listener.dispose())
    this.sessionListeners = []
    this.sessionStart?.dispose()
    this.sessionStart = undefined
  }

  setReadOnly(): void {
    this.term.options.disableStdin = true
  }

  serialize(scrollback: number): string {
    // A range ends at the last row with text and leaves out the final cursor move (#46 D1).
    const buffer = this.term.buffer.normal
    let last = buffer.length - 1
    while (last >= 0 && !buffer.getLine(last)?.translateToString(true).trim()) last--
    const range = keptRange(last, scrollback, this.term.rows)
    if (!range) return ''
    return this.serializer.serialize({ range, excludeModes: true, excludeAltBuffer: true })
  }

  /** Shows the screen in `container`, fitted and kept fitted; returns the detach function. */
  attach(container: HTMLElement): () => void {
    container.appendChild(this.host)
    if (!this.opened) {
      this.term.open(this.host)
      this.opened = true
    }
    this.fitNow()
    this.loadWebgl()
    const observer = new ResizeObserver(() => this.fitNow())
    observer.observe(container)
    this.term.refresh(0, this.term.rows - 1)
    return () => {
      observer.disconnect()
      this.dropWebgl()
      this.host.remove()
    }
  }

  focus(): void {
    this.term.focus()
  }

  /**
   * Calls `listener` with each search's results (#35 D7), also when the addon counts again as
   * new output arrives; returns the unsubscribe function.
   */
  onFindResults(listener: (results: FindResults) => void): () => void {
    const subscription = this.search.onDidChangeResults(({ resultCount, resultIndex }) =>
      listener({ count: resultCount, index: resultIndex })
    )
    return () => subscription.dispose()
  }

  /**
   * Searches as the query or a toggle changes (#35 D5): the active match is the newest, unless
   * the one active before still matches. An empty query or an invalid regex clears the find.
   */
  find(find: FindQuery): void {
    if (!this.searchable(find)) {
      this.clearFind()
      return
    }
    const options = this.searchOptions(find)
    this.finding = true
    const key = `${find.caseSensitive}/${find.regex}`
    const extending = key === this.findOptions && find.query.startsWith(this.findQuery)
    this.findQuery = find.query
    // The addon compares a search's toggles with themselves (0.16.0), so a toggle change alone
    // wouldn't re-highlight: start afresh.
    if (key !== this.findOptions) {
      this.search.clearDecorations()
      this.findOptions = key
    }
    // Only typing that extends the query keeps the active match; anything else starts again
    // from the newest (D5).
    const active = extending && this.findSelected ? this.term.getSelectionPosition() : undefined
    if (active) {
      // The incremental search keeps the active match while it still matches.
      this.search.findNext(find.query, { ...options, incremental: true })
      const now = this.term.getSelectionPosition()
      if (now && now.start.x === active.start.x && now.start.y === active.start.y) return
    }
    // Else from the newest output: searching backwards from the end finds the last match.
    this.term.clearSelection()
    this.search.findPrevious(find.query, options)
  }

  /** Steps to the next match upwards (older) or downwards (newer), wrapping (#35 D6). */
  findStep(find: FindQuery, direction: 'up' | 'down'): void {
    if (!this.searchable(find)) return
    this.finding = true
    const options = this.searchOptions(find)
    // The terminal lost Find's selection (a click into it, say): select the active match again
    // so the step goes on from it; Find made it, so it isn't copied (D9).
    const match = this.activeMatch
    const now = this.term.getSelectionPosition()
    if (match && !(now && samePosition(now, match))) {
      const { start, end } = match
      this.term.select(start.x, start.y, (end.y - start.y) * this.term.cols + end.x - start.x)
    }
    if (direction === 'up') this.search.findPrevious(find.query, options)
    else this.search.findNext(find.query, options)
  }

  /** Clears the highlights and the selection Find made (#35 D10). */
  clearFind(): void {
    if (this.disposed) return
    this.search.clearDecorations()
    if (this.findSelected) this.term.clearSelection()
    this.finding = false
    this.findSelected = false
    this.findOptions = ''
    this.findQuery = ''
    this.activeMatch = undefined
  }

  private searchable({ query, regex }: FindQuery): boolean {
    return query !== '' && (!regex || isValidRegex(query))
  }

  private searchOptions({ caseSensitive, regex }: FindQuery): ISearchOptions {
    return { caseSensitive, regex, decorations: FIND_DECORATIONS }
  }

  /**
   * Takes on a new look without touching the process or the scrollback (D3, D4). An attached
   * screen refits, so new columns and rows reach its PTY as a resize; a detached one refits when
   * next attached.
   */
  applyAppearance({ fontFamily, fontSize, theme, behaviour }: TerminalAppearance): void {
    const options = this.term.options
    if (this.palette !== theme) {
      this.palette = theme
      options.theme = xtermTheme(theme)
    }
    // Only what changed: setting an option, even to its value, makes xterm redraw.
    for (const key of Object.keys(behaviour) as (keyof typeof behaviour)[]) {
      if (options[key] !== behaviour[key])
        (options as Record<string, unknown>)[key] = behaviour[key]
    }
    const cellChanged =
      options.fontFamily !== fontFamily ||
      options.fontSize !== fontSize ||
      this.cell !== `${behaviour.lineHeight}/${behaviour.letterSpacing}`
    if (!cellChanged) return
    options.fontFamily = fontFamily
    options.fontSize = fontSize
    this.cell = `${behaviour.lineHeight}/${behaviour.letterSpacing}`
    this.fitNow()
  }

  dispose(): void {
    this.disposed = true
    window.removeEventListener('mouseup', this.endPointerSelection, true)
    window.removeEventListener('pointercancel', this.endPointerSelection, true)
    window.removeEventListener('blur', this.endPointerSelection)
    liveScreens.delete(this)
    this.dropWebgl()
    this.host.remove()
    this.term.dispose()
  }

  /**
   * Previous prompt, Next prompt (#45 D5): scrolls so a prompt is the top row, Next to the bottom
   * past the last one; Previous with no prompt above the top does nothing, and so do both on the
   * alt screen, which has no scrollback and whose rows aren't the prompts'.
   */
  jumpToPrompt(jump: PromptJump): void {
    const buffer = this.term.buffer.active
    if (buffer.type !== 'normal') return
    const rows = this.marks
      .prompts()
      .flatMap((marker) => (marker && !marker.isDisposed && marker.line >= 0 ? [marker.line] : []))
    const target = promptJumpTarget(jump, rows, buffer.viewportY, buffer.baseY)
    if (target !== null) this.term.scrollToLine(target)
  }

  /**
   * Copy command output (#60 D2–D4): selects the output of the ended command the viewport picks
   * (D3) as the user's selection and writes its text to the clipboard, without scrolling. Nothing
   * on the alternate screen, before the screen is shown, or with no command with output.
   */
  copyCommandOutput(): void {
    const buffer = this.term.buffer.active
    if (!this.opened || buffer.type !== 'normal') return
    const { cols, rows } = this.term
    const text = (y: number, from: number, to: number): string =>
      buffer.getLine(y)?.translateToString(true, from, to) ?? ''
    const withText = (range: OutputRange): OutputRange | null => textRange(range, cols, text)
    const chosen = chooseCommandOutput(
      endedOutputs(this.marks.outputs(), (marker) =>
        marker && !marker.isDisposed && marker.line >= 0 ? marker.line : undefined
      ),
      { top: buffer.viewportY, rows, bottom: buffer.baseY, cols },
      (range) => withText(range) !== null
    )
    const range = chosen && withText(chosen)
    if (!range) return
    // Ends at its last text, so the selection and the copied text agree (D1). `select` neither
    // scrolls nor waits: its change event comes within this call.
    this.selectingOutput = true
    try {
      this.term.select(range.start.x, range.start.y, rangeLength(range, cols))
    } finally {
      this.selectingOutput = false
    }
    // Find's selection is gone: the next Find step selects its match again (#35 D6, #60 D2).
    this.findSelected = false
    void window.drovr.clipboard.write(this.term.getSelection())
  }

  /** The row the cursor is on, as a marker that follows scrolling (#45 D1). */
  private markRow(): MarkLine {
    const marker = this.term.registerMarker(0)
    marker?.onDispose(() => this.marks.forget(marker))
    return marker
  }

  /**
   * A failed command's marks on its line (#45 D6): a red bar on its first cell and a `✗ <code>`
   * badge on its last ones, both with the exit code as their tooltip, and a red mark in the
   * overview ruler. xterm moves them with the line and drops them with it.
   */
  private markFailed({ line, exitCode }: ShellCommand<MarkLine>): void {
    if (!exitCode || !line || line.isDisposed) return
    const label = `✗ ${exitCode}`
    const tooltip = `Exit code ${exitCode}`
    // xterm calls these on every render of the line; it keeps the element and its own styles.
    const show = (element: HTMLElement, testid: string, text = ''): void => {
      element.dataset.line = String(line.line)
      if (element.dataset.testid) return
      element.dataset.testid = testid
      element.dataset.exitCode = String(exitCode)
      element.title = tooltip
      element.classList.add(testid)
      if (!text) return
      const content = document.createElement('span')
      content.textContent = text
      element.replaceChildren(content)
    }
    this.term
      .registerDecoration({ marker: line, overviewRulerOptions: { color: FAILED_RED } })
      ?.onRender((element) => show(element, 'command-failed'))
    this.term
      .registerDecoration({ marker: line, anchor: 'right', width: label.length + 1 })
      ?.onRender((element) => show(element, 'command-failed-badge', label))
  }

  private fitNow(): void {
    if (this.host.isConnected && this.host.clientWidth > 0) this.fit.fit()
  }

  // WebGL where a real GPU backs it; xterm's DOM renderer stays in place otherwise.
  private loadWebgl(): void {
    if (this.webgl || !hardwareWebgl()) return
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => this.dropWebgl())
      this.term.loadAddon(webgl)
      this.webgl = webgl
    } catch {
      this.webgl = undefined
    }
  }

  private dropWebgl(): void {
    this.webgl?.dispose()
    this.webgl = undefined
  }
}

let router: SessionRouter | undefined
let registry: CardSessions<XtermScreen> | undefined
let paneRegistry: CardPanes<XtermScreen> | undefined

/** The one router of terminal events, shared by cards' own terminals and their extra panes. */
function sessionRouter(): SessionRouter {
  router ??= new SessionRouter(window.drovr.terminal)
  return router
}

/** Whether the card's startup command is Claude Code; shells and unknown cards are not. */
function startsClaudeCode(cardId: string): boolean {
  return workspaceStore
    .getState()
    .workspaces.some((w) => w.cards.some((c) => c.id === cardId && c.startup.kind === 'claude'))
}

/** Told of each new screen, with its card or shell and its pane. */
type ScreenListener = (screen: XtermScreen, cardId: string, paneId: string) => void
const screenListeners = new Set<ScreenListener>()

/**
 * Calls `listener` with each screen created from now on (a main pane's at each start, an extra
 * pane's at its split), e.g. to watch its commands (#45 D7). Returns an unsubscribe function.
 */
export function onScreenCreated(listener: ScreenListener): () => void {
  screenListeners.add(listener)
  return () => screenListeners.delete(listener)
}

function created(screen: XtermScreen, cardId: string, paneId: string): XtermScreen {
  for (const listener of screenListeners) listener(screen, cardId, paneId)
  return screen
}

/** Whether `cardId` is a card (not a shell) on the board. */
function isCard(cardId: string): boolean {
  return workspaceStore.getState().workspaces.some((w) => w.cards.some((c) => c.id === cardId))
}

/** Nothing is read or saved while Keep output after a card stops is off (#46 D8). */
const keepingOutput = (): boolean => settingsStore.get().keepOutput

/** Cards' main pane output, kept by main across their starts (#46); never a shell's (D1). */
const outputKeeper: OutputKeeper = {
  keeps: (cardId) => keepingOutput() && isCard(cardId),
  scrollback: () => settingsStore.get().scrollback,
  read: async (cardId) => (keepingOutput() ? window.drovr.scrollback.read(cardId) : null),
  save: (cardId, data) => {
    if (keepingOutput()) window.drovr.scrollback.save(cardId, data)
  }
}

/** The app-wide card terminals: one per card, with a fresh screen each start (#5 D7). */
export function cardTerminals(): CardSessions<XtermScreen> {
  if (!registry) {
    registry = new CardSessions(
      window.drovr.terminal,
      (cardId) => created(new XtermScreen(startsClaudeCode(cardId)), cardId, MAIN_PANE),
      sessionRouter(),
      // Every start opens the card at full size: its view fits the new screen in this task's
      // render, so the shell spawns after it, at the size the user sees (#22 D1).
      (spawn) => setTimeout(spawn, 0),
      outputKeeper
    )
    // When the main pane's shell stops or couldn't start, every extra pane ends with it
    // (#11 D1, D6).
    registry.onEnded((cardId) => cardPanes().dispose(cardId))
    // A local main pane's output shows its dev servers' chips (#49 D2, D5, D6).
    registry.watchOutput({
      output: (cardId, data) => devServers().output(cardId, MAIN_PANE, data),
      ended: (cardId) => devServers().paneEnded(cardId, MAIN_PANE)
    })
    // Every running card's output is saved as the app starts quitting, before main stops the
    // shells (#46 D2).
    const cards = registry
    window.drovr.app.onQuitting(() => {
      cards.keepRunning()
      window.drovr.scrollback.quitSaved()
    })
  }
  return registry
}

/** The app-wide extra panes of cards (#11 D1), with their layouts. */
export function cardPanes(): CardPanes<XtermScreen> {
  if (!paneRegistry) {
    paneRegistry = new CardPanes(
      window.drovr.terminal,
      sessionRouter(),
      (cardId, paneId) => created(new XtermScreen(), cardId, paneId),
      (cardId) => cardTerminals().runState(cardId)?.kind === 'running',
      // A new split starts where the focused pane's shell last said it was (#45 D8).
      (card, focused) => {
        const screen =
          focused === MAIN_PANE
            ? cardTerminals().screen(card.id)
            : paneRegistry?.screen(card.id, focused)
        return splitDirectory(screen?.marks.directory(), {
          cardDirectory: card.directory,
          sshHost: card.host,
          localHostName: window.drovr.hostName
        })
      }
    )
    // A local extra pane's output shows its dev servers' chips too (#49 D3, D5, D6).
    paneRegistry.watchOutput({
      opened: (cardId, paneId) => devServers().paneOpened(cardId, paneId),
      output: (cardId, paneId, data) => devServers().output(cardId, paneId, data),
      ended: (cardId, paneId) => devServers().paneEnded(cardId, paneId)
    })
  }
  return paneRegistry
}

/** The card's panes and which is focused (#11 D2, D3), re-rendering when they change. */
export function usePaneLayout(cardId: string): PaneLayout {
  return useSyncExternalStore(
    (listener) => cardPanes().subscribe(cardId, listener),
    () => cardPanes().layout(cardId)
  )
}

/**
 * The card's status (D9), re-rendering at most about 4 times a second while it prints; `Stopped`
 * for a card not started in this run, e.g. restored after a restart (#8 D9).
 */
export function useCardStatus(cardId: string): CardStatus {
  return useSyncExternalStore(
    (listener) => cardTerminals().subscribe(cardId, listener),
    () => knownStatus(cardTerminals().status(cardId))
  )
}

/** The card's process state: running, Stopped or couldn't start (#5 D6); see `useCardStatus`. */
export function useCardRunState(cardId: string): CardRunState {
  return useSyncExternalStore(
    (listener) => cardTerminals().subscribe(cardId, listener),
    () => knownRunState(cardTerminals().runState(cardId))
  )
}

/** How many of `cards` have a running process, kept current as their processes exit (D15). */
export function useRunningCount(cards: readonly { id: string }[]): number {
  const ids = cards.map((c) => c.id).join('\n')
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribes = ids
        .split('\n')
        .filter(Boolean)
        .map((id) => cardTerminals().subscribe(id, listener))
      return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
    },
    [ids]
  )
  return useSyncExternalStore(subscribe, () =>
    runningCount(cards, (id) => cardTerminals().runState(id))
  )
}
