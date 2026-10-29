import { describe, expect, it } from 'vitest'
import { ghosttyBinds, ghosttyTrigger, withGhosttyShortcuts } from './ghostty-keybinds'
import { defaultKeymap, matchesShortcut, type KeyEventLike } from './keymap'

describe('ghosttyTrigger', () => {
  it.each([
    ['cmd+d', 'Cmd+D'],
    ['super+shift+d', 'Shift+Cmd+D'],
    ['cmd+.', 'Cmd+.'],
    ['cmd+shift+.', 'Shift+Cmd+>'],
    ['cmd+ctrl+equal', 'Ctrl+Cmd+='],
    ['super+ctrl+=', 'Ctrl+Cmd+='],
    ['cmd+alt+right', 'Alt+Cmd+ArrowRight'],
    ['super+ctrl+arrow_up', 'Ctrl+Cmd+ArrowUp'],
    ['performable:cmd+c', 'Cmd+C'],
    ['ctrl+shift+page_up', 'Ctrl+Shift+PageUp'],
    ['opt+physical:key_a', 'Alt+A']
  ])('%s → %s', (trigger, shortcut) => {
    expect(ghosttyTrigger(trigger)).toBe(shortcut)
  })

  it.each(['shift+enter', 'a', 'global:cmd+d', 'ctrl+a>n', 'cmd+bogus_key', 'hyper+d'])(
    'skips %s',
    (trigger) => {
      expect(ghosttyTrigger(trigger)).toBeNull()
    }
  )
})

describe('ghosttyBinds', () => {
  it("lays the user's keybinds over Ghostty's macOS defaults for the actions Bikube has", () => {
    const binds = ghosttyBinds(
      [
        'shift+enter=text:\\x1b\\r',
        'cmd+r=prompt_surface_title',
        'cmd+.=goto_split:next',
        'cmd+shift+.=goto_split:previous',
        'cmd+ctrl+equal=equalize_splits',
        'cmd+alt+right=resize_split:right,10',
        'performable:cmd+c=copy_to_clipboard'
      ],
      'darwin'
    )
    expect(binds).toMatchObject({
      renameCard: 'Cmd+R',
      focusNextPane: 'Cmd+.',
      focusPreviousPane: 'Shift+Cmd+>',
      equalizePanes: 'Ctrl+Cmd+=',
      resizePaneRight: 'Alt+Cmd+ArrowRight',
      // Ghostty's defaults the config doesn't change.
      splitRight: 'Cmd+D',
      zoomPane: 'Shift+Cmd+Enter',
      resizePaneLeft: 'Ctrl+Cmd+ArrowLeft',
      // Ghostty binds it twice; the later bind wins.
      previousPrompt: 'Cmd+ArrowUp'
    })
  })

  it('drops an unbound trigger and everything before clear, defaults included', () => {
    expect(ghosttyBinds(['super+d=unbind'], 'darwin').splitRight).toBeUndefined()
    expect(ghosttyBinds(['clear', 'cmd+e=new_split:right'], 'darwin')).toEqual({
      splitRight: 'Cmd+E'
    })
  })

  it("uses Ghostty's Linux defaults elsewhere", () => {
    expect(ghosttyBinds([], 'linux')).toMatchObject({
      splitRight: 'Ctrl+Shift+O',
      focusNextPane: 'Ctrl+Cmd+]',
      resizePaneUp: 'Ctrl+Shift+Cmd+ArrowUp'
    })
  })
})

describe('withGhosttyShortcuts', () => {
  it('sets the actions Ghostty binds, skipping a fixed shortcut and one another action keeps', () => {
    const keymap = defaultKeymap('darwin')
    const result = withGhosttyShortcuts(
      keymap,
      { renameCard: 'Cmd+R', focusNextPane: 'Cmd+Q', splitDown: 'Cmd+K' },
      'darwin'
    )
    expect(result.keymap.renameCard).toBe('Cmd+R')
    expect(result.keymap.focusNextPane).toBe(keymap.focusNextPane)
    // Cmd+K is the palette's, which Ghostty doesn't move.
    expect(result.keymap.splitDown).toBe(keymap.splitDown)
    expect(result.fromGhostty).toEqual(['renameCard'])
    expect(result.skipped).toEqual([
      'Cmd+Q (Next pane): Quit',
      'Cmd+K (Split down): Command palette'
    ])
  })

  it('gives an action Ghostty moves its key to another action Ghostty binds', () => {
    const keymap = defaultKeymap('darwin')
    const result = withGhosttyShortcuts(
      keymap,
      { palette: 'Shift+Cmd+P', splitDown: 'Cmd+K' },
      'darwin'
    )
    expect(result.keymap).toMatchObject({ palette: 'Shift+Cmd+P', splitDown: 'Cmd+K' })
    expect(result.skipped).toEqual([])
  })
})

describe('matchesShortcut with Shift and punctuation', () => {
  it('matches the shifted character or the key itself', () => {
    const press = (key: string): KeyEventLike => ({
      type: 'keydown',
      key,
      code: 'Period',
      shiftKey: true,
      metaKey: true,
      ctrlKey: false,
      altKey: false
    })
    expect(matchesShortcut(press('>'), 'Shift+Cmd+>')).toBe(true)
    expect(matchesShortcut(press('.'), 'Shift+Cmd+>')).toBe(true)
    expect(matchesShortcut(press('.'), 'Cmd+.')).toBe(false)
  })
})
