/**
 * The renderer's answer to a `board` request (#9 D10): it resolves the card and column against
 * its store, applies the change, and answers with the reply the CLI prints. Plain TS.
 */
import type { Activity } from './activity'
import type { ReplyRead } from './agent-tab'
import {
  ORCHESTRATOR_ONLY_COMMANDS,
  WAIT_DEFAULT_SECONDS,
  type BoardCommand,
  type SetupResult
} from './board-args'
import {
  boardListing,
  formatBoardListing,
  formatWorkspacesListing,
  workspacesListing,
  type CardRuntime
} from './board-list'
import {
  ACROSS_WORKSPACES,
  agentStartup,
  inheritedStartup,
  placedIn,
  resolveAnyCard,
  resolveWorkspace,
  servesRemoteCard,
  boardMoveTarget,
  cleanAgentStatus,
  cleanCardTitle,
  TITLE_REQUIRED,
  findCallingWorkspace,
  callingTerminal,
  CALLING_CARD,
  SHELL_NOT_A_CARD,
  ORCHESTRATOR_NOT_A_CARD,
  ONLY_ORCHESTRATOR,
  noSetupError,
  notRunningError,
  resolveCard,
  resolveColumn
} from './board-commands'
import { INVALID_REQUEST, type BoardReply } from './board-protocol'
import { checkSendText } from './board-send'
import type { StartOutcome } from './board-start'
import { waitTimedOut, type WaitResult } from './board-wait'
import { transcriptBackupTarget } from './transcript-backup-target'
import type { ClaudeUsage } from './claude-usage-types'
import { orchestratorGuide } from './orchestrator-guide'
import type { Card, Workspace, WorkspaceState, WorkspaceStore } from './workspace-store'
import { branchProblem, suggestBranch } from './worktree-names'

/** The local branches of the repository a folder is in, or null outside one (main's `worktree.info`). */
export type RepoBranches = (dir: string) => Promise<{ branches: string[] } | null>

/**
 * `board create --worktree`'s checks (#69 D10), run before the card is created since they ask
 * git: the target workspace must be local and inside a git repository, and the branch (the one
 * given, else `suggestBranch`'s from the title, free among the repository's branches) must be a
 * valid name, checked before git is asked, that doesn't exist yet. Answers with the command,
 * its `branch` filled in, or the reason to refuse it with. Any other command, and a create the
 * board refuses anyway (no calling card, an SSH card's, no title), comes back as it is.
 */
export async function checkCreateWorktree(
  state: WorkspaceState,
  callingCardId: string,
  command: BoardCommand,
  repoBranches: RepoBranches
): Promise<{ ok: true; command: BoardCommand } | { ok: false; error: string }> {
  const unchanged = { ok: true as const, command }
  if (command.command !== 'create' || !command.worktree) return unchanged
  const calling = findCallingWorkspace(state, callingCardId)
  if (!calling.ok) return unchanged
  if (callingTerminal(calling.value, callingCardId).card.host !== undefined) return unchanged
  const title = cleanCardTitle(command.title)
  if (!title) return unchanged
  const target =
    command.workspace !== undefined ? resolveWorkspace(state, command.workspace) : calling
  if (!target.ok) return target
  const ws = target.value
  const column = resolveColumn(ws, command.column)
  if (!column.ok) return column
  if (ws.host !== undefined) return { ok: false, error: `board: ${ws.name} is an SSH workspace` }
  if (command.branch !== undefined) {
    const problem = branchProblem(command.branch)
    if (problem) return { ok: false, error: `board: ${problem}` }
  }
  const repo = await repoBranches(ws.directory)
  if (!repo) return { ok: false, error: `board: ${ws.directory} is not in a git repository` }
  const branch = command.branch ?? suggestBranch(title, new Set(repo.branches))
  if (repo.branches.includes(branch)) {
    return { ok: false, error: `board: a branch named '${branch}' already exists` }
  }
  return { ok: true, command: { ...command, branch } }
}

/** What a workspace shell's `.` hands on: its status, activity, Claude Code session and usage. */
interface ShellReports {
  setAgentStatus: (cardId: string, text: string) => void
  setActivity: (cardId: string, activity: Activity | null) => void
  setShellSession: (shellId: string, sessionId: string) => void
  setUsage: (cardId: string, usage: ClaudeUsage) => void
}

