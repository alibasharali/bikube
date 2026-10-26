/**
 * Names for a card's own git worktree: the branch (`bikube/<slug of the card title>`) and the
 * worktree's folder (the slug). Plain TS.
 */

export const BRANCH_PREFIX = 'bikube/'
export const MAX_SLUG_LENGTH = 40

/**
 * `title` as a branch-safe slug: lowercase ASCII letters and digits joined by single dashes,
 * accents dropped, cut at a dash to at most 40 characters; `card` when nothing is left.
 */
export function titleSlug(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length <= MAX_SLUG_LENGTH) return slug || 'card'
  const cut = slug.slice(0, MAX_SLUG_LENGTH + 1)
  const dash = cut.lastIndexOf('-')
  return (dash > 0 ? cut.slice(0, dash) : slug.slice(0, MAX_SLUG_LENGTH)).replace(/-+$/, '')
}

/** The branch suggested for a card titled `title`: `bikube/<slug>`, `-2`, `-3`… when taken. */
export function suggestBranch(title: string, taken: ReadonlySet<string>): string {
  const base = `${BRANCH_PREFIX}${titleSlug(title)}`
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
  }
}

/**
 * Why `name` can't be a new branch, as `git check-ref-format --branch` would refuse it (plus no
 * spaces, for typing it in a shell), or null when it can. Main asks git too before creating it.
 */
export function branchProblem(name: string): string | null {
  if (name.trim() === '') return 'Enter a branch name'
  if (name.length > 200) return 'Branch name is too long'
  if (
    // eslint-disable-next-line no-control-regex -- control characters are refused, as git does
    /[\s~^:?*[\\\x00-\x1f\x7f]/.test(name) ||
    name.includes('..') ||
    name.includes('@{') ||
    name.includes('//') ||
    name === '@' ||
    name.startsWith('-') ||
    name.startsWith('/') ||
    name.endsWith('/') ||
    name.endsWith('.') ||
    name.endsWith('.lock') ||
    name.split('/').some((part) => part.startsWith('.'))
  ) {
    return 'Not a valid branch name'
  }
  return null
}

/** The worktree's folder for `branch`: its last part, which the branch's slug already made safe. */
export function worktreeFolder(branch: string): string {
  return branch.slice(branch.lastIndexOf('/') + 1).replace(/[^A-Za-z0-9._-]/g, '-') || 'card'
}
