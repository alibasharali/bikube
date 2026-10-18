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
import type { BranchList, GitResult } from '../../core/git'
import { refreshBranch } from './branches'
import { MENU_ICON, SMALL_ICON } from './icons'

/**
 * The title bar's branch chip (#33 D1): the branch where what is shown runs, as a button that
 * opens the branch menu below it. The menu lists the local branches, then each remote's (D4, D5);
 * clicking one switches to it. Esc, a click outside or a switch closes it; git's refusal keeps it
 * open with git's message (D6). A command keeps running when the menu is closed meanwhile (D13).
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
    // Escape closes it wherever focus is, and nothing else sees it.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
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

  const toggle = (): void => {
    if (open) {
      setOpen(false)
      return
    }
    setList(null)
    setError(null)
    setOpen(true)
    openRef.current = true
    load()
  }

  /** Runs one git command: busy meanwhile, then the chip re-read; success closes the menu. */
  const act = async (label: string, command: () => Promise<GitResult>): Promise<void> => {
    if (busy) return
    setBusy(label)
    setError(null)
    const result = await command()
    setBusy(null)
    refreshBranch(dir)
    if (result.ok) {
      const active = document.activeElement
      const inMenu = active === document.body || (root.current?.contains(active) ?? false)
      if (openRef.current) close(inMenu)
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

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
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
  // New branch, Fetch, Pull and Push are run by their own slices (#33 S2, S3); until then, no `run`.
  const actions: {
    label: string
    testId: string
    icon: typeof Check
    /** Pull and Push need a branch: disabled on a detached HEAD (D9). */
    needsBranch?: boolean
    run?: () => void
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
          <div className="branch-menu-actions">
            {actions.map(({ label, testId, icon: ActionIcon, needsBranch, run }) => (
              <button
                key={label}
                type="button"
                role="menuitem"
                className="menu-item"
                data-testid={testId}
                disabled={busy !== null || list === null || !run || (needsBranch && detached)}
                onClick={run}
              >
                <ActionIcon {...MENU_ICON} />
                {label}
              </button>
            ))}
          </div>
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