/**
 * `command` naming `.` from a workspace shell (see `answerBoardCommand`): its status, activity,
 * Claude Code session and usage are handed on for the running shell, runtime only (#75 D3a);
 * `description` prints nothing; anything else is refused.
 */
function answerShell(
  shellId: string,
  command: BoardCommand,
  isRunning: (cardId: string) => boolean,
  reports: ShellReports
): BoardReply {
  if (
    command.command === 'status' ||
    command.command === 'activity' ||
    command.command === 'session' ||
    command.command === 'usage'
  ) {
    if (!isRunning(shellId)) return { ok: false, error: SHELL_NOT_A_CARD }
    if (command.command === 'status') {
      reports.setAgentStatus(shellId, cleanAgentStatus(command.text))
    } else if (command.command === 'activity') {
      reports.setActivity(shellId, command.activity === 'none' ? null : command.activity)
    } else if (command.command === 'session') {
      reports.setShellSession(shellId, command.session.toLowerCase())
    } else reports.setUsage(shellId, command.usage)
    return { ok: true }
  }
  if (command.command === 'description') return { ok: true }
  return { ok: false, error: SHELL_NOT_A_CARD }
}

/**
 * What the orchestrator-only commands read and do in the renderer (#81 D13, D17–D23); later
 * slices add theirs. Every field is optional so callers and tests pass only what they use.
 */
export interface OrchestratorAnswers {
  /** Settings' Your orchestrator instructions (D14), read at each `board guide`. */
  instructions?: () => string
  /**
   * Starts a stopped card or shell in the background exactly as opening it would (D17: a pending
   * worktree first, a conversation check), changing no view; resolves with how its start ended.
   */
  start?: (workspaceId: string, cardId: string) => Promise<StartOutcome>
  /**
   * Shows a running card or shell (D17, D22): makes its workspace active and opens it at full size,
   * in its own window if it has one, as any open does (clearing `New`).
   */
  open?: (workspaceId: string, cardId: string) => void
  /**
   * Types the cleaned text into the running card's main pane as one paste, then Enter 50 ms later
   * (D19); resolves once the Enter is typed.
   */
  send?: (cardId: string, text: string) => Promise<void>
  /** Waits until the card stops, waits or asks, `seconds` at most (D20). */
  wait?: (cardId: string, seconds: number) => Promise<WaitResult | 'timeout'>
  /** Main's read of the last reply in the Claude Code session's transcript in `folder` (D21). */
  reply?: (folder: string, sessionId: string) => Promise<ReplyRead>
}

/** The orchestrator-only `command` from the Orchestrator of `workspace` (#81 D16). */
type OrchestratorOnly = Extract<
  BoardCommand,
  { command: 'guide' | 'start' | 'open' | 'send' | 'wait' | 'reply' | 'terminal' | 'palette' }
>

const isOrchestratorOnly = (command: BoardCommand): command is OrchestratorOnly =>
  ORCHESTRATOR_ONLY_COMMANDS.has(command.command)

/** The refusal for a card or terminal whose start failed (#81 D17). */
const startFailed = (title: string, reason: string): BoardReply => ({
  ok: false,
  error: `board: "${title}" couldn't start: ${reason}`
})

/**
 * An orchestrator-only command from the Orchestrator of `workspace`: `guide` prints the guide
 * with the workspace's name and folder and the user's instructions (D13); `start`, `open`,
 * `terminal`, `send`, `wait` and `reply` are `answerBoardRequest`'s; `palette` comes with S6.
 */
function answerOrchestratorOnly(
  workspace: Workspace,
  command: OrchestratorOnly,
  answers: OrchestratorAnswers
): BoardReply {
  if (command.command === 'guide') {
    const output = orchestratorGuide(
      workspace.name,
      workspace.directory,
      answers.instructions?.() ?? ''
    )
    return { ok: true, output }
  }
  return { ok: false, error: `board: ${command.command} is not available yet` }
}

/** The commands answered once something has happened, not at once (#81 D17, D19–D22). */
type AwaitedCommand = Extract<
  BoardCommand,
  { command: 'start' | 'open' | 'terminal' | 'send' | 'wait' | 'reply' }
>

