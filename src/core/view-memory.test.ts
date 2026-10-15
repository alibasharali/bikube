import { describe, expect, it } from 'vitest'
import {
  enterWorkspace,
  forgetView,
  NO_VIEWS,
  openedCard,
  rememberCard,
  selectWorkspace,
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
})
