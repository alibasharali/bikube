#!/usr/bin/env node
// Builds the Files tab's icons from a vscode-icons checkout (github.com/vscode-icons/vscode-icons,
// MIT; keep THIRD_PARTY_NOTICES current): src/core/vscode-icons.json maps file names, extensions
// and folder names to icons, and src/renderer/public/file-icons/ holds the SVGs it names. The
// checkout's TypeScript manifests are parsed, never run. Usage:
// node scripts/import-vscode-icons.mjs <vscode-icons checkout>
/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS, no types to declare */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repo = process.argv[2]
if (!repo) {
  console.error('usage: node scripts/import-vscode-icons.mjs <vscode-icons checkout>')
  process.exit(1)
}
const manifests = join(repo, 'src', 'iconsManifest')
const icons = join(repo, 'icons')

/** The exported object `name` of a manifest file, read as plain data (`refs` resolves `a.b`). */
function exported(file, name, refs = {}) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest)
  const value = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const out = {}
      for (const p of node.properties) {
        if (!ts.isPropertyAssignment(p)) throw new Error(`${file}: unexpected ${p.getText(source)}`)
        out[p.name.getText(source).replace(/^['"]|['"]$/g, '')] = value(p.initializer)
      }
      return out
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(value)
    if (ts.isStringLiteralLike(node)) return node.text
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false
    if (ts.isPropertyAccessExpression(node)) {
      const [base, key] = [node.expression.getText(source), node.name.text]
      if (refs[base] && key in refs[base]) return refs[base][key]
      return `${base}.${key}`
    }
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return value(node.expression)
    throw new Error(`${file}: unexpected ${node.getText(source)}`)
  }
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const d of statement.declarationList.declarations) {
      if (d.name.getText(source) === name && d.initializer) return value(d.initializer)
    }
  }
  throw new Error(`${file}: no ${name}`)
}

const languages = exported(join(manifests, 'languages.ts'), 'languages')
const files = exported(join(manifests, 'supportedExtensions.ts'), 'extensions', { languages })
const folders = exported(join(manifests, 'supportedFolders.ts'), 'extensions')

const list = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v])
const svg = (name) => (existsSync(join(icons, name)) ? name : null)
const used = new Set()
const use = (name) => {
  if (!name) return null
  used.add(name)
  return name
}

// Files: names first, then extensions (longest first at lookup), then languages' known file
// names and extensions, as VS Code matches an icon theme's fileNames, fileExtensions and languageIds; a
// later entry wins over an earlier one, as the generated theme's keys do.
const fileNames = {}
const fileExtensions = {}
const languageExtensions = {}
const languageNames = {}
const fileLight = {}
for (const entry of files.supported) {
  if (entry.disabled) continue
  const dark = use(svg(`file_type_${entry.icon}.svg`))
  if (!dark) continue
  if (entry.light) {
    const light = use(svg(`file_type_light_${entry.icon}.svg`))
    if (light) fileLight[entry.icon] = true
  }
  const globbed = list(entry.filenamesGlob).flatMap((name) =>
    list(entry.extensionsGlob).map((ext) => `${name}.${ext}`)
  )
  for (const key of [...list(entry.extensions), ...globbed]) {
    const map = entry.filename ? fileNames : fileExtensions
    map[key.toLowerCase()] = entry.icon
  }
  for (const language of list(entry.languages)) {
    for (const ext of list(language.knownExtensions)) {
      languageExtensions[ext.toLowerCase()] = entry.icon
    }
    for (const name of list(language.knownFilenames)) {
      languageNames[name.toLowerCase()] = entry.icon
    }
  }
}

const folderNames = {}
const folderLight = {}
for (const entry of folders.supported) {
  if (entry.disabled) continue
  const closed = use(svg(`folder_type_${entry.icon}.svg`))
  const opened = use(svg(`folder_type_${entry.icon}_opened.svg`))
  if (!closed || !opened) continue
  if (entry.light) {
    const lightClosed = use(svg(`folder_type_light_${entry.icon}.svg`))
    const lightOpened = use(svg(`folder_type_light_${entry.icon}_opened.svg`))
    if (lightClosed && lightOpened) folderLight[entry.icon] = true
  }
  for (const name of list(entry.extensions)) folderNames[name.toLowerCase()] = entry.icon
}
for (const name of [
  'default_file.svg',
  'default_folder.svg',
  'default_folder_opened.svg',
  'default_root_folder.svg',
  'default_root_folder_opened.svg'
]) {
  if (!use(svg(name))) throw new Error(`missing ${name}`)
}

const root = fileURLToPath(new URL('..', import.meta.url))
const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)))
const version = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version
writeFileSync(
  join(root, 'src', 'core', 'vscode-icons.json'),
  JSON.stringify({
    version,
    fileNames: sorted(fileNames),
    fileExtensions: sorted(fileExtensions),
    languageNames: sorted(languageNames),
    languageExtensions: sorted(languageExtensions),
    fileLight: sorted(fileLight),
    folderNames: sorted(folderNames),
    folderLight: sorted(folderLight)
  }) + '\n'
)
const out = join(root, 'src', 'renderer', 'public', 'file-icons')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
for (const name of used) copyFileSync(join(icons, name), join(out, name))
console.log(
  `vscode-icons ${version}: ${Object.keys(fileNames).length} file names, ` +
    `${Object.keys(fileExtensions).length} extensions, ${Object.keys(folderNames).length} folder names, ` +
    `${used.size} icons`
)
