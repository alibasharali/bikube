---
item: 14
type: feature
title: Linux and Windows builds
status: approved
branch: claude/14-linux-windows-builds
---

# Linux and Windows builds

## Problem

A GitHub release ships only an unsigned macOS .dmg. Someone who develops on a Linux desktop has no Drovr to install, although the app already runs and is tested on Linux every day (development and CI happen there). After this ships, every published release (pre-releases included) also carries a Linux AppImage and .deb built by the release workflow, PR CI catches a broken Linux package before it reaches a release, and the window on Linux doesn't show Electron's default menu bar. Windows needs a real port (shell, `board` transport, SSH quoting) and is split out as its own feature, #27.

## Domain decisions

- **D1 – Scope:** this item ships Linux release builds. Windows is #27, its own feature with its own spec; nothing here makes Windows harder (no new POSIX-only code outside packaging). *Why:* round 1 Q1. Linux is packaging plus a release job on code that already runs there; Windows needs a port that can only be verified on Windows runners, and Linux shouldn't wait for it.
- **D2 – Formats and architecture:** a Linux release attaches an AppImage and a .deb, both x64 only. No .rpm, .tar.gz, snap or flatpak; no arm64. *Why:* round 1 Q2, Q3. AppImage runs on any distro without installing; .deb covers Debian/Ubuntu. node-pty is native, so arm64 would need its own runner build; it can be added later without renaming anything (D4).
- **D3 – One `dist` command:** `npm run dist` builds the release packages for the OS it runs on: the .dmg on macOS (unchanged), the AppImage and .deb on Linux. `npm run pack` stays the unpacked app for the current OS. *Why:* round 2 Q2. Each release job runs on its own OS; #27 then only adds a target.
- **D4 – File names:** `drovr-<version>-x86_64.AppImage` and `drovr-<version>-amd64.deb`, next to the existing `drovr-<version>.dmg` (unchanged). `<version>` is `package.json`'s version. *Why:* round 2 Q4. Consistent with the .dmg; each format's own arch word leaves room for arm64.
- **D5 – Package metadata:** product name `Drovr`, app id `com.drovr.app` (as today), desktop entry category Development, icon from `build/icon.png` (512×512, already in the repo). The .deb's maintainer is `Drovr` and its homepage the GitHub repository URL (`https://github.com/alibasharali/drovr`); no personal name or email is published. The .deb installs the app so the command `drovr` launches it, and its Chromium `chrome-sandbox` helper is set up by the package's install script (electron-builder's standard .deb behaviour). *Why:* round 2 Q3.
- **D6 – Sandbox kept:** Drovr never turns off Chromium's sandbox in a package: no `--no-sandbox` baked into the AppImage, the .deb or the desktop entry, and the window settings (contextIsolation on, nodeIntegration off, renderer sandbox on) are untouched. Ubuntu 23.10+ restricts unprivileged user namespaces, so the AppImage may refuse to start there; the README says the .deb is the way to install on those systems, and names the user's own options for the AppImage (an AppArmor allowance, or running it with `--no-sandbox` at their own risk). The README also notes that the AppImage needs FUSE 2 (`libfuse2`/`libfuse2t64` on Ubuntu 22.04+). *Why:* round 2 Q1; AGENTS.md forbids weakening the sandbox.
- **D7 – Release workflow:** `.github/workflows/release.yml` gets a second job on `ubuntu-latest`, beside the macOS job, on the same trigger (`release: published`, so pre-releases get Linux builds too): `npm ci`, `npm run dist`, then attach `dist/*.AppImage` and `dist/*.deb` to the release with `--clobber`, like the .dmg. The two jobs are independent: one failing doesn't cancel the other. *Why:* round 1 Q4; one release carries every platform's files.
- **D8 – PR CI guards the Linux package:** the `check` job in `ci.yml` (its id stays `check`, it is the required status) gains, after the smoke tests, a packaged check: `npm run pack` on Linux, then a check that `resources/bin/board` in the unpacked app is an executable file and `resources/app.asar.unpacked/out/main/board-cli.js` exists, then one launch of the unpacked packaged app under xvfb (with `--no-sandbox`, as the dev-build smoke tests do, because CI has no setuid helper) that opens the window, creates a workspace and a card, and runs `board status . packaged` in the card, which shows on the card. It is its own npm script (`npm run test:packaged`), not part of `npm run test:smoke`, so local smoke runs don't need a pack. `npm run dist` (AppImage and .deb) runs only in the release job. *Why:* round 1 Q5. A broken asar unpack or a lost exec bit would otherwise only show in a release; launching the real packaged executable is the only check that catches it.
- **D9 – Menu bar off macOS:** on every platform but macOS the window auto-hides Electron's default menu bar: it isn't shown, pressing and releasing Alt alone shows it, and its accelerators keep working. macOS keeps its app menu as today. No custom menu. Checked in this session on Linux under xvfb with real X key events: Ctrl+R and Ctrl+W typed in a card reach the shell (reverse search, delete word), not the menu's Reload and Close, so the menu doesn't take terminal keys and doesn't need removing. *Why:* round 1 Q6; the default menu is Electron's, not Drovr's, and takes vertical space.
- **D10 – Docs follow:** `docs/product.md` says Drovr is a kanban board for macOS and Linux (the Description's first line, and the Shipping paragraph gains the Linux job), and moves "Linux builds" out of "Not in v1", leaving Windows there. README opens the same way and gains a short *Install* section (macOS: .dmg, unsigned; Linux: .deb or AppImage with D6's notes). AGENTS.md's `dist`, release workflow and smoke-test lines describe D3, D7 and D8. *Why:* round 1 Q7.

## Acceptance criteria

- **AC1 – Linux packages:** Given a Linux x64 machine with the repo at version `X`, when `npm run dist` runs, then `dist/` holds `drovr-X-x86_64.AppImage` and `drovr-X-amd64.deb`, and no .dmg.
- **AC2 – .deb contents:** Given the .deb from AC1, when its control data is read (`dpkg-deb -I`) and its files listed (`dpkg-deb -c`), then the package is `drovr`, architecture `amd64`, maintainer `Drovr`, homepage `https://github.com/alibasharali/drovr`; it contains a desktop entry with `Name=Drovr` and category Development, the Drovr icon, an executable `resources/bin/board`, and `resources/app.asar.unpacked/out/main/board-cli.js`.
- **AC3 – macOS unchanged:** Given macOS, when `npm run dist` runs, then it builds `dist/drovr-<version>.dmg` as before, and no Linux package.
- **AC4 – Packaged app works on Linux:** Given `npm run pack` on Linux, when `npm run test:packaged` launches `dist/linux-unpacked`'s executable under xvfb, then the window opens, a workspace and a card can be created, and `board status . packaged` typed in the card shows `Running · packaged` on the card; `resources/bin/board` is executable and the unpacked CLI module exists.
- **AC5 – CI:** Given a pull request, when the `check` job runs, then after `check.sh` and the smoke tests it packs the Linux app and runs `npm run test:packaged`, and the job fails if any of it fails.
- **AC6 – Release:** Given a published release (or pre-release) on GitHub, when the release workflow runs, then a job on `ubuntu-latest` builds with `npm run dist` and attaches `drovr-<version>-x86_64.AppImage` and `drovr-<version>-amd64.deb` to that release, alongside the macOS job's .dmg; the jobs don't depend on each other. `actionlint` passes on the workflow.
- **AC7 – No menu bar off macOS:** Given Drovr running on Linux, when its window opens, then the menu bar isn't visible (`isMenuBarVisible()` false, auto-hide on); given macOS, the app menu is as before.
- **AC8 – Sandbox kept:** Given the packaging config and the packages, then no `--no-sandbox` (or other sandbox-disabling flag) appears in the electron-builder configuration, the desktop entry or the launcher; the window settings are unchanged.
- **AC9 – Docs:** Given the PR, then `docs/product.md` and README say macOS and Linux, README has the Install section with the .deb recommendation for Ubuntu 23.10+, the AppImage sandbox options and the FUSE 2 note, and AGENTS.md describes `npm run dist` per OS, `npm run test:packaged` and the release workflow's two jobs.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Menu bar off macOS:** auto-hide the default menu bar on non-macOS windows; a smoke test asserts it on Linux. Satisfies AC7.
2. **S2 – Linux packages:** electron-builder Linux targets (AppImage and .deb, x64), file names, .deb metadata and desktop entry; `npm run dist` builds for the current OS. Build both on Linux in the session and inspect the .deb. Satisfies AC1, AC2, AC3, AC8.
3. **S3 – Packaged check in CI:** `npm run test:packaged` (pack, file checks, one launch of the unpacked app with a `board status` round trip), excluded from `test:smoke`; the `check` job runs it after the smoke tests. Satisfies AC4, AC5.
4. **S4 – Release job and docs:** the Linux job in `release.yml`; product.md, README (Install) and AGENTS.md updated. Satisfies AC6, AC9.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | manual in session | `npm run dist` on Linux; `ls dist` shows both files with the D4 names |
| AC2 | manual in session | `dpkg-deb -I` and `dpkg-deb -c` on the .deb; check fields and files |
| AC3 | config review | electron-builder config: the mac target and dmg name unchanged; `dist` script per OS. The developer checks the .dmg on the next release |
| AC4 | e2e (`npm run test:packaged`, its own Playwright spec launching the packaged executable) | `npm run pack && xvfb-run -a npm run test:packaged` |
| AC5 | CI | the PR's `check` job log shows the pack and the packaged test passing |
| AC6 | actionlint + workflow review | `actionlint`; read `release.yml`; the next published pre-release carries the AppImage and .deb |
| AC7 | e2e (smoke, Linux) | launch under xvfb; main reports `isMenuBarVisible()` false and auto-hide on |
| AC8 | config review | grep packaging config, desktop entry and launcher for sandbox flags |
| AC9 | review | read product.md, README, AGENTS.md |

The developer checks by hand, on the next pre-release: the .deb installs on an Ubuntu desktop, Drovr starts from the app menu with the sandbox on, and a card's shell and `board` work; the .dmg is unchanged.

## Stack changes

None. electron-builder already builds the .dmg and gains Linux targets; no new dependency, service or secret.

## Data and migrations

None. On Linux the data directory is Electron's `userData` (`~/.config/Drovr`), as it already is when the app runs there.

## Out of scope

- Windows builds and the Windows port: #27.
- arm64 Linux, .rpm, .tar.gz, snap, flatpak, a Linux repository or auto-update.
- Signing Linux packages; macOS signing and notarization (#15).
- A custom application menu on any platform.
- Shipping an AppArmor profile, or any change that relaxes Chromium's sandbox.

## Open questions

None.
