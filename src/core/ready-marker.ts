/**
 * Watches an SSH card's output for the ready marker (#12 D6), which the remote command prints
 * just before the remote login shell starts. Output arrives in chunks, so the marker can be
 * split across them. Plain TS.
 */
import { READY_MARKER } from './ssh-command'

/**
 * A watcher for one start: fed every output chunk in order, it returns true for the chunk in
 * which the marker first completes, and false for every other chunk, before and after.
 */
export function readyWatcher(): (data: string) => boolean {
  let tail = ''
  let seen = false
  return (data) => {
    if (seen) return false
    const text = tail + data
    if (text.includes(READY_MARKER)) {
      seen = true
      tail = ''
      return true
    }
    // Only the end that could still begin the marker is kept.
    tail = text.slice(-(READY_MARKER.length - 1))
    return false
  }
}
