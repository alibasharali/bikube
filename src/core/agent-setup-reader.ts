/**
 * Reads a workspace's Claude Code setup (#68 D8–D11, D17, D18, D24) into one snapshot
 * (`agent-setup-snapshot.ts`): the settings files, `~/.claude.json`, `.mcp.json`, the installed
 * plugins, every skill, agent and command (project, user and plugin) and the memory files with
 * their imports. Plain TS with no Electron imports: the file system is injected (Node's by
 * default), so Vitest drives real temporary folders. Only reads: nothing a file names is run.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  AgentSetupSnapshot,
  CappedSection,
  ClaudeJson,
  DefinitionEntry,
  EntrySource,
  FileWarning,
  FileWarningSection,
  HookEntry,
  JsonFile,
  MemoryEntry,
  PluginEntry,
  SettingsFile
} from './agent-setup-snapshot'
import { fieldList, fieldText, parseFrontmatter } from './frontmatter'

/** A file over this many bytes is not parsed (D11). */
export const MAX_FILE_BYTES = 1024 * 1024
/** The most entries one folder lists (D11); the rest are counted in `more`. */
export const FOLDER_LIMIT = 500
/** How deep `agents/**` and `commands/**` are followed (D11). */
export const MAX_DEPTH = 5
/** How many lines of a memory file show when its row is expanded (D17). */
export const MEMORY_HEAD_LINES = 40
/** How many hops of `@path` imports are followed (D17). */
export const MAX_IMPORT_HOPS = 5

export const TOO_LARGE = 'Too large to read (over 1 MB)'
export const IMPORT_NOT_FOUND = 'Imported file not found'
export const COMMAND_NOT_FOUND = 'Command not found'

/** The file system calls a read makes; `stat` follows symlinks, so a broken one throws. */
export interface SetupFs {
  stat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean; size: number }>
  readdir(path: string): Promise<string[]>
  readFile(path: string, encoding: 'utf8'): Promise<string>
}

const nodeFs: SetupFs = { stat, readdir, readFile }

export interface ReadAgentSetupOptions {
  /** The workspace folder (absolute). */
  folder: string
  /** The user's home (main's `BIKUBE_HOME_DIR`, else the OS home). */
  home: string
  /**
   * Bikube's own Claude Code settings file (`claude-settings.json`, #31 D14), whose hooks every
   * Claude Code card gets (D8). Read-only, and never listed in `paths` (no Open file, D27).
   */
  bikubeSettings?: string
  fs?: SetupFs
}

type Text =
  { kind: 'missing' } | { kind: 'large'; size: number } | { kind: 'ok'; text: string; size: number }

const within = (base: string, path: string): boolean => {
  const rel = relative(base, path)
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const byName = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) ||
  (a < b ? -1 : a > b ? 1 : 0)

/** One read's state: the file system, what it found, and its warnings. */
class Reader {
  readonly paths = new Set<string>()
  readonly fileWarnings: FileWarning[] = []
  readonly more: Partial<Record<CappedSection, number>> = {}

  constructor(
    readonly folder: string,
    readonly home: string,
    private readonly fs: SetupFs
  ) {}

  /** `file` as the page shows it: relative inside the folder, `~/…` inside the home, else absolute. */
  label(file: string): string {
    if (within(this.folder, file) && file !== this.folder) return relative(this.folder, file)
    if (within(this.home, file) && file !== this.home) return `~/${relative(this.home, file)}`
    return file
  }

  async kind(path: string): Promise<'file' | 'folder' | null> {
    try {
      const info = await this.fs.stat(path)
      return info.isFile() ? 'file' : info.isDirectory() ? 'folder' : null
    } catch {
      return null
    }
  }

  /** A regular file's text, unless it is over 1 MB; found files are recorded in `paths` when `listed`. */
  async text(path: string, listed = true): Promise<Text> {
    try {
      const info = await this.fs.stat(path)
      if (!info.isFile()) return { kind: 'missing' }
      if (listed) this.paths.add(path)
      if (info.size > MAX_FILE_BYTES) return { kind: 'large', size: info.size }
      return { kind: 'ok', text: await this.fs.readFile(path, 'utf8'), size: info.size }
    } catch {
      return { kind: 'missing' }
    }
  }

