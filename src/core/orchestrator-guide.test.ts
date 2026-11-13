import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ORCHESTRATOR_GUIDE,
  ORCHESTRATOR_INSTRUCTION_FILE,
  orchestratorGuide
} from './orchestrator-guide'

describe("the orchestrator's guide (#81 D12, D13)", () => {
  it('ships in the bin directory beside board, equal to its constant', () => {
    const bin = join(__dirname, '..', '..', 'resources', 'bin')
    expect(readFileSync(join(bin, ORCHESTRATOR_INSTRUCTION_FILE), 'utf8')).toBe(ORCHESTRATOR_GUIDE)
  })

  it('names the workspace and its folder, each where the template marks it', () => {
    const guide = orchestratorGuide('Proj', '/x/proj', '')
    expect(guide).toContain('Orchestrator of the Bikube workspace "Proj"')
    expect(guide).toContain('/x/proj')
    expect(guide).not.toMatch(/\{\{|\}\}/)
    // A name or folder holding `$&` or `{{FOLDER}}` is put in as written.
    expect(orchestratorGuide('A $& B', '/p/{{WORKSPACE}}', '')).toContain(
      'workspace "A $& B", whose folder is /p/{{WORKSPACE}}'
    )
  })

  it("quotes the workspace's name for the shell where a command names it, a ' included", () => {
    const guide = orchestratorGuide("Bob's app", '/x/proj', '')
    expect(guide).toContain('workspace "Bob\'s app"')
    expect(guide).toContain("board terminal --show --workspace 'Bob'\\''s app' 'npm run dev'")
    expect(orchestratorGuide('Proj', '/x', '')).toContain(
      "board terminal --show --workspace 'Proj' 'npm run dev'"
    )
    // A name holding a placeholder is put in as written there too.
    expect(orchestratorGuide('{{FOLDER}}', '/x', '')).toContain("--workspace '{{FOLDER}}'")
  })

  it("appends the user's instructions under their heading, and nothing when there are none (D13)", () => {
    const guide = orchestratorGuide('Proj', '/x/proj', 'Always use worktrees.')
    expect(guide).toBe(
      `${orchestratorGuide('Proj', '/x/proj', '')}\n## Your instructions\n\nAlways use worktrees.\n`
    )
    expect(orchestratorGuide('Proj', '/x/proj', '')).not.toContain('## Your instructions')
    expect(orchestratorGuide('Proj', '/x/proj', '').endsWith('\n')).toBe(true)
  })

  it('shows every board command it may run, each with an example (D12)', () => {
    for (const example of [
      'board workspaces',
      'board list',
      'board create ',
      'board rename ',
      'board move ',
      'board status . ',
      'board description ',
      'board describe ',
      'board guide',
      'board start ',
      'board open ',
      'board send ',
      'board wait ',
      'board reply ',
      'board terminal ',
      'board terminal --show ',
      'board palette list',
      'board palette run '
    ]) {
      expect(ORCHESTRATOR_GUIDE).toContain(example)
    }
  })

  it("explains the item's examples (D12)", () => {
    expect(ORCHESTRATOR_GUIDE).toContain("board palette run 'Switch to workspace")
    expect(ORCHESTRATOR_GUIDE).toContain("board palette run 'Agent setup'")
    expect(ORCHESTRATOR_GUIDE).toContain('board create --worktree --description-file -')
    expect(ORCHESTRATOR_GUIDE).toMatch(
      /board create[^\n]*\n[^]*board start[^]*board wait[^]*board reply/
    )
  })

  it('has no backslash, so it can be printed by any shell as it is', () => {
    expect(ORCHESTRATOR_GUIDE).not.toContain('\\')
  })
})
