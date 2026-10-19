# Progress #51 Global hotkey

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `44d2515..3b19c1b` | CLEAN | `src/core/global-hotkey.ts`: `globalAccelerator(text, platform)`, `globalShortcutRefusal(text, keymap, platform)`, `isGlobalShortcut`, `recordGlobalPress(event, keymap, platform): RecordResult`, `NO_ACCELERATOR_MESSAGE`; keymap: `GLOBAL_SHORTCUT_LABEL`, `recordPress`/`resetRefusal` optional `globalShortcut` last arg; `Settings.globalShortcut?`, `Preferences.openWaitingOnShow` |
| S2 | done | `e804930..b101e87` | CLEAN | `window.drovr.globalShortcut.state()` (IPC `globalShortcut:state`, none/registered/failed), `window.drovr.globalShortcut.suspend(bool)` (IPC `globalShortcut:suspend`; main also resumes on window blur), `window.drovr.app.onGlobalShow`; core `src/core/global-shortcut.ts`; `MainSettings.globalShortcut()/openWaitingOnShow()/onGlobalShortcut()`; dev hook `globalThis.__drovrGlobalShortcutPress`; e2e `e2e/global-hotkey.spec.ts` |
| S3 | done | `bed6d49..4cd310a` | CLEAN | Settings test ids `settings-shortcut-global`, `settings-shortcut-clear-global`, `settings-global-shortcut-failed`, `settings-open-waiting-on-show` |

## Rulings

Decisions the developer made during implementation, with the date. A ruling that changes the spec also got its own `docs(spec):` commit.

## Verification

- todo