  /** A JSON file; an invalid or too large one is warned about in `section` (D24) as `entry`. */
  async json(
    path: string,
    section: FileWarningSection,
    entry = this.label(path),
    listed = true
  ): Promise<JsonFile> {
    const text = await this.text(path, listed)
    if (text.kind === 'missing') return { file: path, state: 'missing' }
    let error: string
    if (text.kind === 'large') error = TOO_LARGE
    else {
      try {
        return { file: path, state: 'found', value: JSON.parse(text.text) as unknown }
      } catch (e) {
        error = `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    this.fileWarnings.push({ section, entry, file: path, message: error })
    return { file: path, state: 'invalid', error }
  }

  /** A folder's entries by name, the first 500 (D11), the rest counted toward `section`'s `more`. */
  async list(path: string, section: CappedSection): Promise<string[]> {
    let names: string[]
    try {
      names = await this.fs.readdir(path)
    } catch {
      return []
    }
    names.sort(byName)
    if (names.length > FOLDER_LIMIT) {
      this.more[section] = (this.more[section] ?? 0) + names.length - FOLDER_LIMIT
    }
    return names.slice(0, FOLDER_LIMIT)
  }

  /** The `.md` files under `root`, `agents/**` or `commands/**`, to depth 5 (D11), relative. */
  async markdownFiles(root: string, section: CappedSection, depth = 0): Promise<string[]> {
    const found: string[] = []
    for (const name of await this.list(root, section)) {
      const path = join(root, name)
      const kind = await this.kind(path)
      if (kind === 'file' && name.toLowerCase().endsWith('.md')) found.push(name)
      else if (kind === 'folder' && depth < MAX_DEPTH) {
        for (const nested of await this.markdownFiles(path, section, depth + 1)) {
          found.push(`${name}/${nested}`)
        }
      }
    }
    return found
  }
}

/** A definition file's frontmatter fields and its D18 warnings. */
async function definition(
  reader: Reader,
  file: string,
  requireFrontmatter: boolean
): Promise<{ fields: Record<string, string | string[]>; warnings: string[] }> {
  const text = await reader.text(file)
  if (text.kind === 'large') return { fields: {}, warnings: [TOO_LARGE] }
  const parsed = parseFrontmatter(text.kind === 'ok' ? text.text : '')
  if (parsed.kind === 'none') {
    return { fields: {}, warnings: requireFrontmatter ? ['No frontmatter'] : [] }
  }
  if (parsed.kind === 'invalid') return { fields: {}, warnings: ['Invalid frontmatter'] }
  const warnings: string[] = []
  if (requireFrontmatter) {
    if (fieldText(parsed.fields, 'name') === undefined) warnings.push('Missing name')
    if (fieldText(parsed.fields, 'description') === undefined) warnings.push('Missing description')
  }
  return { fields: parsed.fields, warnings }
}

const prefixed = (source: EntrySource, name: string): string =>
  source.kind === 'plugin' ? `${source.plugin}:${name}` : name

/** Each `<root>/<skill>/SKILL.md` (D8, D18). */
async function readSkills(
  reader: Reader,
  root: string,
  source: EntrySource
): Promise<DefinitionEntry[]> {
  const entries: DefinitionEntry[] = []
  for (const name of await reader.list(root, 'skills')) {
    const file = join(root, name, 'SKILL.md')
    if (
      (await reader.kind(join(root, name))) !== 'folder' ||
      (await reader.kind(file)) !== 'file'
    ) {
      continue
    }
    const { fields, warnings } = await definition(reader, file, true)
    entries.push({
      name: prefixed(source, fieldText(fields, 'name') ?? name),
      description: fieldText(fields, 'description') ?? null,
      file,
      source,
      warnings
    })
  }
  return entries
}

/** `<root>/**\/*.md` agents (D8, D18). */
async function readAgents(
  reader: Reader,
  root: string,
  source: EntrySource
): Promise<DefinitionEntry[]> {
  const entries: DefinitionEntry[] = []
  for (const path of await reader.markdownFiles(root, 'agents')) {
    const file = join(root, path)
    const { fields, warnings } = await definition(reader, file, true)
    const entry: DefinitionEntry = {
      name: prefixed(source, fieldText(fields, 'name') ?? basename(path).replace(/\.md$/i, '')),
      description: fieldText(fields, 'description') ?? null,
      file,
      source,
      warnings
    }
    const model = fieldText(fields, 'model')
    if (model !== undefined) entry.model = model
    const tools = fieldList(fields, 'tools')
    if (tools !== undefined) entry.tools = tools
    entries.push(entry)
  }
  return entries
}

/** `<root>/**\/*.md` commands, named `/<path:with:colons>` (D8, D18). */
async function readCommands(
  reader: Reader,
  root: string,
  source: EntrySource
): Promise<DefinitionEntry[]> {
  const entries: DefinitionEntry[] = []
  for (const path of await reader.markdownFiles(root, 'commands')) {
    const file = join(root, path)
    const { fields, warnings } = await definition(reader, file, false)
    const entry: DefinitionEntry = {
      name: `/${prefixed(source, path.replace(/\.md$/i, '').split('/').join(':'))}`,
      description: fieldText(fields, 'description') ?? null,
      file,
      source,
      warnings
    }
    const hint = fieldText(fields, 'argument-hint')
    if (hint !== undefined) entry.argumentHint = hint
    entries.push(entry)
  }
  return entries
}

/** A settings file (D10): its object, or why it has none. */
async function readSettings(
  reader: Reader,
  scope: SettingsFile['scope'],
  file: string
): Promise<SettingsFile> {
  const json = await reader.json(file, 'status')
  if (json.state !== 'found') {
    return { scope, file, state: json.state, ...(json.error ? { error: json.error } : {}) }
  }
  if (!isRecord(json.value)) {
    const error = 'Not a JSON object'
    reader.fileWarnings.push({ section: 'status', entry: reader.label(file), file, message: error })
    return { scope, file, state: 'invalid', error }
  }
  return { scope, file, state: 'found', value: json.value }
}

async function readClaudeJson(reader: Reader): Promise<ClaudeJson> {
  const file = join(reader.home, '.claude.json')
  const json = await reader.json(file, 'status')
  const empty: ClaudeJson = {
    file,
    state: json.state,
    ...(json.error ? { error: json.error } : {}),
    mcpServers: {},
    localMcpServers: {},
    oauthAccount: null,
    preferences: {}
  }
  if (json.state !== 'found' || !isRecord(json.value)) return empty
  const value = json.value
  const project = isRecord(value['projects']) ? value['projects'][reader.folder] : undefined
  const account = value['oauthAccount']
  const preferences: Record<string, boolean | number> = {}
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)))
      preferences[key] = v
  }
  const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  return {
    ...empty,
    mcpServers: isRecord(value['mcpServers']) ? value['mcpServers'] : {},
    localMcpServers:
      isRecord(project) && isRecord(project['mcpServers']) ? project['mcpServers'] : {},
    oauthAccount: isRecord(account)
      ? {
          ...(text(account['emailAddress']) ? { emailAddress: text(account['emailAddress']) } : {}),
          ...(text(account['organizationName'])
            ? { organizationName: text(account['organizationName']) }
            : {})
        }
      : null,
    preferences
  }
}

