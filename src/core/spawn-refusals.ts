/**
 * Why main refused `terminal:spawn`; the renderer shows it after "Couldn't start: " (#4 D3). No
 * Node imports: the renderer reads it too.
 */
export const SPAWN_REFUSAL = {
  invalidSize: 'invalid terminal size',
  invalidDirectory: 'invalid working directory',
  directoryNotFound: 'working directory not found',
  invalidCard: 'invalid card id'
} as const
