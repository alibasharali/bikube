/**
 * A worktree card's pull request, read through the user's own `gh` (#38 D7, D8). Plain TS with
 * the process spawner injected, so Vitest runs real login shells on a fake `gh`.
 */

import type { spawn as nodeSpawn } from 'node:child_process'

/** An open pull request's CI (D8): null when it has no checks. */
export type CiState = 'passing' | 'failing' | 'pending'

/** A check run's conclusions that read as failing (D8). */
const FAILED_CONCLUSIONS = new Set([
  'FAILURE',
  'CANCELLED',
  'TIMED_OUT',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE'
])

/**
 * The CI state of `gh`'s `statusCheckRollup` (D8): any failed check run or failed or errored
 * status context is failing; else any run not completed or context pending or expected is
 * pending; else (all success, neutral or skipped) passing; an empty rollup has none.
 */
export function ciState(rollup: unknown): CiState | null {
  if (!Array.isArray(rollup) || rollup.length === 0) return null
  let pending = false
  for (const check of rollup as unknown[]) {
    if (typeof check !== 'object' || check === null) continue
    const { __typename, state, status, conclusion } = check as Record<string, unknown>
    const isContext =
      __typename === 'StatusContext' || (__typename === undefined && 'state' in check)
    if (isContext) {
      if (state === 'FAILURE' || state === 'ERROR') return 'failing'
      if (state === 'PENDING' || state === 'EXPECTED') pending = true
    } else {
      if (typeof conclusion === 'string' && FAILED_CONCLUSIONS.has(conclusion)) return 'failing'
      if (status !== 'COMPLETED') pending = true
    }
  }
  return pending ? 'pending' : 'passing'
}

/** What a pull request reads as on the card (D8). */
export interface PullRequestStatus {
  number: number
  state: 'open' | 'merged' | 'closed'
  /** `https://github.com/<owner>/<repo>/pull/<number>`, checked. */
  url: string
  /** An open PR's CI; null for one without checks, and for a merged or closed one. */
  ci: CiState | null
}

/** A read of a worktree's PR (D9): the branch it was read for, and its PR or null for none. */
export interface PullRequestRead {
  branch: string
  pr: PullRequestStatus | null
}

const STATES: Record<string, PullRequestStatus['state']> = {
  OPEN: 'open',
  MERGED: 'merged',
  CLOSED: 'closed'
}

/** An owner's or repository's name on GitHub (as #38 D4 accepts them). */
const NAME = '[A-Za-z0-9._-]+'
const PULL_URL = new RegExp(`^https://github\\.com/(${NAME})/(${NAME})/pull/([1-9][0-9]*)$`)

/**
 * `gh pr view --json number,state,url,statusCheckRollup`'s output as a pull request (D7, D8);
 * null for anything else, including a `url` that isn't this PR's page on github.com, so the URL
 * is safe to open. Only gh's JSON is read: its last non-empty line starting with `{` (gh prints
 * one compact line when stdout isn't a terminal), so whatever a login profile printed before it
 * is skipped.
 */
export function parsePullRequest(text: string): PullRequestStatus | null {
  const line = text
    .split('\n')
    .map((each) => each.trim())
    .filter((each) => each.startsWith('{'))
    .pop()
  if (line === undefined) return null
  let data: unknown
  try {
    data = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const { number, state, url, statusCheckRollup } = data as Record<string, unknown>
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0) return null
  const read = typeof state === 'string' ? STATES[state] : undefined
  if (read === undefined || typeof url !== 'string') return null
  const match = PULL_URL.exec(url)
  if (!match || Number(match[3]) !== number) return null
  if ([match[1], match[2]].some((name) => name === '.' || name === '..')) return null
  return { number, state: read, url, ci: read === 'open' ? ciState(statusCheckRollup) : null }
}

/** Shells that take POSIX `sh -c 'text' $0 $1…` (as opening a file in an editor, #55 D15). */
const POSIX_SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'oksh', 'yash', 'ash'])

/** gh's arguments before the branch: the fields read, then `--` so the branch is never an option. */
const GH_VIEW = ['pr', 'view', '--json', 'number,state,url,statusCheckRollup', '--']

/**
 * How `gh pr view` runs for `branch` through the login shell `shell` (D7, #55 D15): the command
 * and the branch are positional arguments, never in the text the shell parses; fish gets `$argv`,
 * a shell with neither syntax is replaced by `/bin/sh -l`.
 */
export function ghPlan(shell: string, branch: string): { command: string; args: string[] } {
  const flavour = shell.slice(shell.lastIndexOf('/') + 1)
  if (flavour === 'fish') {
    return {
      command: shell,
      args: ['-l', '-c', 'command -q $argv[1]; or exit 127; exec $argv', 'gh', ...GH_VIEW, branch]
    }
  }
  return {
    command: POSIX_SHELLS.has(flavour) ? shell : '/bin/sh',
    args: [
      '-l',
      '-c',
      'command -v "$1" >/dev/null 2>&1 || exit 127; exec "$@"',
      'bikube',
      'gh',
      ...GH_VIEW,
      branch
    ]
  }
}

/** Main's environment with gh never prompting, checking for updates or colouring (D7). */
export function ghEnv(base: Record<string, string | undefined>): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) if (value !== undefined) vars[key] = value
  return { ...vars, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' }
}

/** How long gh may take before its process group is killed and it reads as no PR (D7). */
export const GH_TIMEOUT_MS = 20_000

/** The most of gh's output kept; a PR's JSON is far smaller. */
const OUTPUT_MAX = 1024 * 1024

export interface GhDeps {
  spawn: typeof nodeSpawn
  /** The login shell (`editorShell`: the Shell setting, else `$SHELL`, else `/bin/sh`). */
  shell: string
  /** Main's environment; gh's variables are added (`ghEnv`). */
  env: Record<string, string | undefined>
  /** `GH_TIMEOUT_MS` unless given. */
  timeoutMs?: number
}

/**
 * `branch`'s pull request as the user's `gh` sees it from `dir` (D7): run through the login
 * shell, detached (its own process group, killed at the timeout), stdin closed. Any failure (gh
 * missing, a non-zero exit, a timeout, output that isn't a PR) is null; nothing is reported.
 */
export function readPullRequest(
  dir: string,
  branch: string,
  { spawn, shell, env, timeoutMs = GH_TIMEOUT_MS }: GhDeps
): Promise<PullRequestStatus | null> {
  const plan = ghPlan(shell, branch)
  return new Promise((done) => {
    let settled = false
    const finish = (result: PullRequestStatus | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      done(result)
    }
    let child: ReturnType<typeof nodeSpawn>
    try {
      child = spawn(plan.command, plan.args, {
        cwd: dir,
        env: ghEnv(env),
        shell: false,
        detached: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true
      })
    } catch {
      done(null)
      return
    }
    const timer = setTimeout(() => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
      finish(null)
    }, timeoutMs)
    let stdout = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < OUTPUT_MAX) stdout += chunk
    })
    child.on('error', () => finish(null))
    child.on('close', (code) => finish(code === 0 ? parsePullRequest(stdout) : null))
  })
}
