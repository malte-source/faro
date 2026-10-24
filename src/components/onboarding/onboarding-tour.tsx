'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, ChevronRight, ChevronLeft, Sparkles, Compass } from 'lucide-react'

const STORAGE_KEY = 'faro:onboarding:v1'

interface TourStep {
  id: string
  title: string
  body: string
  target?: string          // CSS selector of element to highlight
  placement?: 'bottom' | 'right' | 'left' | 'top' | 'center'
  spotlight?: boolean       // shows a circular spotlight cutout
}

const STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: '¡Bienvenido a Faro! 🎉',
    body: 'Tu plataforma de gestión de proyectos. En los próximos pasos te mostramos las funciones más importantes.',
    placement: 'center',
  },
  {
    id: 'sidebar-nav',
    title: 'Navegación principal',
    body: 'Accede a proyectos, tareas, calendario, reportes y más desde el menú lateral.',
    target: 'aside',
    placement: 'right',
    spotlight: true,
  },
  {
    id: 'new-task',
    title: 'Crear tareas rápido',
    body: 'Presiona la tecla N en cualquier momento para crear una tarea al instante, sin perder el contexto.',
    target: '[data-tour="quick-create"]',
    placement: 'right',
    spotlight: true,
  },
  {
    id: 'command-palette',
    title: 'Paleta de comandos',
    body: 'Presiona ⌘K (o Ctrl+K) para buscar proyectos, tareas y navegar a cualquier sección sin tocar el mouse.',
    target: '[data-tour="search-trigger"]',
    placement: 'right',
    spotlight: true,
  },
  {
    id: 'projects',
    title: 'Tus proyectos',
    body: 'Crea tu primer proyecto desde la sección Proyectos. Puedes asignar tareas, equipo, fechas y mucho más.',
    placement: 'center',
  },
  {
    id: 'done',
    title: '¡Listo para zarpar!',
    body: 'Ya conoces lo esencial. Si quieres volver a ver este tour, encuéntralo en Configuración → Ayuda.',
    placement: 'center',
  },
]

function getTargetRect(selector: string): DOMRect | null {
  const el = document.querySelector(selector)
  return el ? el.getBoundingClientRect() : null
}

interface TooltipPosition {
  top: number
  left: number
  transformOrigin?: string
}

function computePosition(
  targetRect: DOMRect | null,
  placement: TourStep['placement'],
  tooltipW: number,
  tooltipH: number
): TooltipPosition {
  if (!targetRect || placement === 'center') {
    return {
      top: window.innerHeight / 2 - tooltipH / 2,
      left: window.innerWidth / 2 - tooltipW / 2,
    }
  }

  const gap = 16
  const winW = window.innerWidth
  const winH = window.innerHeight

  let top = 0
  let left = 0

  if (placement === 'right') {
    top = targetRect.top + targetRect.height / 2 - tooltipH / 2
    left = targetRect.right + gap
  } else if (placement === 'left') {
    top = targetRect.top + targetRect.height / 2 - tooltipH / 2
    left = targetRect.left - tooltipW - gap
  } else if (placement === 'bottom') {
    top = targetRect.bottom + gap
    left = targetRect.left + targetRect.width / 2 - tooltipW / 2
  } else if (placement === 'top') {
    top = targetRect.top - tooltipH - gap
    left = targetRect.left + targetRect.width / 2 - tooltipW / 2
  }

  // Clamp
  top = Math.max(12, Math.min(top, winH - tooltipH - 12))
  left = Math.max(12, Math.min(left, winW - tooltipW - 12))

  return { top, left }
}

