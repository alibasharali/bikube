/** The window's title (and the title bar's text) for where the user is. Plain TS. */

/** The open card and its workspace, the active workspace, or the app's name. */
export function windowTitle(
  workspace: { name: string } | null | undefined,
  card: { title: string } | null | undefined
): string {
  if (workspace && card) return `${card.title} — ${workspace.name}`
  return workspace?.name ?? 'Drovr'
}

/** A card window's title (#53 D4): its card (or shell) as shown, then its workspace. */
export function cardWindowTitle(workspace: { name: string }, card: { title: string }): string {
  return `${card.title} · ${workspace.name}`
}
