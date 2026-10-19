# Progress #51 Global hotkey

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `44d2515..3b19c1b` | CLEAN | `src/core/global-hotkey.ts`: `globalAccelerator(text, platform)`, `globalShortcutRefusal(text, keymap, platform)`, `isGlobalShortcut`, `recordGlobalPress(event, keymap, platform): RecordResult`, `NO_ACCELERATOR_MESSAGE`; keymap: `GLOBAL_SHORTCUT_LABEL`, `recordPress`/`resetRefusal` optional `globalShortcut` last arg; `Settings.globalShortcut?`, `Preferences.openWaitingOnShow` |
| S2 | todo | | | |
| S3 | todo | | | |

## Rulings

Decisions the developer made during implementation, with the date. A ruling that changes the spec also got its own `docs(spec):` commit.

## Verification

- todo
