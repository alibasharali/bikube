/**
 * Shell integration marks (#45 D1, D2), free of Electron and DOM imports: the OSC 133 and OSC 633
 * marks a shell sends around its prompts and commands, the directory it reports (OSC 7, OSC 633
 * `P;Cwd=`), and the commands and prompts they make. The renderer feeds each terminal's marks with
 * a handle on the row they arrived on (an xterm marker), so the rows follow scrolling.
 */

/** The OSC numbers a terminal watches for marks: FinalTerm's (133), VS Code's (633), the cwd (7). */
export const SHELL_MARK_OSCS = [133, 633, 7] as const
export type ShellMarkFamily = (typeof SHELL_MARK_OSCS)[number]

/** A mark a shell sent (#45 D1). */
export type ShellMark =
  /** `A`: the prompt starts. */
  | { kind: 'prompt-start' }
  /** `B`: the prompt ends, the command line starts. */
  | { kind: 'prompt-end' }
  /** `C`: the command's output starts. */
  | { kind: 'output-start' }
  /** `D[;<exit code>]`: the command finished; 0 without an integer code (D2). */
  | { kind: 'command-end'; exitCode: number }
  /** OSC 7 `file://<host><path>` or OSC 633 `P;Cwd=<path>` (no host). */
  | { kind: 'directory'; directory: ShellDirectory }

/** The directory a shell last reported: OSC 7's host (`''` when empty), none for OSC 633's. */
export interface ShellDirectory {
  host?: string
  path: string
}

/** A command (#45 D2): from its `C` to its `D`, on the row of its command line. */
export interface ShellCommand<Line> {
  line: Line
  /** When its `C` was parsed, in ms. */
  start: number
  /** When its `D` was parsed, in ms; none while it runs. */
  end?: number
  /** The `D`'s exit code; none while it runs. */
  exitCode?: number
}

/** Where a mark arrived (#60 D1): the row's handle and the cursor's column when it was parsed. */
export interface MarkPosition<Line> {
  line: Line
  x: number
}

/** An ended command's output (#60 D1): from where its `C` arrived to where its `D` did. */
export interface CommandOutput<Line> {
  command: ShellCommand<Line>
  start: MarkPosition<Line>
  end: MarkPosition<Line>
}

/** The mark in an OSC payload of `family`, or undefined for anything else (D1). */
export function parseShellMark(family: ShellMarkFamily, data: string): ShellMark | undefined {
  if (family === 7) return parseOsc7(data)
  const [command = '', ...args] = data.split(';')
  switch (command) {
    case 'A':
      return { kind: 'prompt-start' }
    case 'B':
      return { kind: 'prompt-end' }
    case 'C':
      return { kind: 'output-start' }
    case 'D':
      return { kind: 'command-end', exitCode: exitCode(args[0]) }
  }
  // Of VS Code's own commands only the directory counts (`E`, other properties are ignored).
  if (family === 633 && command === 'P' && args[0]?.startsWith('Cwd=')) {
    const path = unescape633(args.join(';').slice('Cwd='.length))
    return path ? { kind: 'directory', directory: { path } } : undefined
  }
  return undefined
}

/** A `D`'s code: an integer, else 0 (D2). */
function exitCode(arg: string | undefined): number {
  return arg !== undefined && /^-?\d+$/.test(arg) ? Number(arg) : 0
}

/** OSC 633 escapes `\` as `\\` and any byte as `\xHH` (e.g. `;` as `\x3b`). */
function unescape633(value: string): string {
  return value.replace(/\\(\\|x([0-9a-fA-F]{2}))/g, (_, escaped: string, hex?: string) =>
    hex ? String.fromCharCode(parseInt(hex, 16)) : escaped
  )
}

/** OSC 7's `file://<host><path>`, the path percent-decoded; undefined when malformed. */
function parseOsc7(data: string): ShellMark | undefined {
  const match = /^file:\/\/([^/]*)(\/.*)$/.exec(data)
  if (!match) return undefined
  try {
    const path = decodeURIComponent(match[2]!)
    return { kind: 'directory', directory: { host: match[1]!, path } }
  } catch {
    return undefined
  }
}

/**
 * One terminal's marks (#45 D2): its commands, its prompts and the directory it last reported.
 * `Line` is the renderer's handle on a row; `forget` drops one that left the scrollback.
 */
export class ShellMarks<Line> {
  private readonly promptStarts: Line[] = []
  private readonly promptEnds: Line[] = []
  private sawPromptStart = false
  /** The latest `A` and `B` since the last command started, for the next command's line. */
  private latestStart: Line | undefined
  private latestEnd: Line | undefined
  private running: ShellCommand<Line> | undefined
  private readonly ended: ShellCommand<Line>[] = []
  /** Where the running command's `C` arrived (#60 D1); none when fed without a column. */
  private runningStart: MarkPosition<Line> | undefined
  private readonly endedOutputs: CommandOutput<Line>[] = []
  private lastDirectory: ShellDirectory | undefined
  private readonly listeners = new Set<(command: ShellCommand<Line>) => void>()

