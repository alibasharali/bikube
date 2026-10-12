import { contextBridge } from 'electron'
import type { DrovrApi } from '../shared/api'

const api: DrovrApi = {
  platform: process.platform
}

contextBridge.exposeInMainWorld('drovr', api)
