/**
 * The Files tab's icons (vscode-icons): which SVG in `public/file-icons` a file or folder gets,
 * matched as VS Code matches an icon theme. A file's whole name first, then its dotted suffixes
 * longest first (`a.spec.ts`: `spec.ts`, then `ts`), then a language's known file names and
 * extensions (`Dockerfile`); a folder by its name. Case never matters. The light version is used
 * where the icon has one. Plain TS with no Node imports: the renderer runs it. The table is built
 * by scripts/import-vscode-icons.mjs.
 */
import table from './vscode-icons.json'

type IconMap = Readonly<Record<string, string>>

const FILE_NAMES: IconMap = table.fileNames
const FILE_EXTENSIONS: IconMap = table.fileExtensions
const LANGUAGE_NAMES: IconMap = table.languageNames
const LANGUAGE_EXTENSIONS: IconMap = table.languageExtensions
const FILE_LIGHT: Readonly<Record<string, boolean>> = table.fileLight
const FOLDER_NAMES: IconMap = table.folderNames
const FOLDER_LIGHT: Readonly<Record<string, boolean>> = table.folderLight

/** `name`'s dotted suffixes, longest first: `.eslintrc.json` gives `eslintrc.json`, `json`. */
function suffixes(name: string): string[] {
  const parts = name.split('.')
  const out: string[] = []
  for (let i = 1; i < parts.length; i++) {
    const suffix = parts.slice(i).join('.')
    if (suffix !== '') out.push(suffix)
  }
  return out
}

/** The icon file for the file `name`. */
export function fileIcon(name: string, light: boolean): string {
  const lower = name.toLowerCase()
  const ends = suffixes(lower)
  const icon =
    FILE_NAMES[lower] ??
    ends.map((s) => FILE_EXTENSIONS[s]).find(Boolean) ??
    LANGUAGE_NAMES[lower] ??
    ends.map((s) => LANGUAGE_EXTENSIONS[s]).find(Boolean)
  if (icon === undefined) return 'default_file.svg'
  return light && FILE_LIGHT[icon] ? `file_type_light_${icon}.svg` : `file_type_${icon}.svg`
}

/** The icon file for the folder `name`, open or closed; the tree's root has its own. */
export function folderIcon(name: string, open: boolean, light: boolean, root = false): string {
  const opened = open ? '_opened' : ''
  if (root) return `default_root_folder${opened}.svg`
  const icon = FOLDER_NAMES[name.toLowerCase()]
  if (icon === undefined) return `default_folder${opened}.svg`
  return light && FOLDER_LIGHT[icon]
    ? `folder_type_light_${icon}${opened}.svg`
    : `folder_type_${icon}${opened}.svg`
}
