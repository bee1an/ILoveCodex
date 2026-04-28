import { gsap } from 'gsap'

export interface RevealOptions {
  delay?: number
  duration?: number
  x?: number
  y?: number
  scale?: number
  blur?: number
  opacity?: number
  ease?: string
}

export interface CascadeOptions extends RevealOptions {
  selector?: string
  stagger?: number
}

export interface MagneticOptions {
  strength?: number
  maxOffset?: number
  scale?: number
  duration?: number
}

export interface ProgressOptions {
  delay?: number
  duration?: number
  opacity?: number
  targetWidth?: string
}

type DestroyActionReturn = {
  destroy: () => void
}

type UpdateDestroyActionReturn = {
  update: (options?: ProgressOptions) => void
  destroy: () => void
}

const noop = (): void => {}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function cancelFrame(frame: number | null): void {
  if (frame != null && typeof window !== 'undefined') {
    window.cancelAnimationFrame(frame)
  }
}

export function reveal(node: HTMLElement, options: RevealOptions = {}): DestroyActionReturn {
  if (prefersReducedMotion()) {
    return { destroy: noop }
  }

  let frame: number | null = window.requestAnimationFrame(() => {
    frame = null
    gsap.fromTo(
      node,
      {
        autoAlpha: options.opacity ?? 0,
        x: options.x ?? 0,
        y: options.y ?? 4,
        scale: options.scale ?? 0.995,
        filter: `blur(${options.blur ?? 2}px)`
      },
      {
        autoAlpha: 1,
        x: 0,
        y: 0,
        scale: 1,
        filter: 'blur(0px)',
        duration: options.duration ?? 0.32,
        delay: options.delay ?? 0,
        ease: options.ease ?? 'power2.out',
        clearProps: 'filter,transform,opacity,visibility'
      }
    )
  })

  return {
    destroy() {
      cancelFrame(frame)
      gsap.killTweensOf(node)
    }
  }
}

export function cascadeIn(node: HTMLElement, options: CascadeOptions = {}): DestroyActionReturn {
  if (prefersReducedMotion()) {
    return { destroy: noop }
  }

  const selector = options.selector ?? '[data-motion-item]'
  let frame: number | null = window.requestAnimationFrame(() => {
    frame = null
    const targets = Array.from(node.querySelectorAll<HTMLElement>(selector)).filter(
      (target) => target.offsetParent !== null || target === document.activeElement
    )

    if (!targets.length) {
      return
    }

    gsap.fromTo(
      targets,
      {
        autoAlpha: options.opacity ?? 0,
        y: options.y ?? 4,
        x: options.x ?? 0,
        scale: options.scale ?? 0.998,
        filter: `blur(${options.blur ?? 2}px)`
      },
      {
        autoAlpha: 1,
        y: 0,
        x: 0,
        scale: 1,
        filter: 'blur(0px)',
        delay: options.delay ?? 0,
        duration: options.duration ?? 0.28,
        stagger: options.stagger ?? 0.02,
        ease: options.ease ?? 'power2.out',
        clearProps: 'filter,transform,opacity,visibility'
      }
    )
  })

  return {
    destroy() {
      cancelFrame(frame)
      gsap.killTweensOf(node.querySelectorAll(selector))
    }
  }
}

export function magnetic(node: HTMLElement, options: MagneticOptions = {}): DestroyActionReturn {
  if (prefersReducedMotion()) {
    return { destroy: noop }
  }

  const strength = options.strength ?? 0.2
  const maxOffset = options.maxOffset ?? 10
  const duration = options.duration ?? 0.26
  const hoverScale = options.scale ?? 1.035

  const setTo = gsap.quickTo(node, 'x', { duration, ease: 'power3.out' })
  const setLeft = gsap.quickTo(node, 'y', { duration, ease: 'power3.out' })
  const setScale = gsap.quickTo(node, 'scale', {
    duration: duration * 0.9,
    ease: 'power2.out'
  })

  const handleMove = (event: PointerEvent): void => {
    const rect = node.getBoundingClientRect()
    const offsetX = (event.clientX - (rect.left + rect.width / 2)) * strength
    const offsetY = (event.clientY - (rect.top + rect.height / 2)) * strength
    setTo(Math.max(-maxOffset, Math.min(maxOffset, offsetX)))
    setLeft(Math.max(-maxOffset, Math.min(maxOffset, offsetY)))
  }

  const handleEnter = (): void => {
    setScale(hoverScale)
  }

  const handleLeave = (): void => {
    setTo(0)
    setLeft(0)
    setScale(1)
  }

  node.addEventListener('pointermove', handleMove)
  node.addEventListener('pointerenter', handleEnter)
  node.addEventListener('pointerleave', handleLeave)

  return {
    destroy() {
      node.removeEventListener('pointermove', handleMove)
      node.removeEventListener('pointerenter', handleEnter)
      node.removeEventListener('pointerleave', handleLeave)
      gsap.killTweensOf(node)
      node.style.removeProperty('transform')
    }
  }
}

export function animateProgress(
  node: HTMLElement,
  options: ProgressOptions = {}
): UpdateDestroyActionReturn {
  if (prefersReducedMotion()) {
    return { update: noop, destroy: noop }
  }

  const run = (immediate = false): void => {
    const targetWidth =
      options.targetWidth ||
      node.style.width ||
      `${Math.round(node.getBoundingClientRect().width)}px`
    gsap.killTweensOf(node)

    if (immediate) {
      gsap.to(node, {
        width: targetWidth,
        opacity: 1,
        duration: options.duration ?? 0.46,
        ease: 'power2.out'
      })
      return
    }

    gsap.fromTo(
      node,
      {
        width: '0%',
        opacity: options.opacity ?? 0.72
      },
      {
        width: targetWidth,
        opacity: 1,
        duration: options.duration ?? 0.52,
        delay: options.delay ?? 0,
        ease: 'power2.out'
      }
    )
  }

  let frame: number | null = window.requestAnimationFrame(() => {
    frame = null
    run(false)
  })

  return {
    update(nextOptions: ProgressOptions = {}) {
      options = { ...options, ...nextOptions }
      run(true)
    },
    destroy() {
      cancelFrame(frame)
      gsap.killTweensOf(node)
    }
  }
}