const AWAITED: ReadonlySet<BoardCommand['command']> = new Set([
  'start',
  'open',
  'terminal',
  'send',
  'wait',
  'reply'
])

const isAwaited = (command: BoardCommand): command is AwaitedCommand => AWAITED.has(command.command)

/** A start's answer: nothing, or that it is still starting at the renderer's limit (D17). */
const started = (title: string, outcome: StartOutcome): BoardReply =>
  outcome.ok && outcome.pending
    ? { ok: true, output: `${title} is still starting\n` }
    : { ok: true }

/** `send`, `wait` and `reply` on a card found for the Orchestrator (D19–D21). */
async function answerCardCommand(
  card: Card,
  command: Extract<AwaitedCommand, { command: 'send' | 'wait' | 'reply' }>,
  isRunning: (cardId: string) => boolean,
  answers: OrchestratorAnswers
): Promise<BoardReply> {
  if (command.command === 'send') {
    if (!isRunning(card.id)) return { ok: false, error: notRunningError(card) }
    const checked = checkSendText(command.text)
    if (!checked.ok) return checked
    await answers.send?.(card.id, checked.text)
    return { ok: true }
  }
  if (command.command === 'wait') {
    const seconds = command.timeout ?? WAIT_DEFAULT_SECONDS
    const result = answers.wait ? await answers.wait(card.id, seconds) : 'timeout'
    return result === 'timeout'
      ? { ok: false, error: waitTimedOut(seconds) }
      : { ok: true, output: `${result}\n` }
  }
  // A local Claude Code card's transcript is on this machine (#75 D3); any other card has none.
  const target = transcriptBackupTarget(card)
  if (!target) return { ok: false, error: `board: "${card.title}" is not a Claude Code card` }
  const read = answers.reply
    ? await answers.reply(target.folder, target.sessionId)
    : ({ state: 'none' } as const)
  return read.state === 'reply'
    ? { ok: true, output: `${read.text}\n` }
    : { ok: false, error: `board: "${card.title}" has no reply yet` }
}

/**
 * `start` and `open` act on a card by id in any workspace, or by title in the active workspace or
 * `--workspace`'s (D17); `terminal` adds a temporary terminal typing its command to
 * `--workspace`'s workspace, else the active one, starts it and, with `--show`, opens it (D22).
 * Each answers once the start is over, refusing a failed one with its reason, and saying a start
 * still undecided at the renderer's limit is still starting. `send`, `wait` and `reply` find their
 * card as `start` does and answer as `answerCardCommand` does (D19–D21).
 */
function answerAwaited(
  state: WorkspaceState,
  store: Pick<WorkspaceStore, 'createTemporaryShell'>,
  workspace: Workspace,
  callingCardId: string,
  command: AwaitedCommand,
  isRunning: (cardId: string) => boolean,
  answers: OrchestratorAnswers
): BoardReply | Promise<BoardReply> {
  // The workspace `--workspace` names, else the active one (the user's, not the Orchestrator's).
  const named =
    'workspace' in command && command.workspace !== undefined
      ? resolveWorkspace(state, command.workspace)
      : {
          ok: true as const,
          value: state.workspaces.find((w) => w.id === state.activeId) ?? workspace
        }
  if (!named.ok) return named
  const start =
    answers.start ?? (async (): Promise<StartOutcome> => ({ ok: false, reason: 'not available' }))
  const open = answers.open ?? (() => {})
  if (command.command === 'terminal') {
    const added = store.createTemporaryShell(named.value.id, command.line)
    if (!added.ok) return { ok: false, error: `board: ${added.error.message}` }
    const shell = added.value
    return start(named.value.id, shell.id).then((started) => {
      if (!started.ok) return startFailed(shell.name, started.reason)
      if (command.show) open(named.value.id, shell.id)
      return { ok: true, output: `${shell.name} ${shell.id}\n` }
    })
  }
  const placed = resolveAnyCard(state, named.value, callingCardId, command.card)
  if (!placed.ok) return placed
  const { workspace: ws, card } = placed.value
  if (command.command === 'send' || command.command === 'wait' || command.command === 'reply') {
    return answerCardCommand(card, command, isRunning, answers)
  }
  if (isRunning(card.id)) {
    if (command.command === 'start') {
      return { ok: true, output: `${card.title} is already running\n` }
    }
    open(ws.id, card.id)
    return { ok: true }
  }
  return start(ws.id, card.id).then((outcome) => {
    if (!outcome.ok) return startFailed(card.title, outcome.reason)
    if (command.command === 'open') open(ws.id, card.id)
    return started(card.title, outcome)
  })
}

