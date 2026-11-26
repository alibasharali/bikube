import { useSyncExternalStore } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import {
  EDITOR_TEXT_LIMIT,
  formatSize,
  type EditorDraft,
  type EditorFileRef,
  type EditorReadResult,
  type EditorStatResult,
  type EditorWrite,
  type EditorWriteResult
} from '../../core/editor-files-types'
import {
  activeTab,
  baseName,
  closeTab,
  closeWorkspaceTabs,
  keepWorkspaces,
  NO_TABS,
  openTab,
  refPath,
  selectTab,
  type EditorTabsMemory
} from '../../core/editor-tabs'
import {
  checkOutcome,
  isDirty,
  replacement,
  statStep,
  type CheckedTab,
  type CheckOutcome,
  type EditorNotice
} from '../../core/editor-sync'
import { isMarkdownPath } from '../../core/markdown-render'

/**
 * What an open tab holds (#83 D3, D7): main's read, and once shown as text its CodeMirror state,
 * kept across tab and view switches so its edits and undo history stay.
 */
export interface EditorDoc {
  read: Exclude<EditorReadResult, { kind: 'refused' }>
  state: EditorState | null
  /**
   * The tab's text before its editor first shows, when it isn't what it read: a draft restored
   * at launch (D11).
   */
  text?: string
}

type Reader = (ref: EditorFileRef) => Promise<EditorReadResult>

/** Main's stat and save (D12, D13); a store without them never checks or saves. */
export interface EditorIo {
  stat(ref: EditorFileRef): Promise<EditorStatResult>
  write(ref: EditorFileRef, write: EditorWrite): Promise<EditorWriteResult>
}

/** Where dirty tabs' drafts go (D11): main's drafts store, and how many tabs are dirty. */
export interface EditorDraftsIo {
  save(draft: EditorDraft): void
  delete(workspaceId: string, realPath: string): void
  dirty(count: number): void
}

/**
 * A tab's editor state (D7): lines split at `\n` only, so a lone `\r` main left in the text stays
 * a character, the tab stays clean and a save writes it back as it was (CodeMirror's default split
 * would turn it into a line break).
 */
export function editorTextState(doc: string, extensions: Extension[] = []): EditorState {
  return EditorState.create({
    doc,
    extensions: [EditorState.lineSeparator.of('\n'), ...extensions]
  })
}

/** Text main refuses to save (D12, `parseEditorWrite`'s cap by characters); null when it fits. */
function tooLargeToSave(text: string): string | null {
  if (text.length <= EDITOR_TEXT_LIMIT) return null
  return `too large to save (${formatSize(new TextEncoder().encode(text).length)})`
}

/** A dirty tab's draft is saved this long after its last edit (D11). */
export const DRAFT_DELAY_MS = 2000

/**
 * What a tab shows about its edits and its file (D12, D13): its dirty dot, the `changed on disk`
 * bar or `Deleted on disk`, and the reason its last save failed.
 */
export interface EditorDocStatus {
  dirty: boolean
  notice: EditorNotice | null
  saveError: string | null
}

const CLEAN: EditorDocStatus = Object.freeze({ dirty: false, notice: null, saveError: null })

/** The tab's CodeMirror view while it shows: a silent reload or Reload changes its text there. */
export interface LiveEditor {
  readonly state: EditorState
  dispatch(spec: { changes: { from: number; to: number; insert: string } }): void
}

/** A dirty tab's close asks first (D12): the question in front, and the tabs after it. */
export interface CloseQuestion {
  workspaceId: string
  id: string
  name: string
}

export type CloseAnswer = 'save' | 'discard' | 'cancel'

/** How a Markdown tab shows (D10): rendered, or its source in the editor. */
export type MarkdownMode = 'preview' | 'edit'

