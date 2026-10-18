/**
 * The title bar's branch menu (#33): reads a folder's local and remote branches and switches
 * between them. Plain TS with git injected (`GitRunner`), so Vitest drives real throwaway
 * repositories. Every command gets the same no-prompt environment and timeout (D12): main runs
 * it with `execFile`, no shell, stdin closed.
 */

/** One git command: its arguments (never through a shell), folder, environment and time limit. */
export interface GitCall {
  args: string[]
  cwd: string
  env: Record<string, string>
  timeoutMs: number
}

export interface GitOutput {
  code: number
  stdout: string
  stderr: string
  /** Killed at `timeoutMs`. */
  timedOut?: boolean
}

/** Runs `git` with the call's arguments; never throws. */
export type GitRunner = (call: GitCall) => Promise<GitOutput>

/** A git command's whole time (D12): long enough for a slow fetch, short of a hung prompt. */
export const GIT_TIMEOUT_MS = 2 * 60 * 1000

export const CREDENTIAL_HINT = 'Set up an SSH key or a git credential helper for this remote.'

/** How long git's message may be in the menu's error line (D6). */
const MESSAGE_MAX = 400

/**
 * `base` (main's environment) with every way git or ssh could ask for input turned off (D12): no
 * terminal prompt, no askpass program (an empty one counts as none), ssh in batch mode. The user's
 * own ssh is kept, in git's order: `GIT_SSH_COMMAND`, else the folder's `core.sshCommand`
 * (`sshCommand`), each with `-o BatchMode=yes` added; else `GIT_SSH` is left alone; else plain
 * `ssh`. Keys in an agent and credential helpers still work.
 */
export function gitEnv(
  base: Record<string, string | undefined>,
  sshCommand: string | null = null
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) if (value !== undefined) env[key] = value
  const ssh =
    base.GIT_SSH_COMMAND?.trim() || sshCommand?.trim() || (base.GIT_SSH?.trim() ? null : 'ssh')
  return {
    ...env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    SSH_ASKPASS_REQUIRE: 'never',
    GCM_INTERACTIVE: 'never',
    ...(ssh ? { GIT_SSH_COMMAND: `${ssh} -o BatchMode=yes` } : {})
  }
}

/** Runs one git command in `dir` with the no-prompt environment and the timeout. */
export type Git = (dir: string, args: string[]) => Promise<GitOutput>

/**
 * A `Git` over `runner`, with `base` as the environment to start from. Without `GIT_SSH_COMMAND`
 * in `base`, each command first reads `core.sshCommand` in its folder (with no ssh involved).
 */
export function gitIn(runner: GitRunner, base: Record<string, string | undefined> = {}): Git {
  const plain = gitEnv(base)
  const call = (cwd: string, args: string[], env: Record<string, string>): Promise<GitOutput> =>
    runner({ args, cwd, env, timeoutMs: GIT_TIMEOUT_MS })
  return async (cwd, args) => {
    if (base.GIT_SSH_COMMAND?.trim()) return call(cwd, args, plain)
    const config = await call(cwd, ['config', '--get', 'core.sshCommand'], plain)
    const sshCommand = config.code === 0 ? config.stdout.trim() || null : null
    return call(cwd, args, sshCommand ? gitEnv(base, sshCommand) : plain)
  }
}

export interface RemoteBranches {
  /** The remote's name, e.g. `origin`. */
  name: string
  /** Its branches without the remote's prefix and without `HEAD`, sorted by name. */
  branches: string[]
}

export interface BranchList {
  /** The checked-out branch; null on a detached HEAD. */
  current: string | null
  /** Every local branch, sorted by name with the current one first. */
  local: string[]
  /** One entry per remote, sorted by name; each as the last fetch left it. */
  remotes: RemoteBranches[]
}

