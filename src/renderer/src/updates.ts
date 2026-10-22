import { useEffect, useState } from 'react'
import type { UpdateState } from '../../core/updates'

/** The updater's state from main, the version running, and the popup requests from the menu. */
export function useUpdate(onShow: () => void): { state: UpdateState; current: string } {
  const [update, setUpdate] = useState<{ state: UpdateState; current: string }>({
    state: { kind: 'off' },
    current: ''
  })
  useEffect(() => {
    let live = true
    const offState = window.bikube.update.onState((state) => setUpdate((u) => ({ ...u, state })))
    void window.bikube.update.state().then((u) => {
      if (live) setUpdate(u)
    })
    return () => {
      live = false
      offState()
    }
  }, [])
  useEffect(() => window.bikube.update.onShow(onShow), [onShow])
  return update
}
