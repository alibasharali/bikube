---
item: 53
type: feature
title: Open a card in its own window
status: approved
branch: claude/53-card-own-window
---

# Open a card in its own window

## Problem

On a big screen, or with a second monitor, a user wants to watch two agents at full size at once, but Drovr shows one card at full size at a time, in its one window (a card's split panes are its own shells, not other cards). After this ships, any card or workspace shell can be opened in its own window: its process, panes and screen move there and keep running, the board stays usable in the main window, and the card comes back to its board when that window closes.

## Domain decisions

- **D1 – What opens in a window:** a card or a workspace shell (the Default shell or a named one), each in at most one window, any number of them at once. Never a workspace's board. *Why:* cards and shells share the full-size card view; a second board needs its own sidebar and drags between windows, a separate item.
- **D2 – A card window is the same renderer:** the main window's page opens the window itself (`window.open('about:blank', <frame name>)`, VS Code's auxiliary-window approach) and renders the card view into that window's document. Sessions, PTY ownership, flow-control acknowledgements (#16), kept output (#46), `board` requests, activity, notifications and automatic moves stay exactly as they are, in the main window's page; main's terminal IPC does not change. The card's existing screens (xterm instances) move into the window and back, keeping their scrollback, marks and find state; a screen moved to another document re-opens xterm on its host (xterm 6 then follows the new window) before WebGL is loaded there. *Why:* a second page would need terminal ownership handed between pages, a second store and acks per window; a spike on Electron 39 with `sandbox: true` showed an `about:blank` window opened this way is in the same process and scriptable by its opener.
- **D3 – Main allows only that window:** the open handler still denies everything except, from the main window's main frame, `about:blank` with the frame name `drovr-card:<card id>` (the id passing `isCardId`), opened as a 900×640 window, position left to the OS, with the main window's background colour, `autoHideMenuBar` off macOS, the standard title bar on macOS (not `hiddenInset`), and webPreferences `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` and no preload (so no `window.drovr` in it). The navigation lock and the deny-all open handler apply to it as to every web contents. Main keeps the card windows by card id, closes them all when the main window closes or its page navigates (a reload) or crashes, and focuses one on request (`cardWindow:focus`, main frame only, an unknown id doing nothing). The global shortcut (#51), a second launch and the update popup act on the main window only, never a card window. *Why:* no new bridge or privileges; the window must not outlive the page that drives it.
- **D4 – What the window shows:** only the card view, as at full size in the main window: its panes, zoom, find bar, side panel (the shared Side panel setting and width) and Close confirmation; no sidebar, title bar, board or shell strip. The native window title is `<title> · <workspace name>`, kept up to date when either is renamed. It looks like the main window: the app's stylesheets, the theme (which follows `prefers-color-scheme`, the same in both windows), the terminal settings and the bundled symbols font all apply. A file or link dropped on it opens nothing. *Why:* the view is the point; the title bar's chips belong to the main window's workspace.
- **D5 – Keys in a card window:** the card view's actions work there with their shortcuts (Back, Split right and down, Close pane, Close card, Find, Previous and Next prompt, Zoom pane) and Toggle panel does too (the setting is shared, so it shows or hides the panel everywhere, as in the main window). The app's own shortcuts (Settings, Command palette, Next waiting card, Default shell, Open in new window, Mod+1…9) do nothing there, and, as everywhere, never reach the shell. A dialog in one window owns only that window's keyboard: a card window's Close confirmation doesn't block the main window's shortcuts, nor a main window dialog the card window's. The command palette's card view actions act on the main window's open card only, never on a card window. *Why:* a window acts on its own content; the palette and Settings live in the main window.
- **D6 – Opening a card in its own window:** **Open in new window** in the board card's ⋯ menu and in a shell's menu, the **Open in new window** card view action (a palette row while a card or shell is open at full size in the main window) and its shortcut (`Shift+Cmd+O` on macOS, `Ctrl+Shift+O` elsewhere; recordable, refused and reset in Settings' Shortcuts section like the others, #31). A card that isn't running is started first, as opening it does. If the card was open at full size in the main window, the main window goes back to its board (that workspace forgets its view, #31 D19). The new window gets focus with the card's focused pane's terminal focused. For a card already in its own window, every one of these brings that window forward instead. *Why:* reachable like every other card view action (#31, #40).
- **D7 – While in its own window:** the board card shows an `In window` chip on its status row (a shell's strip button has the same chip), and opening the card from the main window (a click on the board card or shell button, a palette pick, Next waiting card, a clicked notification, the Default shell's shortcut for the Default shell) brings its window forward with its terminal focused, and changes nothing in the main window: no workspace switch, no view change. Everything else about the card is unchanged on the board: status, activity, agent status, usage, dev server chips, moves, menu. *Why:* a card is shown in one place at a time; the chip says why it doesn't open in the main window.
- **D8 – Coming back:** the window closes, and the card is again only on its board, when the user closes it (the window's close button, Cmd+W's Close Window on macOS), when Back runs in it, when its main pane's shell stops (exit or Close, as the full-size view goes back to the board, #5 D6), when the card or its workspace is deleted, when the main window closes or reloads, and at quit. Unless it stopped, its process and extra panes keep running; the main window's view never changes when a card window closes. The card's panes and their layout, focus and zoom are kept, as after Back. *Why:* mirrors the full-size view going back to the board; never pulls the main window away from what the user does there.
- **D9 – Not kept:** card windows, their sizes and positions are runtime only: never in `drovr-state.json`, `drovr-settings.json` or the Sync folder; after a restart every card is on its board and no window opens. *Why:* processes don't survive a restart either; restoring windows is a separate UI-preferences item.
- **D10 – Looking at a card:** the user is looking at a card when it is open at full size in the focused main window or its own window is focused. Notifications skip such a card (#41's rule, now per window) and a long command's notice (#45 D7) counts its window's focus and the card's focused pane. Everything that refreshes "while the window is focused" or "on focus" (the Files tab, branch and PR reads, dev server probes) treats any Drovr window being focused as the window being focused, and a card window gaining focus as a focus. *Why:* a card window is where the user is looking; its side panel must stay live.

## Acceptance criteria

- **AC1 – Open from the card menu:** Given a workspace with a running card `Agent A` on its board, when the user picks **Open in new window** in its ⋯ menu, then a second window opens titled `Agent A · <workspace>` showing only that card's terminal, with its earlier output, the typed `echo hello-53` runs there and prints `hello-53`, and the main window still shows the board, where the card reads `Running` with an `In window` chip.
- **AC2 – A stopped card starts:** Given a `Stopped` card, when **Open in new window** is picked from its menu, then it starts (its startup command runs) and shows in its new window.
- **AC3 – From the full-size view:** Given a card open at full size in the main window, when the user presses the Open in new window shortcut (`Ctrl+Shift+O` on Linux), or picks the palette's `Open in new window` row, then the card opens in its own window and the main window shows its workspace's board; the shell receives none of the shortcut's keys.
- **AC4 – Opening it again focuses it:** Given `Agent A` in its own window, when the user clicks the card on the board, picks it in the command palette, or picks **Open in new window** again, then no second window opens, main focuses `Agent A`'s window, and the main window's active workspace and view stay as they were.
- **AC5 – Closing the window brings it back:** Given `Agent A` in its own window with a `sleep 1000` running, when the user closes that window, then the card on the board reads `Running` without the chip, and opening it in the main window shows the same screen with `sleep 1000` still running; the main window's view didn't change when the window closed.
- **AC6 – Back, stop and delete close it:** Given a card in its own window, when Back's shortcut is pressed there, or `exit` ends its shell, or the card is deleted from the board, then its window closes (after `exit` the card reads `Stopped`; after delete it is gone).
- **AC7 – The card view works there:** Given a card in its own window, when the user splits it right, zooms the pane, opens Find and searches `hello-53`, and presses Close card, then each acts in that window as in the main window (2 panes, the zoom chip, `1 of 1`, the Close confirmation shown in the card window), while the main window's shortcuts (e.g. Settings) still work there with the card window's dialog open.
- **AC8 – App shortcuts don't act there:** Given a card focused in its own window, when Settings', the palette's and Next waiting card's shortcuts are pressed there, then no dialog opens in either window, nothing changes in the main window, and the shell receives none of their keys.
- **AC9 – Shells:** Given a workspace's Default shell running, when **Open in new window** is picked from its menu in the shell strip, then it opens in its own window titled `Default shell · <workspace>` (its title as shown), the strip button shows `In window`, and the Default shell's shortcut in the main window brings that window forward.
- **AC10 – Title follows renames:** Given `Agent A` in its own window, when the card is renamed to `Agent B` on the board, then the window title reads `Agent B · <workspace>`.
- **AC11 – Main window closing closes them:** Given two cards in their own windows, when the main window's page reloads (or the main window closes), then both card windows close; at quit, and after a restart, no card window opens and `drovr-state.json` holds nothing about windows.
- **AC12 – Notifications per window:** Given a card in its own window that is focused, when its activity becomes `waiting`, then no notification is shown; when the main window is focused instead, one is, and clicking it brings the card's window forward without changing the main window's view.
- **AC13 – Settings:** Given Settings' Shortcuts section, then it lists `Open in new window` with `Ctrl+Shift+O` (Linux), which can be recorded, saved to `drovr-settings.json`, refused when taken and reset like the others; the card window's terminals follow a font size change made in Settings.
- **AC14 – Only that window opens:** Given the app, when its page calls `window.open` with any other URL or frame name (e.g. `https://example.com`, or `about:blank` named `x`), then no window opens; a card window has no `window.drovr`.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – A card in its own window:** main's open handler, card window options, the card windows by id, `cardWindow:focus`, closing them with the main window's page (D3); the renderer's card windows (open, focus, close, the title, the stylesheets, the symbols font, drop handling: D2, D4), the card view rendered into a window using that window's document and window for its keys, dialog checks, focus, the Modal, menus, the find bar, the side panel's resize and the screen's pointer listeners (D5), and xterm re-opened on its moved host; the card ⋯ menu's **Open in new window**, the `In window` chip, opening from the board focusing the window, a card window closing on its close button, Back, its shell stopping and the card's or workspace's deletion (D6–D9). Satisfies AC1, AC2, AC4 (board click and menu), AC5, AC6, AC7, AC8, AC10, AC11, AC14.
2. **S2 – Shortcut, palette and shells:** the `openInWindow` shortcut action with its defaults and Settings row, the card view action and palette row, the main window going back to its board when its open card leaves (D6), palette picks, Next waiting card and the Default shell's shortcut focusing a card's window (D7), the shell menu's **Open in new window** and the strip button's chip. Satisfies AC3, AC4 (palette), AC9, AC13.
3. **S3 – Looking at a card in its window:** notifications and long command notices counting the card window's focus, a clicked notification focusing the card's window, and the focus-based refreshes counting any Drovr window (D10); `AGENTS.md` (Architecture and the smoke test list) and `CONTEXT.md` (**Card window**). Satisfies AC12.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1, AC2, AC5, AC6, AC10, AC11 | e2e `e2e/card-windows.spec.ts` (the new window through Playwright's `electronApp.waitForEvent('window')`; terminal text read through the window page) | Open a card from its menu; type in the new window; close it; reopen in the main window |
| AC3, AC8, AC9, AC13 | e2e `e2e/card-windows.spec.ts`; Vitest for the keymap defaults and refusals (`src/core/keymap.test.ts`), the palette row (`src/core/palette.test.ts`) | Press `Ctrl+Shift+O` with a card open; press Settings' shortcut in the card window |
| AC4, AC12 | e2e with a spy on main's card window `focus()` (xvfb has no window manager, so focus is read from the spy, not the OS) and `Notification` stubbed in the page, as `e2e/waiting.spec.ts` and `e2e/shell-integration.spec.ts` do | Click a popped-out card on the board; make a card wait with the main window focused |
| AC7 | e2e | Split, zoom, Find and Close card in the card window |
| AC14, D3 | Vitest for the pure open-handler decision and window options (`src/core/card-windows.ts`: frame name, URL, sender); e2e for `window.open` from the page | `window.open('https://example.com')` from DevTools opens nothing |

## Stack changes

None.

## Data and migrations

None. `drovr-settings.json`'s `shortcuts` may gain an `openInWindow` entry, written only when it differs from its default, read like the others (an older file simply lacks it).

## Out of scope

- A workspace's board in its own window, dragging cards or panes between windows, moving a pane of a card into its own window.
- Restoring card windows, their sizes or positions after a restart.
- The title bar's chips (branch menu, PR chip, usage), the sidebar, the command palette and Settings inside a card window.
- A second Drovr page per window or any change to how sessions are owned in main.

## Open questions

None.
