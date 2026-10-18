/**
 * Merge into the workspace branch from a worktree card (#38 D11, D12): merges the branch checked
 * out in the card's worktree into the workspace folder's current branch, locally. Plain TS with
 * git injected (`Git`), so Vitest drives real throwaway repositories; main queues it with the
 * workspace folder's other git commands.
 */

import { resolve } from 'node:path'
import { currentBranch, gitError, type Git, type GitOutput, type SyncResult } from './git'

/** The branches the confirmation named (D10): the card's and the workspace folder's. */
export interface MergeBranches {
  cardBranch: string
  branch: string
}

export const WORKSPACE_DIRTY =
  'The workspace folder has uncommitted changes: commit or stash them first'

const CARD_BRANCH_CHANGED: SyncResult = {
  ok: false,
  reason: "The card's branch changed: try again"
}
const BRANCH_CHANGED: SyncResult = {
  ok: false,
  reason: "The workspace folder's branch changed: try again"
}

const OTHER_REPOSITORY: SyncResult = {
  ok: false,
  reason: "The card's worktree is not in this repository"
}

/**
 * `dir`'s repository as git's absolute common directory (`--path-format=absolute`; a relative
 * answer from an older git is resolved against `dir`); null when git can't say.
 */
async function commonDir(dir: string, run: Git): Promise<string | null> {
  const out = await run(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const path = out.stdout.trim()
  return out.code === 0 && !out.timedOut && path !== '' ? resolve(dir, path) : null
}

/** How many conflicting files the error names before `and N more` (D11). */
const NAMED_CONFLICTS = 5

/** `a.txt, b.txt and 2 more`: at most `NAMED_CONFLICTS` names, then how many more. */
function conflictList(files: string[]): string {
  const named = files.slice(0, NAMED_CONFLICTS).join(', ')
  const more = files.length - NAMED_CONFLICTS
  return more > 0 ? `${named} and ${more} more` : named
}

/**
 * A failed merge's error, with the workspace folder put back as it was (D11): on a conflict
 * (files `git diff --name-only --diff-filter=U` lists) `git merge --abort` and the files named;
 * else git's message, aborting too should git have left a merge in progress.
 */
async function abandon(repoDir: string, merged: GitOutput, run: Git): Promise<SyncResult> {
  const unmerged = await run(repoDir, ['diff', '--name-only', '--diff-filter=U', '-z'])
  const files = unmerged.code === 0 ? unmerged.stdout.split('\0').filter(Boolean) : []
  const inProgress = await run(repoDir, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
  if (files.length > 0 || inProgress.code === 0) await run(repoDir, ['merge', '--abort'])
  return files.length > 0
    ? { ok: false, reason: `Merge conflict in ${conflictList(files)}: nothing was merged` }
    : { ok: false, reason: gitError(merged, 'merge') }
}

/**
 * Merges the branch checked out in the card's worktree `worktreeDir` into the workspace folder
 * `repoDir`'s current branch (D11), refusing a worktree of another repository (both folders'
 * git common directories must be the same), and unless both are still the ones `expected` names (D12)
 * and unless the workspace folder has no uncommitted changes to tracked files. Then `git merge
 * --no-edit refs/heads/<card branch>` (a full ref, so a name never reads as an option;
 * fast-forwarding when it can): `Merged <card branch> into <branch>`, or `Already up to date`
 * when HEAD didn't move. A failure leaves the folder as it was (`abandon`).
 */
export async function mergeCardBranch(
  repoDir: string,
  worktreeDir: string,
  expected: MergeBranches,
  run: Git
): Promise<SyncResult> {
  // The card's worktree must be one of the workspace folder's own (D12).
  const [worktreeRepo, repo] = [await commonDir(worktreeDir, run), await commonDir(repoDir, run)]
  if (worktreeRepo === null || worktreeRepo !== repo) return OTHER_REPOSITORY
  // The confirmation must merge exactly what it said (D12).
  if ((await currentBranch(worktreeDir, run)) !== expected.cardBranch) return CARD_BRANCH_CHANGED
  if ((await currentBranch(repoDir, run)) !== expected.branch) return BRANCH_CHANGED
  // Untracked files are left to git, which refuses itself if the merge would overwrite one.
  const status = await run(repoDir, ['status', '--porcelain', '--untracked-files=no'])
  if (status.code !== 0 || status.timedOut) return { ok: false, reason: gitError(status, 'status') }
  if (status.stdout.trim() !== '') return { ok: false, reason: WORKSPACE_DIRTY }
  const before = await run(repoDir, ['rev-parse', 'HEAD'])
  const merged = await run(repoDir, ['merge', '--no-edit', `refs/heads/${expected.cardBranch}`])
  if (merged.code !== 0 || merged.timedOut) return abandon(repoDir, merged, run)
  const after = await run(repoDir, ['rev-parse', 'HEAD'])
  const moved = !(before.code === 0 && after.code === 0 && before.stdout === after.stdout)
  return {
    ok: true,
    note: moved ? `Merged ${expected.cardBranch} into ${expected.branch}` : 'Already up to date'
  }
}