export type GitResult = { ok: true } | { ok: false; reason: string }

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** The branches of the repository `dir` is in, or null outside one (or without git). */
export async function listBranches(dir: string, run: Git): Promise<BranchList | null> {
  const inside = await run(dir, ['rev-parse', '--is-inside-work-tree'])
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') return null
  const [head, refs, remotes] = await Promise.all([
    run(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    run(dir, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']),
    run(dir, ['remote'])
  ])
  const current = head.code === 0 ? head.stdout.trim() || null : null
  const names = refs.code === 0 ? refs.stdout.split('\n').filter(Boolean) : []
  const local = names
    .filter((ref) => ref.startsWith('refs/heads/'))
    .map((ref) => ref.slice('refs/heads/'.length))
    .sort((a, b) => (a === current ? -1 : b === current ? 1 : byName(a, b)))
  // Longest remote names first, so `up/stream` wins over `up` for `refs/remotes/up/stream/x`.
  const remoteNames = (remotes.code === 0 ? remotes.stdout.split('\n') : [])
    .map((name) => name.trim())
    .filter(Boolean)
  const byLength = [...remoteNames].sort((a, b) => b.length - a.length)
  const branches = new Map<string, string[]>(remoteNames.map((name) => [name, []]))
  for (const ref of names) {
    if (!ref.startsWith('refs/remotes/')) continue
    const rest = ref.slice('refs/remotes/'.length)
    const remote = byLength.find((name) => rest.startsWith(`${name}/`))
    if (!remote) continue
    const branch = rest.slice(remote.length + 1)
    if (branch && branch !== 'HEAD') branches.get(remote)!.push(branch)
  }
  return {
    current,
    local,
    remotes: remoteNames
      .sort(byName)
      .map((name) => ({ name, branches: branches.get(name)!.sort(byName) }))
  }
}

/**
 * Switches `dir`'s repository to the local `branch` (D4); only a branch `for-each-ref` lists is
 * run (D15). A refusal (changes it would overwrite, a branch checked out elsewhere) changes
 * nothing and gives git's message (D6).
 */
export async function switchBranch(dir: string, branch: string, run: Git): Promise<GitResult> {
  const list = await listBranches(dir, run)
  if (!list) return { ok: false, reason: 'not a git repository' }
  if (!list.local.includes(branch)) return { ok: false, reason: `No branch ${branch}` }
  if (branch === list.current) return { ok: true }
  return switchTo(dir, branch, run)
}

/** `git switch <branch>`, after `check-ref-format` (a name like `-f` would read as an option). */
async function switchTo(dir: string, branch: string, run: Git): Promise<GitResult> {
  if (!(await validBranchName(dir, branch, run))) return { ok: false, reason: INVALID_NAME }
  return outcome(await run(dir, ['switch', '--no-guess', branch]), 'switch')
}

const INVALID_NAME = 'Not a valid branch name'

/** Whether git takes `name` as a branch name (D15); S2's new branch check is the same. */
export async function validBranchName(dir: string, name: string, run: Git): Promise<boolean> {
  return (await run(dir, ['check-ref-format', '--branch', name])).code === 0
}

/**
 * Switches to `remote`'s `branch` (D5): to the local branch of that name when there is one, else
 * a new local branch tracking it (`git switch -c <branch> --track <remote>/<branch>`). Only a
 * remote branch `for-each-ref` lists is run (D15).
 */
export async function trackBranch(
  dir: string,
  remote: string,
  branch: string,
  run: Git
): Promise<GitResult> {
  const list = await listBranches(dir, run)
  if (!list) return { ok: false, reason: 'not a git repository' }
  const listed = list.remotes.find((r) => r.name === remote)?.branches.includes(branch)
  if (!listed) return { ok: false, reason: `No branch ${remote}/${branch}` }
  if (list.local.includes(branch)) {
    return branch === list.current ? { ok: true } : switchTo(dir, branch, run)
  }
  if (!(await validBranchName(dir, branch, run))) return { ok: false, reason: INVALID_NAME }
  const args = ['switch', '--no-guess', '-c', branch, '--track', `${remote}/${branch}`]
  return outcome(await run(dir, args), 'switch')
}

function outcome(output: GitOutput, command: string): GitResult {
  return output.code === 0 && !output.timedOut
    ? { ok: true }
    : { ok: false, reason: gitError(output, command) }
}

/**
 * What the menu's error line says when git fails (D6, D12): `git timed out`, else the meaningful
 * lines of git's stderr (no hints, no blank lines, without `error:`/`fatal:`) trimmed to 400
 * characters, followed by how to set up credentials when git needed some it couldn't ask for.
 */
export function gitError(output: GitOutput, command: string): string {
  if (output.timedOut) return 'git timed out'
  const lines = output.stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^hint:/.test(line))
    .map((line) => line.replace(/^(fatal|error):\s*/, ''))
  const text = lines.join('\n') || `git ${command} failed`
  const message = text.length > MESSAGE_MAX ? `${text.slice(0, MESSAGE_MAX - 1)}…` : text
  return needsCredentials(output.stderr) ? `${message}\n${CREDENTIAL_HINT}` : message
}

/** What git and ssh print when they would have had to ask for a password, passphrase or key. */
const CREDENTIAL_FAILURES = [
  /terminal prompts disabled/i,
  /could not read (username|password)/i,
  /authentication failed/i,
  /permission denied \(/i,
  /host key verification failed/i
]

function needsCredentials(stderr: string): boolean {
  return CREDENTIAL_FAILURES.some((pattern) => pattern.test(stderr))
}
