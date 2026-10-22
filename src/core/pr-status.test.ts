import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ciState, ghEnv, ghPlan, parsePullRequest, readPullRequest } from './pr-status'

const run = (status: string, conclusion: string | null): Record<string, unknown> => ({
  __typename: 'CheckRun',
  name: 'build',
  status,
  conclusion
})
const context = (state: string): Record<string, unknown> => ({
  __typename: 'StatusContext',
  context: 'ci/legacy',
  state
})

describe('ciState (#38 D8, AC10)', () => {
  it('is failing for a failed, cancelled or timed-out run, or a failed or errored context', () => {
    for (const conclusion of [
      'FAILURE',
      'CANCELLED',
      'TIMED_OUT',
      'ACTION_REQUIRED',
      'STARTUP_FAILURE'
    ]) {
      expect(ciState([run('COMPLETED', 'SUCCESS'), run('COMPLETED', conclusion)])).toBe('failing')
    }
    expect(ciState([context('ERROR')])).toBe('failing')
    expect(ciState([context('FAILURE'), context('SUCCESS')])).toBe('failing')
    // A failure wins over a run still going.
    expect(ciState([run('IN_PROGRESS', null), run('COMPLETED', 'CANCELLED')])).toBe('failing')
  })

  it('is pending for a run not completed or a pending or expected context', () => {
    expect(ciState([run('IN_PROGRESS', null)])).toBe('pending')
    expect(ciState([run('QUEUED', null), run('COMPLETED', 'SUCCESS')])).toBe('pending')
    expect(ciState([context('PENDING')])).toBe('pending')
    expect(ciState([context('EXPECTED')])).toBe('pending')
  })

  it('is passing when every check succeeded, was neutral or skipped', () => {
    expect(ciState([run('COMPLETED', 'SUCCESS'), run('COMPLETED', 'SKIPPED')])).toBe('passing')
    expect(ciState([run('COMPLETED', 'NEUTRAL'), context('SUCCESS')])).toBe('passing')
  })

  it('is none for an empty or missing rollup', () => {
    expect(ciState([])).toBeNull()
    expect(ciState(null)).toBeNull()
    expect(ciState(undefined)).toBeNull()
  })
})

const VIEW = ['pr', 'view', '--json', 'number,state,url,statusCheckRollup', '--']

describe('ghPlan (#38 D7, AC10)', () => {
  it('runs gh through a POSIX login shell, the branch a positional argument', () => {
    expect(ghPlan('/bin/zsh', '$(touch x); feat/a b')).toEqual({
      command: '/bin/zsh',
      args: [
        '-l',
        '-c',
        'command -v "$1" >/dev/null 2>&1 || exit 127; exec "$@"',
        'bikube',
        'gh',
        ...VIEW,
        '$(touch x); feat/a b'
      ]
    })
  })

  it("uses fish's $argv under fish, and /bin/sh for a shell with neither syntax", () => {
    expect(ghPlan('/usr/bin/fish', 'card-1')).toEqual({
      command: '/usr/bin/fish',
      args: ['-l', '-c', 'command -q $argv[1]; or exit 127; exec $argv', 'gh', ...VIEW, 'card-1']
    })
    expect(ghPlan('/usr/local/bin/nu', 'card-1').command).toBe('/bin/sh')
  })

  it("adds gh's no-prompt, no-update-notice and no-colour variables to main's environment", () => {
    expect(ghEnv({ PATH: '/usr/bin', HOME: '/home/me', GH_PROMPT_DISABLED: undefined })).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/me',
      GH_PROMPT_DISABLED: '1',
      GH_NO_UPDATE_NOTIFIER: '1',
      NO_COLOR: '1'
    })
  })
})

const pr = (fields: Record<string, unknown> = {}): string =>
  JSON.stringify({
    number: 12,
    state: 'OPEN',
    url: 'https://github.com/acme/widget/pull/12',
    statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }],
    ...fields
  })

