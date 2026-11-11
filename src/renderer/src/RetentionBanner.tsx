import { useEffect } from 'react'
import { retentionNotice } from '../../core/claude-retention-types'
import {
  checkClaudeRetention,
  dismissClaudeRetention,
  keepClaudeConversations,
  useClaudeRetention
} from './claude-retention'
import { settingsStore, useSettings } from './settings'

/**
 * The one-time notice over a local Claude Code card (#80 D5): while Claude Code keeps its
 * conversations less than 3650 days and Offer to keep Claude Code conversations is on, a banner at
 * the top of the card view, not a dialog, so the terminal keeps its keys. Keep for 10 years writes
 * the setting (its error line kept under the text on a failure), Not now hides it for this run,
 * Don't ask again turns the preference off. The setting is read when such a card opens (`cardId`).
 * `onDone` gives the keyboard back to the terminal once a button made the banner go.
 */
function RetentionBanner({
  cardId,
  onDone
}: {
  cardId: string
  onDone: () => void
}): React.JSX.Element | null {
  const { offerClaudeRetention } = useSettings()
  const { retention, dismissed, saving, error } = useClaudeRetention()
  useEffect(() => {
    if (offerClaudeRetention) checkClaudeRetention()
  }, [cardId, offerClaudeRetention])
  if (!offerClaudeRetention || dismissed || retention?.state !== 'low') return null
  return (
    <div
      className="retention-banner"
      data-testid="retention-banner"
      role="region"
      aria-label="Claude Code conversations"
    >
      <div className="retention-banner-text">
        <p data-testid="retention-banner-text">{retentionNotice(retention.days)}</p>
        {error && (
          <p className="retention-banner-error" role="alert" data-testid="retention-banner-error">
            {error}
          </p>
        )}
      </div>
      <div className="retention-banner-actions">
        <button
          type="button"
          className="btn btn-small"
          data-testid="retention-dont-ask"
          onClick={() => {
            settingsStore.update({ offerClaudeRetention: false })
            onDone()
          }}
        >
          Don&apos;t ask again
        </button>
        <button
          type="button"
          className="btn btn-small"
          data-testid="retention-not-now"
          onClick={() => {
            dismissClaudeRetention()
            onDone()
          }}
        >
          Not now
        </button>
        <button
          type="button"
          className="btn btn-small btn-primary"
          data-testid="retention-keep"
          disabled={saving}
          onClick={() => {
            void keepClaudeConversations().then((failed) => {
              if (failed === null) onDone()
            })
          }}
        >
          Keep for 10 years
        </button>
      </div>
    </div>
  )
}

export default RetentionBanner
