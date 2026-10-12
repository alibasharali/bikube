/** Single character shown for a workspace when the sidebar is collapsed to a rail. */
export function workspaceInitial(name: string): string {
  const match = name.match(/[\p{L}\p{N}\p{Extended_Pictographic}]/u)
  return match ? match[0].toUpperCase() : '?'
}
