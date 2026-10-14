/**
 * Main's handling of a renderer's `terminal:ack` (#16 D3): it counts only for a session the
 * sending window owns and a positive safe integer; anything else leaves flow state unchanged.
 */
import type { FlowControl } from './flow-control'
import { isAckChars } from './ipc-guards'

export function acknowledgeRequest(
  isOwner: (id: unknown) => id is string,
  id: unknown,
  chars: unknown,
  flow: Pick<FlowControl, 'acknowledged'>
): void {
  if (isOwner(id) && isAckChars(chars)) flow.acknowledged(id, chars)
}
