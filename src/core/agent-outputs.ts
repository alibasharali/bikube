/**
 * The files and artifacts the Agent tab's Files and artifacts group reads from a transcript (#79
 * D5–D7): document paths named in a command, a reply or a `Write`, and claude.ai artifact links.
 * Nothing here touches the disk (main checks each path, S2). No Node imports.
 */

/** D5: the extensions of files made for the user; code and text stay What changed's. */
export const OUTPUT_EXTENSIONS = [
  'pdf',
  'doc',
  'docx',
  'odt',
  'rtf',
  'pages',
  'xls',
  'xlsx',
  'ods',
  'csv',
  'tsv',
  'numbers',
  'ppt',
  'pptx',
  'odp',
  'key',
  'html',
  'htm',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'heic',
  'mp3',
  'wav',
  'mp4',
  'mov',
  'zip',
  'epub'
] as const

/** D6: a candidate is at most this long. */
const MAX_PATH = 300

const EXTENSIONS = OUTPUT_EXTENSIONS.join('|')

/** A path's start: `/`, `~/`, `$HOME/` or `${HOME}/` at a word's start or after a quote, `(`, `` ` `` or `=`. */
const START = /(?<=^|[\s"'(`=])(?:\/|~\/|\$HOME\/|\$\{HOME\}\/)/g

/** The first `.<extension>` followed by an end, a closing character or a sentence's punctuation. */
const END = new RegExp(`\\.(?:${EXTENSIONS})(?=$|[\\s"'\`)]|[.,;:!?](?:\\s|$))`, 'i')

const HAS_EXTENSION = new RegExp(`\\.(?:${EXTENSIONS})$`, 'i')

/** `$HOME/` and `${HOME}/` read as `~/`, so one file is one row; main expands `~` (S2). */
const homeForm = (path: string): string => path.replace(/^(?:\$HOME|\$\{HOME\})\//, '~/')

/** D7: scratch folders, Claude's own state, dependencies and hidden folders. */
const LEFT_OUT =
  /^(?:\/private)?\/(?:tmp|var\/folders)(?:\/|$)|^~\/\.claude(?:\/|$)|\/node_modules\/|\/\./

/**
 * `path` in the summary's form when it is an output (D1, D5, D7): absolute or from the home, with
 * an output extension, not left out; else null. A `Write`'s `file_path` goes through this as is.
 */
export function outputPath(path: string): string | null {
  const shown = homeForm(path)
  if (!shown.startsWith('/') && !shown.startsWith('~/')) return null
  if (!HAS_EXTENSION.test(shown) || LEFT_OUT.test(shown)) return null
  return shown
}

/**
 * D6: the output paths a command or reply names, in order, each once. Every start is tried on its
 * own, so a candidate running past another path's start never hides that path.
 */
export function outputPaths(text: string): string[] {
  const found: string[] = []
  for (const start of text.matchAll(START)) {
    const from = start.index
    const lineEnd = text.indexOf('\n', from)
    const line = text.slice(from, lineEnd === -1 ? undefined : lineEnd)
    const end = END.exec(line)
    if (!end) continue
    const length = end.index + end[0].length
    if (length > MAX_PATH) continue
    const path = outputPath(line.slice(0, length))
    if (path !== null && !found.includes(path)) found.push(path)
  }
  return found
}

/** A claude.ai artifact or doc link (D4). */
const ARTIFACT_URL = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/g

/** The artifact links `text` holds, in order, each once. */
export function artifactUrls(text: string): string[] {
  return [...new Set(text.match(ARTIFACT_URL) ?? [])]
}
