import { describe, expect, it, vi } from 'vitest'
import {
  clipboardShortcut,
  copySelection,
  pasteFromClipboard,
  type ClipboardBridge,
  type KeyLike,
  type PasteTarget
} from './clipboard'

const key = (over: Partial<KeyLike>): KeyLike => ({
  type: 'keydown',
  key: 'c',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...over
})

describe('clipboardShortcut', () => {
  it('uses Cmd+C and Cmd+V on macOS', () => {
    expect(clipboardShortcut(key({ metaKey: true }), 'darwin')).toBe('copy')
    expect(clipboardShortcut(key({ key: 'v', metaKey: true }), 'darwin')).toBe('paste')
  })

  it('leaves Ctrl+C alone on macOS and elsewhere (it is SIGINT)', () => {
    expect(clipboardShortcut(key({ ctrlKey: true }), 'darwin')).toBeNull()
    expect(clipboardShortcut(key({ ctrlKey: true }), 'linux')).toBeNull()
  })

  it('uses Ctrl+Shift+C and Ctrl+Shift+V on other platforms', () => {
    expect(clipboardShortcut(key({ ctrlKey: true, shiftKey: true, key: 'C' }), 'linux')).toBe(
      'copy'
    )
    expect(clipboardShortcut(key({ ctrlKey: true, shiftKey: true, key: 'V' }), 'win32')).toBe(
      'paste'
    )
  })

  it('ignores key releases and extra modifiers', () => {
    expect(clipboardShortcut(key({ type: 'keyup', metaKey: true }), 'darwin')).toBeNull()
    expect(clipboardShortcut(key({ metaKey: true, altKey: true }), 'darwin')).toBeNull()
    expect(clipboardShortcut(key({ metaKey: true, shiftKey: true }), 'darwin')).toBeNull()
  })
})

describe('copySelection', () => {
  it('writes the selection to the clipboard exactly', async () => {
    const write = vi.fn(() => Promise.resolve())
    const text = '  two  spaces\tand a tab\nsecond line  '
    const copied = await copySelection(
      { hasSelection: () => true, getSelection: () => text },
      { read: vi.fn(), write, hasImage: vi.fn() }
    )
    expect(copied).toBe(true)
    expect(write).toHaveBeenCalledWith(text)
  })

  it('does nothing without a selection', async () => {
    const write = vi.fn(() => Promise.resolve())
    const copied = await copySelection(
      { hasSelection: () => false, getSelection: () => '' },
      { read: vi.fn(), write, hasImage: vi.fn() }
    )
    expect(copied).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })
})

describe('pasteFromClipboard', () => {
  it('hands clipboard text with a newline to term.paste, which brackets it when enabled', async () => {
    const bridge: ClipboardBridge = {
      read: () => Promise.resolve('echo a\necho b'),
      write: vi.fn(),
      hasImage: () => Promise.resolve(true)
    }
    const paste = vi.fn()
    const target: PasteTarget = { paste }
    const input = vi.fn()
    await pasteFromClipboard(target, bridge, { accepts: () => true, input })
    expect(paste).toHaveBeenCalledWith('echo a\necho b')
    // Text wins over an image copied with it.
    expect(input).not.toHaveBeenCalled()
  })

  it('sends Ctrl+V for an image alone to a pane that takes it, and nothing elsewhere', async () => {
    const bridge: ClipboardBridge = {
      read: () => Promise.resolve(''),
      write: vi.fn(),
      hasImage: () => Promise.resolve(true)
    }
    const paste = vi.fn()
    const input = vi.fn()
    await pasteFromClipboard({ paste }, bridge, { accepts: () => true, input })
    expect(input).toHaveBeenCalledWith('\x16')
    expect(paste).not.toHaveBeenCalled()
    input.mockClear()
    await pasteFromClipboard({ paste }, bridge, { accepts: () => false, input })
    await pasteFromClipboard({ paste }, bridge)
    await pasteFromClipboard(
      { paste },
      { ...bridge, hasImage: () => Promise.resolve(false) },
      { accepts: () => true, input }
    )
    expect(input).not.toHaveBeenCalled()
    expect(paste).not.toHaveBeenCalled()
  })

  it('pastes nothing for an empty clipboard', async () => {
    const paste = vi.fn()
    await pasteFromClipboard(
      { paste },
      { read: () => Promise.resolve(''), write: vi.fn(), hasImage: () => Promise.resolve(false) }
    )
    expect(paste).not.toHaveBeenCalled()
  })
})
