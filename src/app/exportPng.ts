/** Export the React Flow canvas as a PNG via html-to-image. */
import { toPng } from 'html-to-image'
import { toast } from './toast'

const EXCLUDE = ['react-flow__controls', 'react-flow__minimap', 'react-flow__attribution', 'react-flow__panel']

export function findCanvasElement(root: ParentNode = document): HTMLElement | null {
  return (root.querySelector('.react-flow') as HTMLElement | null) ?? (root.querySelector('[data-testid="canvas"]') as HTMLElement | null)
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
  }
}

export function downloadText(text: string, filename: string, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  downloadDataUrl(url, filename)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
