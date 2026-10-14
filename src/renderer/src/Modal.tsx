import { useEffect, useId, useRef } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  testId: string
  children: React.ReactNode
  /** Selector inside the dialog to focus on open; defaults to the first focusable element. */
  initialFocus?: string
  /** Close on a click outside the dialog (on the backdrop); off by default. */
  closeOnOutsideClick?: boolean
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Accessible modal: role=dialog, labelled, Esc closes, Tab is trapped, focus is restored on close. */
function Modal({
  title,
  onClose,
  testId,
  children,
  initialFocus,
  closeOnOutsideClick = false
}: ModalProps): React.JSX.Element {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)

  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const root = ref.current
    const first = initialFocus ? root?.querySelector<HTMLElement>(initialFocus) : null
    ;(first ?? root?.querySelector<HTMLElement>(FOCUSABLE))?.focus()

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab' || !root) return
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      const active = document.activeElement
      if (!root.contains(active)) {
        e.preventDefault()
        firstItem.focus()
      } else if (e.shiftKey && active === firstItem) {
        e.preventDefault()
        lastItem.focus()
      } else if (!e.shiftKey && active === lastItem) {
        e.preventDefault()
        firstItem.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previous && previous.isConnected) previous.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="modal-backdrop"
      onMouseDown={
        closeOnOutsideClick
          ? (e) => {
              if (e.target === e.currentTarget) closeRef.current()
            }
          : undefined
      }
    >
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
      >
        <h2 id={titleId} className="modal-title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}

export default Modal
