import { Check, ChevronDown } from 'lucide-react'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const MENU_SELECT_CONTENT_ATTR = 'data-menu-select-content'

export interface MenuSelectOption {
  value: string
  label: string
  hint?: string
}

interface MenuSelectProps {
  value: string
  onChange: (value: string) => void
  options: MenuSelectOption[]
  placeholder?: string
  leading?: ReactNode
  id?: string
  disabled?: boolean
  className?: string
  triggerClassName?: string
  menuClassName?: string
}

interface MenuPosition {
  top: number
  left: number
  width: number
  openUp: boolean
}

function measurePosition(
  trigger: HTMLElement,
  menuHeight: number,
): MenuPosition {
  const rect = trigger.getBoundingClientRect()
  const gap = 6
  const spaceBelow = window.innerHeight - rect.bottom - gap
  const openUp = spaceBelow < menuHeight && rect.top > spaceBelow
  return {
    top: openUp ? rect.top - gap : rect.bottom + gap,
    left: rect.left,
    width: Math.max(rect.width, 192),
    openUp,
  }
}

export function isMenuSelectTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(`[${MENU_SELECT_CONTENT_ATTR}]`))
}

export function MenuSelect({
  value,
  onChange,
  options,
  placeholder = '선택',
  leading,
  id,
  disabled,
  className,
  triggerClassName,
  menuClassName,
}: MenuSelectProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const autoId = useId()
  const listboxId = id ? `${id}-listbox` : `${autoId}-listbox`

  useLayoutEffect(() => {
    if (!open || !rootRef.current) {
      setPosition(null)
      return
    }

    function updatePosition() {
      const trigger = rootRef.current
      if (!trigger) return
      const menuHeight = menuRef.current?.offsetHeight ?? 240
      setPosition(measurePosition(trigger, menuHeight))
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, options.length])

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const selected = options.find((option) => option.value === value)

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <Button
        type="button"
        id={id}
        variant="outline"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (disabled) return
          setOpen((prev) => {
            const next = !prev
            if (next && rootRef.current) {
              setPosition(measurePosition(rootRef.current, 240))
            }
            return next
          })
        }}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        className={cn('w-full justify-between gap-3 px-3.5', triggerClassName)}
      >
        <span className="flex min-w-0 items-center gap-2">
          {leading}
          <span
            className={cn(
              'truncate',
              !selected && 'text-muted-foreground font-medium',
            )}
          >
            {selected?.label ?? placeholder}
          </span>
        </span>
        <ChevronDown
          className={cn(
            'text-muted-foreground size-4 shrink-0 transition-transform',
            open && 'rotate-180',
          )}
        />
      </Button>

      {open && position
        ? createPortal(
            <div
              ref={menuRef}
              id={listboxId}
              role="listbox"
              {...{ [MENU_SELECT_CONTENT_ATTR]: 'true' }}
              onPointerDown={(event) => event.stopPropagation()}
              style={{
                position: 'fixed',
                top: position.openUp ? undefined : position.top,
                bottom: position.openUp
                  ? window.innerHeight - position.top
                  : undefined,
                left: position.left,
                width: position.width,
                pointerEvents: 'auto',
                zIndex: 300,
              }}
              className={cn(
                'bg-card overflow-hidden rounded-xl border shadow-lg',
                menuClassName,
              )}
            >
              <div className="max-h-64 overflow-y-auto p-1.5">
                {options.map((option) => {
                  const isSelected = option.value === value
                  return (
                    <button
                      key={option.value === '' ? '__empty' : option.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onPointerDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        onChange(option.value)
                        setOpen(false)
                      }}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                        isSelected
                          ? 'bg-accent text-foreground font-semibold'
                          : 'hover:bg-muted/70 text-foreground font-medium',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      {option.hint ? (
                        <span className="text-muted-foreground shrink-0 text-xs">
                          {option.hint}
                        </span>
                      ) : null}
                      {isSelected ? (
                        <Check className="text-primary size-4 shrink-0" />
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
