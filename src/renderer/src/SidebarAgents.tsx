import { useId } from 'react'
import { statusLabel } from '../../core/activity'
import type { AgentGroup } from '../../core/sidebar-sections'
import type { Workspace } from '../../core/workspace-store'
import { ToolIcon } from './AgentLogo'
import { StatusMark, TerminalRow } from './WorkspaceTerminals'

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

/**
 * The collapsed Split sidebar's agents (#79 D7): after a divider below the badges, one icon button
 * per agent row in the groups' order, with no headings: its tool's logo (or its held number, D9)
 * with its status mark over the corner, named `<title> · <workspace> · <status>`.
 */
export function SidebarAgentIcons({
  groups,
  workspaces,
  activeId,
  openId,
  onOpen,
  numbers
}: Omit<SidebarAgentsProps, 'stamps'>): React.JSX.Element {
  const names = new Map(workspaces.map((w) => [w.id, w.name]))
  return (
    <ul className="sidebar-agent-icons" data-testid="sidebar-agent-icons" aria-label="Agents">
      {groups.flatMap((group) =>
        group.rows.map((row) => {
          const current = row.workspaceId === activeId && row.cardId === openId
          const needsYou = row.activity === 'waiting' || row.activity === 'question'
          const number = numbers?.get(row.cardId) ?? null
          const classes = ['agent-icon']
          if (current) classes.push('active')
          if (needsYou) classes.push('needs-you')
          const label = `${row.title} · ${names.get(row.workspaceId) ?? ''} · ${statusLabel(row.activity)}`
          return (
            <li key={row.cardId} data-kind={row.tool}>
              <button
                type="button"
                className={classes.join(' ')}
                data-testid="agent-icon"
                data-kind={row.kind}
                aria-current={current ? 'true' : undefined}
                aria-label={label}
                title={label}
                onClick={() => onOpen(row.workspaceId, row.cardId)}
              >
                {number !== null ? (
                  <span className="agent-icon-kind held-number" data-testid="terminal-number">
                    {number}
                  </span>
                ) : (
                  <span className="agent-icon-kind" data-testid="workspace-terminal-kind">
                    <ToolIcon tool={row.tool} size={16} />
                  </span>
                )}
                <StatusMark activity={row.activity} />
              </button>
            </li>
          )
        })
      )}
    </ul>
  )
}

export default SidebarAgents
