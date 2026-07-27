import { useId } from 'react'
import type { ReactNode } from 'react'

type CollapsibleSectionProps = {
  title: string
  isOpen: boolean
  onToggle: () => void
  children: ReactNode
}

export function CollapsibleSection({ title, isOpen, onToggle, children }: CollapsibleSectionProps) {
  const contentId = useId()

  return (
    <section className="panel collapsible-panel">
      <button
        type="button"
        className="collapsible-toggle"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={onToggle}
      >
        <span>{title}</span>
        <span className="material-symbols-outlined" aria-hidden="true">
          expand_more
        </span>
      </button>
      <div id={contentId} className="collapsible-content" hidden={!isOpen}>
        {children}
      </div>
    </section>
  )
}
