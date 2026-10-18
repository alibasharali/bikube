import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  GitBranch,
  GitBranchPlus,
  RefreshCw,
  TreePine
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type {
  AheadBehind,
  BranchList,
  GitResult,
  NewBranchResult,
  SyncResult
} from '../../core/git'
import { refreshBranch } from './branches'
import { MENU_ICON, SMALL_ICON } from './icons'

/**
 * The title bar's branch chip (#33 D1): the branch where what is shown runs, as a button that
 * opens the branch menu below it. The menu lists the local branches, then each remote's (D4, D5);
 * clicking one switches to it. New branch shows a name field in place of the lists (D7): Enter
 * or Create makes the branch at HEAD and switches to it, Esc returns to the lists. Esc, a click
 * outside, a switch or a new branch closes it; git's refusal keeps it open with git's message
 * (D6). Fetch, Pull and Push keep it open with a note and read it again (D8, D9); its header shows
 * how far the current branch is from its upstream (D10). One command at a time, every action
 * disabled meanwhile; it keeps running when the menu is closed (D13).
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
  const [list, setList] = useState<BranchList | null>(null)
  /** What is running (`Switching…`), null when idle; every action waits for it (D13). */
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** What the last Fetch, Pull or Push did (`Fetched`), shown until the next command. */
  const [note, setNote] = useState<string | null>(null)
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
    void window.drovr.git.branches(dir).then((next) => {
      if (openRef.current) setList(next)
    })
    void window.drovr.git.aheadBehind(dir).then((next) => {
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
    setList(null)
    setSync(undefined)
    setError(null)
    setNote(null)
    setNaming(null)
    setNameProblem(null)
    setOpen(true)
    openRef.current = true
    load()
  }

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
   * Runs one git command: busy meanwhile, then the chip re-read. A switch or a new branch closes
   * the menu on success; Fetch, Pull and Push show their note and read the menu again.
   */
  const act = async (
    label: string,
    command: () => Promise<GitResult | NewBranchResult | SyncResult>
  ): Promise<void> => {
    if (busy) return
    returnFocus.current = document.activeElement
    setBusy(label)
    setError(null)
    setNote(null)
    const result = await command()
    setBusy(null)
    refreshBranch(dir)
    if (result.ok && 'note' in result) {
      setNote(result.note)
      load()
    } else if (result.ok) {
      const active = document.activeElement
      const inMenu = active === document.body || (root.current?.contains(active) ?? false)
      if (openRef.current) close(inMenu)
    } else if ('name' in result && result.name) {
      setNameProblem(result.reason)
    } else {
      setError(result.reason)
      load()
    }
  }

  const switchTo = (name: string): void => {
    if (name === list?.current) return
    void act('Switching…', () => window.drovr.git.switch(dir, name))
  }
  const track = (remote: string, name: string): void => {
    if (name === list?.current) return
    void act('Switching…', () => window.drovr.git.track(dir, remote, name))
  }

  const create = (e: React.FormEvent): void => {
    e.preventDefault()
    if (naming === null) return
    setNameProblem(null)
    void act('Creating…', () => window.drovr.git.create(dir, naming))
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
  const detached = list !== null && list.current === null
  /** Runs the action `testId` names: New branch shows the name field, the others run git. */
  const runAction = (testId: string): void => {
    if (testId === 'branch-new') {
      setError(null)
      setNote(null)
      setNameProblem(null)
      setNaming('')
    } else if (testId === 'branch-fetch') {
      void act('Fetching…', () => window.drovr.git.fetch(dir))
    } else if (testId === 'branch-pull') {
      void act('Pulling…', () => window.drovr.git.pull(dir))
    } else if (testId === 'branch-push') {
      void act('Pushing…', () => window.drovr.git.push(dir))
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
                    : 'This branch tracks no remote branch'
                }
              >
                {sync ? `↑${sync.ahead} ↓${sync.behind}` : 'No upstream'}
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
              {list === null ? (
                <p className="menu-hint branch-menu-loading">Reading branches…</p>
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
                  disabled={busy !== null || list === null || (needsBranch && detached)}
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

/** One section of the menu: `Local` or a remote, its branches by name. */
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
  return (
    <div className="branch-menu-section" role="group" aria-label={name}>
      <p className="menu-label" aria-hidden="true">
        {name}
      </p>
      {branches.length === 0 && <p className="menu-hint">No branches</p>}
      {branches.map((branch) => (
        <button
          key={branch}
          type="button"
          role="menuitem"
          className="menu-item branch-menu-item"
          data-testid="branch-item"
          aria-current={branch === current ? 'true' : undefined}
          disabled={disabled}
          onClick={() => onPick(branch)}
        >
          {branch === current ? (
            <Check {...MENU_ICON} />
          ) : (
            <span className="branch-menu-spacer" aria-hidden="true" />
          )}
          <span className="branch-menu-name">{branch}</span>
        </button>
      ))}
    </div>
  )
}
