import { useId, useMemo, useState } from 'react'

// A text field with suggestions underneath. Anything can be typed; suggestions only save typing.
export default function Combobox({ id, value, onChange, options, ...rest }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const listId = useId()

  const matches = useMemo(() => {
    const query = value.trim().toLowerCase()
    if (!query) return []
    const found = options.filter((o) => o.toLowerCase().includes(query) && o.toLowerCase() !== query)
    // Places that start with what was typed come before places that merely contain it.
    const starts = found.filter((o) => o.toLowerCase().startsWith(query))
    return [...starts, ...found.filter((o) => !starts.includes(o))].slice(0, 8)
  }, [value, options])

  const shown = open && matches.length > 0

  const pick = (option) => {
    onChange(option)
    setOpen(false)
    setActive(-1)
  }

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' && matches.length) {
      event.preventDefault()
      setOpen(true)
      setActive((i) => (i + 1) % matches.length)
    } else if (event.key === 'ArrowUp' && matches.length) {
      event.preventDefault()
      setOpen(true)
      setActive((i) => (i <= 0 ? matches.length - 1 : i - 1))
    } else if (event.key === 'Enter' && shown && active >= 0) {
      event.preventDefault()
      pick(matches[active])
    } else if (event.key === 'Escape' && shown) {
      event.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <div className="combo">
      <input
        id={id}
        className="input"
        type="text"
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        {...rest}
      />
      {shown && (
        <ul className="combo-list" role="listbox" id={listId}>
          {matches.map((option, i) => (
            <li
              key={option}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(event) => {
                event.preventDefault()
                pick(option)
              }}
              onMouseEnter={() => setActive(i)}
            >
              {option}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
