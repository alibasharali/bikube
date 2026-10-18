import type { FindQuery } from './card-terminals'

/**
 * The last query and toggles of the find bar (#35 D11): one value for every card, shell and
 * pane, kept for the run of the app and never saved.
 */
let remembered: FindQuery = { query: '', caseSensitive: false, regex: false }

export const findStore = {
  get(): FindQuery {
    return remembered
  },
  set(find: FindQuery): void {
    remembered = find
  }
}
