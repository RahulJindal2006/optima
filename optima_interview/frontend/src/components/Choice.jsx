// A small set of options where one is picked. With `allowNone`, picking the chosen one clears it.
export default function Choice({ options, value, onChange, allowNone = false, label, className = '' }) {
  return (
    <div className={`seg ${className}`} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          aria-pressed={value === option.value}
          onClick={() => onChange(allowNone && value === option.value ? '' : option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
