import { describe, expect, it } from 'vitest'
import { parseEtcShells, shellCandidates, shellToStart } from './shells'

describe('parseEtcShells', () => {
  it('lists the paths in order, without comments, blanks or duplicates', () => {
    expect(
      parseEtcShells('# List of acceptable shells\n/bin/bash\n\n/bin/zsh # default\n/bin/bash\n')
    ).toEqual(['/bin/bash', '/bin/zsh'])
  })
})

describe('shellToStart', () => {
  it("is the login shell for '', else the setting's path", () => {
    expect(shellToStart('', '/bin/zsh')).toBe('/bin/zsh')
    expect(shellToStart('/opt/homebrew/bin/fish', '/bin/zsh')).toBe('/opt/homebrew/bin/fish')
  })
})

describe('shellCandidates', () => {
  it("adds known shells in the usual install directories after /etc/shells' own", () => {
    const shells = shellCandidates('/bin/bash\n/bin/zsh\n', '/Users/me')
    expect(shells.slice(0, 2)).toEqual(['/bin/bash', '/bin/zsh'])
    expect(shells).toContain('/opt/homebrew/bin/fish')
    expect(shells).toContain('/usr/local/bin/fish')
    expect(shells).toContain('/Users/me/.local/bin/nu')
    // Never twice, even when /etc/shells lists one of them.
    expect(shells.filter((s) => s === '/bin/zsh')).toHaveLength(1)
  })
})
