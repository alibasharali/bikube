/**
 * Props for lucide icons (#31 D17). Icons are decorative: the control around them carries the
 * accessible name, so they are hidden from assistive technology.
 */
export const ICON = { size: 16, 'aria-hidden': true } as const

/** A smaller icon: a row's hover actions. */
export const SMALL_ICON = { size: 14, 'aria-hidden': true } as const

/** A menu item's icon, beside the item's text. */
export const MENU_ICON = { size: 14, 'aria-hidden': true, className: 'menu-icon' } as const
