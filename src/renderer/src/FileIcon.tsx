import { useSyncExternalStore } from 'react'
import { fileIcon, folderIcon } from '../../core/file-icons'

const LIGHT_QUERY = '(prefers-color-scheme: light)'

/** Whether the app shows its light version (the Theme setting, or the OS under System). */
function useLight(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia(LIGHT_QUERY)
      query.addEventListener('change', listener)
      return () => query.removeEventListener('change', listener)
    },
    () => window.matchMedia(LIGHT_QUERY).matches
  )
}

/**
 * A Files tab row's vscode-icons icon (`src/core/file-icons.ts`), loaded from the app's
 * `file-icons` folder. Its URL is absolute from the main page, so a card window's tree, drawn into
 * an `about:blank` document, finds it too. Decorative: the row's name says what it is.
 */
function FileIcon({
  name,
  kind,
  open = false
}: {
  name: string
  kind: 'root' | 'folder' | 'file'
  open?: boolean
}): React.JSX.Element {
  const light = useLight()
  const icon =
    kind === 'file' ? fileIcon(name, light) : folderIcon(name, open, light, kind === 'root')
  return (
    <img
      className="files-icon"
      data-testid="files-icon"
      data-icon={icon}
      src={new URL(`file-icons/${icon}`, window.location.href).href}
      alt=""
      width={16}
      height={16}
      draggable={false}
    />
  )
}

export default FileIcon
