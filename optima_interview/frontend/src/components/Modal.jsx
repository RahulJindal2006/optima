import { useEffect, useEffectEvent, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Dialogs that are open, oldest first. Only the newest one answers the keyboard.
const open = []

// A dialog over the page. Keeps the keyboard inside it, closes on Escape or a click outside,
// and hands focus back to whatever opened it.
export default function Modal({ title, onClose, children, foot, wide = false, className = '' }) {
  const box = useRef(null)
  const titleId = useId()
  const close = useEffectEvent(() => onClose())

  useEffect(() => {
    const node = box.current
    const opener = document.activeElement
    const first = node.querySelector('[data-autofocus]') || node.querySelector(FOCUSABLE) || node
    first.focus({ preventScroll: true })
    open.push(node)

    // Listening on the document, so the keys still work when focus has fallen out of the dialog
    // (a button that was focused and then disabled drops focus to the page).
    const onKey = (event) => {
      if (open[open.length - 1] !== node) return
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
        return
      }
      if (event.key !== 'Tab') return
      const items = [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null)
      if (!items.length) {
        event.preventDefault()
        node.focus()
        return
      }
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      const active = document.activeElement
      if (!node.contains(active)) {
        event.preventDefault()
        ;(event.shiftKey ? lastItem : firstItem).focus()
      } else if (event.shiftKey && active === firstItem) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault()
        firstItem.focus()
      }
    }
    document.addEventListener('keydown', onKey)

    const root = document.documentElement
    const before = root.style.overflow
    root.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      open.splice(open.indexOf(node), 1)
      root.style.overflow = before
      if (opener && typeof opener.focus === 'function') opener.focus({ preventScroll: true })
    }
  }, [])

  return createPortal(
    <div
      className="veil"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={`dialog ${wide ? 'wide' : ''} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={box}
      >
        <div className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn quiet sm icon-only" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {foot && <div className="dialog-foot">{foot}</div>}
      </div>
    </div>,
    document.body,
  )
}
