import { X } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import {
  valueOfView,
  viewOfValue,
  viewOptions,
  type ChangeView,
  type ChangedFile,
  type ChangesShown
} from '../../core/agent-changes'
import type { AgentSummary } from '../../core/agent-summary'
import { isOpenNote, openErrorLine } from '../../core/open-result'
import { SMALL_ICON } from './icons'

/**
 * What changed (#75 D9): the view select, `<n> files · +a −r`, the files grouped by folder with
 * their badges and sizes, a file inside the folder opening through the Files tab's `files:open`,
 * and the prompt's summary.
 */
export function ChangesList({
  summary,
  folder,
  view,
  onView,
  shown
}: {
  summary: AgentSummary
  folder: string
  view: ChangeView
  onView: (view: ChangeView) => void
  shown: ChangesShown
}): React.JSX.Element {
  const [openError, setOpenError] = useState<{ text: string; note: boolean } | null>(null)
  const opens = useRef(0)
  const open = (path: string): void => {
    const at = ++opens.current
    setOpenError(null)
    void window.bikube.files.open(folder, path).then((result) => {
      if (at !== opens.current) return
      const text = openErrorLine(path, result)
      setOpenError(text === null ? null : { text, note: isOpenNote(result) })
    })
  }
  return (
    <div className="agent-changes">
      <select
        className="settings-input agent-changes-view"
        data-testid="agent-changes-view"
        aria-label="Changes shown"
        value={valueOfView(view)}
        onChange={(e) => onView(viewOfValue(e.target.value))}
      >
        {viewOptions(summary).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {openError !== null && (
        <div
          className={openError.note ? 'files-error files-note' : 'files-error'}
          role={openError.note ? 'status' : 'alert'}
          data-testid="agent-changes-open-error"
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
      {shown.empty !== null ? (
        <p className="agent-tab-empty" data-testid="agent-changes-empty">
          {shown.empty}
        </p>
      ) : (
        <>
          <p className="agent-changes-heading" data-testid="agent-changes-heading">
            {shown.heading}
          </p>
          {shown.groups.map((group) => (
            <div
              key={group.folder}
              className="agent-changes-folder"
              data-testid="agent-changes-folder"
            >
              <p className="agent-changes-folder-name" data-testid="agent-changes-folder-name">
                {group.folder}
              </p>
              <ul className="agent-changes-files">
                {group.files.map((file) => (
                  <ChangeRow key={file.name} file={file} largest={shown.largest} onOpen={open} />
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
      {shown.summary !== null && <Summary key={shown.summary} text={shown.summary} />}
    </div>
  )
}

/** One file: its name (a button when it opens), badge, and for New and Edited its size and bar. */
function ChangeRow({
  file,
  largest,
  onOpen
}: {
  file: ChangedFile
  largest: number
  onOpen: (path: string) => void
}): React.JSX.Element {
  const open = file.open
  return (
    <li className="agent-change" data-testid="agent-change" data-badge={file.badge}>
      {open !== null ? (
        <button
          type="button"
          className="agent-change-name agent-change-open"
          data-testid="agent-change-name"
          title={open}
          onClick={() => onOpen(open)}
        >
          {file.name}
        </button>
      ) : (
        <span className="agent-change-name" data-testid="agent-change-name">
          {file.name}
        </span>
      )}
      <span className="agent-change-meta">
        <span
          className="agent-change-badge"
          data-testid="agent-change-badge"
          data-badge={file.badge}
        >
          {file.badge}
        </span>
        {file.sized && (
          <>
            <span className="agent-change-size" data-testid="agent-change-size">
              <span className="agent-change-added">+{file.added}</span>{' '}
              <span className="agent-change-removed">−{file.removed}</span>
            </span>
            <span className="agent-change-bar" aria-hidden="true">
              <span
                className="agent-change-bar-added"
                style={{ width: `${largest > 0 ? (file.added / largest) * 100 : 0}%` }}
              />
              <span
                className="agent-change-bar-removed"
                style={{ width: `${largest > 0 ? (file.removed / largest) * 100 : 0}%` }}
              />
            </span>
          </>
        )}
      </span>
    </li>
  )
}

/** The prompt's last reply as plain text, line breaks kept, clamped to 6 lines with Show more. */
function Summary({ text }: { text: string }): React.JSX.Element {
  const ref = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && !expanded) setClamped(el.scrollHeight > el.clientHeight + 1)
  }, [text, expanded])
  return (
    <div className="agent-changes-summary-block">
      <p
        ref={ref}
        className={
          expanded ? 'agent-changes-summary' : 'agent-changes-summary agent-changes-clamped'
        }
        data-testid="agent-changes-summary"
      >
        {text}
      </p>
      {(clamped || expanded) && (
        <button
          type="button"
          className="btn btn-small agent-tab-show-all"
          data-testid="agent-changes-more"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}
