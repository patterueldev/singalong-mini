import type { SuggestResult } from '../../../shared/types/client'

type IdentifyOverrideModalProps = {
  result: SuggestResult
  onCancel: () => void
  onConfirm: () => void
}

export function IdentifyOverrideModal({ result, onCancel, onConfirm }: IdentifyOverrideModalProps) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="modal-card context-menu-card"
        role="dialog"
        aria-modal="true"
        aria-label={`${result.title} already exists`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>Song already exists</h2>
            <p className="subtitle">{result.title}</p>
          </div>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>

        <p className="modal-description top-gap">
          This video already exists or is currently downloading. Do you want to override it and identify again?
        </p>

        <div className="row-actions modal-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm}>
            Identify
          </button>
        </div>
      </div>
    </div>
  )
}
