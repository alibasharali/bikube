import { describe, expect, it } from 'vitest'
import { parseEtcShells, shellToStart } from './shells'

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