export interface EditorFiles {
  get(): EditorTabsMemory
  subscribe(listener: () => void): () => void
  /** App shows `workspaceId`'s editor view with its active tab (D2). */
  onShow(fn: (workspaceId: string) => void): () => void
  /**
   * Opens `ref` in a tab of `workspaceId` (D3) and shows the editor; a file already open is
   * focused, keeping what its tab holds. `refused`, nothing opened, when main refused it.
   */
  open(workspaceId: string, ref: EditorFileRef): Promise<'opened' | 'refused'>
  doc(workspaceId: string, id: string): EditorDoc | null
  /** Keeps a shown text tab's editor state for when it shows again. */
  keepState(workspaceId: string, id: string, state: EditorState): void
  select(workspaceId: string, id: string): void
  close(workspaceId: string, id: string): void
  closeAll(workspaceId: string): void
  /** Only these workspaces keep their tabs: deleted workspaces' tabs close (D3). */
  keep(workspaceIds: readonly string[]): void
  /** What the tab shows about its edits and its file (D12, D13); stable until it changes. */
  status(workspaceId: string, id: string): EditorDocStatus
  /** How many of the workspace's tabs are dirty (D12's workspace delete line). */
  dirtyCount(workspaceId: string): number
  /** The tab's view while it shows; returns what detaches it. */
  attach(workspaceId: string, id: string, view: LiveEditor): () => void
  /** The tab's text changed: its state kept, its dirty dot updated. */
  edited(workspaceId: string, id: string, state: EditorState): void
  /**
   * Saves the tab (D12) after checking its file (D13): written only while the file still matches
   * the tab's base, else the bar; a failure's reason under the header. True once its text is on
   * disk (a clean tab's already is).
   */
  save(workspaceId: string, id: string): Promise<boolean>
  /** The bar's Reload (D13): the disk text, the edits dropped. */
  reload(workspaceId: string, id: string): Promise<void>
  /** The bar's Keep mine (D13): the disk version as the new base, so the next save writes. */
  keepMine(workspaceId: string, id: string): Promise<void>
  /** Checks every open text tab's file (D13), one run at a time. */
  check(): Promise<void>
  /**
   * Closes these tabs in turn (D12): a clean one at once, a dirty one after its question, the
   * rest stopping at Cancel or a failed save.
   */
  askClose(workspaceId: string, ids: readonly string[]): void
  /** The question being asked, or null. */
  closeQuestion(): CloseQuestion | null
  answerClose(answer: CloseAnswer): Promise<void>
  /** A Markdown tab's Preview or Edit (D10), Preview when opened; null for any other tab. */
  mode(workspaceId: string, id: string): MarkdownMode | null
  /** Switches a Markdown tab to Preview or Edit (D10; D14's Find, D15's palette rows). */
  setMode(workspaceId: string, id: string, mode: MarkdownMode): void
  /** The tab's text now, dirty or not (D10's Preview); null for a tab that holds none. */
  text(workspaceId: string, id: string): string | null
  /** Saves every dirty tab's draft not yet written, now (D11: at `app:quitting`). */
  flushDrafts(): void
  /**
   * Reopens each draft of these workspaces as a dirty tab, the editor not shown (D11), deleting
   * the others' drafts; then checks the files against the drafts' bases (D13).
   */
  restore(drafts: readonly EditorDraft[], workspaceIds: readonly string[]): Promise<void>
}

/**
 * Every workspace's open files for this run of the app (#83 D3): the tab lists (`editor-tabs.ts`)
 * and each tab's document. Opening a file asks main to read it first, since a tab is its real
 * path, then shows the editor view through what App registered (`onShow`).
 */
