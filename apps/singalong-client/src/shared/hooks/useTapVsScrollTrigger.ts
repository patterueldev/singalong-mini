import { useCallback, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

const MOVE_THRESHOLD_PX = 10

type TapVsScrollTrigger = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
}

// Distinguishes a tap (should open a Radix DropdownMenu) from the start of a touch-scroll
// gesture (must not open it). Radix's Trigger opens on raw pointerdown with no gesture
// disambiguation, so this drives the menu via a controlled `open` state instead: touch
// pointerdown is preventDefault()'d (which suppresses Radix's own pointerdown-open handler,
// since it's composed after ours and skips when defaultPrevented) and open only fires if
// pointerup lands within MOVE_THRESHOLD_PX of where the touch started.
export function useTapVsScrollTrigger(): TapVsScrollTrigger {
  const [open, setOpen] = useState(false)
  const startRef = useRef<{ x: number; y: number; pointerId: number } | null>(null)

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch') {
      return
    }
    event.preventDefault()
    startRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }

    const target = event.currentTarget

    const cleanup = () => {
      target.removeEventListener('pointerup', handlePointerUp)
      target.removeEventListener('pointercancel', handlePointerCancel)
    }

    const handlePointerUp = (upEvent: PointerEvent) => {
      cleanup()
      const start = startRef.current
      startRef.current = null
      if (start === null || upEvent.pointerId !== start.pointerId) {
        return
      }
      const dx = upEvent.clientX - start.x
      const dy = upEvent.clientY - start.y
      if (Math.hypot(dx, dy) <= MOVE_THRESHOLD_PX) {
        setOpen(true)
      }
    }

    const handlePointerCancel = () => {
      startRef.current = null
      cleanup()
    }

    target.addEventListener('pointerup', handlePointerUp)
    target.addEventListener('pointercancel', handlePointerCancel)
  }, [])

  return { open, onOpenChange: setOpen, onPointerDown }
}
