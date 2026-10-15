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
