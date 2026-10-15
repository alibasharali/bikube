# Progress #31 Modernize and polish

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 Configurable shortcuts | done | `27fd188..d41237d` | CLEAN | `src/core/keymap.ts`: SHORTCUT_ACTIONS (back, splitRight, splitDown, closePane, closeCard, settings), SHORTCUT_LABELS, defaultKeymap(platform), fixedShortcuts(platform) (incl. Mod+1…9 → Switch workspace), parseShortcut, formatShortcut, eventKey, matchesShortcut, keymapAction(event, keymap), recordPress, resolveKeymap, shortcutOverrides, readShortcuts, validateShortcuts. Settings.shortcuts?: ShortcutOverrides; parseSettingsFile/validateSettings/createSettingsStore take platform. Renderer: currentKeymap(). Test ids settings-shortcut-<action>, settings-shortcut-reset-<action>, settings-shortcut-error-<action>. macOS defaults written Shift+Cmd+… (D7 order). |
| S2 No bar | done | `a6c3f78..1b2c667` | CLEAN | `e2e/card-view.ts`: SHORTCUTS, cardView, expectCardOpen, backToBoard, splitRight, splitDown, closeCard, boardCard, checkOnBoard(page,title,check), expectStatusOnBoard. Card view has no header; `card-view` keeps aria-label=title; `pane-close` is a plain × glyph (S7 swaps to lucide X), hidden via opacity until hover/focus-visible. CardStatusLine still used by CardItem. |
| S3 Board card and stop button | done | `b706445..89bde79` + glossary fix | fixed r1 | `CardStatus = { label, agentStatus, lastLine }` (texts '' unless running). `src/renderer/src/CardLines.tsx` replaces CardStatusLine. Test ids: `card-status` (row; S4 pill slot marked by a comment), `card-status-label`, `card-agent-status` (title = full text), `card-status-line` (monospace), `card-stop` (■ glyph, name/tooltip Close; S7 → lucide Square). `.card` is a 2-col grid with subgrid body. Column `width: 300px`. |
| S4 Activity | done | `4687f20..03da4b0` | CLEAN | `src/core/activity.ts`: Activity, ActivityValue, ACTIVITY_VALUES, isActivityValue, ACTIVITY_LABELS. Protocol v1 `{command:'activity',card,activity}`. `CardSessions.setActivity(cardId, Activity|null)`; cleared on every state change. `CardStatus.activity?`. Pill test id `card-activity` (data-activity, classes card-activity-<v>), CSS vars `--pill-{working,waiting,question}-{bg,text}`. e2e helper `boardInFocusedPane` in board-cli.spec.ts. |
| S5 Claude Code hooks | review (awaiting ruling) | `349bf57..585c15a` | HUMAN: SSH setup failure leaves DROVR_CLAUDE_SETTINGS unset → `claude --settings ""`; options (a) accept / (b) export `{}` on failure / (c) drop --settings when empty | `src/core/claude-hooks.ts`: CLAUDE_SETTINGS_FILE, CLAUDE_INSTRUCTION_FILE, CLAUDE_INSTRUCTION, claudeSettings(); static `resources/bin/claude-settings.json`, `claude-instruction.txt` (test keeps them equal to the module). `DROVR_CLAUDE_SETTINGS` in every card env. `e2e/fake-claude.ts`: LOCAL_CLAUDE_SETTINGS, SETTINGS_ARGS, REMOTE_SETTINGS_ARGS, claudeFirstLine(id), claudeResumeLine(id). |
| S6 Workspace switching | done | `e1ab425..29e67bc` + AGENTS.md fix | fixed r1 | `workspaceShortcut(event, platform): number|null` in keymap.ts. `src/core/view-memory.ts`: ViewMemory, NO_VIEWS, openedCard, rememberCard, forgetView, selectWorkspace, enterWorkspace. App.tsx: per-workspace `views` + `onSelectWorkspace`. |
| S7 Visual refresh | review (awaiting ruling) | `dfbb441..ccd2110` | HUMAN: SSH board header now shows Server icon + host:directory (beyond D17); options (a) accept / (b) sidebar icon only, header shows directory as before | `src/renderer/src/icons.ts` (ICON, SMALL_ICON, MENU_ICON); tokens --space-1..6, --radius-lg/sm, --text-xs..lg, --shadow-*, --terminal-bg. lucide-react in devDependencies. Screenshots in docs/specs/31-modernize-polish/screenshots/. |

## Rulings

- (pending) S5: SSH setup failure leaves DROVR_CLAUDE_SETTINGS unset
- (pending) S7: SSH host in the board header

## Verification

- todo
