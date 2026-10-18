import { ArrowUpRight, FileText, PackageCheck } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { formatSize, installMessage, type UpdateState } from '../../core/updates'
import ConfirmDialog from './ConfirmDialog'
import { ICON, SMALL_ICON } from './icons'
import { useUpdate } from './updates'

type Available = Extract<UpdateState, { kind: 'available' }>

/**
 * The sidebar's "Update Available" button and its popup: the version, size and date, Skip, Later
 * and Install and Relaunch (or Download where Drovr can't replace itself), and the release notes.
 * The button shows while a version that isn't skipped or put off is available; the popup also
 * opens from the app menu's Check for Updates… (or Settings), showing the check's outcome.
 */
function UpdateButton({ collapsed }: { collapsed: boolean }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  /** The version Later put off, until the next launch or a check the user asks for. */
  const [later, setLater] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<number | null>(null)
  const show = useCallback(() => {
    setLater(null)
    setOpen(true)
  }, [])
  const { state, current } = useUpdate(show)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const [position, setPosition] = useState<React.CSSProperties>()

  useEffect(() => {
    if (!open) return
    const place = (): void => {
      const rect = (button.current ?? root.current)?.getBoundingClientRect()
      if (rect) setPosition({ left: rect.left, bottom: window.innerHeight - rect.top + 8 })
    }
    place()
    const onDown = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    // Escape closes it wherever focus is: opened from the menu or Settings, focus stays outside.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      if (root.current?.contains(document.activeElement)) button.current?.focus()
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

  const available = state.kind === 'available' ? state : null
  const shown = available && !available.skipped && later !== available.release.version
  if (!shown && !open) return null

  const install = async (): Promise<void> => {
    if (!available) return
    const ready = available.install !== 'manual' && !available.error && available.progress === 1
    if (!ready) {
      window.drovr.update.install()
      return
    }
    const running = await window.drovr.update.running()
    if (running === 0) {
      window.drovr.update.install()
      return
    }
    setOpen(false)
    setConfirm(running)
  }

  return (
    <div className="update" ref={root}>
      {shown && (
        <button
          type="button"
          ref={button}
          className="update-button"
          data-testid="update-button"
          aria-expanded={open}
          aria-label={collapsed ? `Update available: ${available.release.version}` : undefined}
          title={collapsed ? `Update available: ${available.release.version}` : undefined}
          onClick={() => setOpen((o) => !o)}
        >
          <PackageCheck {...ICON} />
          {!collapsed && <span>Update Available: {available.release.version}</span>}
        </button>
      )}
      {open && (
        <div
          className="update-popup"
          role="dialog"
          aria-label="Update"
          data-testid="update-popup"
          style={{ position: 'fixed', ...position }}
        >
          {available ? (
            <AvailableBody
              update={available}
              onSkip={() => {
                window.drovr.update.skip()
                setOpen(false)
              }}
              onLater={() => {
                setLater(available.release.version)
                setOpen(false)
              }}
              onInstall={() => void install()}
            />
          ) : (
            <StatusBody state={state} current={current} />
          )}
        </div>
      )}
      {confirm !== null && (
        <ConfirmDialog
          title="Install and relaunch?"
          message={installMessage(confirm)}
          confirmLabel="Install and Relaunch"
          confirmTestId="update-confirm"
          onConfirm={() => {
            setConfirm(null)
            window.drovr.update.install()
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

function AvailableBody({
  update,
  onSkip,
  onLater,
  onInstall
}: {
  update: Available
  onSkip: () => void
  onLater: () => void
  onInstall: () => void
}): React.JSX.Element {
  const { release, install, progress, error, skipped } = update
  const waiting = release.waiting && error === undefined
  const manual = !waiting && (install === 'manual' || error !== undefined)
  const ready = !waiting && !manual && progress === 1
  const downloading = !waiting && !manual && !skipped && progress < 1
  // Readiness first: a version skipped after its download is already there to install.
  const label = waiting
    ? 'Not Ready Yet'
    : manual
      ? 'Download'
      : ready
        ? 'Install and Relaunch'
        : skipped
          ? 'Download Update'
          : `Downloading… ${Math.round(progress * 100)}%`
  const released = release.publishedAt
    ? new Date(release.publishedAt).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      })
    : null
  return (
    <>
      <div className="update-popup-body">
        <h2 className="update-popup-title">Update Available</h2>
        <dl className="update-facts">
          <dt>Version</dt>
          <dd data-testid="update-version">{release.version}</dd>
          {release.asset && (
            <>
              <dt>Size</dt>
              <dd data-testid="update-size">{formatSize(release.asset.size)}</dd>
            </>
          )}
          {released && (
            <>
              <dt>Released</dt>
              <dd data-testid="update-released">{released}</dd>
            </>
          )}
        </dl>
        {error !== undefined && (
          <p className="update-note" data-testid="update-error">
            {error} Download it from the release page instead.
          </p>
        )}
        {waiting && (
          <p className="update-note" data-testid="update-waiting">
            The download for {release.version} isn’t ready yet. Drovr checks again in a few minutes.
          </p>
        )}
        {!waiting && install === 'manual' && error === undefined && (
          <p className="update-note">
            This copy of Drovr can’t replace itself: download the new version from the release page.
          </p>
        )}
        <div className="update-actions">
          {!skipped && (
            <button type="button" className="btn" data-testid="update-skip" onClick={onSkip}>
              Skip
            </button>
          )}
          <button type="button" className="btn" data-testid="update-later" onClick={onLater}>
            Later
          </button>
          <button
            type="button"
            className="btn btn-primary update-install"
            data-testid="update-install"
            disabled={downloading || waiting}
            onClick={onInstall}
          >
            {label}
          </button>
        </div>
        {ready && !skipped && <p className="update-note">Or it installs when you quit Drovr.</p>}
      </div>
      <button
        type="button"
        className="update-notes"
        data-testid="update-notes"
        onClick={() => window.drovr.update.openPage()}
      >
        <FileText {...SMALL_ICON} />
        <span>View Release Notes</span>
        <ArrowUpRight className="update-notes-arrow" {...SMALL_ICON} />
      </button>
    </>
  )
}

/** The popup after a check the user asked for, when there is nothing to install. */
function StatusBody({
  state,
  current
}: {
  state: UpdateState
  current: string
}): React.JSX.Element {
  const [title, text] =
    state.kind === 'checking' || state.kind === 'idle'
      ? ['Checking for Updates…', null]
      : state.kind === 'up-to-date'
        ? ['Drovr is up to date', `Version ${current} is the latest.`]
        : state.kind === 'error'
          ? ['Couldn’t check for updates', state.message]
          : ['Updates are off', 'This build of Drovr doesn’t update itself.']
  return (
    <div className="update-popup-body" data-testid="update-status">
      <h2 className="update-popup-title">{title}</h2>
      {text && <p className="update-note">{text}</p>}
    </div>
  )
}

export default UpdateButton
