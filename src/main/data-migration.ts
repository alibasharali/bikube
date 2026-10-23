import { app, dialog } from 'electron'
import { execFileSync } from 'node:child_process'
import { homedir, hostname } from 'node:os'
import { moveOrRefuse, oldDataDir, runsOldApp } from '../core/data-migration'

/**
 * Moves Drovr's data folder to Bikube's at the first launch after the rename. Runs before the
 * single-instance lock, which lives in that folder; a test's own data folder is never touched.
 * False when the app must not start yet (the user was told why).
 */
export function moveOldData(): boolean {
  if (process.env['BIKUBE_USER_DATA_DIR']) return true
  const to = app.getPath('userData')
  const from = oldDataDir(to)
  if (!from) return true
  const outcome = moveOrRefuse({
    from,
    to,
    home: homedir(),
    git: (args, cwd) => {
      execFileSync('git', args, { cwd, stdio: 'ignore', timeout: 10_000 })
    },
    isOldApp: (host, pid) => runsOldApp(host, hostname(), commandOf(pid))
  })
  if (outcome.start) return true
  // Shown before ready on purpose: nothing may create the new folder first.
  dialog.showErrorBox('Bikube can’t start yet', outcome.message)
  return false
}

/** The command running as `pid` (`ps -o comm=`), `''` when none runs. */
function commandOf(pid: number): string {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'comm='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000
    }).trim()
  } catch {
    return ''
  }
}
