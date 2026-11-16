import Icon from './Icon'

// Appears at the bottom of a form while there are changes to keep.
export default function SaveBar({ dirty, saving, saved, onSave, onDiscard }) {
  if (!dirty) {
    return saved ? (
      <p className="saved-note" role="status">
        <Icon name="check" size={16} />
        Saved
      </p>
    ) : null
  }
  return (
    <div className="savebar" role="region" aria-label="Unsaved changes">
      <p>You have unsaved changes</p>
      <div className="cluster">
        <button type="button" className="btn on-dark outline sm" onClick={onDiscard} disabled={saving}>
          Discard
        </button>
        <button type="button" className="btn on-dark sm" onClick={onSave} disabled={saving}>
          {saving && <span className="spinner" aria-hidden="true" />}
          Save changes
        </button>
      </div>
    </div>
  )
}
