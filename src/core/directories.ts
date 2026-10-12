import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

export const MAX_PATH_LENGTH = 4096

/** A path argument from the renderer: non-empty, absolute, bounded, no NUL. */
export function isPathArg(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    path.length <= MAX_PATH_LENGTH &&
    !path.includes('\0') &&
    isAbsolute(path)
  )
}

export interface StatFs {
  stat(path: string): Promise<{ isDirectory(): boolean }>
}

/** True only for an existing directory; invalid arguments and any fs error give false. */
export async function isDirectory(path: unknown, fsImpl: StatFs = { stat }): Promise<boolean> {
  if (!isPathArg(path)) return false
  try {
    return (await fsImpl.stat(path)).isDirectory()
  } catch {
    return false
  }
}
