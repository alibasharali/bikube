/**
 * Open pull request from a worktree card (#38): push the card's live branch with #33's `push`,
 * then the GitHub page for a new pull request on it. Plain TS with git injected (`Git`), so
 * Vitest drives real throwaway repositories; main opens the URL (D3).
 */

import { currentBranch, push, type Git } from './git'

/** An owner's or repository's name on GitHub (D4). */
const NAME = '[A-Za-z0-9._-]+?'
/** `/<owner>/<repo>`, with an optional `.git` and trailing `/`, to the end of the URL. */
const PATH = `/(${NAME})/(${NAME})(?:\\.git)?/?$`

/**
 * The remote URL forms accepted, on host `github.com` only (D4): `https://` with an optional
 * user, `git@github.com:`, and `ssh://git@github.com` with an optional port. The host is
 * case-insensitive; nothing may come between it and the path.
 */
const GITHUB_REMOTES = [
  new RegExp(`^https://(?:[^@/\\s]+@)?github\\.com${PATH}`, 'i'),
  new RegExp(`^git@github\\.com:${PATH.slice(1)}`, 'i'),
  new RegExp(`^ssh://git@github\\.com(?::\\d+)?${PATH}`, 'i')
]

/** The `owner` and `repo` of a GitHub remote URL (D4); null for any other URL. */
export function githubRepository(url: string): { owner: string; repo: string } | null {
  for (const pattern of GITHUB_REMOTES) {
    const match = pattern.exec(url.trim())
    if (!match) continue
    const [owner, repo] = [match[1]!, match[2]!]
    if ([owner, repo].some((name) => name === '.' || name === '..')) return null
    return { owner, repo }
  }
  return null
}

/**
 * GitHub's page for a new pull request from `branch` (D3, D4): its compare page with no base, so
 * GitHub targets the default branch; each `/`-separated part of the branch percent-encoded, the
 * `/`s kept. Null when `remoteUrl` isn't a GitHub remote.
 */
export function compareUrl(remoteUrl: string, branch: string): string | null {
  const repository = githubRepository(remoteUrl)
  if (!repository) return null
  const path = branch.split('/').map(encodeURIComponent).join('/')
  return `https://github.com/${repository.owner}/${repository.repo}/compare/${path}?expand=1`
}

export const NOT_GITHUB = 'Not a GitHub remote: open the pull request on its site'

export const OPENED_NOTE = 'Pushed · opened in the browser'

/** Open pull request's outcome: the URL to open after a push, else why nothing opens. */
export type PullRequestResult = { ok: true; url: string } | { ok: false; reason: string }

/**
 * Open pull request's git step (D2, D3, D4), in the card's worktree `dir`: pushes its live branch
 * with #33's `push` (to its upstream, else to `origin` as its new upstream; never forced), then
 * builds the compare URL from the URL (`git remote get-url`) of the branch's upstream remote
 * (`branch.<branch>.remote`), else `origin`'s. A failed push is git's message and gives no URL; a
 * remote that isn't on GitHub stays pushed and reads `NOT_GITHUB`.
 */
export async function pushForPullRequest(dir: string, run: Git): Promise<PullRequestResult> {
  // Main queues this with every other git command for `dir`, so the branch can't change between
  // this read and the push's own.
  const branch = await currentBranch(dir, run)
  if (!branch) return { ok: false, reason: 'Not on a branch' }
  const pushed = await push(dir, run)
  if (!pushed.ok) return pushed
  const configured = await run(dir, ['config', '--get', `branch.${branch}.remote`])
  const name = configured.code === 0 ? configured.stdout.trim() : ''
  const remote = name && name !== '.' ? name : 'origin'
  const url = await run(dir, ['remote', 'get-url', '--', remote])
  const page = url.code === 0 && !url.timedOut ? compareUrl(url.stdout.trim(), branch) : null
  return page ? { ok: true, url: page } : { ok: false, reason: NOT_GITHUB }
}
