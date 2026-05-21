type ChipFieldProps = {
  label: string
  values: string[]
  inputValue: string
  placeholder: string
  helperText?: string
  required?: boolean
  suggestions?: string[]
  datalistId?: string
  onInputValueChange: (value: string) => void
  onCommitValue: () => void
  onSelectSuggestion?: (value: string) => void
  onRemoveValue: (value: string) => void
}

export function ChipField({
  label,
  values,
  inputValue,
  placeholder,
  helperText,
  required,
  suggestions,
  datalistId,
  onInputValueChange,
  onCommitValue,
  onSelectSuggestion,
  onRemoveValue,
}: ChipFieldProps) {
  return (
    <label>
      {label}
      <div className="chip-input-shell">
        <div className="chip-list">
          {values.length === 0 ? (
            <span className="chip-empty">{required ? 'At least one required' : 'None yet'}</span>
          ) : (
            values.map((value) => (
              <span className="chip" key={value}>
                {value}
                <button type="button" aria-label={`Remove ${value}`} onClick={() => onRemoveValue(value)}>
                  ×
                </button>
              </span>
            ))
          )}
        </div>
        <div className="chip-input-row">
          <input
            value={inputValue}
            list={datalistId}
            onChange={(event) => onInputValueChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault()
                onCommitValue()
              }
            }}
            onBlur={onCommitValue}
            placeholder={placeholder}
          />
          <button type="button" className="secondary" onClick={onCommitValue}>
            Add
          </button>
        </div>
        {datalistId !== undefined && suggestions !== undefined && suggestions.length > 0 ? (
          <datalist id={datalistId}>
            {suggestions.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
        ) : null}
        {suggestions !== undefined && suggestions.length > 0 ? (
          <div className="chip-suggestion-list">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="chip-suggestion"
                onClick={() => onSelectSuggestion?.(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {helperText !== undefined ? <span className="field-help">{helperText}</span> : null}
    </label>
  )
}