export function createEditorFiles(
  read: Reader,
  io?: EditorIo,
  drafts?: EditorDraftsIo
): EditorFiles {
  let memory: EditorTabsMemory = NO_TABS
  const docs = new Map<string, EditorDoc>()
  const statuses = new Map<string, EditorDocStatus>()
  /** Markdown tabs switched to Edit; the others show Preview. */
  const editing = new Set<string>()
  const views = new Map<string, LiveEditor>()
  const saving = new Set<string>()
  /** Each tab's running check (D13): a save waits for it, so it never replaces the base mid-save. */
  const checks = new Map<string, Promise<void>>()
  /** Tabs whose draft is on disk, and those with one due (D11). */
  const drafted = new Set<string>()
  const draftTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Restored drafts whose file no longer holds their base: dirty whatever their text (D11). */
  const baseUnknown = new Set<string>()
  let dirtyReported = 0
  const listeners = new Set<() => void>()
  let show: ((workspaceId: string) => void) | null = null
  let checking: Promise<void> | null = null
  let question: (CloseQuestion & { rest: readonly string[] }) | null = null
  const key = (workspaceId: string, id: string): string => `${workspaceId}\n${id}`
  const split = (k: string): [string, string] => {
    const at = k.indexOf('\n')
    return [k.slice(0, at), k.slice(at + 1)]
  }
  const dropDraft = (k: string): void => {
    const timer = draftTimers.get(k)
    if (timer !== undefined) clearTimeout(timer)
    draftTimers.delete(k)
    if (!drafted.delete(k)) return
    const [workspaceId, id] = split(k)
    drafts?.delete(workspaceId, id)
  }
  /** Drafts of tabs closed or clean go (D11); main hears how many tabs are dirty. */
  const syncDrafts = (): void => {
    for (const k of new Set([...drafted, ...draftTimers.keys()])) {
      if (!docs.has(k) || !statusOf(k).dirty) dropDraft(k)
    }
    let dirty = 0
    for (const k of docs.keys()) if (statusOf(k).dirty) dirty++
    if (dirty !== dirtyReported) {
      dirtyReported = dirty
      drafts?.dirty(dirty)
    }
  }
  const notify = (): void => {
    syncDrafts()
    for (const listener of [...listeners]) listener()
  }
  const set = (next: EditorTabsMemory): void => {
    if (next === memory) return
    memory = next
    // Documents of tabs no longer open go. A workspace id holds no newline; a real path may.
    for (const k of [...docs.keys()]) {
      const [workspaceId, id] = split(k)
      if (!memory[workspaceId]?.tabs.some((t) => t.id === id)) {
        docs.delete(k)
        statuses.delete(k)
        editing.delete(k)
        baseUnknown.delete(k)
      }
    }
    // A question about a tab gone meanwhile (its workspace deleted) would block every later close.
    if (question && !docs.has(key(question.workspaceId, question.id))) question = null
    notify()
  }
  const statusOf = (k: string): EditorDocStatus => statuses.get(k) ?? CLEAN
  const setStatus = (k: string, patch: Partial<EditorDocStatus>): void => {
    const current = statusOf(k)
    const next = { ...current, ...patch }
    if (
      next.dirty === current.dirty &&
      next.notice === current.notice &&
      next.saveError === current.saveError
    ) {
      return
    }
    statuses.set(k, next)
    notify()
  }
  const refOf = (k: string): EditorFileRef | null => {
    const [workspaceId, id] = split(k)
    return memory[workspaceId]?.tabs.find((t) => t.id === id)?.ref ?? null
  }
  /** The tab's text now: its view's, else its kept state's, else a draft's, else what it read. */
  const textOf = (k: string, doc: EditorDoc): string | null => {
    if (doc.read.kind !== 'text') return null
    const state = views.get(k)?.state ?? doc.state
    return state ? state.doc.toString() : (doc.text ?? doc.read.text)
  }
  const refreshDirty = (k: string): void => {
    const doc = docs.get(k)
    const text = doc ? textOf(k, doc) : null
    if (!doc || doc.read.kind !== 'text' || text === null) return
    setStatus(k, { dirty: baseUnknown.has(k) || isDirty(text, doc.read.text) })
  }
  /** Writes the dirty tab's draft now (D11). */
  const writeDraft = (k: string): void => {
    const timer = draftTimers.get(k)
    if (timer !== undefined) clearTimeout(timer)
    draftTimers.delete(k)
    const doc = docs.get(k)
    const ref = refOf(k)
    const text = doc ? textOf(k, doc) : null
    if (!drafts || !doc || !ref || doc.read.kind !== 'text' || text === null) return
    // Main refuses it (D12): the save says so, and no draft is sent.
    if (!statusOf(k).dirty || tooLargeToSave(text) !== null) return
    const [workspaceId, id] = split(k)
    const { eol, bom, base } = doc.read
    drafts.save({ workspaceId, ref, realPath: id, text, eol, bom, base })
    drafted.add(k)
  }
  /** The dirty tab's draft, 2 s after its last change (D11). */
  const scheduleDraft = (k: string): void => {
    if (!drafts || !statusOf(k).dirty) return
    const timer = draftTimers.get(k)
    if (timer !== undefined) clearTimeout(timer)
    draftTimers.set(
      k,
      setTimeout(() => {
        draftTimers.delete(k)
        writeDraft(k)
      }, DRAFT_DELAY_MS)
    )
  }
  /** Changes the tab's text to `next` by its differing middle, keeping the cursor line and scroll. */
  const applyText = (k: string, doc: EditorDoc, next: string): void => {
    const view = views.get(k)
    const state = view?.state ?? doc.state
    if (!state) {
      if (doc.text !== undefined) doc.text = next
      return
    }
    const change = replacement(state.doc.toString(), next)
    if (!change) return
    if (view) view.dispatch({ changes: change })
    else doc.state = state.update({ changes: change }).state
  }
  /** A read that replaces the tab's file (a silent reload, Reload). */
  const takeRead = (
    k: string,
    doc: EditorDoc,
    result: Extract<CheckOutcome, { kind: 'reload' }>['read']
  ): void => {
    baseUnknown.delete(k)
    if (result.kind === 'text' && doc.read.kind === 'text') {
      doc.read = result
      applyText(k, doc, result.text)
      statuses.set(k, statusOf(k))
      setStatus(k, { notice: null, saveError: null })
      refreshDirty(k)
      // A Preview redraws from the new text, which may have changed no status.
      notify()
      return
    }
    // No longer text (or text again): the tab shows what it now is.
    docs.set(k, { read: result, state: null })
    statuses.delete(k)
    notify()
  }
  const apply = (k: string, doc: EditorDoc, outcome: CheckOutcome): void => {
    if (outcome.kind === 'none' || doc.read.kind !== 'text') return
    if (outcome.kind === 'rebase') {
      doc.read = { ...doc.read, base: outcome.base }
      setStatus(k, { notice: null })
    } else if (outcome.kind === 'reload') {
      takeRead(k, doc, outcome.read)
    } else if (outcome.kind === 'bar') {
      setStatus(k, { notice: 'changed' })
    } else {
      setStatus(k, { notice: 'deleted' })
    }
  }
  /** One tab's check (D13), kept while it runs so a save can wait for it. */
  const checkOne = (k: string): Promise<void> => {
    const running = checkFile(k)
    checks.set(k, running)
    const forget = (): void => {
      if (checks.get(k) === running) checks.delete(k)
    }
    running.then(forget, forget)
    return running
  }
  /** One tab's check (D13): stat, then a read when size or mtime changed. */
  const checkFile = async (k: string): Promise<void> => {
    const doc = docs.get(k)
    const ref = refOf(k)
    if (!io || !doc || !ref || doc.read.kind !== 'text') return
    const before = doc.read
    const unchanged = (): boolean => docs.get(k) === doc && doc.read === before
    const tab = (): CheckedTab => ({
      dirty: statusOf(k).dirty,
      base: before.base,
      notice: statusOf(k).notice
    })
    const stat = await io.stat(ref)
    if (!unchanged()) return
    const step = statStep(tab(), stat)
    if (step === 'none') return
    const result: EditorReadResult = step === 'missing' ? { kind: 'missing' } : await read(ref)
    if (!unchanged()) return
    apply(k, doc, checkOutcome(tab(), result))
  }
  const close = (workspaceId: string, id: string): void => {
    set(closeTab(memory, workspaceId, id))
  }
  /** Goes on closing `ids` in turn, stopping at the first dirty one to ask. */
  const closeNext = (workspaceId: string, ids: readonly string[]): void => {
    for (let i = 0; i < ids.length; i++) {
      const k = key(workspaceId, ids[i])
      if (!docs.has(k)) continue
      if (statusOf(k).dirty) {
        question = { workspaceId, id: ids[i], name: baseName(ids[i]), rest: ids.slice(i + 1) }
        notify()
        return
      }
      close(workspaceId, ids[i])
    }
    if (question) {
      question = null
      notify()
    }
  }
  const files: EditorFiles = {
    get: (): EditorTabsMemory => memory,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    /** App shows `workspaceId`'s editor view with its active tab (D2). */
    onShow(fn: (workspaceId: string) => void): () => void {
      show = fn
      return () => {
        if (show === fn) show = null
      }
    },
    /**
     * Opens `ref` in a tab of `workspaceId` (D3) and shows the editor; a file already open is
     * focused, keeping what its tab holds. `refused`, nothing opened, when main refused it.
     */
    async open(workspaceId: string, ref: EditorFileRef): Promise<'opened' | 'refused'> {
      const result = await read(ref)
      if (result.kind === 'refused') return 'refused'
      const id = result.kind === 'missing' ? refPath(ref) : result.realPath
      const k = key(workspaceId, id)
      const held = docs.get(k)
      // An open text or picture keeps its tab's document; a tab that showed no file reads again.
      const reread = !held || (held.read.kind !== 'text' && held.read.kind !== 'image')
      if (reread) {
        docs.set(k, { read: result, state: null })
        statuses.delete(k)
      }
      const before = memory
      set(openTab(memory, workspaceId, { id, ref }))
      // The tab already in front shows its new read too.
      if (reread && memory === before) notify()
      show?.(workspaceId)
      return 'opened'
    },
    doc: (workspaceId: string, id: string): EditorDoc | null =>
      docs.get(key(workspaceId, id)) ?? null,
    /** Keeps a shown text tab's editor state for when it shows again. */
    keepState(workspaceId: string, id: string, state: EditorState): void {
      const doc = docs.get(key(workspaceId, id))
      if (doc) doc.state = state
    },
    select: (workspaceId: string, id: string): void => set(selectTab(memory, workspaceId, id)),
    close,
    closeAll: (workspaceId: string): void => set(closeWorkspaceTabs(memory, workspaceId)),
    /** Deleted workspaces' tabs close (D3). */
    keep: (workspaceIds: readonly string[]): void => set(keepWorkspaces(memory, workspaceIds)),
    status: (workspaceId: string, id: string): EditorDocStatus => statusOf(key(workspaceId, id)),
    dirtyCount: (workspaceId: string): number =>
      (memory[workspaceId]?.tabs ?? []).filter((t) => statusOf(key(workspaceId, t.id)).dirty)
        .length,
    attach(workspaceId: string, id: string, view: LiveEditor): () => void {
      const k = key(workspaceId, id)
      views.set(k, view)
      return () => {
        if (views.get(k) === view) views.delete(k)
      }
    },
    edited(workspaceId: string, id: string, state: EditorState): void {
      const k = key(workspaceId, id)
      const doc = docs.get(k)
      if (!doc) return
      doc.state = state
      refreshDirty(k)
      scheduleDraft(k)
    },
    async save(workspaceId: string, id: string): Promise<boolean> {
      const k = key(workspaceId, id)
      const doc = docs.get(k)
      const ref = refOf(k)
      if (!io || !doc || !ref || doc.read.kind !== 'text' || saving.has(k)) return false
      saving.add(k)
      try {
        // A check that started before the save ends first, so it can't replace the base while the
        // save's write is out; then the save's own check (D13): a file changed outside shows the
        // bar, and nothing is written.
        await checks.get(k)?.catch(() => undefined)
        await checkOne(k)
        if (docs.get(k) !== doc || doc.read.kind !== 'text') return false
        const status = statusOf(k)
        if (status.notice === 'changed') return false
        if (!status.dirty) return status.notice !== 'deleted'
        const text = textOf(k, doc) ?? ''
        const tooLarge = tooLargeToSave(text)
        if (tooLarge !== null) {
          setStatus(k, { saveError: tooLarge })
          return false
        }
        const before = doc.read
        // D11's `Deleted on disk` bar: Save writes the file again where its folder still exists.
        const recreate = status.notice === 'deleted'
        const result = await io.write(ref, {
          text,
          eol: before.eol,
          bom: before.bom,
          base: before.base,
          ...(recreate && { recreate: true as const })
        })
        if (docs.get(k) !== doc || doc.read !== before) return false
        if (result.ok) {
          doc.read = { ...before, text, base: result.base }
          baseUnknown.delete(k)
          setStatus(k, { notice: null, saveError: null })
          refreshDirty(k)
          return true
        }
        if (result.reason === 'conflict') setStatus(k, { notice: 'changed', saveError: null })
        else if (result.reason === 'missing') {
          setStatus(k, { notice: 'deleted', saveError: 'file not found' })
        } else {
          setStatus(k, {
            saveError: result.reason === 'failed' ? result.message : 'not allowed'
          })
        }
        return false
      } finally {
        saving.delete(k)
      }
    },
    async reload(workspaceId: string, id: string): Promise<void> {
      const k = key(workspaceId, id)
      const doc = docs.get(k)
      const ref = refOf(k)
      if (!doc || !ref) return
      const before = doc.read
      const result = await read(ref)
      if (docs.get(k) !== doc || doc.read !== before) return
      if (result.kind === 'missing') setStatus(k, { notice: 'deleted' })
      else if (result.kind !== 'refused') takeRead(k, doc, result)
    },
    async keepMine(workspaceId: string, id: string): Promise<void> {
      const k = key(workspaceId, id)
      const doc = docs.get(k)
      const ref = refOf(k)
      if (!doc || !ref || doc.read.kind !== 'text') return
      const before = doc.read
      const result = await read(ref)
      if (docs.get(k) !== doc || doc.read !== before) return
      if (result.kind === 'missing') setStatus(k, { notice: 'deleted' })
      if (result.kind !== 'text') return
      // The disk version becomes the base; the tab keeps its text, dirty against it.
      doc.read = { ...result, text: result.text }
      baseUnknown.delete(k)
      setStatus(k, { notice: null })
      refreshDirty(k)
      // Its draft now names the new base.
      scheduleDraft(k)
    },
    check(): Promise<void> {
      if (checking) return checking
      const run = (async () => {
        for (const k of [...docs.keys()]) if (!saving.has(k)) await checkOne(k)
      })()
      // Forgotten once done; with no tab it is done before it is even kept.
      checking = run
      const forget = (): void => {
        if (checking === run) checking = null
      }
      run.then(forget, forget)
      return run
    },
    askClose(workspaceId: string, ids: readonly string[]): void {
      if (question) return
      closeNext(workspaceId, ids)
    },
    closeQuestion: (): CloseQuestion | null => question,
    async answerClose(answer: CloseAnswer): Promise<void> {
      const asked = question
      if (!asked) return
      const { workspaceId, id, rest } = asked
      if (answer === 'cancel') {
        question = null
        notify()
        return
      }
      if (answer === 'save') {
        const saved = await files.save(workspaceId, id)
        if (question !== asked) return
        if (!saved) {
          // The failure's line or the bar shows; the rest stay open.
          question = null
          notify()
          return
        }
      }
      question = null
      close(workspaceId, id)
      closeNext(workspaceId, rest)
      if (!question) notify()
    },
    mode(workspaceId: string, id: string): MarkdownMode | null {
      const k = key(workspaceId, id)
      if (!docs.has(k) || !isMarkdownPath(id)) return null
      return editing.has(k) ? 'edit' : 'preview'
    },
    setMode(workspaceId: string, id: string, mode: MarkdownMode): void {
      const k = key(workspaceId, id)
      if (files.mode(workspaceId, id) === null || files.mode(workspaceId, id) === mode) return
      if (mode === 'edit') editing.add(k)
      else editing.delete(k)
      notify()
    },
    text(workspaceId: string, id: string): string | null {
      const doc = docs.get(key(workspaceId, id))
      return doc ? textOf(key(workspaceId, id), doc) : null
    },
    flushDrafts(): void {
      for (const k of docs.keys()) {
        if (statusOf(k).dirty && (draftTimers.has(k) || !drafted.has(k))) writeDraft(k)
      }
    },
    async restore(list: readonly EditorDraft[], workspaceIds: readonly string[]): Promise<void> {
      const kept = new Set(workspaceIds)
      for (const draft of list) {
        if (!kept.has(draft.workspaceId)) {
          drafts?.delete(draft.workspaceId, draft.realPath)
          continue
        }
        const k = key(draft.workspaceId, draft.realPath)
        if (docs.has(k)) continue
        const result = await read(draft.ref)
        if (docs.has(k) || !kept.has(draft.workspaceId)) continue
        // The file's text is the tab's base only while it still holds the draft's base; else the
        // check below shows what happened to it, and the tab stays dirty until it is resolved.
        const known = result.kind === 'text' && result.base.sha256 === draft.base.sha256
        const { eol, bom, base, realPath, text } = draft
        const baseText = known ? result.text : ''
        const next = openTab(memory, draft.workspaceId, { id: realPath, ref: draft.ref })
        docs.set(k, {
          read: { kind: 'text', text: baseText, eol, bom, base, realPath },
          state: null,
          text
        })
        if (!known) baseUnknown.add(k)
        drafted.add(k)
        statuses.set(k, { ...CLEAN, dirty: !known || isDirty(text, baseText) })
        set(next)
      }
      await files.check()
    }
  }
  return files
}

