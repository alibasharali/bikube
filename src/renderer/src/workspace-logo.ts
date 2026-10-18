import {
  Book,
  Box,
  Briefcase,
  Bug,
  Camera,
  Cloud,
  Code,
  Cpu,
  Database,
  Flame,
  FlaskConical,
  Gamepad2,
  Globe,
  Heart,
  Leaf,
  Music,
  Palette,
  Rocket,
  Server,
  Shield,
  Star,
  Terminal,
  Wrench,
  Zap,
  type LucideIcon
} from 'lucide-react'
import type { WorkspaceLogoId } from '../../core/workspace-logos'

/** Each workspace logo's lucide icon (#59 D1); typed by the core list, so the two stay in step. */
export const LOGO_ICONS: Record<WorkspaceLogoId, LucideIcon> = {
  rocket: Rocket,
  code: Code,
  terminal: Terminal,
  globe: Globe,
  database: Database,
  server: Server,
  cpu: Cpu,
  bug: Bug,
  'flask-conical': FlaskConical,
  book: Book,
  briefcase: Briefcase,
  box: Box,
  cloud: Cloud,
  zap: Zap,
  flame: Flame,
  leaf: Leaf,
  heart: Heart,
  star: Star,
  music: Music,
  camera: Camera,
  'gamepad-2': Gamepad2,
  shield: Shield,
  wrench: Wrench,
  palette: Palette
}

/** The badge icon's size: as tall as the letter it replaces (#59 D4). */
export const LOGO_ICON = { size: 14, 'aria-hidden': true } as const
