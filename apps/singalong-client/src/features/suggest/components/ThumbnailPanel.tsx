import type { ChangeEvent, RefObject } from 'react'

type ThumbnailPanelProps = {
  previewUrl: string
  title: string
  contextMenu: { x: number; y: number } | null
  onOpenContextMenu: (element: HTMLElement) => void
  onCloseContextMenu: () => void
  thumbnailFileInputRef: RefObject<HTMLInputElement | null>
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void
  onReset: () => void
}

export function ThumbnailPanel({
  previewUrl,
  title,
  contextMenu,
  onOpenContextMenu,
  onCloseContextMenu,
  thumbnailFileInputRef,
  onUpload,
  onReset,
}: ThumbnailPanelProps) {
  return (
    <section className="panel thumbnail-panel">
      <h2>Thumbnail</h2>
      <div
        className="thumbnail-preview"
        onClick={(e) => {
          onOpenContextMenu(e.currentTarget)
        }}
        style={{ cursor: 'pointer', position: 'relative' }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpenContextMenu(e.currentTarget)
          }
        }}
      >
        {previewUrl !== '' ? (
          <img src={previewUrl} alt={title} />
        ) : (
          <div className="thumbnail-placeholder">No thumbnail available</div>
        )}
        <button
          type="button"
          className="thumbnail-edit-button"
          aria-label="Edit thumbnail"
          onClick={(e) => {
            e.stopPropagation()
            const previewElement = e.currentTarget.closest('.thumbnail-preview')
            if (previewElement instanceof HTMLElement) {
              onOpenContextMenu(previewElement)
            }
          }}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            photo_camera
          </span>
        </button>
      </div>

      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            backgroundColor: 'var(--surface-secondary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 8,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
            zIndex: 1000,
            minWidth: 180,
          }}
        >
          <button
            type="button"
            onClick={() => {
              thumbnailFileInputRef.current?.click()
              onCloseContextMenu()
            }}
            style={{
              display: 'block',
              width: '100%',
              padding: '10px 16px',
              border: 'none',
              backgroundColor: 'transparent',
              textAlign: 'left',
              cursor: 'pointer',
              fontSize: '14px',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-input)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            Upload Thumbnail
          </button>
          <button
            type="button"
            onClick={onReset}
            style={{
              display: 'block',
              width: '100%',
              padding: '10px 16px',
              border: 'none',
              backgroundColor: 'transparent',
              textAlign: 'left',
              cursor: 'pointer',
              fontSize: '14px',
              borderTop: '1px solid var(--border-primary)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-input)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            Reset Thumbnail
          </button>
        </div>
      )}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999,
          }}
          onClick={onCloseContextMenu}
        />
      )}

      <input
        ref={thumbnailFileInputRef}
        type="file"
        accept="image/*"
        onChange={onUpload}
        style={{ display: 'none' }}
      />
    </section>
  )
}
