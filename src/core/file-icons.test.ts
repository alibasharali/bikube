import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileIcon, folderIcon } from './file-icons'
import table from './vscode-icons.json'

// The Files tab's vscode-icons, matched as VS Code matches an icon theme.

const ICONS = join(__dirname, '..', 'renderer', 'public', 'file-icons')

describe('fileIcon', () => {
  it('matches a whole file name before its extension, in any case', () => {
    expect(fileIcon('package.json', false)).toBe('file_type_npm.svg')
    expect(fileIcon('README.md', false)).toBe('file_type_readme.svg')
    expect(fileIcon('notes.md', false)).toBe('file_type_markdown.svg')
  })

  it('tries the longest dotted suffix first', () => {
    expect(fileIcon('board.spec.ts', false)).toBe('file_type_testts.svg')
    expect(fileIcon('api.d.ts', false)).toBe('file_type_typescriptdef.svg')
    expect(fileIcon('App.tsx', false)).toBe('file_type_reactts.svg')
  })

  it("falls back to a language's known file names and extensions", () => {
    expect(fileIcon('Dockerfile', false)).toBe('file_type_docker.svg')
    expect(fileIcon('main.ts', false)).toBe('file_type_typescript.svg')
  })

  it('gives anything unknown the default file icon, a dotfile included', () => {
    expect(fileIcon('THIRD_PARTY_NOTICES', false)).toBe('default_file.svg')
    expect(fileIcon('.weird-thing', false)).toBe('default_file.svg')
  })

  it('uses the light version only where the icon has one', () => {
    const light: Readonly<Record<string, boolean>> = table.fileLight
    const [name, withLight] = Object.entries(table.fileExtensions).find(([, icon]) => light[icon])!
    expect(fileIcon(`x.${name}`, true)).toBe(`file_type_light_${withLight}.svg`)
    expect(fileIcon(`x.${name}`, false)).toBe(`file_type_${withLight}.svg`)
    expect(fileIcon('notes.md', true)).toBe('file_type_markdown.svg')
  })
})

describe('folderIcon', () => {
  it('matches folder names, open and closed, and the root has its own', () => {
    expect(folderIcon('src', false, false)).toBe('folder_type_src.svg')
    expect(folderIcon('SRC', true, false)).toBe('folder_type_src_opened.svg')
    expect(folderIcon('.github', false, false)).toBe('folder_type_github.svg')
    expect(folderIcon('misc-stuff', true, false)).toBe('default_folder_opened.svg')
    expect(folderIcon('src', false, false, true)).toBe('default_root_folder.svg')
  })
})

describe('the imported table', () => {
  it('names only icons that are in public/file-icons', () => {
    const named = new Set<string>(['default_file.svg', 'default_folder.svg'])
    for (const icon of [
      ...Object.values(table.fileNames),
      ...Object.values(table.fileExtensions),
      ...Object.values(table.languageNames),
      ...Object.values(table.languageExtensions)
    ]) {
      named.add(fileIcon(`x.unused-${icon}`, false))
      named.add(`file_type_${icon}.svg`)
    }
    for (const icon of Object.keys(table.fileLight)) named.add(`file_type_light_${icon}.svg`)
    for (const icon of Object.values(table.folderNames)) {
      named.add(`folder_type_${icon}.svg`).add(`folder_type_${icon}_opened.svg`)
    }
    for (const icon of Object.keys(table.folderLight)) {
      named.add(`folder_type_light_${icon}.svg`).add(`folder_type_light_${icon}_opened.svg`)
    }
    const missing = [...named].filter((name) => !existsSync(join(ICONS, name)))
    expect(missing).toEqual([])
  })
})
