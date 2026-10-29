/**
 * Main's side of the Agent tab (#75 D3, D4): the request's checks and the session's transcript
 * under `<home>/.claude/projects`. fs is injected for Vitest; nothing outside that path is read.
 */
import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { isSessionId, type AgentSummaryRead } from './agent-tab'
import { encodeProjectFolder } from './claude-stats'
import { isDirectory, isPathArg } from './directories'

export interface TranscriptFs {
  stat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean }>
}

/** The session's transcript for a card in `folder` (D3). */
export const transcriptPath = (home: string, folder: string, sessionId: string): string =>
  join(home, '.claude', 'projects', encodeProjectFolder(folder), `${sessionId}.jsonl`)

const errorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined

/**
 * Answers the tab's request: a session id that isn't a UUID or a folder that isn't an absolute
 * existing directory is refused before anything is read; else whether the transcript exists.
 */
export async function readAgentSummary(
  request: { folder: unknown; sessionId: unknown },
  deps: { home: string; fs?: TranscriptFs }
): Promise<AgentSummaryRead> {
  const fs = deps.fs ?? { stat }
  if (!isSessionId(request.sessionId)) return { state: 'error', reason: 'invalid session id' }
  if (!isPathArg(request.folder) || !(await isDirectory(request.folder, fs))) {
    return { state: 'error', reason: 'not a folder' }
  }
  const path = transcriptPath(deps.home, resolve(request.folder), request.sessionId)
  try {
    return (await fs.stat(path)).isFile() ? { state: 'conversation' } : { state: 'none' }
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') return { state: 'none' }
    return { state: 'error', reason: code ?? 'unreadable' }
  }
}