/**
 * `command` naming `.` from the Orchestrator (#81 D9): its status, activity and usage are handed
 * on for it at runtime (it has no board card to keep them on), its session is saved as its
 * conversation (D8), `description` prints nothing, and anything else is refused.
 */
function answerOrchestrator(
  store: Pick<WorkspaceStore, 'setAgentSession'>,
  workspaceId: string,
  orchestrator: Card,
  command: BoardCommand,
  isRunning: (cardId: string) => boolean,
  reports: Omit<ShellReports, 'setShellSession'>
): BoardReply {
  const id = orchestrator.id
  if (command.command === 'description') return { ok: true }
  if (command.command === 'session') {
    const set = store.setAgentSession(workspaceId, id, command.session.toLowerCase())
    return set.ok ? { ok: true } : { ok: false, error: `board: ${set.error.message}` }
  }
  if (
    command.command !== 'status' &&
    command.command !== 'activity' &&
    command.command !== 'usage'
  ) {
    return { ok: false, error: ORCHESTRATOR_NOT_A_CARD }
  }
  if (!isRunning(id)) return { ok: false, error: notRunningError(orchestrator) }
  if (command.command === 'status') reports.setAgentStatus(id, cleanAgentStatus(command.text))
  else if (command.command === 'activity') {
    reports.setActivity(id, command.activity === 'none' ? null : command.activity)
  } else reports.setUsage(id, command.usage)
  return { ok: true }
}

/** `answerBoardCommand`'s and `answerBoardRequest`'s arguments. */
type AnswerArgs = [
  store: Pick<
    WorkspaceStore,
    | 'getState'
    | 'moveCard'
    | 'setAgentSession'
    | 'clearCardSetup'
    | 'createCard'
    | 'renameCard'
    | 'setCardLastStatus'
    | 'setCardLastUsage'
    | 'setCardDescription'
    | 'createTemporaryShell'
  >,
  callingCardId: string,
  command: BoardCommand,
  isRunning: (cardId: string) => boolean,
  setAgentStatus: (cardId: string, text: string) => void,
  setActivity?: (cardId: string, activity: Activity | null) => void,
  setupAnswered?: (card: Card, result: SetupResult) => void,
  setUsage?: (cardId: string, usage: ClaudeUsage) => void,
  runtime?: (cardId: string) => CardRuntime,
  setShellSession?: (shellId: string, sessionId: string) => void,
  orchestrator?: OrchestratorAnswers
]

/**
 * Applies `command` for the calling card (#9 D2, D7, D8). A move goes to the bottom of the
 * column through the store, so it is saved like any board change (#8 D6). `status` needs a
 * running card and hands the cleaned text to `setAgentStatus` (#9 D8), which shows it, and keeps
 * it in the store as the card's last status, shown once it stops;
 * `activity` likewise hands its value to `setActivity`, null for `none` (#31 D12). `setup` acts
 * only on the calling card, which must be running with a pending setup (#39 D4): `ok` clears it in the store (saved) and hands the
 * card as it now is to `setupAnswered`, which types its start line; `failed` keeps it. `usage`
 * needs a running card and hands the usage to `setUsage`, also keeping it in the store as the
 * card's last usage, so it is there after a restart (#50 D5, D7). From a workspace shell, `.`'s
 * `session` goes to `setShellSession` and its `usage` to `setUsage`, both runtime only (#75 D3a).
 * `list` answers with the workspace's columns and cards (`runtime` gives each card's state);
 * `create` adds a card, not started, at the bottom of a column and answers with its id; `rename`
 * renames one. Both save through the store like any board change. `description` answers with
 * the card's description and one newline, or nothing; `describe` replaces it through the store,
 * which trims it, removes it when empty and refuses one over the cap (#69 D5).
 * `start`, `open`, `terminal`, `send`, `wait` and `reply` from the Orchestrator are answered by `answerBoardRequest`.
 */
