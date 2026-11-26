import { useEffect, useMemo, useRef } from 'react'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { highlightCode } from '@lezer/highlight'
import type { EditorFileRef } from '../../core/editor-files-types'
import type { EditorTab } from '../../core/editor-tabs'
import { markdownLink, renderMarkdown } from '../../core/markdown-render'
import { editorFiles, useEditorText } from './editor-files'
import { editorHighlightStyle, useEditorLookStyle } from './editor-look'

/** The syntax colours' class rules: CodeMirror mounts them only inside an editor. */
const HIGHLIGHT_RULES = editorHighlightStyle.module?.getRules() ?? ''

/**
 * A Markdown tab's Preview (#83 D10): markdown-it's HTML of the tab's current text, dirty or not,
 * its fenced code highlighted with the editor's languages and colours once they load, its
 * relative pictures read through main (D6) as `data:` URLs. A click on a link never navigates:
 * `http`/`https` open in the browser, a relative file inside the folder in a tab, `#anchor`
 * scrolls the preview, anything else does nothing.
 */
function MarkdownPreview({
  workspaceId,
  tab
}: {
  workspaceId: string
  tab: EditorTab
}): React.JSX.Element {
  const text = useEditorText(workspaceId, tab.id) ?? ''
  const { ref } = tab
  // A listed file (Agent setup) has no folder its relative links and pictures are checked in.
  const base = ref.kind === 'folder' ? ref.path : null
  const html = useMemo(() => renderMarkdown(text, base), [text, base])
  const style = useEditorLookStyle()
  const content = useRef<HTMLDivElement>(null)
  const pictures = useRef(new Map<string, Promise<string | null>>())

  useEffect(() => {
    const root = content.current
    if (!root) return
    // markdown-it's own output, with raw HTML escaped (D10).
    root.innerHTML = html
    let shown = true
    const live = (): boolean => shown
    for (const code of root.querySelectorAll<HTMLElement>('pre > code[class*="language-"]')) {
      void highlightBlock(code, live)
    }
    for (const img of root.querySelectorAll<HTMLImageElement>('img[data-md-src]')) {
      const path = img.dataset.mdSrc ?? ''
      let picture = pictures.current.get(path)
      if (!picture) {
        picture = readPicture(ref, path)
        pictures.current.set(path, picture)
      }
      void picture.then((url) => {
        if (!live()) return
        if (url !== null) img.src = url
        else img.replaceWith(altText(img))
      })
    }
    return () => {
      shown = false
    }
  }, [html, ref])

  const onClick = (event: React.MouseEvent): void => {
    const anchor = (event.target as HTMLElement).closest('a')
    if (!anchor || !content.current?.contains(anchor)) return
    event.preventDefault()
    const link = markdownLink(anchor.getAttribute('href') ?? '', base)
    if (link.kind === 'external') window.bikube.link.open(link.url)
    else if (link.kind === 'file' && ref.kind === 'folder') {
      void editorFiles.open(workspaceId, { kind: 'folder', folder: ref.folder, path: link.path })
    } else if (link.kind === 'anchor') {
      content.current
        .querySelector(`[id="${CSS.escape(link.id)}"]`)
        ?.scrollIntoView({ block: 'start' })
    }
  }
  // A middle click opens no window either.
  const onAuxClick = (event: React.MouseEvent): void => {
    if ((event.target as HTMLElement).closest('a')) event.preventDefault()
  }

  return (
    <div
      className="markdown-preview"
      data-testid="file-editor-preview"
      style={style as React.CSSProperties}
      onClick={onClick}
      onAuxClick={onAuxClick}
    >
      <style>{HIGHLIGHT_RULES}</style>
      <div ref={content} className="markdown-body" />
    </div>
  )
}

/** A relative picture inside the folder as a `data:` URL (D7's limits), null when it isn't one. */
async function readPicture(ref: EditorFileRef, path: string): Promise<string | null> {
  try {
    const read = await window.bikube.editor.read({ kind: 'folder', folder: ref.folder, path })
    return read.kind === 'image' ? read.dataUrl : null
  } catch {
    return null
  }
}

/** What a picture that can't be shown leaves: its alt text, as markdown-it renders others. */
function altText(img: HTMLImageElement): HTMLElement {
  const span = img.ownerDocument.createElement('span')
  span.className = 'markdown-image-alt'
  span.textContent = img.alt
  return span
}

/** A fenced block's code in the editor's syntax colours, once its language has loaded (D1, D8). */
async function highlightBlock(code: HTMLElement, live: () => boolean): Promise<void> {
  const name = /(?:^|\s)language-(\S+)/.exec(code.className)?.[1]
  const description = name ? LanguageDescription.matchLanguageName(languages, name, true) : null
  if (!description) return
  let support
  try {
    support = await description.load()
  } catch {
    return
  }
  if (!live()) return
  const source = code.textContent ?? ''
  const doc = code.ownerDocument
  const highlighted = doc.createDocumentFragment()
  highlightCode(
    source,
    support.language.parser.parse(source),
    editorHighlightStyle,
    (text, classes) => {
      if (!classes) {
        highlighted.append(text)
        return
      }
      const span = doc.createElement('span')
      span.className = classes
      span.textContent = text
      highlighted.append(span)
    },
    () => highlighted.append('\n')
  )
  code.replaceChildren(highlighted)
  code.dataset.highlighted = 'true'
}

export default MarkdownPreview