export function OnboardingTour() {
  const [visible, setVisible] = useState(false)
  const [stepIdx, setStepIdx] = useState(0)
  const [pos, setPos] = useState<TooltipPosition>({ top: 0, left: 0 })
  const tooltipRef = useRef<HTMLDivElement>(null)

  // Show on first visit
  useEffect(() => {
    const done = localStorage.getItem(STORAGE_KEY)
    if (!done) {
      // Small delay so layout renders first
      setTimeout(() => setVisible(true), 800)
    }
  }, [])

  const step = STEPS[stepIdx]

  const updatePosition = useCallback(() => {
    if (!visible || !step) return
    const tooltipEl = tooltipRef.current
    const w = tooltipEl?.offsetWidth ?? 340
    const h = tooltipEl?.offsetHeight ?? 200

    const targetRect = step.target ? getTargetRect(step.target) : null
    const p = computePosition(targetRect, step.placement, w, h)
    setPos(p)
  }, [visible, step])

  useEffect(() => {
    updatePosition()
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [updatePosition])

  // Skip-when-target-missing: if the current step references a CSS target that
  // isn't in the DOM (eg. user is on a route where the sidebar isn't mounted,
  // or the data-tour attribute was renamed), auto-advance instead of freezing
  // with no spotlight. Without this the user sees the tour text but no anchor
  // and gets stuck wondering "what should I look at?".
  useEffect(() => {
    if (!visible || !step?.target) return
    const t = setTimeout(() => {
      if (!document.querySelector(step.target!)) {
        if (stepIdx < STEPS.length - 1) setStepIdx(i => i + 1)
        else {
          localStorage.setItem(STORAGE_KEY, 'done')
          setVisible(false)
        }
      }
    }, 60)  // small delay to allow lazy-mounted targets to attach
    return () => clearTimeout(t)
  }, [stepIdx, visible, step])

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, 'done')
    setVisible(false)
  }

  function next() {
    if (stepIdx < STEPS.length - 1) {
      setStepIdx(i => i + 1)
    } else {
      dismiss()
    }
  }

  function prev() {
    if (stepIdx > 0) setStepIdx(i => i - 1)
  }

  if (!visible) return null

  const isFirst = stepIdx === 0
  const isLast = stepIdx === STEPS.length - 1
  const progress = ((stepIdx + 1) / STEPS.length) * 100

  // Spotlight rect
  const spotlightRect = step.spotlight && step.target ? getTargetRect(step.target) : null

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-[70]"
        style={{
          background: spotlightRect
            ? `radial-gradient(ellipse ${spotlightRect.width + 24}px ${spotlightRect.height + 24}px at ${spotlightRect.left + spotlightRect.width / 2}px ${spotlightRect.top + spotlightRect.height / 2}px, transparent 0%, rgba(10,26,38,0.7) 60%)`
            : 'rgba(10,26,38,0.6)',
        }}
      />

      {/* Señal ring around the spotlighted target */}
      {spotlightRect && (
        <div
          className="pointer-events-none fixed z-[71] rounded-xl ring-2 ring-signal"
          style={{
            top: spotlightRect.top - 6,
            left: spotlightRect.left - 6,
            width: spotlightRect.width + 12,
            height: spotlightRect.height + 12,
          }}
        />
      )}

      {/* Tooltip — Noche reverse-out, per brand (dark tooltip on any surface) */}
      <div
        ref={tooltipRef}
        className="fixed z-[80] w-80 rounded-2xl border border-signal/20 bg-night shadow-2xl"
        style={{ top: pos.top, left: pos.left }}
      >
        {/* Progress bar */}
        <div className="h-1 w-full overflow-hidden rounded-t-2xl bg-night-700">
          <div
            className="h-full rounded-full bg-signal transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-night-700">
              {isLast ? <Sparkles className="h-3.5 w-3.5 text-signal" /> : <Compass className="h-3.5 w-3.5 text-signal" />}
            </div>
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-signal">
              {stepIdx + 1} / {STEPS.length}
            </span>
          </div>
          <button
            onClick={dismiss}
            className="rounded-md p-1 text-[#9DB0BC] transition-colors hover:bg-night-700 hover:text-mist"
            title="Saltar tour"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-4 pb-4">
          <h3 className="font-display text-sm font-bold text-mist mb-1.5">
            {step.title}
          </h3>
          <p className="text-xs leading-relaxed text-[#9DB0BC]">
            {step.body}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between border-t border-[#17313F] px-4 py-3">
          <button
            onClick={dismiss}
            className="text-xs text-[#9DB0BC] transition-colors hover:text-mist"
          >
            Saltar
          </button>
          <div className="flex gap-2">
            {!isFirst && (
              <button
                onClick={prev}
                className="flex items-center gap-1 rounded-lg border border-[#1E3A4C] px-3 py-1.5 text-xs font-medium text-[#9DB0BC] transition-colors hover:bg-night-700"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Atrás
              </button>
            )}
            <button
              onClick={next}
              className="flex items-center gap-1 rounded-lg bg-signal px-3 py-1.5 text-xs font-semibold text-night transition-colors hover:bg-[#F0A30F] active:scale-95"
            >
              {isLast ? '¡Empezar!' : 'Siguiente'}
              {!isLast && <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
