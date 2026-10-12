/** Renderer strings of CPU-emulated GL, where xterm's WebGL renderer is slower than its DOM one. */
const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software/i

/** True when the GL renderer string names a software rasteriser (D8: WebGL only where it is real). */
export function isSoftwareRenderer(renderer: string): boolean {
  return SOFTWARE_GL.test(renderer)
}
