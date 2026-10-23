/**
 * The argument main gives the development build's renderer (never a packaged app's) so the page
 * exposes hooks the smoke tests drive, such as `__bikubeSettings` (#64).
 */
export const TEST_HOOKS_ARG = '--bikube-test-hooks'

/** Whether `argv` asks for the test hooks. */
export const hasTestHooks = (argv: readonly string[]): boolean => argv.includes(TEST_HOOKS_ARG)
