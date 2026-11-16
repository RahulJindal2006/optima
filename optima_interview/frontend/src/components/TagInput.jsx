import { useRef, useState } from 'react'
import Icon from './Icon'

// A list of short entries (skills, places, job titles). Enter or a comma adds one.
export default function TagInput({ id, tags = [], onChange, max, placeholder, describedBy, labelledBy }) {
  const [text, setText] = useState('')
  const input = useRef(null)
  const full = max != null && tags.length >= max

  const add = (raw) => {
    const value = raw.replace(/,+$/, '').trim()
    if (!value || full) return
    if (!tags.some((tag) => tag.toLowerCase() === value.toLowerCase())) onChange([...tags, value])
    setText('')
  }

  const remove = (index) => onChange(tags.filter((_, i) => i !== index))

  const onKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      add(text)
    } else if (event.key === 'Backspace' && !text && tags.length) {
      remove(tags.length - 1)
    }
  }

  return (
    <div className="tagbox" onClick={() => input.current?.focus()}>
      {tags.map((tag, i) => (
        <span className="chip" key={tag}>
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={(event) => {
              event.stopPropagation()
              remove(i)
            }}
          >
            <Icon name="x" size={14} />
          </button>
        </span>
      ))}
      <input
        id={id}
        ref={input}
        value={text}
        disabled={full}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => add(text)}
        placeholder={full ? '' : tags.length ? 'Add another' : placeholder}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        autoComplete="off"
        enterKeyHint="done"
      />
      {max != null && (
        <span className="tagbox-count">
          {tags.length} of {max}
        </span>
      )}
    </div>
  )
}
