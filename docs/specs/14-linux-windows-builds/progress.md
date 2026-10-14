# Progress #14 Linux and Windows builds

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `eb6b9bd..2072cf7` | CLEAN | `autoHideMenuBar` in createWindow |
| S2 | done | `0ecd60e..13eac85` | HUMAN → rulings r3, r4; comment fix r1 | `npm run dist` = build + electron-builder (current OS); `dist/drovr-<v>-x86_64.AppImage`, `dist/drovr-<v>-amd64.deb`; .deb → `/opt/Drovr/drovr`, `/usr/bin/drovr`; packaged unpacked app `dist/linux-unpacked/drovr` |
| S3 | done | `3f4ff72..16e633c` | CLEAN | `npm run test:packaged` = pack + `playwright.packaged.config.ts`; CI step "Packaged app check"; `launchApp({ executablePath })` |
| S4 | done | `fed34b6..5b52d53` | CLEAN | release.yml `linux` job |

## Rulings

- 2026-10-14 S2 (round 3, full auto): electron-builder's AppImage AppRun falls back to --no-sandbox where user namespaces are blocked → accept; README says so and points Ubuntu 23.10+ to the .deb. Spec D6/AC8 revised (0ecd60e).
- 2026-10-14 S2 (round 4, full auto): electron-builder's .deb installs an AppArmor profile → keep it; spec D5/D6/Out of scope revised (2294712).
- Note: in cloud sessions `npm run dist`/`pack` fail at the node-pty rebuild (proxy 403 on Electron headers) and wipe node-pty's build; build with `npx electron-builder -c.npmRebuild=false` (or `--dir`) after `npm run build`, and `npm rebuild node-pty` if it was wiped.

## Verification

- todo
