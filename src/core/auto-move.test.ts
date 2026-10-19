import { describe, expect, it } from 'vitest'
import { autoMoveTarget, type AutoMoveEvent } from './auto-move'
import type { AutoMove } from './auto-move'
import type { Card, Workspace } from './workspace-store'

const card = (id: string, columnId: string): Card => ({
  id,
  columnId,
  title: id,
  directory: '/tmp/drovr-alpha',
  startup: { kind: 'shell' },
  agentSessionId: 'x',
  claudeStarted: false,
  startedAgents: []
})

const workspace = (autoMove: AutoMove | undefined, cards: Card[]): Workspace => ({
  id: 'alpha',
  name: 'alpha',
  directory: '/tmp/drovr-alpha',
  columns: [
    { id: 'backlog', name: 'Backlog' },
    { id: 'running', name: 'Running' },
    { id: 'needs', name: 'Needs me' },
    { id: 'done', name: 'Done' }
  ],
  cards,
  nextCardNumber: 1,
  defaultStartup: { kind: 'claude' },
  shells: [],
  worktreeSetup: '',
  ...(autoMove ? { autoMove } : {})
})

const EVERY_RULE: AutoMove = { working: 'running', waiting: 'needs', stopped: 'done' }

const working: AutoMoveEvent = { kind: 'activity', activity: 'working' }
const waiting: AutoMoveEvent = { kind: 'activity', activity: 'waiting' }
const question: AutoMoveEvent = { kind: 'activity', activity: 'question' }
const cleared: AutoMoveEvent = { kind: 'activity', activity: null }
const stopped: AutoMoveEvent = { kind: 'ended', state: { kind: 'stopped' } }
const failed: AutoMoveEvent = { kind: 'ended', state: { kind: 'failed', reason: 'ENOENT' } }
const sshFailed: AutoMoveEvent = { kind: 'ended', state: { kind: 'stopped', sshFailed: 'boom' } }

/** Where the card `c` (in `columnId`, below two others there) goes on `event`. */
function target(
  autoMove: AutoMove | undefined,
  columnId: string,
  event: AutoMoveEvent
): ReturnType<typeof autoMoveTarget> {
  const c = card('c', columnId)
  const ws = workspace(autoMove, [card('a', 'needs'), card('b', 'done'), card('d', 'running'), c])
  return autoMoveTarget(ws, c, event)
}

describe('autoMoveTarget (#42 D3, D4, D9)', () => {
  it('moves to the bottom of the rule’s column on each trigger when its rule is on', () => {
    expect(target(EVERY_RULE, 'backlog', working)).toEqual({ columnId: 'running', index: 1 })
    expect(target(EVERY_RULE, 'backlog', waiting)).toEqual({ columnId: 'needs', index: 1 })
    expect(target(EVERY_RULE, 'backlog', question)).toEqual({ columnId: 'needs', index: 1 })
    expect(target(EVERY_RULE, 'backlog', stopped)).toEqual({ columnId: 'done', index: 1 })
  })

  it('moves nothing when the matching rule is off', () => {
    for (const event of [working, waiting, question, stopped]) {
      expect(target(undefined, 'backlog', event)).toBeNull()
    }
    expect(target({ waiting: 'needs' }, 'backlog', working)).toBeNull()
    expect(target({ waiting: 'needs' }, 'backlog', stopped)).toBeNull()
    expect(target({ working: 'running', stopped: 'done' }, 'backlog', waiting)).toBeNull()
    expect(target({ working: 'running', stopped: 'done' }, 'backlog', question)).toBeNull()
  })

  it('moves nothing when the card is already in the rule’s column', () => {
    expect(target(EVERY_RULE, 'running', working)).toBeNull()
    expect(target(EVERY_RULE, 'needs', waiting)).toBeNull()
    expect(target(EVERY_RULE, 'needs', question)).toBeNull()
    expect(target(EVERY_RULE, 'done', stopped)).toBeNull()
  })

  it('moves nothing when the activity is cleared', () => {
    expect(target(EVERY_RULE, 'backlog', cleared)).toBeNull()
  })

  it('moves nothing on a failed start or an SSH failed stop (AC6)', () => {
    expect(target(EVERY_RULE, 'backlog', failed)).toBeNull()
    expect(target(EVERY_RULE, 'backlog', sshFailed)).toBeNull()
    expect(target({ stopped: 'done' }, 'running', failed)).toBeNull()
    expect(target({ stopped: 'done' }, 'running', sshFailed)).toBeNull()
  })

  it('moves nothing when the rule names a column the workspace doesn’t have', () => {
    expect(target({ waiting: 'gone' }, 'backlog', waiting)).toBeNull()
  })
})
