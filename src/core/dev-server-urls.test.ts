import { describe, expect, it } from 'vitest'
import { MAX_CARRY_CHARS, urlScanner, type DevServerUrl } from './dev-server-urls'

/** Everything a fresh scanner finds in `chunks`, in order. */
function scan(...chunks: string[]): DevServerUrl[] {
  const next = urlScanner()
  return chunks.flatMap((chunk) => next(chunk))
}

describe('urlScanner (#49 D1, AC9)', () => {
  it("finds Vite's coloured port", () => {
    expect(scan('  Local:   http://localhost:\x1b[1m5173\x1b[22m/\r\n')).toEqual([
      { port: 5173, url: 'http://localhost:5173/' }
    ])
  })

  it('finds a URL split across chunks at any position, inside an escape sequence too', () => {
    const line = '  ➜  Local:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m\r\n'
    for (let at = 0; at <= line.length; at++) {
      expect(scan(line.slice(0, at), line.slice(at)), `split at ${at}`).toEqual([
        { port: 5173, url: 'http://localhost:5173/' }
      ])
    }
    expect(scan(...line)).toEqual([{ port: 5173, url: 'http://localhost:5173/' }])
  })

  it('reads only finished lines', () => {
    const next = urlScanner()
    expect(next('http://localhost:51')).toEqual([])
    expect(next('73/\n')).toEqual([{ port: 5173, url: 'http://localhost:5173/' }])
  })

  it('recognises 127.0.0.1, 0.0.0.0 and [::1], in any case, with https and a path', () => {
    expect(
      scan(
        'a http://127.0.0.1:8000/app?x=1#y b\n',
        'Listening on http://0.0.0.0:3000\n',
        'HTTPS://[::1]:4000/api\n',
        'see http://LocalHost:9000/\n'
      )
    ).toEqual([
      { port: 8000, url: 'http://127.0.0.1:8000/app?x=1#y' },
      { port: 3000, url: 'http://localhost:3000/' },
      { port: 4000, url: 'https://[::1]:4000/api' },
      { port: 9000, url: 'http://localhost:9000/' }
    ])
  })

  it('finds several URLs on one line', () => {
    expect(scan('http://localhost:1 and http://localhost:2/\n').map((u) => u.port)).toEqual([1, 2])
  })

  it('drops trailing punctuation', () => {
    for (const end of ['.', ',', ';', ':', ')', ']', "'", '"', '>', ').', '",']) {
      expect(scan(`(at http://localhost:5173/app${end}\n`), end).toEqual([
        { port: 5173, url: 'http://localhost:5173/app' }
      ])
      expect(scan(`<http://localhost:5173${end}\n`), end).toEqual([
        { port: 5173, url: 'http://localhost:5173/' }
      ])
    }
  })

  it('finds nothing without a port, for other hosts, or a port outside 1 to 65535', () => {
    expect(
      scan(
        'http://localhost/\n',
        'Network: http://192.168.1.5:5173/\n',
        'http://example.com:3000/\n',
        'http://localhost.example.com:3000/\n',
        'http://localhost:0/\n',
        'http://localhost:70000/\n',
        'http://localhost:123456/\n',
        'ftp://localhost:21/\n'
      )
    ).toEqual([])
  })

  it("keeps at most the unfinished line's last 4,096 characters", () => {
    const next = urlScanner()
    for (let i = 0; i < 100; i++) next('x'.repeat(1000))
    // The carry was cut to its tail: a URL started long ago is lost, a recent one is whole.
    expect(next(' http://localhost:8080/\n')).toEqual([
      { port: 8080, url: 'http://localhost:8080/' }
    ])
    const lost = urlScanner()
    lost('http://localhost:8080/' + 'x'.repeat(MAX_CARRY_CHARS))
    expect(lost('\n')).toEqual([])
  })
})
