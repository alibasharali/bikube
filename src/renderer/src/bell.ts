import { settingsStore } from './settings'

let audio: AudioContext | undefined

/** A short soft tone, made on the spot: no sound file to ship. */
export function playTone(frequency = 880, seconds = 0.12): void {
  try {
    audio ??= new AudioContext()
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.08, audio.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + seconds)
    oscillator.connect(gain).connect(audio.destination)
    oscillator.start()
    oscillator.stop(audio.currentTime + seconds)
  } catch {
    // No audio output: the bell stays silent.
  }
}

/** A terminal's bell (BEL), as the Bell setting says: nothing, a brief flash of `host`, or a tone. */
export function ringBell(host: HTMLElement): void {
  const bell = settingsStore.get().bell
  if (bell === 'sound') playTone()
  if (bell !== 'flash') return
  host.classList.remove('terminal-bell')
  // Restarts the animation when bells come quickly.
  void host.offsetWidth
  host.classList.add('terminal-bell')
}
