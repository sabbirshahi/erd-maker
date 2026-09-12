import { Shell } from '@/app/Shell'
import { EmbedView } from '@/app/EmbedView'
import { Toaster } from '@/app/toast'
import { isEmbed } from '@/app/embed'

export default function App() {
  // ?embed=1 is a different product surface, not a variant of the shell: rendering the shell and
  // hiding its parts would leave every one of its write paths a toggle away.
  if (isEmbed()) return <EmbedView />
  return (
    <>
      <Shell />
      <Toaster />
    </>
  )
}
