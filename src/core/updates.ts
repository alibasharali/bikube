/**
 * App updates from GitHub Releases, without code signing: main checks the latest full release,
 * downloads this platform's file, checks its SHA-256 against the one GitHub publishes, and on
 * install a detached script swaps the app once Drovr has quit. Plain TS: no Electron or Node
 * imports.
 */

export const REPOSITORY = 'alibasharali/drovr'
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`
export const RELEASES_URL = `https://github.com/${REPOSITORY}/releases/`

/** Checked at launch and then this often. */
export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

/** Largest release file Drovr downloads (the macOS zip is about 110 MB). */
export const MAX_ASSET_BYTES = 500 * 1024 * 1024

/** How an update reaches this install. */
export type InstallKind =
  /** A macOS app bundle in a folder the user can write: swapped for the zip's `Drovr.app`. */
  | 'mac'
  /** An AppImage in a folder the user can write: swapped for the new AppImage. */
  | 'appimage'
  /** Anything else (the .deb, a read-only folder): the release page is opened to download it. */
  | 'manual'

export interface ReleaseAsset {
  name: string
  url: string
  size: number
  /** Lowercase hex. */
  sha256: string
}

/** A newer full release, as the updater shows it. */
export interface Release {
  version: string
  /** ISO date and time it was published. */
  publishedAt: string
  /** The release's page on GitHub: its notes, and its files for a manual download. */
  pageUrl: string
  /** This platform's file; null when the release has none (then it can only be downloaded). */
  asset: ReleaseAsset | null
}

const VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/
/** A pre-release build's version, `1.2.3-rc.1`, as the release workflow accepts its tag. */
const PRE_RELEASE = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})-[0-9A-Za-z.-]+$/

/** `1.2.3` (an optional leading `v`) as numbers; null for anything else, pre-releases included. */
export function parseVersion(text: string): [number, number, number] | null {
  const m = VERSION.exec(text.startsWith('v') ? text.slice(1) : text)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/**
 * Whether the release `candidate` (`x.y.z`) is later than the running `current`, which may be a
 * pre-release build (`x.y.z-rc.1`): `1.2.0` is later than `1.2.0-rc.1`. False for anything else.
 */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate)
  const pre = PRE_RELEASE.exec(current)
  const b = pre
    ? ([Number(pre[1]), Number(pre[2]), Number(pre[3])] as const)
    : parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!
  return pre !== null
}

/** The release file this platform installs from, as the release workflow names it. */
export function assetName(version: string, platform: string, arch: string): string | null {
  if (platform === 'darwin' && arch === 'arm64') return `drovr-${version}-arm64-mac.zip`
  if (platform === 'linux' && arch === 'x64') return `drovr-${version}-x86_64.AppImage`
  return null
}

const SHA256 = /^sha256:([0-9a-f]{64})$/i

/**
 * The release in GitHub's `releases/latest` answer when it is newer than `current`, else null.
 * Drafts and pre-releases never count. Every URL must start with `base` (this repository's
 * releases), so a tampered answer can't send the download or a link anywhere else.
 */
export function newerRelease(
  json: unknown,
  opts: { current: string; platform: string; arch: string; base?: string }
): Release | null {
  const base = opts.base ?? RELEASES_URL
  if (typeof json !== 'object' || json === null) return null
  const r = json as Record<string, unknown>
  if (r['draft'] === true || r['prerelease'] === true) return null
  const tag = r['tag_name']
  if (typeof tag !== 'string' || !parseVersion(tag)) return null
  const version = tag.replace(/^v/, '')
  if (!isNewer(version, opts.current)) return null
  const pageUrl = r['html_url']
  if (typeof pageUrl !== 'string' || !pageUrl.startsWith(base)) return null
  const publishedAt = typeof r['published_at'] === 'string' ? r['published_at'] : ''
  const wanted = assetName(version, opts.platform, opts.arch)
  const assets = Array.isArray(r['assets']) ? (r['assets'] as unknown[]) : []
  let asset: ReleaseAsset | null = null
  for (const a of assets) {
    if (typeof a !== 'object' || a === null) continue
    const f = a as Record<string, unknown>
    if (wanted === null || f['name'] !== wanted) continue
    const url = f['browser_download_url']
    const size = f['size']
    const digest = typeof f['digest'] === 'string' ? SHA256.exec(f['digest']) : null
    if (typeof url !== 'string' || !url.startsWith(base)) continue
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) continue
    if (size > MAX_ASSET_BYTES || !digest) continue
    asset = { name: wanted, url, size, sha256: digest[1]!.toLowerCase() }
  }
  return { version, publishedAt, pageUrl, asset }
}

