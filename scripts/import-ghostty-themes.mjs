#!/usr/bin/env node
// Builds src/core/ghostty-themes.json from a directory of Ghostty theme files (Ghostty's
// `themes`, from iTerm2-Color-Schemes; keep THIRD_PARTY_NOTICES current). Usage: node scripts/import-ghostty-themes.mjs <dir>
/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS, no types to declare */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: node scripts/import-ghostty-themes.mjs <ghostty themes dir>')
  process.exit(1)
}
const KEYS = [
  'background',
  'foreground',
  'cursor-color',
  'cursor-text',
  'selection-background',
  'selection-foreground'
]
const hex = (value) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(value.trim())
  return m ? m[1].toLowerCase() : null
}
const themes = {}
for (const name of readdirSync(dir).sort((a, b) => a.localeCompare(b))) {
  const colours = {}
  for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
    const m = /^\s*([a-z-]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (!m) continue
    if (m[1] === 'palette') {
      const p = /^(\d+)\s*=\s*(.+)$/.exec(m[2])
      if (p && Number(p[1]) < 16) colours[Number(p[1])] = hex(p[2])
    } else if (KEYS.includes(m[1])) colours[m[1]] = hex(m[2])
  }
  const row = [
    ...KEYS.map((k) => colours[k] ?? ''),
    ...Array.from({ length: 16 }, (_, i) => colours[i] ?? '')
  ]
  // Background, foreground and all 16 ANSI colours are required; cursor and selection may be empty.
  if ([0, 1, ...Array.from({ length: 16 }, (_, i) => i + 6)].some((i) => !row[i])) {
    console.warn(`skipped ${name}: incomplete`)
    continue
  }
  themes[name] = row.join(' ')
}
const out = fileURLToPath(new URL('../src/core/ghostty-themes.json', import.meta.url))
writeFileSync(out, JSON.stringify(themes, null, 0).replace(/","/g, '",\n"') + '\n')
console.log(`${Object.keys(themes).length} themes written to ${out}`)
