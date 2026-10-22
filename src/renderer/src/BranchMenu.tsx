import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitBranchPlus,
  RefreshCw,
  TreePine
} from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  BRANCH_ROW_LIMIT,
  branchTree,
  foldersOf,
  visibleRows,
  type BranchNode
} from '../../core/branch-tree'
import type { AheadBehind, BranchList } from '../../core/git'
import { clearGitResult, runGit, takeGitResult, useGitRun, type GitCommandResult } from './git-runs'
import { MENU_ICON, SMALL_ICON } from './icons'

/**
 * The title bar's branch chip (#33 D1): the branch where what is shown runs, as a button that
 * opens the branch menu below it. The menu lists the local branches, then each remote's (D4, D5);
 * clicking one switches to it. New branch shows a name field in place of the lists (D7): Enter
 * or Create makes the branch at HEAD and switches to it, Esc returns to the lists. Esc, a click
 * outside, a switch or a new branch closes it; git's refusal keeps it open with git's message
 * (D6). Fetch, Pull and Push keep it open with a note and read it again (D8, D9); its header shows
 * how far the current branch is from its upstream (D10). One command at a time per folder, every
 * action disabled meanwhile in every chip for that folder; it keeps running when the menu is
 * closed or the chip goes away, and the next menu opened shows its result once (D13, `git-runs`);
 * a result shown in an open menu stays until it closes or the next command. A folder
 * that isn't a repository (any more) says so, with every action disabled.
 */
