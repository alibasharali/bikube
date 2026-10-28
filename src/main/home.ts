import { homedir } from 'node:os'

/** The user's home as Bikube reads `~`: `BIKUBE_HOME_DIR` when set (tests), else the OS home. */
export const userHome = (): string => process.env['BIKUBE_HOME_DIR'] || homedir()
