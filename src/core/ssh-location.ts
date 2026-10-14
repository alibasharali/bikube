/**
 * Where an SSH workspace's cards run (#12 D1): the host rule (D2) and the remote directory rule
 * (D3). Plain TS with no Electron or Node imports, so the dialog, the saved-state file and main's
 * spawn checks all run the same rules.
 */

export type LocationCheck = { ok: true; value: string } | { ok: false; message: string }

export const HOST_REQUIRED = 'Host is required'
export const HOST_INVALID = 'Enter a host as ssh takes it, e.g. me@devbox'
export const REMOTE_DIRECTORY_REQUIRED = 'Working directory is required'
export const REMOTE_DIRECTORY_INVALID = 'Enter an absolute path or one starting with ~'

const MAX_HOST = 255
const MAX_REMOTE_DIRECTORY = 4096

/** ASCII letters, digits and `. _ @ : / % [ ] -`, never starting with `-` (D2). */
const HOST_PATTERN = /^[A-Za-z0-9._@:/%[\]][A-Za-z0-9._@:/%[\]-]*$/

/** `/…`, `~` or `~/…` (D3). */
const REMOTE_PATH_PATTERN = /^(\/|~$|~\/)/

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

/** The trimmed host, or why it fails D2. */
export function checkHost(raw: string): LocationCheck {
  const host = raw.trim()
  if (!host) return { ok: false, message: HOST_REQUIRED }
  if (host.length > MAX_HOST || !HOST_PATTERN.test(host))
    return { ok: false, message: HOST_INVALID }
  return { ok: true, value: host }
}

/** The trimmed remote directory, or why it fails D3. It is never checked on the host. */
export function checkRemoteDirectory(raw: string): LocationCheck {
  const directory = raw.trim()
  if (!directory) return { ok: false, message: REMOTE_DIRECTORY_REQUIRED }
  if (
    directory.length > MAX_REMOTE_DIRECTORY ||
    !REMOTE_PATH_PATTERN.test(directory) ||
    CONTROL_CHARACTERS.test(directory)
  ) {
    return { ok: false, message: REMOTE_DIRECTORY_INVALID }
  }
  return { ok: true, value: directory }
}