/** The app's open files, read, checked and saved through main (D6). */
export const editorFiles: EditorFiles = createEditorFiles(
  (ref) => window.bikube.editor.read(ref),
  {
    stat: (ref) => window.bikube.editor.stat(ref),
    write: (ref, write) => window.bikube.editor.write(ref, write)
  },
  {
    save: (draft) => window.bikube.drafts.save(draft),
    delete: (workspaceId, realPath) => window.bikube.drafts.delete(workspaceId, realPath),
    dirty: (count) => window.bikube.drafts.dirty(count)
  }
)

export function useEditorTabs(): EditorTabsMemory {
  return useSyncExternalStore(editorFiles.subscribe, editorFiles.get)
}

/** The tab's dirty dot, bar and save error (D12, D13), redrawn as they change. */
export function useEditorStatus(workspaceId: string, id: string): EditorDocStatus {
  return useSyncExternalStore(editorFiles.subscribe, () => editorFiles.status(workspaceId, id))
}

/** The dirty-tab question in front (D12), or null. */
export function useCloseQuestion(): CloseQuestion | null {
  return useSyncExternalStore(editorFiles.subscribe, editorFiles.closeQuestion)
}

/** A Markdown tab's Preview or Edit (D10), null for another tab. */
export function useMarkdownMode(workspaceId: string, id: string): MarkdownMode | null {
  return useSyncExternalStore(editorFiles.subscribe, () => editorFiles.mode(workspaceId, id))
}

/** The tab's text now (D10's Preview), redrawn as it changes. */
export function useEditorText(workspaceId: string, id: string): string | null {
  return useSyncExternalStore(editorFiles.subscribe, () => editorFiles.text(workspaceId, id))
}

/** How many of the workspace's tabs are dirty (D12). */
export function useDirtyCount(workspaceId: string): number {
  return useSyncExternalStore(editorFiles.subscribe, () => editorFiles.dirtyCount(workspaceId))
}

/** Saves the workspace's tab in front (D12: Mod+S, and the palette's Save file). */
export function saveActiveTab(workspaceId: string): Promise<boolean> {
  const tab = activeTab(editorFiles.get(), workspaceId)
  return tab ? editorFiles.save(workspaceId, tab.id) : Promise.resolve(false)
}

/** Closes the workspace's tab in front, asking first when dirty (D12, D14: Close pane, Close tab). */
export function closeActiveTab(workspaceId: string): void {
  const tab = activeTab(editorFiles.get(), workspaceId)
  if (tab) editorFiles.askClose(workspaceId, [tab.id])
}
