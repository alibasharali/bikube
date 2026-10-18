import { useSyncExternalStore } from 'react'
import type { GitResult, NewBranchResult, SyncResult } from '../../core/git'
import { refreshBranch } from './branches'

/**
 * The branch menu's command in each folder (#33 D13), kept outside any chip: the title bar shows
 * a chip in more than one place and makes a new one when a card opens or closes, so what is
 * running and what the last command did must outlive them. Every chip for a folder shows its
 * busy label and disables its actions until it ends; a reopened menu shows its note or error.
 */
export interface GitRun {
  /** What is running (`Fetching…`), null when idle. */
  busy: string | null
  /** git's message when the last command failed, until the next one. */
  error: string | null
  /** What the last Fetch, Pull or Push did (`Fetched`), until the next command. */
  note: string | null
}

export type GitCommandResult = GitResult | NewBranchResult | SyncResult

const IDLE: GitRun = { busy: null, error: null, note: null }

const runs = new Map<string, GitRun>()
const listeners = new Set<() => void>()

function set(dir: string, run: GitRun): void {
  if (run.busy === null && run.error === null && run.note === null) runs.delete(dir)
  else runs.set(dir, run)
  for (const listener of [...listeners]) listener()
}

/** `dir`'s command and the last one's result. */
export function gitRun(dir: string): GitRun {
  return runs.get(dir) ?? IDLE
}

export function subscribeGitRuns(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Forgets the last command's note and error in `dir` (e.g. New branch shows its field). */
export function clearGitResult(dir: string): void {
  const run = gitRun(dir)
  if (run.error !== null || run.note !== null) set(dir, { ...run, error: null, note: null })
}

/**
 * Runs `command` as `dir`'s one command (D13): null, running nothing, while another runs there.
 * Busy with `label` meanwhile; afterwards the folder's note (a Fetch, Pull or Push) or error
 * (git's refusal, or a call that failed) is kept, a refused new branch name is left to the
 * caller, and the branch is read again at once. Never rejects.
 */
export async function runGit(
  dir: string,
  label: string,
  command: () => Promise<GitCommandResult>
): Promise<GitCommandResult | null> {
  if (gitRun(dir).busy !== null) return null
  set(dir, { busy: label, error: null, note: null })
  let result: GitCommandResult
  try {
    result = await command()
  } catch (error) {
    result = { ok: false, reason: error instanceof Error ? error.message : String(error) }
  } finally {
    refreshBranch(dir)
  }
  if (result.ok) set(dir, { busy: null, error: null, note: 'note' in result ? result.note : null })
  else if ('name' in result && result.name) set(dir, IDLE)
  else set(dir, { busy: null, error: result.reason, note: null })
  return result
}

/** `dir`'s command and the last one's result, for a chip. */
export function useGitRun(dir: string): GitRun {
  return useSyncExternalStore(subscribeGitRuns, () => gitRun(dir))
}