export function BranchChip({
  dir,
  branch,
  worktree = false
}: {
  /** The folder the menu acts on: the open worktree card's directory, else the workspace's (D2). */
  dir: string
  /** The branch shown, `detached` for a detached HEAD. */
  branch: string
  /** The open card's own worktree: the tree icon. */
  worktree?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  /** The folder's branches; undefined until read, null when it isn't a repository. */
  const [list, setList] = useState<BranchList | null | undefined>(undefined)
  /**
   * What is running in the folder (`Switching…`), null when idle, every action waiting for it
   * (D13); git's message when the last command failed; what the last Fetch, Pull or Push did.
   */
  const run = useGitRun(dir)
  const { busy } = run
  /** The result of a command that finished while the menu was closed, taken when it opened. */
  const [earlier, setEarlier] = useState<{ error: string | null; note: string | null } | null>(null)
  const error = run.error ?? (busy ? null : (earlier?.error ?? null))
  const note = run.note ?? (busy ? null : (earlier?.note ?? null))
  /** The current branch against its upstream; null without one, undefined until read (D10). */
  const [sync, setSync] = useState<AheadBehind | null | undefined>(undefined)
  /** The element focused when a command started, focused again when it ends. */
  const returnFocus = useRef<Element | null>(null)
  const nameField = useRef<HTMLInputElement>(null)
  /** The new branch's name while its field shows (D7), null for the lists. */
  const [naming, setNaming] = useState<string | null>(null)
  /** Why the typed name was refused before git ran, shown under the field. */
  const [nameProblem, setNameProblem] = useState<string | null>(null)
  const namingRef = useRef(naming)
  useEffect(() => {
    namingRef.current = naming
  }, [naming])
  /** New branch, focused again when Esc leaves its field. */
  const newButton = useRef<HTMLButtonElement>(null)
  const refocusNew = useRef(false)
  const [position, setPosition] = useState<React.CSSProperties>()
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  /** Whether the menu is open, for a command's result that comes after it was closed. */
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  }, [open])

  const load = (): void => {
    void window.bikube.git.branches(dir).then((next) => {
      if (openRef.current) setList(next)
    })
    void window.bikube.git.aheadBehind(dir).then((next) => {
      if (openRef.current) setSync(next)
    })
  }

  const close = (refocus: boolean): void => {
    setOpen(false)
    if (refocus) button.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const place = (): void => {
      const rect = button.current?.getBoundingClientRect()
      if (!rect) return
      setPosition({
        top: rect.bottom + 4,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 288))
      })
    }
    place()
    const onDown = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    // Escape closes it wherever focus is (from the name field: back to the lists), and nothing
    // else sees it.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      if (namingRef.current !== null) {
        refocusNew.current = true
        namingRef.current = null
        setNaming(null)
        setNameProblem(null)
        return
      }
      close(true)
    }
    window.addEventListener('resize', place)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('resize', place)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  // Focus the current branch (or the first item) once the list shows.
  useEffect(() => {
    if (!open || !list) return
    const items = popup.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')
    const current = popup.current?.querySelector<HTMLElement>('[aria-current="true"]')
    if (!popup.current?.contains(document.activeElement)) (current ?? items?.[0])?.focus()
  }, [open, list])

  useEffect(() => {
    if (naming !== null || !refocusNew.current) return
    refocusNew.current = false
    newButton.current?.focus()
  }, [naming])

  const toggle = (): void => {
    if (open) {
      setOpen(false)
      return
    }
    setList(undefined)
    setSync(undefined)
    setEarlier(takeGitResult(dir))
    setNaming(null)
    setNameProblem(null)
    setOpen(true)
    openRef.current = true
    load()
  }

  // Closing the menu forgets the result it showed (the next opening takes a new one); a command
  // still running keeps its result for the next opening.
  const wasOpen = useRef(open)
  useEffect(() => {
    const closed = wasOpen.current && !open
    wasOpen.current = open
    if (closed) clearGitResult(dir)
  }, [open, dir])

  // When the folder's command ends (started here or in a chip since gone), read the menu again.
  const wasBusy = useRef(busy)
  useEffect(() => {
    const ended = wasBusy.current !== null && busy === null
    wasBusy.current = busy
    if (ended && openRef.current) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` reads only refs and `dir`
  }, [busy])

  // A command's disabled buttons lose the focus: give it back when the command ends, to the name
  // field when the name was refused (D7), else to what had it.
  useEffect(() => {
    if (busy !== null) return
    const back = returnFocus.current
    returnFocus.current = null
    if (nameProblem !== null) {
      nameField.current?.focus()
      return
    }
    const lost = document.activeElement === null || document.activeElement === document.body
    if (lost && back instanceof HTMLElement && popup.current?.contains(back)) back.focus()
  }, [busy, nameProblem])

  /**
   * Runs one git command as the folder's one command (`runGit`: busy meanwhile, its note or error
   * kept, the chip re-read). A switch or a new branch closes the menu on success; a refused name
   * shows under the field; the menu is read again when the command ends (above).
   */
  const act = async (label: string, command: () => Promise<GitCommandResult>): Promise<void> => {
    if (busy) return
    returnFocus.current = document.activeElement
    setEarlier(null)
    const result = await runGit(dir, label, command)
    if (!result) return
    if (result.ok && !('note' in result)) {
      const active = document.activeElement
      const inMenu = active === document.body || (root.current?.contains(active) ?? false)
      if (openRef.current) close(inMenu)
    } else if (!result.ok && 'name' in result && result.name) {
      setNameProblem(result.reason)
    }
  }

  const switchTo = (name: string): void => {
    if (name === list?.current) return
    void act('Switching…', () => window.bikube.git.switch(dir, name))
  }
  const track = (remote: string, name: string): void => {
    if (name === list?.current) return
    void act('Switching…', () => window.bikube.git.track(dir, remote, name))
  }

  const create = (e: React.FormEvent): void => {
    e.preventDefault()
    if (naming === null) return
    setNameProblem(null)
    void act('Creating…', () => window.bikube.git.create(dir, naming))
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    if (e.target instanceof HTMLInputElement) return
    e.preventDefault()
    const items = Array.from(
      popup.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []
    )
    if (items.length === 0) return
    const at = items.indexOf(document.activeElement as HTMLElement)
    const step = e.key === 'ArrowDown' ? 1 : -1
    items[(at + step + items.length) % items.length]!.focus()
  }

  const Icon = worktree ? TreePine : GitBranch
  const detached = list != null && list.current === null
  /** Runs the action `testId` names: New branch shows the name field, the others run git. */
  const runAction = (testId: string): void => {
    if (testId === 'branch-new') {
      clearGitResult(dir)
      setEarlier(null)
      setNameProblem(null)
      setNaming('')
    } else if (testId === 'branch-fetch') {
      void act('Fetching…', () => window.bikube.git.fetch(dir))
    } else if (testId === 'branch-pull') {
      void act('Pulling…', () => window.bikube.git.pull(dir))
    } else if (testId === 'branch-push') {
      void act('Pushing…', () => window.bikube.git.push(dir))
    }
  }

  const actions: {
    label: string
    testId: string
    icon: typeof Check
    /** Pull and Push need a branch: disabled on a detached HEAD (D9). */
    needsBranch?: boolean
  }[] = [
    { label: 'New branch', testId: 'branch-new', icon: GitBranchPlus },
    { label: 'Fetch', testId: 'branch-fetch', icon: RefreshCw },
    { label: 'Pull', testId: 'branch-pull', icon: ArrowDownToLine, needsBranch: true },
    { label: 'Push', testId: 'branch-push', icon: ArrowUpFromLine, needsBranch: true }
  ]

  return (
    <div className="branch-chip-wrap" ref={root} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className={
          worktree ? 'card-branch card-branch-worktree branch-chip' : 'card-branch branch-chip'
        }
        data-testid="card-branch"
        data-worktree={worktree || undefined}
        title={worktree ? `Own worktree on ${branch}` : `On ${branch}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy !== null || undefined}
        onClick={toggle}
      >
        <Icon {...SMALL_ICON} />
        <span className="card-branch-name">{branch}</span>
        <ChevronDown {...SMALL_ICON} className="branch-chip-chevron" />
      </button>
      {open && (
        <div
          ref={popup}
          className="branch-menu"
          role="menu"
          aria-label="Branches"
          aria-busy={busy !== null}
          data-testid="branch-menu"
          style={{ position: 'fixed', ...position }}
        >
          {list?.current && sync !== undefined && (
            <div className="branch-menu-header">
              <span className="branch-menu-current">{list.current}</span>
              <span
                className="branch-menu-sync"
                data-testid="branch-sync"
                title={
                  sync
                    ? 'Commits ahead of and behind its upstream, as of the last fetch'
                    : list.remotes.length === 0
                      ? 'This repository has no remote'
                      : 'This branch tracks no remote branch'
                }
              >
                {sync
                  ? `↑${sync.ahead} ↓${sync.behind}`
                  : list.remotes.length === 0
                    ? 'No remote'
                    : 'No upstream'}
              </span>
            </div>
          )}
          {busy && (
            <p className="branch-menu-status" role="status" data-testid="branch-busy">
              {busy}
            </p>
          )}
          {error && (
            <p className="branch-menu-error" role="alert" data-testid="branch-error">
              {error}
            </p>
          )}
          {note && (
            <p
              className="branch-menu-status branch-menu-note"
              role="status"
              data-testid="branch-note"
            >
              {note}
            </p>
          )}
          {naming !== null ? (
            <form className="branch-menu-new" onSubmit={create} noValidate>
              <label className="menu-label" htmlFor="branch-new-name">
                New branch from {list?.current ?? 'HEAD'}
              </label>
              <div className="branch-menu-new-row">
                <input
                  ref={nameField}
                  id="branch-new-name"
                  className="inline-input branch-menu-new-name"
                  data-testid="branch-new-name"
                  value={naming}
                  autoFocus
                  spellCheck={false}
                  autoComplete="off"
                  disabled={busy !== null}
                  aria-invalid={nameProblem ? true : undefined}
                  aria-describedby={nameProblem ? 'branch-new-problem' : undefined}
                  onChange={(e) => {
                    setNaming(e.target.value)
                    setNameProblem(null)
                  }}
                />
                <button
                  type="submit"
                  className="btn btn-primary btn-small"
                  data-testid="branch-new-create"
                  disabled={busy !== null}
                >
                  Create
                </button>
              </div>
              {nameProblem && (
                <p
                  className="field-error"
                  id="branch-new-problem"
                  role="alert"
                  data-testid="branch-new-problem"
                >
                  {nameProblem}
                </p>
              )}
            </form>
          ) : (
            <div className="branch-menu-lists">
              {list === undefined ? (
                <p className="menu-hint branch-menu-loading">Reading branches…</p>
              ) : list === null ? (
                <p className="menu-hint" data-testid="branch-not-repository">
                  Not a git repository
                </p>
              ) : (
                <>
                  <BranchSection
                    name="Local"
                    branches={list.local}
                    current={list.current}
                    disabled={busy !== null}
                    onPick={switchTo}
                  />
                  {list.remotes.map((remote) => (
                    <BranchSection
                      key={remote.name}
                      name={remote.name}
                      branches={remote.branches}
                      current={null}
                      disabled={busy !== null}
                      onPick={(name) => track(remote.name, name)}
                    />
                  ))}
                </>
              )}
            </div>
          )}
          {naming === null && (
            <div className="branch-menu-actions">
              {actions.map(({ label, testId, icon: ActionIcon, needsBranch }) => (
                <button
                  key={label}
                  ref={testId === 'branch-new' ? newButton : undefined}
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  data-testid={testId}
                  disabled={busy !== null || !list || (needsBranch && detached)}
                  onClick={() => runAction(testId)}
                >
                  <ActionIcon {...MENU_ICON} />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * One section of the menu: `Local` or a remote, its branches as a tree of folders by their `/`
 * segments (`branch-tree`). The folders holding the current branch start open; a click, Enter,
 * or Right and Left open and close one. At the top level it shows its first loose branches, View
 * all, then every folder; an open folder shows everything in it.
 */
function BranchSection({
  name,
  branches,
  current,
  disabled,
  onPick
}: {
  name: string
  branches: string[]
  /** The checked-out branch, marked (Local only). */
  current: string | null
  disabled: boolean
  onPick: (branch: string) => void
}): React.JSX.Element {
  const tree = useMemo(() => branchTree(branches), [branches])
  const [expanded, setExpanded] = useState(() => new Set(foldersOf(tree, current)))
  const [showAll, setShowAll] = useState(false)
  const section = useRef<HTMLDivElement>(null)
  /** The first row View all showed, focused once it is there. */
  const focusRow = useRef<number | null>(null)
  const { branches: loose, folders, hidden } = visibleRows(tree, current, showAll)

  useEffect(() => {
    const at = focusRow.current
    if (at === null) return
    focusRow.current = null
    section.current?.querySelector<HTMLElement>(`[data-top-row="${at}"]`)?.focus()
  }, [showAll])

  const setOpen = (path: string, open: boolean): void => {
    setExpanded((was) => {
      if (was.has(path) === open) return was
      const next = new Set(was)
      if (open) next.add(path)
      else next.delete(path)
      return next
    })
  }

  const renderNode = (node: BranchNode, depth: number, topRow?: number): React.JSX.Element => {
    const indent = { paddingLeft: `calc(var(--space-2) + ${depth * 14}px)` }
    if (node.kind === 'branch') {
      return (
        <button
          key={`b:${node.branch}`}
          type="button"
          role="menuitem"
          className="menu-item branch-menu-item"
          data-testid="branch-item"
          data-branch={node.branch}
          data-top-row={topRow}
          style={indent}
          title={node.branch}
          aria-current={node.branch === current ? 'true' : undefined}
          disabled={disabled}
          onClick={() => onPick(node.branch)}
        >
          {node.branch === current ? (
            <Check {...MENU_ICON} />
          ) : (
            <span className="branch-menu-spacer" aria-hidden="true" />
          )}
          <span className="branch-menu-name">{node.label}</span>
        </button>
      )
    }
    const open = expanded.has(node.path)
    const Chevron = open ? ChevronDown : ChevronRight
    return (
      <Fragment key={`f:${node.path}`}>
        <button
          type="button"
          role="menuitem"
          className="menu-item branch-menu-item branch-menu-folder"
          data-testid="branch-folder"
          data-path={node.path}
          data-top-row={topRow}
          style={indent}
          aria-expanded={open}
          title={`${node.path}/ (${node.count} branches)`}
          onClick={() => setOpen(node.path, !open)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
            e.preventDefault()
            setOpen(node.path, e.key === 'ArrowRight')
          }}
        >
          <Chevron {...MENU_ICON} />
          <span className="branch-menu-name">{node.label}</span>
          <span className="branch-menu-count" aria-label={`${node.count} branches`}>
            {node.count}
          </span>
        </button>
        {open && node.children.map((child) => renderNode(child, depth + 1))}
      </Fragment>
    )
  }

  return (
    <div className="branch-menu-section" role="group" aria-label={name} ref={section}>
      <p className="menu-label" aria-hidden="true">
        {name}
      </p>
      {branches.length === 0 && <p className="menu-hint">No branches</p>}
      {loose.map((node, i) => renderNode(node, 0, i))}
      {hidden > 0 && (
        <button
          type="button"
          role="menuitem"
          className="menu-item branch-menu-item branch-menu-more"
          data-testid="branch-view-all"
          onClick={() => {
            focusRow.current = BRANCH_ROW_LIMIT
            setShowAll(true)
          }}
        >
          <span className="branch-menu-spacer" aria-hidden="true" />
          View all ({loose.length + hidden})
        </button>
      )}
      {folders.map((node) => renderNode(node, 0))}
    </div>
  )
}
