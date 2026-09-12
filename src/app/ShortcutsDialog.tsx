/**
 * The keyboard shortcuts, which until now existed only in the source.
 *
 * Opened with `?`, and from the diagram menu — a help dialog reachable only by an undiscoverable
 * key would not have fixed much.
 */
import { Modal } from '@/editors/Modal'
import { SHORTCUTS, isMac, renderKey } from './shortcuts'

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mac = isMac()
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" testId="shortcuts-dialog" widthClass="max-w-xl">
      <div className="erd-shortcuts">
        {SHORTCUTS.map((group) => (
          <section key={group.title}>
            <h3 className="erd-shortcuts__title">{group.title}</h3>
            <dl className="erd-shortcuts__list">
              {group.items.map((s) => (
                <div key={`${group.title}-${s.keys.join('+')}-${s.description}`} className="erd-shortcuts__row">
                  <dt className="erd-shortcuts__keys">
                    {s.keys.map((k, i) => (
                      <kbd key={i} className="erd-kbd">
                        {renderKey(k, mac)}
                      </kbd>
                    ))}
                  </dt>
                  <dd className="erd-shortcuts__what">
                    {s.description}
                    {s.scope && <span className="erd-shortcuts__scope">{s.scope}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  )
}
