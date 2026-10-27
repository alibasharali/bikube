import { describe, expect, it } from 'vitest'
import {
  agentSetupWorkspaces,
  enterWorkspace,
  forgetCards,
  forgetView,
  NO_VIEWS,
  openedCard,
  rememberAgentSetup,
  rememberCard,
  selectWorkspace,
  showsAgentSetup,
  type ViewMemory
} from './view-memory'

const running = (): boolean => true

describe('view memory (#31 D19, AC17, AC18)', () => {
  it('opening a card remembers it for its workspace, replacing the one before', () => {
    let views = rememberCard(NO_VIEWS, 'alpha', 'api')
    expect(openedCard(views, 'alpha')).toBe('api')
    expect(openedCard(views, 'beta')).toBeNull()
    views = rememberCard(views, 'alpha', 'web')
    expect(openedCard(views, 'alpha')).toBe('web')
  })

  it('selecting another workspace keeps every workspace’s view', () => {
    const views = rememberCard(NO_VIEWS, 'alpha', 'api')
    const after = selectWorkspace(views, 'alpha', 'beta')
    expect(openedCard(after, 'alpha')).toBe('api')
    expect(openedCard(after, 'beta')).toBeNull()
  })

  it('selecting the active workspace forgets its card, and on its board changes nothing', () => {
    const views = rememberCard(rememberCard(NO_VIEWS, 'alpha', 'api'), 'beta', 'web')
    const after = selectWorkspace(views, 'alpha', 'alpha')
    expect(openedCard(after, 'alpha')).toBeNull()
    expect(openedCard(after, 'beta')).toBe('web')
    expect(selectWorkspace(after, 'alpha', 'alpha')).toEqual(after)
  })

  it('entering a workspace keeps its card only while it exists and runs', () => {
    const views: ViewMemory = rememberCard(NO_VIEWS, 'alpha', 'api')
    expect(openedCard(enterWorkspace(views, 'alpha', ['api', 'web'], running), 'alpha')).toBe('api')
    // Its shell stopped or failed meanwhile.
    expect(
      openedCard(
        enterWorkspace(views, 'alpha', ['api'], () => false),
        'alpha'
      )
    ).toBeNull()
    // Deleted meanwhile (also by sync).
    expect(openedCard(enterWorkspace(views, 'alpha', ['web'], running), 'alpha')).toBeNull()
    // Gone with its workspace.
    expect(openedCard(enterWorkspace(views, 'alpha', null, running), 'alpha')).toBeNull()
  })

  it('Back, or the open card stopping, forgets only that workspace’s card', () => {
    const views = rememberCard(rememberCard(NO_VIEWS, 'alpha', 'api'), 'beta', 'web')
    const after = forgetView(views, 'alpha')
    expect(openedCard(after, 'alpha')).toBeNull()
    expect(openedCard(after, 'beta')).toBe('web')
    expect(forgetView(after, 'alpha')).toBe(after)
  })

  it('a card going to its own window is forgotten wherever it is open (#53 D6)', () => {
    const views = rememberCard(rememberCard(NO_VIEWS, 'alpha', 'api'), 'beta', 'web')
    const after = forgetCards(views, ['api', 'other'])
    expect(openedCard(after, 'alpha')).toBeNull()
    expect(openedCard(after, 'beta')).toBe('web')
    expect(forgetCards(after, ['other'])).toBe(after)
  })

  it('Agent setup is a workspace’s view as a card is (#68 D3): replacing and replaced', () => {
    let views = rememberAgentSetup(rememberCard(NO_VIEWS, 'alpha', 'api'), 'beta')
    views = rememberAgentSetup(views, 'alpha')
    expect(showsAgentSetup(views, 'alpha')).toBe(true)
    // It is no card: nothing is open at full size.
    expect(openedCard(views, 'alpha')).toBeNull()
    expect(showsAgentSetup(views, 'gamma')).toBe(false)
    expect([...agentSetupWorkspaces(views)].sort()).toEqual(['alpha', 'beta'])
    // Opening a card replaces it.
    views = rememberCard(views, 'alpha', 'web')
    expect(showsAgentSetup(views, 'alpha')).toBe(false)
    expect(openedCard(views, 'alpha')).toBe('web')
    expect(agentSetupWorkspaces(views)).toEqual(['beta'])
  })

  it('Agent setup stays while its workspace exists, and goes with Back or the workspace’s row', () => {
    const views = rememberAgentSetup(NO_VIEWS, 'alpha')
    // Another workspace selected and back: it shows again.
    const away = selectWorkspace(views, 'alpha', 'beta')
    expect(
      showsAgentSetup(
        enterWorkspace(away, 'alpha', [], () => false),
        'alpha'
      )
    ).toBe(true)
    // Gone with its workspace.
    expect(showsAgentSetup(enterWorkspace(views, 'alpha', null, running), 'alpha')).toBe(false)
    // Its own sidebar row, or Back.
    expect(showsAgentSetup(selectWorkspace(views, 'alpha', 'alpha'), 'alpha')).toBe(false)
    expect(showsAgentSetup(forgetView(views, 'alpha'), 'alpha')).toBe(false)
    // A card going to its own window leaves it alone.
    expect(forgetCards(views, ['alpha'])).toBe(views)
  })
})
