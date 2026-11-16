import { useEffect, useRef } from 'react'

// Sections of one page. Arrow keys move between tabs, as they do in desktop apps.
export default function Tabs({ tabs, value, onChange, label }) {
  const list = useRef(null)

  // On a narrow screen the row scrolls sideways: keep the open tab in view.
  useEffect(() => {
    const row = list.current
    const tab = row?.querySelector('[aria-selected="true"]')
    if (!tab || row.scrollWidth <= row.clientWidth) return
    const offset = tab.getBoundingClientRect().left - row.getBoundingClientRect().left
    row.scrollTo({ left: Math.max(0, row.scrollLeft + offset - (row.clientWidth - tab.offsetWidth) / 2) })
  }, [value])

  const onKeyDown = (event) => {
    const index = tabs.findIndex((tab) => tab.id === value)
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    onChange(tabs[next].id)
    event.currentTarget.querySelector(`#tab-${tabs[next].id}`)?.focus()
  }

  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown} ref={list}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-selected={value === tab.id}
          aria-controls={`panel-${tab.id}`}
          tabIndex={value === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count != null && <span className="count">{tab.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function TabPanel({ id, children, className = '' }) {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} className={`tab-panel ${className}`}>
      {children}
    </div>
  )
}
