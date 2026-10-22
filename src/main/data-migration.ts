import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { migrateDataDir, oldDataDir } from '../core/data-migration'

/**
 * Moves Drovr's data folder to Bikube's at the first launch after the rename. Runs before the
 * single-instance lock, which lives in that folder; a test's own data folder is never touched.
 */
export function moveOldData(): void {
  if (process.env['BIKUBE_USER_DATA_DIR']) return
  const to = app.getPath('userData')
  const from = oldDataDir(to)
  if (!from) return
  try {
    const result = migrateDataDir({
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
    if (result === 'in use') console.error(`${from} not moved: Drovr is still running`)
  } catch (err) {
    console.error(`${from} not moved to ${to}: ${String(err)}`)
  }
}
