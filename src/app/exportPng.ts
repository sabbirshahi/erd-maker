/** Export the React Flow canvas as a PNG via html-to-image. */
import { toPng } from 'html-to-image'
import { toast } from './toast'

const EXCLUDE = ['react-flow__controls', 'react-flow__minimap', 'react-flow__attribution', 'react-flow__panel']

export function findCanvasElement(root: ParentNode = document): HTMLElement | null {
  return (root.querySelector('.react-flow') as HTMLElement | null) ?? (root.querySelector('[data-testid="canvas"]') as HTMLElement | null)
}

/**
 * Copy the computed stroke of every edge onto the element as an inline style, returning an undo.
 *
 * Edge colour comes from a descendant rule (`.react-flow__edge.erd-edge .react-flow__edge-path`)
 * whose value is a CSS custom property. html-to-image loses that during cloning, so relations came
 * out of the PNG as labels and arrowheads with no lines between them. Inline styles survive the
 * clone, so they are applied for the capture and removed again immediately afterwards.
 */
export function inlineEdgeStyles(root: ParentNode): () => void {
  const selector = '.react-flow__edge-path, .react-flow__connection-path, .react-flow__edge-interaction'
  const saved: Array<[SVGElement, string | null]> = []
  root.querySelectorAll<SVGElement>(selector).forEach((el) => {
    saved.push([el, el.getAttribute('style')])
    const cs = getComputedStyle(el)
    el.style.stroke = cs.stroke
    el.style.strokeWidth = cs.strokeWidth
    el.style.strokeDasharray = cs.strokeDasharray
    el.style.strokeLinecap = cs.strokeLinecap
    el.style.fill = cs.fill
  })
  return () => {
    for (const [el, style] of saved) {
      if (style === null) el.removeAttribute('style')
      else el.setAttribute('style', style)
    }
  }
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export async function exportCanvasPng(filename = 'erd.png'): Promise<boolean> {
  const el = findCanvasElement()
  if (!el) {
    toast('Canvas is not available to export', 'error')
    return false
  }
  const restoreEdges = inlineEdgeStyles(el)
  try {
    const dark = document.documentElement.classList.contains('dark')
    const dataUrl = await toPng(el, {
      pixelRatio: 2,
      backgroundColor: dark ? '#09090b' : '#fafafa',
      cacheBust: true,
      filter: (node) => {
        const cl = (node as HTMLElement).classList
        if (!cl) return true
        return !EXCLUDE.some((c) => cl.contains(c))
      },
    })
    downloadDataUrl(dataUrl, filename)
    toast('Exported PNG')
    return true
  } catch (err) {
    console.error(err)
    toast('PNG export failed', 'error')
    return false
  } finally {
    restoreEdges()
  }
}

export function downloadText(text: string, filename: string, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  downloadDataUrl(url, filename)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
