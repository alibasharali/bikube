/** The shells the Shell setting offers, and the one a local card starts. Plain TS. */

/** The shells listed in `/etc/shells`, in its order, without comments or duplicates. */
export function parseEtcShells(text: string): string[] {
  const shells: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    if (line.startsWith('/') && !shells.includes(line)) shells.push(line)
  }
  return shells
}

/** The shell a local card starts: the setting's path, else the login shell (`$SHELL`). */
export function shellToStart(setting: string, loginShell: string): string {
  return setting === '' ? loginShell : setting
}

/** Shells people install themselves, which `/etc/shells` often doesn't list (Homebrew's fish). */
const KNOWN_SHELLS = ['fish', 'zsh', 'bash', 'nu', 'pwsh', 'elvish', 'xonsh']

/** Where package managers put them: Homebrew on Apple silicon and Intel, the system, the user. */
function shellDirs(home: string): string[] {
  return ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', `${home}/.local/bin`]
}

/**
 * The shells to offer, before checking which exist: `/etc/shells`' first, then the known shells
 * in the usual install directories that it doesn't list.
 */
export function shellCandidates(etcShells: string, home: string): string[] {
  const shells = parseEtcShells(etcShells)
  for (const dir of shellDirs(home)) {
    for (const name of KNOWN_SHELLS) {
      const path = `${dir}/${name}`
      if (!shells.includes(path)) shells.push(path)
    }
  }
  return shells
}
