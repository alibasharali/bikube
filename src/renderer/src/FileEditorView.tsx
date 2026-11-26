import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { formatSize, type EditorFileRef } from '../../core/editor-files-types'
import { baseName, tabLabels, tabPath, workspaceTabs, type EditorTab } from '../../core/editor-tabs'
import { keymapAction } from '../../core/keymap'
import { openInEditorLabel } from '../../core/open-in-editor'
import {
  isOpenNote,
  listedFileErrorLine,
  openErrorLine,
  type OpenResult
} from '../../core/open-result'
import type { Workspace } from '../../core/workspace-store'
import { registerCardViewActions } from './card-view-actions'
import { editorLook, useEditorLookStyle } from './editor-look'
import { editorFiles, useEditorTabs, type EditorDoc } from './editor-files'
import FileIcon from './FileIcon'
import { homeDir } from './home'
import { ICON, SMALL_ICON } from './icons'
import { currentKeymap, useSettings } from './settings'
import Tooltip from './Tooltip'
import { dialogOpenIn, useViewWindow } from './view-window'

/**
 * A workspace's file editor (#83 D2, D8, D9): its open files' tab strip, the active one's path and
 * Open in <editor>, then the file: text in CodeMirror with the terminal's look, a picture, or what
 * it is when it can't be shown (D7). Fills the main area in place of the board, as Agent setup
 * does; Back returns to the board with every tab kept, and the close button closes them all.
 * Main window only.
 */
function FileEditorView({
  workspace,
  onBack,
  onClose
}: {
  workspace: Workspace
  /** To the board, the tabs kept in the sidebar. */
  onBack: () => void
  /** Its close button: every tab closed, and the board. */
  onClose: () => void
}): React.JSX.Element | null {
  const view = useViewWindow()
  const { tabs, activeId } = workspaceTabs(useEditorTabs(), workspace.id)
  const active = tabs.find((t) => t.id === activeId) ?? null
  const labels = tabLabels(tabs)
  const home = homeDir()

  // The Back shortcut and the palette's Back row return to the board (D14).
  const actions = useRef({ onBack })
  useEffect(() => {
    actions.current = { onBack }
  })
  useEffect(() => {
    const run = (action: string): void => {
      if (action === 'back') actions.current.onBack()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (keymapAction(event, currentKeymap()) !== 'back' || dialogOpenIn(view)) return
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat) run('back')
    }
    view.addEventListener('keydown', onKeyDown, true)
    const unregister = registerCardViewActions(run)
    return () => {
      view.removeEventListener('keydown', onKeyDown, true)
      unregister()
    }
  }, [view])

  return (
    <section className="file-editor" data-testid="file-editor" aria-label="File editor">
      <div className="file-editor-strip">
        <div className="file-editor-tabs" role="tablist" aria-label="Open files">
          {tabs.map((tab, i) => (
            <div
              key={tab.id}
              className={tab.id === activeId ? 'file-editor-tab active' : 'file-editor-tab'}
              title={tabPath(tab.ref, workspace.directory, home)}
            >
              <button
                type="button"
                role="tab"
                className="file-editor-tab-select"
                data-testid="file-editor-tab"
                aria-selected={tab.id === activeId}
                onClick={() => editorFiles.select(workspace.id, tab.id)}
              >
                <FileIcon name={labels[i].name} kind="file" />
                <span className="file-editor-tab-name">{labels[i].name}</span>
                {labels[i].detail !== null && (
                  <span className="file-editor-tab-detail">{labels[i].detail}</span>
                )}
              </button>
              <button
                type="button"
                className="icon-btn file-editor-tab-close"
                data-testid="file-editor-tab-close"
                aria-label={`Close ${labels[i].name}`}
                title={`Close ${labels[i].name}`}
                onClick={() => {
                  editorFiles.close(workspace.id, tab.id)
                  if (tabs.length === 1) onClose()
                }}
              >
                <X {...SMALL_ICON} />
              </button>
            </div>
          ))}
        </div>
        <Tooltip
          label="Close editor"
          description="Closes every open file and goes back to the board"
          align="end"
        >
          <button
            type="button"
            className="icon-btn file-editor-close"
            data-testid="file-editor-close"
            aria-label="Close editor"
            onClick={onClose}
          >
            <X {...ICON} />
          </button>
        </Tooltip>
      </div>
      {active && <OpenFile key={active.id} workspace={workspace} tab={active} />}
    </section>
  )
}

