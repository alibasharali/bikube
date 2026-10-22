/**
 * How a local shell starts with Bikube's shell integration (#45 D3, D4). Plain TS: main resolves
 * the scripts folder (`resources/shell-integration`) and passes the environment it starts from.
 *
 * - zsh: `-l` with `ZDOTDIR` set to `<scripts>/zsh`, the user's own in `BIKUBE_ZDOTDIR` (absent
 *   when unset); that `.zshenv` puts it back at once.
 * - bash: `--init-file <scripts>/bash/bikube.bash`, which reads the login files itself.
 * - fish: `-l` with `<scripts>` first in `XDG_DATA_DIRS` (the XDG defaults after it when it was
 *   unset), the old value in `BIKUBE_XDG_DATA_DIRS` ('' for unset); its `fish/vendor_conf.d`
 *   script puts it back.
 *
 * Any other shell, an SSH card's local shell (it only runs `command`) and the setting off start
 * as before: `-l` and no added variables.
 */

export interface ShellStart {
  /** The arguments of an interactive shell (an SSH card's `command` keeps its own). */
  args: string[]
  /** Variables added to the shell's environment. */
  env: Record<string, string>
}

export interface ShellIntegrationOptions {
  /** The Shell integration setting. */
  enabled: boolean
  /** Bikube's `shell-integration` folder. */
  scriptsDir: string
  /** The environment the shell would inherit. */
  env: Record<string, string | undefined>
  /** An SSH card's `exec ssh …` line: that shell gets no integration (D4). */
  command?: string
}

const PLAIN: ShellStart = { args: ['-l'], env: {} }

/** XDG's default data folders, which an unset `XDG_DATA_DIRS` means. */
const XDG_DATA_DEFAULTS = '/usr/local/share:/usr/share'

export function shellIntegrationStart(shell: string, options: ShellIntegrationOptions): ShellStart {
  const { enabled, scriptsDir, env, command } = options
  if (!enabled || command !== undefined) return { ...PLAIN, env: {} }
  switch (shell.slice(shell.lastIndexOf('/') + 1)) {
    case 'zsh':
      return {
        args: ['-l'],
        env: {
          ZDOTDIR: `${scriptsDir}/zsh`,
          ...(env['ZDOTDIR'] !== undefined && { BIKUBE_ZDOTDIR: env['ZDOTDIR'] })
        }
      }
    case 'bash':
      return { args: ['--init-file', `${scriptsDir}/bash/bikube.bash`], env: {} }
    case 'fish': {
      const dirs = env['XDG_DATA_DIRS'] ?? ''
      return {
        args: ['-l'],
        env: {
          XDG_DATA_DIRS: `${scriptsDir}:${dirs === '' ? XDG_DATA_DEFAULTS : dirs}`,
          BIKUBE_XDG_DATA_DIRS: dirs
        }
      }
    }
    default:
      return { ...PLAIN, env: {} }
  }
}
