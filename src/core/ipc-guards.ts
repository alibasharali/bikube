/** Runtime checks for IPC arguments: the renderer is not trusted, types alone do not hold at runtime. */

export const MAX_DIMENSION = 1000
export const MAX_WRITE_BYTES = 1024 * 1024

const isDimension = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_DIMENSION

export function isValidSize(cols: unknown, rows: unknown): boolean {
  return isDimension(cols) && isDimension(rows)
}

export function isSessionId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0
}

export function isWriteData(data: unknown): data is string {
  // Every UTF-16 code unit is at most 3 UTF-8 bytes, so length bounds the cost of measuring.
  return (
    typeof data === 'string' &&
    data.length <= MAX_WRITE_BYTES &&
    Buffer.byteLength(data, 'utf8') <= MAX_WRITE_BYTES
  )
}
