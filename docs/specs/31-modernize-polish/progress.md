# Progress #31 Modernize and polish

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 Configurable shortcuts | done | `27fd188..d41237d` | CLEAN | `src/core/keymap.ts`: SHORTCUT_ACTIONS (back, splitRight, splitDown, closePane, closeCard, settings), SHORTCUT_LABELS, defaultKeymap(platform), fixedShortcuts(platform) (incl. Mod+1…9 → Switch workspace), parseShortcut, formatShortcut, eventKey, matchesShortcut, keymapAction(event, keymap), recordPress, resolveKeymap, shortcutOverrides, readShortcuts, validateShortcuts. Settings.shortcuts?: ShortcutOverrides; parseSettingsFile/validateSettings/createSettingsStore take platform. Renderer: currentKeymap(). Test ids settings-shortcut-<action>, settings-shortcut-reset-<action>, settings-shortcut-error-<action>. macOS defaults written Shift+Cmd+… (D7 order). |
| S2 No bar | todo | | | |
| S3 Board card and stop button | todo | | | |
| S4 Activity | todo | | | |
| S5 Claude Code hooks | todo | | | |
| S6 Workspace switching | todo | | | |
| S7 Visual refresh | todo | | | |

## Rulings

- none yet

## Verification

- todo
