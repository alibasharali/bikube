import { useId } from 'react'
import type { AgentGroup } from '../../core/sidebar-sections'
import type { Workspace } from '../../core/workspace-store'
import { TerminalRow } from './WorkspaceTerminals'

interface SidebarAgentsProps {
  /** The groups in D4's order, an empty one left out. */
  groups: readonly AgentGroup[]
  workspaces: readonly Workspace[]
  activeId: string | null
  /** The card or shell open at full size in the active workspace, or null. */
  openId: string | null
  onOpen: (workspaceId: string, cardId: string) => void
  /** While the terminal modifier is held, the active workspace's rows' numbers; else null. */
  numbers: ReadonlyMap<string, number> | null
  /** When each row's group last changed, by card id (D6). */
  stamps: ReadonlyMap<string, number>
}

/**
 * The Split sidebar's Agents section (#79 D3–D5): every workspace's agent rows under Needs you,
 * Working and Idle, each naming its workspace and how long it has been in its group, scrolling on its own below the workspaces.
 */
function SidebarAgents({
  groups,
  workspaces,
  activeId,
  openId,
  onOpen,
  numbers,
  stamps
}: SidebarAgentsProps): React.JSX.Element {
  const id = useId()
  const names = new Map(workspaces.map((w) => [w.id, w.name]))
  return (
    <section className="sidebar-agents" data-testid="sidebar-agents" aria-labelledby={id}>
      <h2 className="sidebar-section-title" id={id}>
        Agents
      </h2>
      {groups.length === 0 ? (
        <p className="sidebar-agents-empty" data-testid="sidebar-agents-empty">
          No agents running.
        </p>
      ) : (
        groups.map((group) => (
          <div
            key={group.id}
            className="agent-group"
            data-testid="agent-group"
            data-group={group.id}
          >
            <h3 className="agent-group-heading" data-testid="agent-group-heading">
              {group.label} <span className="agent-group-count">{group.rows.length}</span>
            </h3>
            <ul className="workspace-terminals sidebar-agent-rows">
              {group.rows.map((row) => (
                <TerminalRow
                  key={row.cardId}
                  row={row}
                  current={row.workspaceId === activeId && row.cardId === openId}
                  onOpen={onOpen}
                  number={numbers?.get(row.cardId) ?? null}
                  workspaceName={names.get(row.workspaceId) ?? ''}
                  since={stamps.get(row.cardId)}
                />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  )
}

export default SidebarAgents
