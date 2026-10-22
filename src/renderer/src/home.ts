/** The user's home folder, read from main once before the first render, for `~` in paths. */
let home = ''

export async function loadHomeDir(): Promise<void> {
  home = await window.bikube.app.home()
}

export function homeDir(): string {
  return home
}
