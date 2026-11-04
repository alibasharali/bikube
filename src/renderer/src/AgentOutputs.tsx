import { FolderOpen, Link, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { OutputRow } from '../../core/agent-outputs-view'
import { isOpenNote, listedFileErrorLine, type OpenResult } from '../../core/open-result'
import FileIcon from './FileIcon'
import { SMALL_ICON } from './icons'
import { ShowAllButton } from './ShowAllButton'

/**
 * Files and artifacts (#79 D3, D4, D11): the session's documents and claude.ai links, newest
 * first; a file opens with the default app and reveals in the file manager through main, which
 * acts only on what the session's last summary listed (D10); an artifact opens its link.
 */
export function OutputsList({
  sessionId,
  rows,
  more,
  all,
  onToggleAll
}: {
  /** The session the summary was read for: main checks a path against its last summary. */
  sessionId: string
  /** The rows shown: the newest 10 unless every row shows (D3). */
  rows: OutputRow[]
  /** The rows the cut leaves out. */
  more: number
  all: boolean
  onToggleAll: () => void
}): React.JSX.Element {
  const [openError, setOpenError] = useState<{ text: string; note: boolean } | null>(null)
  const opens = useRef(0)
  const act = (path: string, request: Promise<OpenResult>): void => {
    const at = ++opens.current
    setOpenError(null)
    void request.then((result) => {
      if (at !== opens.current) return
      const text = listedFileErrorLine(path, result)
      setOpenError(text === null ? null : { text, note: isOpenNote(result) })
    })
  }
  const open = (path: string): void => act(path, window.bikube.agentTab.openOutput(sessionId, path))
  const reveal = (path: string): void =>
    act(
      path,
      window.bikube.agentTab
        .revealOutput(sessionId, path)
        .then((revealed): OpenResult =>
          revealed ? { ok: true } : { ok: false, reason: 'refused' }
        )
    )
  return (
    <div className="agent-outputs">
      {openError !== null && (
        <div
          className={openError.note ? 'files-error files-note' : 'files-error'}
          role={openError.note ? 'status' : 'alert'}
          data-testid="agent-outputs-open-error"
        >
          <span className="files-error-text">{openError.text}</span>
          <button
            type="button"
            className="icon-btn"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={() => setOpenError(null)}
          >
            <X {...SMALL_ICON} />
          </button>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="agent-tab-empty" data-testid="agent-outputs-empty">
          No files or artifacts yet.
        </p>
      ) : (
        <ul className="agent-output-list">
          {rows.map((row) =>
            row.kind === 'file' ? (
              <FileRow key={row.key} row={row} onOpen={open} onReveal={reveal} />
            ) : (
              <ArtifactRow key={row.key} row={row} />
            )
          )}
        </ul>
      )}
      <ShowAllButton testId="agent-outputs-show-all" more={more} all={all} onToggle={onToggleAll} />
    </div>
  )
}

/** A file: its icon, name and folder as one button, then Reveal, shown on hover and focus. */
function FileRow({
  row,
  onOpen,
  onReveal
}: {
  row: Extract<OutputRow, { kind: 'file' }>
  onOpen: (path: string) => void
  onReveal: (path: string) => void
}): React.JSX.Element {
  return (
    <li className="agent-output" data-testid="agent-output" data-kind="file">
      <button
        type="button"
        className="agent-output-open"
        data-testid="agent-output-open"
        title={row.path}
        onClick={() => onOpen(row.path)}
      >
        <FileIcon name={row.name} kind="file" />
        <span className="agent-output-text">
          <span className="agent-output-name" data-testid="agent-output-name">
            {row.name}
          </span>
          <span className="agent-output-detail" data-testid="agent-output-detail">
            {row.folder}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="icon-btn agent-output-reveal"
        data-testid="agent-output-reveal"
        aria-label="Reveal"
        title={`Show ${row.name} in the file manager`}
        onClick={() => onReveal(row.path)}
      >
        <FolderOpen {...SMALL_ICON} />
      </button>
    </li>
  )
}

/** An artifact: a link icon, its title and `Doc` or `Page`, `claude.ai` under it; opens the link. */
function ArtifactRow({
  row
}: {
  row: Extract<OutputRow, { kind: 'artifact' }>
}): React.JSX.Element {
  return (
    <li className="agent-output" data-testid="agent-output" data-kind="artifact">
      <button
        type="button"
        className="agent-output-open"
        data-testid="agent-output-open"
        title={row.url}
        onClick={() => window.bikube.link.open(row.url)}
      >
        <Link {...SMALL_ICON} className="agent-output-icon" />
        <span className="agent-output-text">
          <span className="agent-output-line">
            <span className="agent-output-name" data-testid="agent-output-name">
              {row.title}
            </span>
            {row.badge !== null && (
              <span
                className="agent-output-badge"
                data-testid="agent-output-badge"
                data-badge={row.badge}
              >
                {row.badge}
              </span>
            )}
          </span>
          <span className="agent-output-detail" data-testid="agent-output-detail">
            claude.ai
          </span>
        </span>
      </button>
    </li>
  )
}
