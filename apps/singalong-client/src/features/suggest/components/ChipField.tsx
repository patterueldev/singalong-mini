import { useId } from 'react'

type ChipFieldProps = {
  label: string
  values: string[]
  inputValue: string
  placeholder: string
  helperText?: string
  required?: boolean
  suggestions?: string[]
  onInputValueChange: (value: string) => void
  onCommitValue: () => void
  onSelectSuggestion?: (value: string) => void
  onRemoveValue: (index: number) => void
}

export function ChipField({
  label,
  values,
  inputValue,
  placeholder,
  helperText,
  required,
  suggestions,
  onInputValueChange,
  onCommitValue,
  onSelectSuggestion,
  onRemoveValue,
}: ChipFieldProps) {
  const inputId = useId()

  return (
    <div>
      <label className="form-label" htmlFor={inputId}>
        {label}
      </label>
      <div className="chip-input-shell">
        <div className="chip-list">
          {values.length === 0 ? (
            <span className="chip-empty">{required ? 'At least one required' : 'None yet'}</span>
          ) : (
            values.map((value, index) => (
              <span className="chip" key={value}>
                {value}
                <button
                  type="button"
                  className="chip-tag-remove"
                  aria-label={`Remove ${value}`}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onRemoveValue(index)
                  }}
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>
        <div className="chip-input-row">
          <input
            id={inputId}
            value={inputValue}
            onChange={(event) => onInputValueChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onCommitValue()
              }
            }}
            placeholder={placeholder}
          />
          <button type="button" className="secondary" onClick={onCommitValue}>
            Add
          </button>
        </div>
        {suggestions !== undefined && suggestions.length > 0 ? (
          <div className="chip-suggestion-list">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="chip-suggestion"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelectSuggestion?.(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {helperText !== undefined ? <span className="field-help">{helperText}</span> : null}
    </div>
  )
}
