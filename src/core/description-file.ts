/**
 * Reading a description from a file or stdin for `board` (#69 D5). Plain Node: the CLI reads the
 * text, so the request carries it, and checks it against D1 before sending anything.
 */
import { readFile } from 'node:fs/promises'
import { checkDescription } from './card-description'

/** `-` names standard input (#69 D5). */
export const STDIN_PATH = '-'

/** The description to send ('' for none), or the error to print, exit 1. */
export type DescriptionFile = { ok: true; description: string } | { ok: false; error: string }

/** All of standard input, as bytes. */
export async function readProcessStdin(): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer))
  }
  return Buffer.concat(chunks)
}

/**
 * The description in `path` (`-` reads `readStdin`): UTF-8 text, trailing whitespace trimmed, ''
 * when empty. Unreadable, not UTF-8 or over `MAX_DESCRIPTION_LENGTH` is refused.
 */
export async function readDescriptionFile(
  path: string,
  readStdin: () => Promise<Uint8Array> = readProcessStdin
): Promise<DescriptionFile> {
  const name = path === STDIN_PATH ? 'stdin' : path
  let bytes: Uint8Array
  try {
    bytes = path === STDIN_PATH ? await readStdin() : await readFile(path)
  } catch {
    return { ok: false, error: `board: can't read ${name}` }
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return { ok: false, error: `board: ${name} is not UTF-8 text` }
  }
  const checked = checkDescription(text)
  if (!checked.ok) return { ok: false, error: `board: ${checked.error.message}` }
  return { ok: true, description: checked.value ?? '' }
}
