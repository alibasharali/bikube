/// <reference types="vite/client" />
import type { DrovrApi } from '../../shared/api'

declare global {
  interface Window {
    drovr: DrovrApi
  }
}
