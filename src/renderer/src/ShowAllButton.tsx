/**
 * Under a cut Agent tab list (#77 C3): `Show all (<n> more)` while `more` rows are left out, and
 * `Show fewer` once they show; nothing for a list within its limit.
 */
export function ShowAllButton({
  testId,
  more,
  all,
  onToggle
}: {
  testId: string
  /** The rows the cut leaves out. */
  more: number
  /** Whether every row shows. */
  all: boolean
  onToggle: () => void
}): React.JSX.Element | null {
  if (more <= 0) return null
  return (
    <button
      type="button"
      className="btn btn-small agent-tab-show-all"
      data-testid={testId}
      onClick={onToggle}
    >
      {all ? 'Show fewer' : `Show all (${more} more)`}
    </button>
  )
}
