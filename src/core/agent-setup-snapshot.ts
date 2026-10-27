/**
 * What the Agent setup page shows (#68 D8–D11, D17, D18, D24): the snapshot main's reader
 * (`agent-setup-reader.ts`) returns for one workspace folder, sent to the renderer as it is. Plain
 * TS with no Node or DOM imports: the renderer imports its types and `agent-setup-rows.ts` reads it.
 *
 * Hooks (D19) are read here, since D19's check needs the file system; Permissions and Status
 * (D13, D20) come from `settings`, `claudeJson`, `mcpJson` and `bikubeSettings`; Plugins and MCP
 * servers (D15, D16) from `plugins`, `marketplaces`, `mcpJson`, `claudeJson`'s servers and the
 * plugins' `mcpServers`. Later slices: Config (S5) `settings` and `claudeJson.preferences`; Open
 * file and Reveal (S6) check a path against `paths`.
 */

/** Where an entry comes from (D9): its source chip. */
export type EntrySource =
  | { kind: 'project' }
  | { kind: 'local' }
  | { kind: 'user' }
  /** A plugin: its name (from its plugin.json, else its key) and its `installed_plugins.json` key. */
  | { kind: 'plugin'; plugin: string; key: string }
  | { kind: 'bikube' }

/** A source chip's text (D9): `Project`, `Local`, `User`, `Plugin <name>` or `Bikube`. */
export function sourceLabel(source: EntrySource): string {
  switch (source.kind) {
    case 'project':
      return 'Project'
    case 'local':
      return 'Local'
    case 'user':
      return 'User'
    case 'plugin':
      return `Plugin ${source.plugin}`
    case 'bikube':
      return 'Bikube'
  }
}

/** A skill, agent or command file (D18). */
export interface DefinitionEntry {
  /** The name shown: a skill's or agent's frontmatter `name` (else its folder or file name), a command's `/<path:with:colons>`; a plugin's prefixed with `<plugin>:`. */
  name: string
  /** Frontmatter `description`, or null. */
  description: string | null
  /** The file read (absolute): a skill's SKILL.md, an agent's or command's `.md`. */
  file: string
  source: EntrySource
  /** An agent's frontmatter `model`. */
  model?: string
  /** An agent's frontmatter `tools`, split on commas or given as a list. */
  tools?: string[]
  /** A command's frontmatter `argument-hint`. */
  argumentHint?: string
  /** D18's and D11's warnings, as shown after `⚠`. */
  warnings: string[]
}

/** A memory file (D17) or a file it imports, nested under it. */
export interface MemoryEntry {
  /** As shown: `~/…` for a file in the home folder, relative for one in the workspace folder, else absolute. */
  label: string
  /** The file (absolute), resolved from the import when one; it may not exist (`missing`). */
  file: string
  source: EntrySource
  /** An import whose file doesn't exist: listed with `Imported file not found`. */
  missing?: true
  size: number
  lines: number
  /** The first 40 lines, shown when the row is expanded. */
  head: string
  imports: MemoryEntry[]
  warnings: string[]
}

/** An installed plugin listed for this folder (D8, D15). */
export interface PluginEntry {
  /** `<name>@<marketplace>`, the key of `installed_plugins.json` and `enabledPlugins`. */
  key: string
  /** Its plugin.json `name`, else the key's part before `@`. */
  name: string
  marketplace: string
  /** The install's `scope` (`user`, `project`, `local`), when given. */
  scope?: string
  installPath: string
  version?: string
  description?: string
  author?: string
  /** The effective `enabledPlugins[key]` (D10) is `true`. */
  enabled: boolean
  /** Its `hooks/hooks.json`, parsed (S3 reads it); null when missing or invalid. */
  hooks: unknown
  /** Its `.mcp.json`'s servers (its `mcpServers`, else the file itself), without secrets; null when missing or invalid. */
  mcpServers: Record<string, McpServerConfig> | null
  warnings: string[]
}

/** One hook command (D19), in a settings file, a plugin's `hooks/hooks.json` or Bikube's file. */
export interface HookEntry {
  /** The event it runs on (`PreToolUse`, `Stop`, …), as the file names it. */
  event: string
  /** Its group's `matcher`, or null for every tool or source (`All`). */
  matcher: string | null
  /** The command as the file holds it (never run). */
  command: string
  /** Its `timeout` in seconds, when set. */
  timeout?: number
  source: EntrySource
  /** The file it is set in; none for Bikube's own hooks, which have no Open file (D27). */
  file?: string
  /** D19's `Command not found`. */
  warnings: string[]
}

/** A JSON file's state (D13's Found, Missing or Invalid). */
export type JsonFileState = 'found' | 'missing' | 'invalid'

