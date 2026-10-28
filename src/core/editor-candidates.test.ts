import { describe, expect, it } from 'vitest'
import { editorCandidates, editorChoices, EDITOR_NAMES } from './editor-candidates'

describe('editorCandidates (#70 D1)', () => {
  it("looks on Linux for each editor's command names, then its installers' paths, ~ the given home", () => {
    expect(editorCandidates('vscode', 'linux', '/h/u/')).toEqual([
      'code',
      '/usr/share/code/bin/code',
      '/snap/bin/code',
      '/var/lib/flatpak/exports/bin/com.visualstudio.code',
      '/h/u/.local/share/flatpak/exports/bin/com.visualstudio.code'
    ])
    expect(editorCandidates('cursor', 'linux', '/h/u')).toEqual([
      'cursor',
      '/h/u/.local/bin/cursor',
      '/opt/cursor/cursor',
      '/usr/bin/cursor'
    ])
    expect(editorCandidates('zed', 'linux', '/h/u')).toEqual([
      'zed',
      'zeditor',
      '/h/u/.local/bin/zed',
      '/var/lib/flatpak/exports/bin/dev.zed.Zed',
      '/h/u/.local/share/flatpak/exports/bin/dev.zed.Zed'
    ])
  })

  it('looks on macOS in /Applications, ~/Applications, then Homebrew and /usr/local', () => {
    expect(editorCandidates('vscode', 'darwin', '/Users/u')).toEqual([
      'code',
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      '/Users/u/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      '/opt/homebrew/bin/code',
      '/usr/local/bin/code'
    ])
    expect(editorCandidates('cursor', 'darwin', '/Users/u')).toEqual([
      'cursor',
      '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
      '/Users/u/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
      '/opt/homebrew/bin/cursor',
      '/usr/local/bin/cursor'
    ])
    expect(editorCandidates('zed', 'darwin', '/Users/u')).toEqual([
      'zed',
      'zeditor',
      '/Applications/Zed.app/Contents/MacOS/cli',
      '/Users/u/Applications/Zed.app/Contents/MacOS/cli',
      '/opt/homebrew/bin/zed',
      '/usr/local/bin/zed'
    ])
  })

  it('looks only on the PATH elsewhere (no Windows paths)', () => {
    expect(editorCandidates('zed', 'win32', 'C:\\Users\\u')).toEqual(['zed', 'zeditor'])
  })

  it("names each editor's not-found reason by its first command", () => {
    expect(EDITOR_NAMES).toEqual({ vscode: 'code', cursor: 'cursor', zed: 'zed' })
  })
})

describe('editorChoices (#70 D2, AC3)', () => {
  it('marks the editors not found disabled, except the saved one; System and Custom always on', () => {
    expect(editorChoices(new Set(['zed']), 'vscode')).toEqual([
      { value: 'vscode', label: 'VS Code', disabled: false },
      { value: 'cursor', label: 'Cursor (not installed)', disabled: true },
      { value: 'zed', label: 'Zed', disabled: false },
      { value: 'system', label: 'System default', disabled: false },
      { value: 'custom', label: 'Custom command', disabled: false }
    ])
  })

  it('marks nothing while unknown (not answered yet, or the check failed)', () => {
    expect(
      editorChoices(null, 'system').every((c) => !c.disabled && !/not installed/.test(c.label))
    ).toBe(true)
  })
})
