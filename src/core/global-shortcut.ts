/**
 * The global shortcut's registration with the OS and what a press does (#51 D3, D6, D8), free of
 * Electron imports: main injects `globalShortcut`'s register and unregister.
 */
import { globalAccelerator } from './global-hotkey'

/** The window as a press finds it (#51 D3). */
export interface WindowLook {
  visible: boolean
  minimized: boolean
  focused: boolean
}

/**
 * What a press of the global shortcut does (#51 D3): a focused window hides (`hide`: the app on
 * macOS, `app.hide()`; `minimize` elsewhere), any other comes forward (`show`), and with no window
 * one is created (`create`).
 */
export type GlobalPressAction = 'hide' | 'minimize' | 'show' | 'create'

export function globalPressAction(window: WindowLook | null, platform: string): GlobalPressAction {
  if (window === null) return 'create'
  if (window.visible && !window.minimized && window.focused) {
    return platform === 'darwin' ? 'hide' : 'minimize'
  }
  return 'show'
}

/**
 * Where the global shortcut stands (#51 D8): `none` (none set, or one set while suspended that
 * resuming will try), `registered`, or `failed` when the OS refused it.
 */
export type GlobalShortcutState = 'none' | 'registered' | 'failed'

/** `globalShortcut`'s calls the registration needs, injected so tests can refuse (AC7). */
export interface GlobalShortcutOs {
  /** Whether the OS took `accelerator`; `onPress` runs on each press. A throw reads as refused. */
  register(accelerator: string, onPress: () => void): boolean
  unregister(accelerator: string): void
}

/**
 * The one global shortcut (#51 D1) kept registered with the OS: `set` with each saved value (at
 * launch and after every settings save, D8), which registers only when it changed, so a refused
 * one is tried again by a save that changes it, the next launch, or a resume. While suspended
 * (D6) nothing is registered; `resume` registers the current one again. `dispose` at quit (D10).
 */
export class GlobalShortcut {
  private text: string | undefined
  /** The accelerator registered with the OS now, if any. */
  private held: string | null = null
  private current: GlobalShortcutState = 'none'
  private suspended = false
  private disposed = false

  constructor(
    private readonly os: GlobalShortcutOs,
    private readonly platform: string,
    private readonly onPress: () => void
  ) {}

  state(): GlobalShortcutState {
    return this.current
  }

  set(text: string | undefined): void {
    if (text === this.text) return
    this.text = text
    this.release()
    this.current = 'none'
    if (!this.suspended) this.register()
  }

  suspend(): void {
    this.suspended = true
    this.release()
  }

  resume(): void {
    if (!this.suspended) return
    this.suspended = false
    this.register()
  }

  dispose(): void {
    this.disposed = true
    this.release()
  }

  private register(): void {
    if (this.disposed || this.text === undefined) return
    const accelerator = globalAccelerator(this.text, this.platform)
    if (accelerator === null) {
      this.current = 'none'
      return
    }
    if (this.tryRegister(accelerator)) {
      this.held = accelerator
      this.current = 'registered'
    } else this.current = 'failed'
  }

  /** The OS's answer, false when it throws: Electron throws on an accelerator it can't parse. */
  private tryRegister(accelerator: string): boolean {
    try {
      return this.os.register(accelerator, this.onPress)
    } catch {
      return false
    }
  }

  private release(): void {
    if (this.held === null) return
    this.os.unregister(this.held)
    this.held = null
  }
}

/** Chromium's `enable-features` value `features` with `feature` added once (#51 D8). */
export function withFeature(features: string, feature: string): string {
  const names = features.split(',').filter((name) => name !== '')
  return names.includes(feature) ? names.join(',') : [...names, feature].join(',')
}