  /**
   * Takes in a mark parsed at `time` (ms); `line` gives the row it arrived on, and is called only
   * when the mark needs it. A row it gives as undefined (xterm has no marker on the alt screen)
   * is never kept: no prompt and no listed command, which could never be forgotten. `column`
   * gives the cursor's column; with it, a command's `C` and `D` positions are kept (#60 D1).
   */
  feed(mark: ShellMark, time: number, line: () => Line, column?: () => number): void {
    switch (mark.kind) {
      case 'prompt-start': {
        const row = line()
        this.sawPromptStart = true
        if (row !== undefined) this.promptStarts.push(row)
        this.latestStart = row
        // A new prompt: a `B` of an earlier one is no command line of the next command.
        this.latestEnd = undefined
        return
      }
      case 'prompt-end': {
        const row = line()
        if (row !== undefined) this.promptEnds.push(row)
        this.latestEnd = row
        return
      }
      case 'output-start':
        // The command runs until its `D`; a second `C` before it starts nothing new.
        if (this.running) return
        this.running = { line: this.latestEnd ?? this.latestStart ?? line(), start: time }
        this.latestStart = this.latestEnd = undefined
        this.runningStart = column && position(line(), column())
        return
      case 'command-end': {
        // A `D` with no `C` since the last `D` ends nothing (D2).
        const command = this.running
        if (!command) return
        this.running = undefined
        command.end = time
        command.exitCode = mark.exitCode
        const start = this.runningStart
        this.runningStart = undefined
        if (command.line !== undefined) {
          this.ended.push(command)
          const end = start && column && position(line(), column())
          if (end) this.endedOutputs.push({ command, start, end })
        }
        for (const listener of this.listeners) listener(command)
        return
      }
      case 'directory':
        this.lastDirectory = mark.directory
    }
  }

  /** The ended commands still in the scrollback, oldest first. */
  commands(): readonly ShellCommand<Line>[] {
    return this.ended
  }

  /**
   * The ended commands still in the scrollback with their `C` and `D` positions (#60 D1), oldest
   * first: only those fed with a column whose rows had handles.
   */
  outputs(): readonly CommandOutput<Line>[] {
    return this.endedOutputs
  }

  /** The prompts' rows, oldest first: of `A` marks, else of `B` marks if no `A` ever came (D2). */
  prompts(): readonly Line[] {
    return this.sawPromptStart ? this.promptStarts : this.promptEnds
  }

  /** The directory the shell last reported (D1), if any. */
  directory(): ShellDirectory | undefined {
    return this.lastDirectory
  }

  /**
   * Calls `listener` with each command as it ends, also one whose line has left the scrollback;
   * returns the unsubscribe function.
   */
  onCommandEnded(listener: (command: ShellCommand<Line>) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Drops the prompts and ended commands on `line`, a row gone from the scrollback. */
  forget(line: Line): void {
    remove(this.promptStarts, line)
    remove(this.promptEnds, line)
    for (let i = this.ended.length - 1; i >= 0; i--) {
      if (this.ended[i]!.line === line) this.ended.splice(i, 1)
    }
    // A command whose `C` row (or, safely, `D` row) is gone has no output (#60 D1).
    for (let i = this.endedOutputs.length - 1; i >= 0; i--) {
      const { command, start, end } = this.endedOutputs[i]!
      if (command.line === line || start.line === line || end.line === line) {
        this.endedOutputs.splice(i, 1)
      }
    }
    if (this.runningStart?.line === line) this.runningStart = undefined
    if (this.latestStart === line) this.latestStart = undefined
    if (this.latestEnd === line) this.latestEnd = undefined
  }
}

/** A mark's position, none on a row without a handle (the alt screen). */
function position<Line>(line: Line, x: number): MarkPosition<Line> | undefined {
  return line === undefined ? undefined : { line, x }
}

function remove<T>(list: T[], item: T): void {
  const index = list.indexOf(item)
  if (index >= 0) list.splice(index, 1)
}

/** Where a new split starts and what decides it (#45 D8). */
export interface SplitPlace {
  /** The card's or shell's own directory. */
  cardDirectory: string
  /** The card's or shell's SSH host; absent for a local one. */
  sshHost?: string
  /** This machine's host name, which OSC 7 may name for a local path. */
  localHostName: string
}

/**
 * The directory a new split tries first (#45 D8): the focused pane's last reported directory when
 * it is a local absolute path (OSC 7's host empty, `localhost` or this machine's, any OSC 633
 * `Cwd`), else the card's own; an SSH card's always. Whether it still exists is main's check.
 */
export function splitDirectory(
  reported: ShellDirectory | undefined,
  { cardDirectory, sshHost, localHostName }: SplitPlace
): string {
  if (sshHost !== undefined || !reported?.path.startsWith('/')) return cardDirectory
  const host = reported.host?.toLowerCase()
  const local =
    host === undefined ||
    host === '' ||
    host === 'localhost' ||
    host === localHostName.toLowerCase()
  return local ? reported.path : cardDirectory
}

const HOST_NAME_ARG = '--drovr-host-name='

/** The renderer's argument carrying this machine's host name (#45 D8), which it can't read. */
export const hostNameArg = (name: string): string => `${HOST_NAME_ARG}${name}`

/** This machine's host name in `argv`; empty without one. */
export const parseHostName = (argv: readonly string[]): string =>
  argv.find((a) => a.startsWith(HOST_NAME_ARG))?.slice(HOST_NAME_ARG.length) ?? ''
