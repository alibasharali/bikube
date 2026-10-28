import { sandboxView } from '../../core/agent-setup-sandbox'
import { FileActions, SourceChip, type SectionViewProps } from './AgentSetupSections'

/** A list's test id: `agent-setup-sandbox-<its dotted path, dots as dashes>`. */
const listTestId = (key: string): string => `agent-setup-sandbox-${key.replaceAll('.', '-')}`

/**
 * Sandbox (#72), read-only: the effective switches and values as facts (D4), then every list's
 * entries of every settings file with where each is set (D5), the lists filtered by the search
 * (D6), and D8's line when no file sets `sandbox`.
 */
export function SandboxSection({ snapshot, query }: SectionViewProps): React.JSX.Element {
  const view = sandboxView(snapshot, query)
  return (
    <div className="agent-setup-groups" data-testid="agent-setup-sandbox">
      {!view.set && (
        <p className="agent-setup-empty" data-testid="agent-setup-sandbox-empty">
          No sandbox settings. Add a &quot;sandbox&quot; object to .claude/settings.json or
          ~/.claude/settings.json.
        </p>
      )}
      <dl className="agent-setup-facts">
        {view.facts.map((fact) => (
          <div
            key={fact.key}
            className="agent-setup-fact"
            data-testid="agent-setup-sandbox-fact"
            data-key={fact.key}
          >
            <dt data-testid="agent-setup-sandbox-fact-label">{fact.label}</dt>
            <dd>
              {fact.source ? (
                <>
                  <span
                    className="agent-setup-fact-value"
                    data-testid="agent-setup-sandbox-fact-value"
                  >
                    {fact.text}
                  </span>
                  <SourceChip source={fact.source} />
                  {fact.file !== undefined && <FileActions file={fact.file} />}
                </>
              ) : (
                <span data-testid="agent-setup-sandbox-fact-value">{fact.text}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {view.lists.map((list) => {
        const testId = listTestId(list.key)
        return (
          <section key={list.key} className="agent-setup-group">
            <h4 className="agent-setup-subheading">{list.label}</h4>
            {list.entries.length === 0 ? (
              <p className="agent-setup-empty" data-testid={testId}>
                None
              </p>
            ) : (
              <ul className="agent-setup-rows" data-testid={testId}>
                {list.entries.map((entry, i) => (
                  <li
                    key={`${entry.file}\n${entry.entry}\n${i}`}
                    className="agent-setup-row"
                    data-testid="agent-setup-row"
                  >
                    <div className="agent-setup-row-main">
                      <code
                        className="agent-setup-row-rule"
                        title={entry.entry}
                        data-testid="agent-setup-sandbox-entry"
                      >
                        {entry.entry}
                      </code>
                      <FileActions file={entry.file} />
                      <span className="agent-setup-row-chips">
                        <SourceChip source={entry.source} />
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
