/**
 * Pure logic behind the create/edit workspace dialog (D6, D7, #12 D4): name defaulting and draft
 * validation. The local directory check is async (main process), so it is injected.
 */
import { checkHost, checkRemoteDirectory } from './ssh-location'
import { defaultWorkspaceName } from './workspace-store'

/** The dialog's Location choice (#12 D4): `This computer` or `SSH`. */
export type WorkspaceLocation = 'local' | 'ssh'

export interface WorkspaceDraft {
  name: string
  directory: string
  /** True once the user typed a non-empty name; while false the name follows the folder. */
  nameTouched: boolean
  /** Defaults to `local`. */
  location?: WorkspaceLocation
  /** The Host field; only used while the location is `ssh`. */
  host?: string
}

export interface DraftErrors {
  name?: string
  directory?: string
  host?: string
}

/** `host` is present only for an SSH draft. */
export type DraftResult =
  | { ok: true; value: { name: string; directory: string; host?: string } }
  | { ok: false; errors: DraftErrors }

export interface DraftContext {
  /** Names of the other workspaces (exclude the one being edited). */
  existingNames: string[]
  isDirectory: (path: string) => Promise<boolean>
}

export const emptyDraft = (): WorkspaceDraft => ({
  name: '',
  directory: '',
  nameTouched: false,
  location: 'local',
  host: ''
})

/** The draft's host when it is an SSH draft, else null. */
const draftHost = (draft: WorkspaceDraft): string | null =>
  draft.location === 'ssh' ? (draft.host ?? '') : null

/** Re-defaults the name from the directory (and host) while the user hasn't typed one. */
const withDefaultName = (draft: WorkspaceDraft): WorkspaceDraft =>
  draft.nameTouched
    ? draft
    : { ...draft, name: defaultWorkspaceName(draft.directory, draftHost(draft)) }

/** The user typed in the Name field. Clearing it hands the name back to the folder default. */
export function applyName(draft: WorkspaceDraft, name: string): WorkspaceDraft {
  return { ...draft, name, nameTouched: name.length > 0 }
}

/** The path changed (typed or picked). Defaults Name to the basename while untouched. */
export function applyDirectory(draft: WorkspaceDraft, directory: string): WorkspaceDraft {
  return withDefaultName({ ...draft, directory })
}

/** The Host field changed; the name follows it while the directory is `~` (#12 D4). */
export function applyHost(draft: WorkspaceDraft, host: string): WorkspaceDraft {
  return withDefaultName({ ...draft, host })
}

/** The Location choice changed (#12 D4). */
export function applyLocation(draft: WorkspaceDraft, location: WorkspaceLocation): WorkspaceDraft {
  return withDefaultName({ ...draft, location })
}

export async function validateDraft(
  input: { name: string; directory: string; location?: WorkspaceLocation; host?: string },
  ctx: DraftContext
): Promise<DraftResult> {
  const name = input.name.trim()
  const directory = input.directory.trim()
  const errors: DraftErrors = {}

  if (!name) errors.name = 'Name is required'
  else if (ctx.existingNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
    errors.name = 'A workspace with this name already exists'
  }

  if (input.location === 'ssh') {
    // Host and remote directory rules only: the path is never checked locally (#12 D3).
    const host = checkHost(input.host ?? '')
    if (!host.ok) errors.host = host.message
    const remote = checkRemoteDirectory(directory)
    if (!remote.ok) errors.directory = remote.message
    return errors.name || !host.ok || !remote.ok
      ? { ok: false, errors }
      : { ok: true, value: { name, directory: remote.value, host: host.value } }
  }

  if (!directory) errors.directory = 'Working directory is required'
  else {
    const ok = await ctx.isDirectory(directory).catch(() => false)
    if (!ok) errors.directory = 'This path does not exist or is not a directory'
  }

  return errors.name || errors.directory
    ? { ok: false, errors }
    : { ok: true, value: { name, directory } }
}
