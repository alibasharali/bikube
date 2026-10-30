/**
 * Which agent CLIs the user has installed, so the startup selects can show the others disabled.
 * Read through the user's login shell, interactive too (`LOGIN_CHECK`), so it sees the PATH a
 * card's shell gets. Plain TS: main injects the process spawner, so Vitest runs real
 * shells on fake commands.
 */

import type { spawn as nodeSpawn } from 'node:child_process'
import { AGENT_KINDS, AGENT_PRESETS, type AgentKind } from './agent-presets'

/** The startup commands that run an agent, and the CLI each needs on the PATH. */
export type AgentChoice = 'claude' | AgentKind

export const AGENT_COMMANDS: Readonly<Record<AgentChoice, string>> = {
  claude: 'claude',
  ...(Object.fromEntries(AGENT_KINDS.map((kind) => [kind, AGENT_PRESETS[kind].plain])) as Record<
    AgentKind,
    string
  >)
}

/** Shells that take POSIX `sh -c 'text' $0 $1…`. */
const POSIX_SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'oksh', 'yash', 'ash'])

/**
 * A login shell that is interactive too, as a card's shell in its PTY is: zsh reads `.zshrc` only
 * then, and Claude Code's and Codex's installers put `~/.local/bin` on PATH there (#78). No
 * terminal: stdin is closed and the process detached, so a profile asking for input reads EOF.
 */
export const LOGIN_CHECK = ['-l', '-i', '-c'] as const

/** Each found command's line, so whatever a login profile prints is never read as one. */
const FOUND = 'bikube-found'

/**
 * The line a `LOGIN_CHECK` script prints last. An interactive rc file can `exec` another shell
 * (`[[ $- == *i* ]] && exec fish`), which then reads EOF and exits 0 having run none of the check:
 * without this line the output means nothing, not that nothing is installed.
 */
export const CHECK_DONE = 'bikube-done'

/** `stdout` when the check ran to its end (`CHECK_DONE`), else null. */
export function finishedCheck(stdout: string | null): string | null {
  return stdout !== null && stdout.split('\n').some((line) => line.trim() === CHECK_DONE)
    ? stdout
    : null
}

/**
 * How the login shell `shell` checks `commands`: they are positional arguments, never in the text
 * the shell parses; fish gets `$argv`, a shell with neither syntax is replaced by `/bin/sh -l`.
 */
export function installedPlan(
  shell: string,
  commands: readonly string[]
): { command: string; args: string[] } {
  const flavour = shell.slice(shell.lastIndexOf('/') + 1)
  if (flavour === 'fish') {
    return {
      command: shell,
      args: [
        ...LOGIN_CHECK,
        `for c in $argv; command -q $c; and printf '${FOUND} %s\\n' $c; end; printf '${CHECK_DONE}\\n'; true`,
        ...commands
      ]
    }
  }
  return {
    command: POSIX_SHELLS.has(flavour) ? shell : '/bin/sh',
    args: [
      ...LOGIN_CHECK,
      `for c in "$@"; do command -v "$c" >/dev/null 2>&1 && printf '${FOUND} %s\\n' "$c"; done; printf '${CHECK_DONE}\\n'; exit 0`,
      'bikube',
      ...commands
    ]
  }
}

/** The agents whose command the check's `stdout` found. */
export function parseInstalled(stdout: string): AgentChoice[] {
  const found = new Set(
    stdout
      .split('\n')
      .filter((line) => line.startsWith(`${FOUND} `))
      .map((line) => line.slice(FOUND.length + 1).trim())
  )
  return (Object.keys(AGENT_COMMANDS) as AgentChoice[]).filter((agent) =>
    found.has(AGENT_COMMANDS[agent])
  )
}

/** How long the check may take before it reads as unknown (a slow profile, a hung one). */
export const INSTALLED_TIMEOUT_MS = 15_000

export interface InstalledDeps {
  spawn: typeof nodeSpawn
  /** The login shell (`editorShell`: the Shell setting, else `$SHELL`, else `/bin/sh`). */
  shell: string
  env: Record<string, string | undefined>
  /** `INSTALLED_TIMEOUT_MS` unless given. */
  timeoutMs?: number
}

/**
 * Runs `plan` (a login shell's `LOGIN_CHECK`) and gives its stdout, or null when it failed (the
 * shell missing, a non-zero exit, a timeout). Detached (its own process group, killed at the
 * timeout), stdin closed, at most 64 KiB of output kept.
 */
export function runLoginShell(
  plan: { command: string; args: string[] },
  { spawn, env, timeoutMs = INSTALLED_TIMEOUT_MS }: Omit<InstalledDeps, 'shell'>
): Promise<string | null> {
  return new Promise((done) => {
    let settled = false
    const finish = (result: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      done(result)
    }
    let child: ReturnType<typeof nodeSpawn>
    try {
      child = spawn(plan.command, plan.args, {
        env,
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
      if (stdout.length < 64 * 1024) stdout += chunk
    })
    child.on('error', () => finish(null))
    child.on('close', (code) => finish(code === 0 ? stdout : null))
  })
}

/**
 * The installed agents, as the login shell finds their commands; null when the check failed
 * (the shell missing, a non-zero exit, a timeout, an rc file's `exec` cutting it short), so nothing is shown as not installed.
 */
export async function readInstalledAgents({
  shell,
  ...deps
}: InstalledDeps): Promise<AgentChoice[] | null> {
  const stdout = finishedCheck(
    await runLoginShell(installedPlan(shell, Object.values(AGENT_COMMANDS)), deps)
  )
  return stdout === null ? null : parseInstalled(stdout)
}
