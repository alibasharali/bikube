/**
 * The logos a workspace can show in its sidebar badge (#59 D1): a fixed list of lucide icons, in
 * the picker's order. Plain TS, ids and labels only; the renderer maps each id to its icon. An id
 * is the icon's kebab-case lucide name and is what the saved and sync files hold.
 */

export const WORKSPACE_LOGOS = [
  { id: 'rocket', label: 'Rocket' },
  { id: 'code', label: 'Code' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'globe', label: 'Globe' },
  { id: 'database', label: 'Database' },
  { id: 'server', label: 'Server' },
  { id: 'cpu', label: 'Chip' },
  { id: 'bug', label: 'Bug' },
  { id: 'flask-conical', label: 'Flask' },
  { id: 'book', label: 'Book' },
  { id: 'briefcase', label: 'Briefcase' },
  { id: 'box', label: 'Box' },
  { id: 'cloud', label: 'Cloud' },
  { id: 'zap', label: 'Lightning' },
  { id: 'flame', label: 'Flame' },
  { id: 'leaf', label: 'Leaf' },
  { id: 'heart', label: 'Heart' },
  { id: 'star', label: 'Star' },
  { id: 'music', label: 'Music' },
  { id: 'camera', label: 'Camera' },
  { id: 'gamepad-2', label: 'Game controller' },
  { id: 'shield', label: 'Shield' },
  { id: 'wrench', label: 'Wrench' },
  { id: 'palette', label: 'Palette' }
] as const

export type WorkspaceLogoId = (typeof WORKSPACE_LOGOS)[number]['id']

/** Whether `value` is one of the list's ids. */
export function isWorkspaceLogo(value: unknown): value is WorkspaceLogoId {
  return WORKSPACE_LOGOS.some((logo) => logo.id === value)
}
