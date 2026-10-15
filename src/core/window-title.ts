/** The window's title (and the title bar's text) for where the user is. Plain TS. */

/** The open card and its workspace, the active workspace, or the app's name. */
export function windowTitle(
  workspace: { name: string } | null | undefined,
  card: { title: string } | null | undefined
): string {
  if (workspace && card) return `${card.title} — ${workspace.name}`
  return workspace?.name ?? 'Drovr'
}