/** The active tab: its header line and its file. */
function OpenFile({ workspace, tab }: { workspace: Workspace; tab: EditorTab }): React.JSX.Element {
  const doc = editorFiles.doc(workspace.id, tab.id)
  const { editor } = useSettings()
  const [openError, setOpenError] = useState<{ text: string; note: boolean } | null>(null)
  const path = tabPath(tab.ref, workspace.directory, homeDir())
  const openExternal = (): void => {
    setOpenError(null)
    void openInExternalEditor(tab.ref).then((result) => {
      const text =
        tab.ref.kind === 'listed'
          ? listedFileErrorLine(tab.ref.path, result)
          : openErrorLine(tab.ref.path, result)
      setOpenError(text === null ? null : { text, note: isOpenNote(result) })
    })
  }
  return (
    <>
      <div className="file-editor-header">
        <span className="file-editor-path" data-testid="file-editor-path" title={path}>
          {path}
        </span>
        <button
          type="button"
          className="btn btn-small file-editor-open-external"
          data-testid="file-editor-open-external"
          onClick={openExternal}
        >
          {openInEditorLabel(editor)}
        </button>
      </div>
      {openError !== null && (
        <div
          className={openError.note ? 'files-error files-note' : 'files-error'}
          role={openError.note ? 'status' : 'alert'}
          data-testid="file-editor-open-error"
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
      <div className="file-editor-body" role="tabpanel" aria-label={baseName(tab.id)}>
        {doc && <FileBody workspaceId={workspace.id} tab={tab} doc={doc} />}
      </div>
    </>
  )
}

/** Today's external editor (#55 D13, #68 D27) for the tab's file: Settings > Editor. */
function openInExternalEditor(ref: EditorFileRef): Promise<OpenResult> {
  return ref.kind === 'listed'
    ? window.bikube.agentSetup.openFile(ref.folder, ref.path)
    : window.bikube.files.open(ref.folder, ref.path)
}

/** What the tab shows (D7). */
function FileBody({
  workspaceId,
  tab,
  doc
}: {
  workspaceId: string
  tab: EditorTab
  doc: EditorDoc
}): React.JSX.Element {
  const { read } = doc
  if (read.kind === 'text') return <CodeEditor workspaceId={workspaceId} tab={tab} doc={doc} />
  if (read.kind === 'image') {
    return (
      <div className="file-editor-picture">
        <img
          src={read.dataUrl}
          alt={baseName(tab.id)}
          data-testid="file-editor-image"
          className="file-editor-image"
        />
      </div>
    )
  }
  const message =
    read.kind === 'binary'
      ? 'Binary file'
      : read.kind === 'too-large'
        ? `Too large to open here (${formatSize(read.size)})`
        : 'File not found'
  return (
    <p className="file-editor-message" data-testid="file-editor-message">
      {message}
    </p>
  )
}

/** The language support for a file's name, loaded lazily (D1); null for plain text. */
function languageFor(name: string): LanguageDescription | null {
  return LanguageDescription.matchFilename(languages, name)
}

/** Every text tab's language: empty until its support has loaded. */
const language = new Compartment()

/** Whether `state` still has no language support. */
function needsLanguage(state: EditorState): boolean {
  const current = language.get(state)
  return Array.isArray(current) && current.length === 0
}

/**
 * A text tab's CodeMirror view: the state kept by the tab, so its edits and undo history survive
 * tab and view switches; its language loaded lazily while it shows, until it has one.
 */
function CodeEditor({
  workspaceId,
  tab,
  doc
}: {
  workspaceId: string
  tab: EditorTab
  doc: EditorDoc
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const style = useEditorLookStyle()
  useEffect(() => {
    if (doc.read.kind !== 'text' || !host.current) return
    const state =
      doc.state ??
      EditorState.create({
        doc: doc.read.text,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          language.of([]),
          editorLook
        ]
      })
    const editor = new EditorView({ state, parent: host.current })
    let live = true
    if (needsLanguage(state)) {
      void languageFor(baseName(tab.id))
        ?.load()
        .then((support) => {
          if (live && needsLanguage(editor.state))
            editor.dispatch({ effects: language.reconfigure(support) })
        })
        .catch(() => undefined)
    }
    return () => {
      live = false
      editorFiles.keepState(workspaceId, tab.id, editor.state)
      editor.destroy()
    }
  }, [workspaceId, tab.id, doc])
  return (
    <div
      ref={host}
      className="file-editor-code"
      data-testid="file-editor-code"
      style={style as React.CSSProperties}
    />
  )
}

export default FileEditorView
