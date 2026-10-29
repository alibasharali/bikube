import { ChevronRight } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { AGENT_TAB_MESSAGES, agentTabSubject, type AgentSummaryRead } from '../../core/agent-tab'
import type { Card, Workspace } from '../../core/workspace-store'
import {
  AGENT_TAB_GROUPS,
  toggleAgentGroup,
  useCollapsedAgentGroups,
  type AgentTabGroupId
} from './agent-tab-groups'
import { SMALL_ICON } from './icons'

/**
 * The side panel's Agent tab (#75): with a local Claude Code card in front, its current session's
 * conversation, asked of main by folder and session id (D3, D4); else D2's message. The board in
 * front is `card` undefined.
 */
function AgentTab({
  workspace,
  card
}: {
  workspace: Workspace | undefined
  card: Card | undefined
}): React.JSX.Element {
  const subject = agentTabSubject(workspace, card)
  const folder = subject.kind === 'conversation' ? subject.folder : null
  const sessionId = subject.kind === 'conversation' ? subject.sessionId : null
  const read = useAgentSummary(folder, sessionId)

  let body: React.ReactNode
  if (subject.kind === 'message') body = <Message text={subject.text} />
  else if (read === undefined) body = null
  else if (read.state === 'none') body = <Message text={AGENT_TAB_MESSAGES.noConversation} />
  else if (read.state === 'error') {
    body = (
      <p className="agent-tab-error" data-testid="agent-tab-error" role="alert">
        Couldn&apos;t read the conversation: {read.reason}
      </p>
    )
  } else body = <AgentGroups />

  return (
    <div className="agent-tab" data-testid="agent-tab">
      {body}
    </div>
  )
}

function Message({ text }: { text: string }): React.JSX.Element {
  return (
    <p className="agent-tab-message" data-testid="agent-tab-message">
      {text}
    </p>
  )
}

/** Main's answer for this folder and session; undefined while asking or with nothing to ask. */
function useAgentSummary(
  folder: string | null,
  sessionId: string | null
): AgentSummaryRead | undefined {
  const [answer, setAnswer] = useState<{ key: string; read: AgentSummaryRead }>()
  const key = folder !== null && sessionId !== null ? `${folder}\0${sessionId}` : null
  useEffect(() => {
    if (folder === null || sessionId === null || key === null) return
    let current = true
    void window.bikube.agentTab
      .summary(folder, sessionId)
      .catch((): AgentSummaryRead => ({ state: 'error', reason: 'request failed' }))
      .then((read) => {
        if (current) setAnswer({ key, read })
      })
    return () => {
      current = false
    }
  }, [folder, sessionId, key])
  return answer && answer.key === key ? answer.read : undefined
}

/** The three groups under the header (D6), collapsed ones kept for the run of the app. */
function AgentGroups(): React.JSX.Element {
  const collapsed = useCollapsedAgentGroups()
  return (
    <div className="agent-tab-groups">
      {AGENT_TAB_GROUPS.map((group) => (
        <AgentGroup
          key={group.id}
          id={group.id}
          name={group.name}
          count={0}
          open={!collapsed.has(group.id)}
        >
          {null}
        </AgentGroup>
      ))}
    </div>
  )
}

/** A group's heading button (chevron, name, count of rows shown) and its rows (D6). */
export function AgentGroup({
  id,
  name,
  count,
  open,
  children
}: {
  id: AgentTabGroupId
  name: string
  count: number
  open: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const rowsId = useId()
  return (
    <section className="agent-tab-group" data-testid="agent-tab-group" data-group={id}>
      <h3 className="agent-tab-group-heading">
        <button
          type="button"
          className="agent-setup-group-toggle"
          data-testid="agent-tab-group-toggle"
          aria-expanded={open}
          aria-controls={rowsId}
          onClick={() => toggleAgentGroup(id)}
        >
          <ChevronRight {...SMALL_ICON} className="agent-setup-expand-icon" />
          <span className="agent-setup-group-title" data-testid="agent-tab-group-name">
            {name}
          </span>{' '}
          <span className="agent-setup-group-count" data-testid="agent-tab-group-count">
            {count}
          </span>
        </button>
      </h3>
      <div id={rowsId} hidden={!open}>
        {children}
      </div>
    </section>
  )
}

export default AgentTab