/** The effective `enabledPlugins[key]` (D10): the first settings file, by precedence, that sets it. */
export function pluginEnabled(settings: readonly SettingsFile[], key: string): boolean {
  for (const file of settings) {
    const enabled = file.value?.['enabledPlugins']
    if (isRecord(enabled) && typeof enabled[key] === 'boolean') return enabled[key]
  }
  return false
}

interface Install {
  installPath: string
  scope?: string
  version?: string
}

const SCOPE_RANK: Record<string, number> = { local: 0, project: 1, user: 2 }

/**
 * The install of a plugin listed for `folder` (D8): a `project` or `local` one only when its
 * `projectPath` is `folder`, a user one always; `local` first, then `project`, then `user`.
 * `installed_plugins.json` holds an array of installs per key (version 2) or one object (version 1).
 */
function installFor(value: unknown, folder: string): Install | null {
  const installs = (Array.isArray(value) ? value : [value]).filter(isRecord).filter((install) => {
    if (typeof install['installPath'] !== 'string' || !isAbsolute(install['installPath']))
      return false
    const scope = install['scope']
    if (scope === 'project' || scope === 'local') return install['projectPath'] === folder
    return true
  })
  installs.sort(
    (a, b) =>
      (SCOPE_RANK[String(a['scope'] ?? 'user')] ?? 3) -
      (SCOPE_RANK[String(b['scope'] ?? 'user')] ?? 3)
  )
  const install = installs[0]
  if (!install) return null
  return {
    installPath: install['installPath'] as string,
    ...(typeof install['scope'] === 'string' ? { scope: install['scope'] } : {}),
    ...(typeof install['version'] === 'string' ? { version: install['version'] } : {})
  }
}

