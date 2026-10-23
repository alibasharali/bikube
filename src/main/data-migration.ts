import { app, dialog } from 'electron'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { moveOrRefuse, oldDataDir } from '../core/data-migration'

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
    isAlive: (pid) => {
      try {
        process.kill(pid, 0)
        return true
      } catch (err) {
        // EPERM: it runs, as another user.
        return (err as NodeJS.ErrnoException).code === 'EPERM'
      }
    }
  })
  if (outcome.start) return true
  // Shown before ready on purpose: nothing may create the new folder first.
  dialog.showErrorBox('Bikube can’t start yet', outcome.message)
  return false
}
