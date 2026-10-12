/**
 * Pure logic behind the create/edit workspace dialog (D6, D7): name defaulting and draft
 * validation. The directory check is async (main process), so it is injected.
 */
import { basename } from './workspace-store'

export interface WorkspaceDraft {
  name: string
  directory: string
  /** True once the user typed a non-empty name; while false the name follows the folder. */
  nameTouched: boolean
}

export interface DraftErrors {
  name?: string
  directory?: string
}

export type DraftResult =
  { ok: true; value: { name: string; directory: string } } | { ok: false; errors: DraftErrors }

export interface DraftContext {
  /** Names of the other workspaces (exclude the one being edited). */
  existingNames: string[]
  isDirectory: (path: string) => Promise<boolean>
}

export const emptyDraft = (): WorkspaceDraft => ({ name: '', directory: '', nameTouched: false })

/** The user typed in the Name field. Clearing it hands the name back to the folder default. */
export function applyName(draft: WorkspaceDraft, name: string): WorkspaceDraft {
  return { ...draft, name, nameTouched: name.length > 0 }
}

/** The path changed (typed or picked). Defaults Name to the basename while untouched. */
export function applyDirectory(draft: WorkspaceDraft, directory: string): WorkspaceDraft {
  return draft.nameTouched
    ? { ...draft, directory }
    : { ...draft, directory, name: basename(directory.trim()) }
}

export async function validateDraft(
  input: { name: string; directory: string },
  ctx: DraftContext
): Promise<DraftResult> {
  const name = input.name.trim()
  const directory = input.directory.trim()
  const errors: DraftErrors = {}

  if (!name) errors.name = 'Name is required'
  else if (ctx.existingNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
    errors.name = 'A workspace with this name already exists'
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