interface ReadPlugin {
  entry: PluginEntry
  source: EntrySource
  /** Its install folder exists: its skills, agents and commands are read. */
  present: boolean
}

async function readPlugins(
  reader: Reader,
  installed: JsonFile,
  settings: readonly SettingsFile[]
): Promise<ReadPlugin[]> {
  const plugins = isRecord(installed.value) ? installed.value['plugins'] : undefined
  if (!isRecord(plugins)) return []
  const found: ReadPlugin[] = []
  for (const key of Object.keys(plugins).sort(byName)) {
    const install = installFor(plugins[key], reader.folder)
    if (!install) continue
    const at = key.lastIndexOf('@')
    const marketplace = at > 0 ? key.slice(at + 1) : ''
    const entry: PluginEntry = {
      key,
      name: at > 0 ? key.slice(0, at) : key,
      marketplace,
      ...(install.scope ? { scope: install.scope } : {}),
      installPath: install.installPath,
      ...(install.version ? { version: install.version } : {}),
      enabled: pluginEnabled(settings, key),
      hooks: null,
      mcpServers: null,
      warnings: []
    }
    const present = (await reader.kind(install.installPath)) === 'folder'
    if (!present) entry.warnings.push('Install folder missing')
    else {
      const manifest = await reader.json(
        join(install.installPath, '.claude-plugin', 'plugin.json'),
        'plugins',
        key
      )
      if (isRecord(manifest.value)) {
        const m = manifest.value
        if (typeof m['name'] === 'string' && m['name'].trim()) entry.name = m['name'].trim()
        if (typeof m['version'] === 'string') entry.version = m['version']
        if (typeof m['description'] === 'string') entry.description = m['description']
        const author = isRecord(m['author']) ? m['author']['name'] : m['author']
        if (typeof author === 'string') entry.author = author
      }
      const hooks = await reader.json(
        join(install.installPath, 'hooks', 'hooks.json'),
        'hooks',
        key
      )
      if (hooks.state === 'found') entry.hooks = hooks.value
      const mcp = await reader.json(join(install.installPath, '.mcp.json'), 'mcp', key)
      if (isRecord(mcp.value)) {
        entry.mcpServers = isRecord(mcp.value['mcpServers']) ? mcp.value['mcpServers'] : mcp.value
      }
    }
    found.push({ entry, present, source: { kind: 'plugin', plugin: entry.name, key } })
  }
  return found
}

/** A command's first word as the shell would read it: quotes removed, up to unquoted whitespace. */
export function firstWord(command: string): string {
  let word = ''
  let quote: string | null = null
  for (const ch of command.trimStart()) {
    if (quote !== null) {
      if (ch === quote) quote = null
      else word += ch
    } else if (ch === '"' || ch === "'") quote = ch
    else if (/\s/.test(ch)) break
    else word += ch
  }
  return word
}

/**
 * The file a hook command's first word names (D19): an absolute path, or one under
 * `$CLAUDE_PROJECT_DIR` (the workspace folder) or, for a plugin's hook, `${CLAUDE_PLUGIN_ROOT}`;
 * null for anything else (a command on the PATH, another variable), which is not checked.
 */
