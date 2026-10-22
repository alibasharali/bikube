// Renders build/icon.svg into build/icon.png (1024 px), build/icon.ico and, on macOS, build/icon.icns.
// Run with Electron, which draws the SVG: `npx electron scripts/render-icons.mjs`.
/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS, no types to declare */
import { app, BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const build = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')
const svg = readFileSync(join(build, 'icon.svg'), 'utf8')

/** The SVG drawn once at 1024 px; smaller sizes are scaled from it. */
async function render(size) {
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    transparent: true,
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: true }
  })
  const html = `<html><body style="margin:0;background:transparent">${svg.replace(
    '<svg ',
    `<svg style="display:block;width:${size}px;height:${size}px" `
  )}</body></html>`
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
  // An offscreen window paints once it has a frame; give it one.
  await new Promise((resolve) => setTimeout(resolve, 300))
  const image = await win.webContents.capturePage()
  win.destroy()
  return image.resize({ width: size, height: size, quality: 'best' })
}

/** An ICO holding PNG entries (read by Windows Vista and later). */
function ico(entries) {
  const header = Buffer.alloc(6 + entries.length * 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  let offset = header.length
  entries.forEach(({ size, png }, i) => {
    const at = 6 + i * 16
    header.writeUInt8(size >= 256 ? 0 : size, at)
    header.writeUInt8(size >= 256 ? 0 : size, at + 1)
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(png.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...entries.map((e) => e.png)])
}

app.whenReady().then(async () => {
  app.on('window-all-closed', () => {})
  const sizes = [16, 32, 48, 64, 128, 256, 512, 1024]
  const full = await render(1024)
  const pngs = new Map(
    sizes.map((size) => [size, full.resize({ width: size, height: size, quality: 'best' }).toPNG()])
  )

  writeFileSync(join(build, 'icon.png'), pngs.get(1024))
  writeFileSync(
    join(build, 'icon.ico'),
    ico([16, 32, 48, 256].map((size) => ({ size, png: pngs.get(size) })))
  )

  if (process.platform === 'darwin') {
    const dir = mkdtempSync(join(tmpdir(), 'icon-'))
    const set = join(dir, 'icon.iconset')
    execFileSync('mkdir', [set])
    for (const size of [16, 32, 128, 256, 512]) {
      writeFileSync(join(set, `icon_${size}x${size}.png`), pngs.get(size))
      writeFileSync(join(set, `icon_${size}x${size}@2x.png`), pngs.get(size * 2))
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', join(build, 'icon.icns')])
    rmSync(dir, { recursive: true })
  }
  app.quit()
})
