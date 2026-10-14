/**
 * The sync status main owns and sends to the renderer (#13 D13). Plain TS, shared by main and the
 * renderer.
 */

export type SyncStatus =
  | { kind: 'off' }
  /** `at` is the ISO time of the last successful read or write. */
  | { kind: 'synced'; folder: string; at: string }
  | { kind: 'unavailable'; folder: string }
  | { kind: 'unreadable'; folder: string }

/** The folder sync uses, or null when it is off. */
export function syncFolderOf(status: SyncStatus): string | null {
  return status.kind === 'off' ? null : status.folder
}

/** The one-line text for the sidebar and Settings, or null when sync is off. */
export function syncStatusText(status: SyncStatus): string | null {
  switch (status.kind) {
    case 'off':
      return null
    case 'synced': {
      const at = new Date(status.at)
      const pad = (n: number): string => String(n).padStart(2, '0')
      return `Synced ${pad(at.getHours())}:${pad(at.getMinutes())}`
    }
    case 'unavailable':
      return 'Sync folder unavailable'
    case 'unreadable':
      return 'Sync file unreadable'
  }
}