export function hookCommandFile(
  command: string,
  folder: string,
  pluginRoot: string | null
): string | null {
  const word = firstWord(command)
  const roots: [string, string][] = [
    ['${CLAUDE_PROJECT_DIR}', folder],
    ['$CLAUDE_PROJECT_DIR', folder]
  ]
  if (pluginRoot !== null) {
    roots.push(['${CLAUDE_PLUGIN_ROOT}', pluginRoot], ['$CLAUDE_PLUGIN_ROOT', pluginRoot])
  }
  // A path still holding a variable, a substitution or a pattern can't be known without a shell.
  const plain = (path: string): boolean => !/[$`*?[]/.test(path)
  for (const [prefix, root] of roots) {
    if (!word.startsWith(prefix)) continue
    const rest = word.slice(prefix.length)
    if (rest !== '' && !rest.startsWith('/')) return null
    return plain(rest) ? join(root, rest) : null
  }
  return isAbsolute(word) && plain(word) ? word : null
}

/**
 * The hooks of one file's `hooks` object (D19): `{ <event>: [{ matcher?, hooks: [{ type,
 * command, timeout? }] }] }`. A missing file named by a command gets `Command not found`.
 */
async function readHooks(
  reader: Reader,
  hooks: unknown,
  source: EntrySource,
  file: string | undefined,
  pluginRoot: string | null
): Promise<HookEntry[]> {
  if (!isRecord(hooks)) return []
  const entries: HookEntry[] = []
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group['hooks'])) continue
      const matcher =
        typeof group['matcher'] === 'string' && group['matcher'] !== '' && group['matcher'] !== '*'
          ? group['matcher']
          : null
      for (const hook of group['hooks']) {
        if (!isRecord(hook)) continue
        const command =
          typeof hook['command'] === 'string'
            ? hook['command']
            : typeof hook['prompt'] === 'string'
              ? hook['prompt']
              : null
        if (command === null) continue
        const entry: HookEntry = { event, matcher, command, source, warnings: [] }
        if (typeof hook['timeout'] === 'number' && Number.isFinite(hook['timeout'])) {
          entry.timeout = hook['timeout']
        }
        if (file !== undefined) entry.file = file
        const target =
          typeof hook['command'] === 'string'
            ? hookCommandFile(command, reader.folder, pluginRoot)
            : null
        if (target !== null && (await reader.kind(target)) !== 'file') {
          entry.warnings.push(COMMAND_NOT_FOUND)
        }
        entries.push(entry)
      }
    }
  }
  return entries
}

/** `@path` imports in a memory file's text: tokens after whitespace, outside code (D17). */
export function memoryImports(text: string): string[] {
  const found: string[] = []
  let fence: string | null = null
  for (const line of text.split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker) {
      if (fence === null) fence = marker[0]!
      else if (marker[0] === fence) fence = null
      continue
    }
    if (fence !== null) continue
    const plain = line.replace(/`[^`]*`/g, ' ')
    for (const match of plain.matchAll(/(?:^|\s)@((?:~\/)?[^\s`]+)/g)) {
      const path = match[1]!.replace(/[.,;:!?)\]]+$/, '')
      if (path && !found.includes(path)) found.push(path)
    }
  }
  return found
}

const lineCount = (text: string): number =>
  text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)

/** One memory file with its imports nested, followed up to 5 hops (D17). */
async function memoryEntry(
  reader: Reader,
  file: string,
  source: EntrySource,
  chain: readonly string[]
): Promise<MemoryEntry> {
  const text = await reader.text(file)
  const entry: MemoryEntry = {
    label: reader.label(file),
    file,
    source,
    size: text.kind === 'missing' ? 0 : text.size,
    lines: 0,
    head: '',
    imports: [],
    warnings: []
  }
  if (text.kind === 'large') {
    entry.warnings.push(TOO_LARGE)
    return entry
  }
  if (text.kind !== 'ok') return entry
  entry.lines = lineCount(text.text)
  entry.head = text.text.split('\n').slice(0, MEMORY_HEAD_LINES).join('\n')
  // A file 5 hops from the memory file lists no imports of its own (D17).
  if (chain.length >= MAX_IMPORT_HOPS) return entry
  for (const path of memoryImports(text.text)) {
    const target = path.startsWith('~/')
      ? join(reader.home, path.slice(2))
      : resolve(dirname(file), path)
    if (chain.includes(target) || target === file) continue
    if ((await reader.kind(target)) !== 'file') {
      entry.imports.push({
        label: reader.label(target),
        file: target,
        source,
        missing: true,
        size: 0,
        lines: 0,
        head: '',
        imports: [],
        warnings: [IMPORT_NOT_FOUND]
      })
      continue
    }
    entry.imports.push(await memoryEntry(reader, target, source, [...chain, file]))
  }
  return entry
}

/** The memory files Claude Code loads for the folder, in its load order (D17); missing ones left out. */
async function readMemory(reader: Reader): Promise<MemoryEntry[]> {
  const files: [string, EntrySource][] = [
    [join(reader.home, '.claude', 'CLAUDE.md'), { kind: 'user' }]
  ]
  const ancestors: string[] = []
  for (let at = dirname(reader.folder); ; at = dirname(at)) {
    ancestors.unshift(at)
    if (dirname(at) === at) break
  }
  if (reader.folder === dirname(reader.folder)) ancestors.length = 0
  for (const at of ancestors) {
    files.push(
      [join(at, 'CLAUDE.md'), { kind: 'project' }],
      // Above the workspace folder both are Project (D17); only its own CLAUDE.local.md is Local.
      [join(at, 'CLAUDE.local.md'), { kind: 'project' }]
    )
  }
  files.push(
    [join(reader.folder, 'CLAUDE.md'), { kind: 'project' }],
    [join(reader.folder, '.claude', 'CLAUDE.md'), { kind: 'project' }],
    [join(reader.folder, 'CLAUDE.local.md'), { kind: 'local' }]
  )
  const seen = new Set<string>()
  const entries: MemoryEntry[] = []
  for (const [file, source] of files) {
    if (seen.has(file)) continue
    seen.add(file)
    if ((await reader.kind(file)) !== 'file') continue
    entries.push(await memoryEntry(reader, file, source, []))
  }
  return entries
}

/** Reads everything the Agent setup page shows for `folder` (D8). */
export async function readAgentSetup({
  folder,
  home,
  bikubeSettings,
  fs = nodeFs
}: ReadAgentSetupOptions): Promise<AgentSetupSnapshot> {
  const reader = new Reader(folder, home, fs)
  const bikube =
    bikubeSettings === undefined
      ? null
      : await reader.json(bikubeSettings, 'status', 'Bikube settings', false)
  const project = join(folder, '.claude')
  const user = join(home, '.claude')
  const settings = [
    await readSettings(reader, 'local', join(project, 'settings.local.json')),
    await readSettings(reader, 'project', join(project, 'settings.json')),
    await readSettings(reader, 'user', join(user, 'settings.json'))
  ]
  const claudeJson = await readClaudeJson(reader)
  const mcpJson = await reader.json(join(folder, '.mcp.json'), 'mcp')
  const pluginsFolder = join(user, 'plugins')
  const installedPlugins = await reader.json(
    join(pluginsFolder, 'installed_plugins.json'),
    'plugins'
  )
  const marketplaces = await reader.json(join(pluginsFolder, 'known_marketplaces.json'), 'plugins')
  const plugins = await readPlugins(reader, installedPlugins, settings)

  const sources: [string, EntrySource][] = [
    [project, { kind: 'project' }],
    [user, { kind: 'user' }],
    ...plugins
      .filter((p) => p.present)
      .map((p): [string, EntrySource] => [p.entry.installPath, p.source])
  ]
  const skills: DefinitionEntry[] = []
  const agents: DefinitionEntry[] = []
  const commands: DefinitionEntry[] = []
  for (const [root, source] of sources) {
    skills.push(...(await readSkills(reader, join(root, 'skills'), source)))
    agents.push(...(await readAgents(reader, join(root, 'agents'), source)))
    commands.push(...(await readCommands(reader, join(root, 'commands'), source)))
  }
  const memory = await readMemory(reader)

  // Hooks merge across every source (D10): Bikube's, the settings files', the plugins'.
  const hooks: HookEntry[] = []
  if (bikube && isRecord(bikube.value)) {
    hooks.push(
      ...(await readHooks(reader, bikube.value['hooks'], { kind: 'bikube' }, undefined, null))
    )
  }
  for (const file of settings) {
    hooks.push(
      ...(await readHooks(reader, file.value?.['hooks'], { kind: file.scope }, file.file, null))
    )
  }
  for (const plugin of plugins) {
    const value = plugin.entry.hooks
    // A plugin's hooks.json holds `{ description?, hooks }`; an older one the events alone.
    const events = isRecord(value) && isRecord(value['hooks']) ? value['hooks'] : value
    hooks.push(
      ...(await readHooks(
        reader,
        events,
        plugin.source,
        join(plugin.entry.installPath, 'hooks', 'hooks.json'),
        plugin.entry.installPath
      ))
    )
  }

  return {
    folder,
    home,
    settings,
    claudeJson,
    mcpJson,
    installedPlugins,
    marketplaces,
    plugins: plugins.map((p) => p.entry),
    skills,
    agents,
    commands,
    memory,
    hooks,
    bikubeSettings: bikube,
    more: reader.more,
    fileWarnings: reader.fileWarnings,
    paths: [...reader.paths].sort()
  }
}
