/**
 * Resolves once `promise` settles (resolved or rejected) or `ms` have passed, whichever comes
 * first, leaving no timer behind: the bound on the sync folder's launch read before the window's
 * first `state:load` (#26 D4) and on the quit hold (#26 D5).
 */
export function boundedWait(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    const done = (): void => {
      clearTimeout(timer)
      resolve()
    }
    promise.then(done, done)
  })
}