describe('parsePullRequest (#38 D7, D8)', () => {
  it("reads gh's number, state, url and CI", () => {
    expect(parsePullRequest(pr())).toEqual({
      number: 12,
      state: 'open',
      url: 'https://github.com/acme/widget/pull/12',
      ci: 'failing'
    })
    expect(parsePullRequest(pr({ state: 'MERGED' }))).toMatchObject({ state: 'merged', ci: null })
    expect(parsePullRequest(pr({ state: 'CLOSED' }))).toMatchObject({ state: 'closed', ci: null })
    expect(parsePullRequest(pr({ statusCheckRollup: [] }))).toMatchObject({ ci: null })
  })

  it("reads gh's one-line JSON after anything a login profile printed first", () => {
    expect(parsePullRequest(`Welcome back\n{not json\n\n${pr()}\n\n`)).toMatchObject({
      number: 12,
      state: 'open'
    })
    expect(parsePullRequest('Welcome back\n')).toBeNull()
  })

  it('reads anything else as no pull request', () => {
    for (const text of [
      '',
      'not json',
      '[]',
      pr({ number: '12' }),
      pr({ number: 0 }),
      pr({ state: 'DRAFT' }),
      pr({ url: 'http://github.com/acme/widget/pull/12' }),
      pr({ url: 'https://github.com.evil.com/acme/widget/pull/12' }),
      pr({ url: 'https://github.com/acme/widget/pull/13' }),
      pr({ url: 'https://github.com/acme/widget/pull/12/../../evil' }),
      pr({ url: 'javascript:alert(1)' })
    ]) {
      expect(parsePullRequest(text)).toBeNull()
    }
  })
})

describe('readPullRequest (#38 D7)', () => {
  let dir: string
  let bin: string
  let env: Record<string, string>

  /** A fake `gh` in `bin`, which only the login shell's profile puts on PATH. */
  const fakeGh = (body: string): void => {
    writeFileSync(join(bin, 'gh'), `#!/bin/sh\n${body}\n`)
    chmodSync(join(bin, 'gh'), 0o755)
  }
  const read = (branch = 'card-1', timeoutMs?: number): ReturnType<typeof readPullRequest> =>
    readPullRequest(dir, branch, {
      spawn,
      shell: '/bin/sh',
      env,
      ...(timeoutMs !== undefined && { timeoutMs })
    })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bikube-gh-'))
    bin = join(dir, 'bin')
    mkdirSync(bin)
    const home = join(dir, 'home')
    mkdirSync(home)
    writeFileSync(join(home, '.profile'), `PATH='${bin}':/usr/bin:/bin; export PATH\n`)
    env = { HOME: home, PATH: '/usr/bin:/bin' }
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("gives the PR gh prints for the branch, run in the folder with gh's variables", async () => {
    fakeGh(
      `printf '%s\\n' "$PWD" "$GH_PROMPT_DISABLED$GH_NO_UPDATE_NOTIFIER$NO_COLOR" "$@" > '${join(dir, 'log')}'\n` +
        `cat <<'EOF'\n${pr()}\nEOF`
    )
    expect(await read('feat/a b')).toMatchObject({ number: 12, state: 'open', ci: 'failing' })
    expect(readFileSync(join(dir, 'log'), 'utf8').trimEnd().split('\n')).toEqual([
      dir,
      '111',
      ...VIEW,
      'feat/a b'
    ])
  })

  it('reads the PR when the login profile prints a line first', async () => {
    const home = env.HOME as string
    writeFileSync(
      join(home, '.profile'),
      `echo Welcome back\nPATH='${bin}':/usr/bin:/bin; export PATH\n`
    )
    fakeGh(`cat <<'EOF'\n${pr()}\nEOF`)
    expect(await read()).toMatchObject({ number: 12, state: 'open', ci: 'failing' })
  })

  it('reads a missing gh, a failing gh, bad output and a timeout as no PR', async () => {
    expect(await read()).toBeNull()
    fakeGh(`echo 'no pull requests found for branch "card-1"' >&2; exit 1`)
    expect(await read()).toBeNull()
    fakeGh(`echo '{"number":'`)
    expect(await read()).toBeNull()
    fakeGh(`sleep 5; cat <<'EOF'\n${pr()}\nEOF`)
    const started = Date.now()
    expect(await read('card-1', 300)).toBeNull()
    expect(Date.now() - started).toBeLessThan(3000)
  })
})