/**
 * An MCP server as the snapshot keeps it (D16, D28): only what the page shows, so no secret ever
 * crosses to the renderer. Environment variables and headers are their names only; a URL has no
 * user name or password, and its query values read `…`; every other field is left out.
 */
export interface McpServerConfig {
  type?: string
  command?: string
  args?: string[]
  url?: string
  /** Its `env`'s variable names. */
  env?: string[]
  /** Its `headers`' names. */
  headers?: string[]
}

/** One settings file (D10), in precedence order in `AgentSetupSnapshot.settings`. */
export interface SettingsFile {
  scope: 'local' | 'project' | 'user'
  file: string
  state: JsonFileState
  /** The parser's message (or D11's) when `invalid`. */
  error?: string
  /** Its top-level object when `found`, its `env` reduced to the variables' names (D21, D28). */
  value?: Record<string, unknown>
}

/** `~/.claude.json`'s parts the page uses (D8). */
export interface ClaudeJson {
  file: string
  state: JsonFileState
  error?: string
  /** Its `mcpServers` (User scope), without secrets. */
  mcpServers: Record<string, McpServerConfig>
  /** Its `projects[<folder>].mcpServers` (Local scope), without secrets. */
  localMcpServers: Record<string, McpServerConfig>
  oauthAccount: { emailAddress?: string; organizationName?: string } | null
  /** Its top-level booleans and numbers (D21 filters them). */
  preferences: Record<string, boolean | number>
}

/** A JSON file read whole (`.mcp.json`, `known_marketplaces.json`). */
export interface JsonFile {
  file: string
  state: JsonFileState
  error?: string
  value?: unknown
}

/** The sections a warning about a file belongs to, for their dot (D7, D24). */
export type FileWarningSection = 'status' | 'plugins' | 'mcp' | 'hooks'

/** A warning about a file that has no row of its own (invalid JSON, D11's size limit). */
export interface FileWarning {
  section: FileWarningSection
  /** What the Warnings list names it by: the file's label (`.claude/settings.json`, `~/.claude.json`, a plugin's name). */
  entry: string
  file: string
  message: string
}

/** Sections whose folders D11 caps at 500 entries. */
export type CappedSection = 'skills' | 'agents' | 'commands'

/** Everything read for one workspace folder. */
export interface AgentSetupSnapshot {
  folder: string
  home: string
  /** Local, project, user: D10's precedence order (Bikube's file is S3's). */
  settings: SettingsFile[]
  claudeJson: ClaudeJson
  mcpJson: JsonFile
  installedPlugins: JsonFile
  marketplaces: JsonFile
  plugins: PluginEntry[]
  skills: DefinitionEntry[]
  agents: DefinitionEntry[]
  commands: DefinitionEntry[]
  memory: MemoryEntry[]
  /** Every hook (D19): Bikube's, then the settings files' by precedence, then the plugins'. */
  hooks: HookEntry[]
  /** Bikube's own Claude Code settings file (D8, read-only), when main named one. */
  bikubeSettings: JsonFile | null
  /** Entries left out past D11's 500 per folder: the `… <n> more` row. */
  more: Partial<Record<CappedSection, number>>
  fileWarnings: FileWarning[]
  /** Every file the read found (absolute, sorted): what Open file and Reveal may name (D28). */
  paths: string[]
}

/** Outcome of `agentSetup:read`. */
export type AgentSetupRead =
  { ok: true; snapshot: AgentSetupSnapshot } | { ok: false; reason: 'not-directory' }

/**
 * Outcome of a change to `<folder>/.claude/settings.local.json` (#68 D23): `message` is the error
 * line the page shows (`Couldn't save: settings.local.json is not valid JSON`). `link`: the file or
 * `.claude` is a link, or the file isn't a regular file, and nothing was written. `refused`: main's
 * check (D28) turned the request down and nothing was read or written.
 */
export type SettingsWriteResult =
  | { ok: true }
  | {
      ok: false
      reason: 'invalid-json' | 'not-object' | 'unexpected-value' | 'link' | 'refused' | 'failed'
      message: string
    }

/** A switch on the page (#68 D15, D16): a plugin's for this workspace, or a project MCP server's. */
export type AgentSetupSwitch =
  | { kind: 'plugin'; key: string; enabled: boolean }
  | { kind: 'mcpServer'; name: string; enabled: boolean }

/**
 * An in-place Config edit (#68 D22): a settings key set to a boolean or a finite number, or (Reset)
 * removed from `<folder>/.claude/settings.local.json`.
 */
export type AgentSetupConfigEdit =
  { kind: 'set'; key: string; value: boolean | number } | { kind: 'remove'; key: string }
