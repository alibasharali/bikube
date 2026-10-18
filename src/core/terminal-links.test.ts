import { describe, expect, it } from 'vitest'
import { openableUrl, opensLink } from './terminal-links'

describe('openableUrl', () => {
  it('opens http and https links', () => {
    expect(openableUrl('http://localhost:5173/')).toBe('http://localhost:5173/')
    expect(openableUrl('https://github.com/x/y?q=1#top')).toBe('https://github.com/x/y?q=1#top')
  })

  it('refuses every other scheme, text that is no URL, and anything too long', () => {
    for (const text of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'ssh://host',
      'vscode://file/x',
      'localhost:5173',
      '',
      `https://example.com/${'a'.repeat(9_000)}`,
      42,
      undefined
    ]) {
      expect(openableUrl(text)).toBeNull()
    }
  })
})

describe('opensLink', () => {
  it('takes Cmd+click on macOS and Ctrl+click elsewhere', () => {
    expect(opensLink({ metaKey: true, ctrlKey: false }, 'darwin')).toBe(true)
    expect(opensLink({ metaKey: false, ctrlKey: true }, 'darwin')).toBe(false)
    expect(opensLink({ metaKey: false, ctrlKey: true }, 'linux')).toBe(true)
    expect(opensLink({ metaKey: true, ctrlKey: false }, 'linux')).toBe(false)
  })

  it('leaves a plain click to selection', () => {
    expect(opensLink({ metaKey: false, ctrlKey: false }, 'darwin')).toBe(false)
    expect(opensLink({ metaKey: false, ctrlKey: false }, 'linux')).toBe(false)
  })
})