export function answerBoardCommand(
  store: AnswerArgs[0],
  callingCardId: string,
  command: BoardCommand,
  isRunning: (cardId: string) => boolean,
  setAgentStatus: (cardId: string, text: string) => void,
  setActivity: (cardId: string, activity: Activity | null) => void = () => {},
  setupAnswered: (card: Card, result: SetupResult) => void = () => {},
  setUsage: (cardId: string, usage: ClaudeUsage) => void = () => {},
  runtime: (cardId: string) => CardRuntime = (id) => ({ running: isRunning(id) }),
  setShellSession: (shellId: string, sessionId: string) => void = () => {},
  orchestrator: OrchestratorAnswers = {}
): BoardReply {
  const state = store.getState()
  const workspace = findCallingWorkspace(state, callingCardId)
  if (!workspace.ok) return workspace
  const calling = workspace.value
  // A workspace shell may call too: it lists, creates and acts on named cards, never on `.`.
  // So may the Orchestrator (#81 D16).
  const { card: callingCard, shell, kind } = callingTerminal(calling, callingCardId)
  // An SSH card's session socket serves only its own card's workspace (#69 D9).
  const remote = callingCard.host !== undefined
  if (remote && !servesRemoteCard(command)) return { ok: false, error: INVALID_REQUEST }
  // Main lets these through only from the Orchestrator's own socket (#81 D16); checked again here.
  if (isOrchestratorOnly(command)) {
    return kind === 'orchestrator'
      ? answerOrchestratorOnly(calling, command, orchestrator)
      : { ok: false, error: ONLY_ORCHESTRATOR }
  }
  if (command.command === 'workspaces') {
    const listing = workspacesListing(state, calling.id)
    const output =
      command.format === 'json'
        ? `${JSON.stringify(listing, null, 2)}\n`
        : formatWorkspacesListing(listing)
    return { ok: true, output }
  }
  // Titles resolve in the workspace `--workspace` names, else the calling card's (#69 D6, D7).
  let titles = calling
  if ('workspace' in command && command.workspace !== undefined) {
    const named = resolveWorkspace(state, command.workspace)
    if (!named.ok) return named
    titles = named.value
  }
  if (command.command === 'list') {
    const listing = boardListing(titles, callingCardId, runtime)
    const output =
      command.format === 'json'
        ? `${JSON.stringify(listing, null, 2)}\n`
        : formatBoardListing(listing)
    return { ok: true, output }
  }
  if (command.command === 'create') {
    const title = cleanCardTitle(command.title)
    if (!title) return { ok: false, error: TITLE_REQUIRED }
    const column = resolveColumn(titles, command.column)
    if (!column.ok) return column
    // Its branch is filled in by `checkCreateWorktree`, which must have run (#69 D10).
    if (command.worktree && command.branch === undefined) {
      return { ok: false, error: INVALID_REQUEST }
    }
    // The Orchestrator has no agent of its own to pass on: the target workspace's default (D16).
    const startup =
      command.agent !== undefined
        ? agentStartup(command.agent)
        : kind === 'orchestrator'
          ? undefined
          : inheritedStartup(callingCard)
    const created = store.createCard(
      titles.id,
      column.value.id,
      title,
      startup,
      undefined,
      command.description,
      {
        unopened: titles.id !== calling.id,
        // Its fresh start is told to start working (#81 D18).
        orchestrated: kind === 'orchestrator',
        ...(command.worktree &&
          command.branch !== undefined && { pendingWorktree: { branch: command.branch } })
      }
    )
    if (!created.ok) return { ok: false, error: `board: ${created.error.message}` }
    return { ok: true, output: `${created.value.id} ${titles.name}\n` }
  }
  // A shell is a terminal like a card's (Claude Code typed in it gets Bikube's hooks): its
  // status, activity, session and usage are kept for it, runtime only (#75 D3a); it has no
  // description, and it can't be moved, renamed, described or set up.
  if (shell && command.card === CALLING_CARD) {
    return answerShell(callingCardId, command, isRunning, {
      setAgentStatus,
      setActivity,
      setShellSession,
      setUsage
    })
  }
  if (kind === 'orchestrator' && command.card === CALLING_CARD) {
    return answerOrchestrator(store, calling.id, callingCard, command, isRunning, {
      setAgentStatus,
      setActivity,
      setUsage
    })
  }
  // A card's id names it in any workspace for a local card (#69 D7); `activity`, `session`,
  // `setup` and `usage` stay in the calling workspace, as an SSH card's commands do (D9).
  const placed =
    remote || !ACROSS_WORKSPACES.has(command.command)
      ? placedIn(calling, resolveCard(calling, callingCardId, command.card))
      : resolveAnyCard(state, titles, callingCardId, command.card)
  if (!placed.ok) return placed
  const ws = placed.value.workspace
  const card = { ok: true as const, value: placed.value.card }
  if (command.command === 'description') {
    const { description } = card.value
    return description ? { ok: true, output: `${description}\n` } : { ok: true }
  }
  if (command.command === 'describe') {
    const set = store.setCardDescription(ws.id, card.value.id, command.description)
    return set.ok ? { ok: true } : { ok: false, error: `board: ${set.error.message}` }
  }
  if (command.command === 'status') {
    if (!isRunning(card.value.id)) return { ok: false, error: notRunningError(card.value) }
    const text = cleanAgentStatus(command.text)
    setAgentStatus(card.value.id, text)
    store.setCardLastStatus(ws.id, card.value.id, text)
    return { ok: true }
  }
  if (command.command === 'rename') {
    const title = cleanCardTitle(command.title)
    if (!title) return { ok: false, error: TITLE_REQUIRED }
    const renamed = store.renameCard(ws.id, card.value.id, title)
    return renamed.ok ? { ok: true } : { ok: false, error: `board: ${renamed.error.message}` }
  }
  if (command.command === 'session') {
    // Bikube's Claude hooks: the session this card resumes from now on (a message sent, a /resume).
    const set = store.setAgentSession(ws.id, card.value.id, command.session.toLowerCase())
    return set.ok ? { ok: true } : { ok: false, error: `board: ${set.error.message}` }
  }
  if (command.command === 'setup') {
    // Only the calling card's own setup (D4): another card's reads as having none.
    if (card.value.id !== callingCardId || !isRunning(card.value.id) || !card.value.setup) {
      return { ok: false, error: noSetupError(card.value) }
    }
    if (command.result === 'failed') {
      setupAnswered(card.value, 'failed')
      return { ok: true }
    }
    const cleared = store.clearCardSetup(ws.id, card.value.id)
    if (!cleared.ok) return { ok: false, error: `board: ${cleared.error.message}` }
    setupAnswered(cleared.value, 'ok')
    return { ok: true }
  }
  if (command.command === 'usage') {
    if (!isRunning(card.value.id)) return { ok: false, error: notRunningError(card.value) }
    setUsage(card.value.id, command.usage)
    store.setCardLastUsage(ws.id, card.value.id, command.usage)
    return { ok: true }
  }
  if (command.command === 'activity') {
    if (!isRunning(card.value.id)) return { ok: false, error: notRunningError(card.value) }
    setActivity(card.value.id, command.activity === 'none' ? null : command.activity)
    return { ok: true }
  }
  const column = resolveColumn(ws, command.column)
  if (!column.ok) return column
  const target = boardMoveTarget(ws, card.value, column.value.id)
  if (!target) return { ok: true }
  const moved = store.moveCard(ws.id, card.value.id, target.columnId, target.index)
  return moved.ok ? { ok: true } : { ok: false, error: `board: ${moved.error.message}` }
}

/**
 * `answerBoardCommand` for every request, with the Orchestrator's `start`, `open` and `terminal`
 * (#81 D17, D22) answered once the start they make is over, and its `send`, `wait` and `reply`
 * (D19–D21) once typed, ended or read, as a promise.
 */
export function answerBoardRequest(...args: AnswerArgs): BoardReply | Promise<BoardReply> {
  const [store, callingCardId, command, isRunning] = args
  const calling = findCallingWorkspace(store.getState(), callingCardId)
  if (
    !isAwaited(command) ||
    !calling.ok ||
    callingTerminal(calling.value, callingCardId).kind !== 'orchestrator'
  ) {
    return answerBoardCommand(...args)
  }
  return answerAwaited(
    store.getState(),
    store,
    calling.value,
    callingCardId,
    command,
    isRunning,
    args[10] ?? {}
  )
}
