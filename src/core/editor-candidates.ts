/**
 * Where Settings > Editor's VS Code, Cursor and Zed are looked for (#70 D1), and how its select
 * shows the ones not found (D2). Plain TS with no Node imports, so the renderer uses it too.
 */

import { EDITORS, type Editor } from './settings'

/** The editors found by their CLI rather than opened by the system or a custom command. */
export type NamedEditor = 'vscode' | 'cursor' | 'zed'
export const NAMED_EDITORS: readonly NamedEditor[] = ['vscode', 'cursor', 'zed']

/** The command a "not found" reason names (#55 D13): each editor's first command name. */
export const EDITOR_NAMES: Readonly<Record<NamedEditor, string>> = {
  vscode: 'code',
  cursor: 'cursor',
  zed: 'zed'
}

/** The names each editor's CLI goes by on the PATH, in order (Arch calls Zed `zeditor`). */
const COMMAND_NAMES: Readonly<Record<NamedEditor, readonly string[]>> = {
  vscode: ['code'],
  cursor: ['cursor'],
  zed: ['zed', 'zeditor']
}

/** Under `/Applications` and `~/Applications` on macOS. */
const MAC_BUNDLES: Readonly<Record<NamedEditor, string>> = {
  vscode: 'Visual Studio Code.app/Contents/Resources/app/bin/code',
  cursor: 'Cursor.app/Contents/Resources/app/bin/cursor',
  zed: 'Zed.app/Contents/MacOS/cli'
}

/** On Linux; `~/` is the home. */
const LINUX_PATHS: Readonly<Record<NamedEditor, readonly string[]>> = {
  vscode: [
    '/usr/share/code/bin/code',
    '/snap/bin/code',
    '/var/lib/flatpak/exports/bin/com.visualstudio.code',
    '~/.local/share/flatpak/exports/bin/com.visualstudio.code'
  ],
  cursor: ['~/.local/bin/cursor', '/opt/cursor/cursor', '/usr/bin/cursor'],
  zed: [
    '~/.local/bin/zed',
    '/var/lib/flatpak/exports/bin/dev.zed.Zed',
    '~/.local/share/flatpak/exports/bin/dev.zed.Zed'
  ]
}

/**
 * What `editor` is looked for as on `platform` (`process.platform`), in order, the first found
 * winning (D1): its command names on the login shell's PATH, then the absolute paths its
 * installers use, `~` being `home` (`BIKUBE_HOME_DIR`, else the OS home). Off macOS and Linux only
 * the names.
 */
export function editorCandidates(editor: NamedEditor, platform: string, home: string): string[] {
  const names = COMMAND_NAMES[editor]
  const homeDir = home.replace(/\/+$/, '')
  if (platform === 'darwin') {
    const name = EDITOR_NAMES[editor]
    return [
      ...names,
      `/Applications/${MAC_BUNDLES[editor]}`,
      `${homeDir}/Applications/${MAC_BUNDLES[editor]}`,
      `/opt/homebrew/bin/${name}`,
      `/usr/local/bin/${name}`
    ]
  }
  if (platform === 'linux') {
    return [
      ...names,
      ...LINUX_PATHS[editor].map((path) =>
        path.startsWith('~/') ? `${homeDir}${path.slice(1)}` : path
      )
    ]
  }
  return [...names]
}

export const EDITOR_LABELS: Readonly<Record<Editor, string>> = {
  vscode: 'VS Code',
  cursor: 'Cursor',
  zed: 'Zed',
  system: 'System default',
  custom: 'Custom command'
}

export interface EditorChoice {
  value: Editor
  label: string
  disabled: boolean
}

const isNamed = (editor: Editor): editor is NamedEditor =>
  (NAMED_EDITORS as readonly string[]).includes(editor)

/**
 * The Open files with select's options (D2): an editor `installed` lacks reads
 * `<Name> (not installed)` and is disabled, unless it is the `saved` choice; System default and
 * Custom command never are; nothing is marked while `installed` is unknown (null).
 */
export function editorChoices(
  installed: ReadonlySet<NamedEditor> | null,
  saved: Editor
): EditorChoice[] {
  return EDITORS.map((value) => {
    const missing = installed !== null && isNamed(value) && value !== saved && !installed.has(value)
    return {
      value,
      label: missing ? `${EDITOR_LABELS[value]} (not installed)` : EDITOR_LABELS[value],
      disabled: missing
    }
  })
}
