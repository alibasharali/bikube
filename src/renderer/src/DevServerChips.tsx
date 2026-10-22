import { useDevServers } from './dev-servers'

/** The most port chips shown; the rest are one `+N` chip (#49 D8). */
export const MAX_DEV_SERVER_CHIPS = 3

/**
 * A card's (or shell's) dev server chips (#49 D7, D8): `localhost:<port>` for each listening port,
 * at most 3, then `+N` with the other URLs in its title. A chip is a button of its own, opening
 * its URL in the browser through main and never the card; `+N` opens nothing. Nothing without a
 * listening port.
 */
function DevServerChips({ cardId }: { cardId: string }): React.JSX.Element | null {
  const ports = useDevServers(cardId)
  if (ports.length === 0) return null
  const shown = ports.slice(0, MAX_DEV_SERVER_CHIPS)
  const rest = ports.slice(MAX_DEV_SERVER_CHIPS)
  return (
    <div className="dev-servers" data-testid="dev-servers">
      {shown.map(({ port, url }) => (
        <button
          key={port}
          type="button"
          className="dev-server-chip"
          data-testid="dev-server-chip"
          title={`Open ${url}`}
          onClick={() => window.bikube.link.open(url)}
        >
          {`localhost:${port}`}
        </button>
      ))}
      {rest.length > 0 && (
        <span
          className="dev-server-chip dev-server-more"
          data-testid="dev-server-more"
          title={rest.map((p) => p.url).join('\n')}
        >
          {`+${rest.length}`}
        </span>
      )}
    </div>
  )
}

export default DevServerChips
