export interface CanvasViewport {
  width: number
  height: number
  pixelRatio: number
}

const MAX_PIXEL_RATIO = 2

export function getCanvasPixelRatio() {
  if (typeof window === 'undefined') return 1
  return Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
}

export function setupHiDPICanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  width?: number,
  height?: number
): CanvasViewport {
  const displayWidth = Math.max(1, Math.floor(width ?? canvas.getBoundingClientRect().width ?? canvas.clientWidth))
  const displayHeight = Math.max(1, Math.floor(height ?? canvas.getBoundingClientRect().height ?? canvas.clientHeight))
  const pixelRatio = getCanvasPixelRatio()
  const backingWidth = Math.max(1, Math.round(displayWidth * pixelRatio))
  const backingHeight = Math.max(1, Math.round(displayHeight * pixelRatio))

  if (canvas.width !== backingWidth) canvas.width = backingWidth
  if (canvas.height !== backingHeight) canvas.height = backingHeight
  canvas.style.width = `${displayWidth}px`
  canvas.style.height = `${displayHeight}px`

  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  return {
    width: displayWidth,
    height: displayHeight,
    pixelRatio,
  }
}
