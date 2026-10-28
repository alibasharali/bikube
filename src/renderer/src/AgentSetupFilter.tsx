import { Check, ChevronDown } from 'lucide-react'
import {
  ALL_SOURCES,
  filterLabel,
  sameFilter,
  type SourceChips,
  type SourceFilter
} from '../../core/agent-setup-rows'
import type { AgentSetupSnapshot } from '../../core/agent-setup-snapshot'
import { MENU_ICON, SMALL_ICON } from './icons'
import MenuButton from './MenuButton'

/**
 * The source filter's chip row at the top of a filterable section (#71 D3–D5): `All`, the sources
 * with rows in the section, then the Plugin chip with its menu. Each chip is a toggle button
 * showing its rows matching the search; clicking the active one other than `All` sets `All`.
 */
function SourceFilterChips({
  chips,
  filter,
  snapshot,
  onFilter
}: {
  chips: SourceChips
  filter: SourceFilter
  snapshot: Pick<AgentSetupSnapshot, 'plugins'>
  onFilter: (filter: SourceFilter) => void
}): React.JSX.Element {
  const toggle = (chip: SourceFilter): void =>
    onFilter(sameFilter(chip, filter) ? ALL_SOURCES : chip)
  const plugin = chips.plugin
  const onePlugin = filter.kind === 'plugin' ? filter : null
  const pluginPressed = filter.kind === 'plugins' || onePlugin !== null
  // The Plugin chip reads the plugin picked, with that plugin's count (#71 D4).
  const pluginText = onePlugin ? filterLabel(snapshot, onePlugin) : 'Plugin'
  const pluginCount = onePlugin
    ? (plugin?.plugins.find((p) => p.key === onePlugin.key)?.count ?? 0)
    : (plugin?.count ?? 0)
  return (
    <div
      className="agent-setup-filter"
      role="group"
      aria-label="Filter by source"
      data-testid="agent-setup-filter"
    >
      <button
        type="button"
        className="agent-setup-filter-chip"
        aria-pressed={filter.kind === 'all'}
        data-testid="agent-setup-filter-all"
        onClick={() => onFilter(ALL_SOURCES)}
      >
        All <ChipCount count={chips.all} />
      </button>
      {chips.sources.map((chip) => (
        <button
          key={chip.kind}
          type="button"
          className="agent-setup-filter-chip"
          aria-pressed={filter.kind === chip.kind}
          data-testid={`agent-setup-filter-${chip.kind}`}
          onClick={() => toggle({ kind: chip.kind })}
        >
          {chip.label} <ChipCount count={chip.count} />
        </button>
      ))}
      {plugin && (
        <MenuButton
          label={`${pluginText} ${pluginCount}`}
          menuLabel="Filter by plugin"
          testId="agent-setup-filter-plugin"
          className="agent-setup-filter-menu"
          buttonClassName="agent-setup-filter-chip"
          pressed={pluginPressed}
          icon={
            <>
              {pluginText} <ChipCount count={pluginCount} />
              <ChevronDown {...SMALL_ICON} className="agent-setup-filter-chevron" />
            </>
          }
        >
          {(run) => (
            <>
              <PluginItem
                text="All plugins"
                count={plugin.count}
                checked={filter.kind === 'plugins'}
                onClick={run(() => onFilter({ kind: 'plugins' }))}
              />
              {plugin.plugins.map((item) => (
                <PluginItem
                  key={item.key}
                  text={item.name}
                  count={item.count}
                  pluginKey={item.key}
                  checked={onePlugin?.key === item.key}
                  onClick={run(() => onFilter({ kind: 'plugin', key: item.key }))}
                />
              ))}
            </>
          )}
        </MenuButton>
      )}
    </div>
  )
}

function ChipCount({ count }: { count: number }): React.JSX.Element {
  return (
    <span className="agent-setup-filter-count" data-testid="agent-setup-filter-count">
      {count}
    </span>
  )
}

/** One row of the Plugin chip's menu: `All plugins` or a plugin, with its count. */
function PluginItem({
  text,
  count,
  checked,
  pluginKey,
  onClick
}: {
  text: string
  count: number
  checked: boolean
  pluginKey?: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      className="menu-item menu-item-checkable"
      data-testid="agent-setup-filter-plugin-item"
      data-key={pluginKey}
      onClick={onClick}
    >
      {checked ? (
        <Check {...MENU_ICON} />
      ) : (
        <span className="branch-menu-spacer" aria-hidden="true" />
      )}
      <span className="agent-setup-filter-item-name">{text}</span>{' '}
      <span className="agent-setup-filter-item-count">{count}</span>
    </button>
  )
}

export default SourceFilterChips
