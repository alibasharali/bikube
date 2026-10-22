/// <reference types="vite/client" />
import type { BikubeApi } from '../../shared/api'

declare global {
  interface Window {
    bikube: BikubeApi
  }
}