/**
 * What an install replaces: the `.app` bundle the executable is in on macOS, the AppImage file
 * on Linux; null when Drovr isn't running from one (a development build, the .deb). A bundle
 * macOS runs from a randomized read-only copy (App Translocation, before it was moved out of
 * Downloads) can't be replaced.
 */
export function installTarget(opts: {
  platform: string
  exePath: string
  appImage?: string
}): { kind: 'mac' | 'appimage'; path: string } | null {
  if (opts.platform === 'darwin') {
    const m = /^(\/.+\.app)\/Contents\/MacOS\/[^/]+$/.exec(opts.exePath)
    if (!m || m[1]!.includes('/AppTranslocation/')) return null
    return { kind: 'mac', path: m[1]! }
  }
  if (opts.platform === 'linux' && opts.appImage && opts.appImage.startsWith('/')) {
    return { kind: 'appimage', path: opts.appImage }
  }
  return null
}

/**
 * The paths an install swaps, and the app it reopens. On macOS it replaces the bundle's
 * `Contents` folder (its code, resources and signature) rather than the bundle: a standard
 * account can't rename anything in `/Applications`, but owns the `Drovr.app` it copied there.
 * An AppImage is one file, swapped in its folder.
 */
export function installPaths(
  kind: 'mac' | 'appimage',
  prepared: string,
  target: string
): { from: string; to: string; app: string; writable: string[] } {
  if (kind === 'mac') {
    return {
      from: `${prepared}/Contents`,
      to: `${target}/Contents`,
      app: target,
      writable: [target, `${target}/Contents`]
    }
  }
  const folder = target.slice(0, target.lastIndexOf('/')) || '/'
  return { from: prepared, to: target, app: target, writable: [folder, target] }
}

/**
 * The detached script that installs a downloaded update: `sh -c SCRIPT sh <pid> <from> <to>
 * <relaunch> <failed> <app>`. It waits (at most 60 s) for Drovr's process `pid` to end, moves
 * `to` aside, moves `from` into its place (putting the old one back if that fails) and removes
 * the old one. When it can't, it writes why to the file `failed`, for the next launch to say, and
 * the old app stays. Either way it reopens `app`: `open` (macOS, after touching the bundle so
 * macOS reads its new version), `exec` (an AppImage) or `none`. Every value is a positional
 * parameter, so nothing from outside is parsed as shell.
 */
export const INSTALL_SCRIPT = [
  'pid=$1 from=$2 to=$3 relaunch=$4 failed=$5 app=$6',
  'i=0',
  'while kill -0 "$pid" 2>/dev/null; do',
  '  i=$((i + 1))',
  '  [ "$i" -gt 600 ] && { echo "Drovr did not quit" > "$failed"; exit 1; }',
  '  sleep 0.1',
  'done',
  'old="$to.drovr-old-$$"',
  'ok=0',
  'if err=$(mv "$to" "$old" 2>&1); then',
  '  if err=$(mv "$from" "$to" 2>&1); then ok=1; rm -rf "$old"; else mv "$old" "$to"; fi',
  'fi',
  '[ "$ok" = 1 ] || printf %s "$err" > "$failed"',
  'case $relaunch in',
  '  open) touch "$app"; open "$app" ;;',
  '  exec) nohup "$app" >/dev/null 2>&1 & ;;',
  'esac',
  '[ "$ok" = 1 ]'
].join('\n')

/** What the updater is doing, as the renderer shows it. */
export type UpdateState =
  | { kind: 'off' }
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'error'; message: string }
  | {
      kind: 'available'
      release: Release
      install: InstallKind
      /** Downloaded fraction 0–1 while downloading; 1 once ready to install. */
      progress: number
      /** The user skipped this version: not downloaded, and shown only when they open the popup. */
      skipped: boolean
      /** Downloading or preparing failed; Install falls back to the release page. */
      error?: string
    }

/** Bytes as the popup shows them: `77.7 MB`. */
export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** The confirmation before installing, naming the terminals it stops. */
export function installMessage(running: number): string {
  const base = 'Drovr quits, installs the update and opens again.'
  if (running === 0) return base
  const terminals = running === 1 ? '1 terminal is' : `${running} terminals are`
  return `${base} ${terminals} running and will be stopped.`
}
