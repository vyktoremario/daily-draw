/** Design tokens taken from the player app mockups (placeholder brand). */
export const colors = {
  ground: '#F6F5F1',
  surface: '#FFFFFF',
  ink: '#15171A',
  inkMuted: '#5B6068',
  border: '#E3E1DA',
  brand: '#0A6B48',
  brandHover: '#08513A',
  brandSoft: '#E6F3EC',
  night: '#0E2B22',
  nightText: '#CDE3D8',
  gold: '#F5B92E',
} as const;

export const fonts = {
  body: 'Inter, system-ui, sans-serif',
  display: "'Space Grotesk', Inter, system-ui, sans-serif",
} as const;

export const radii = { sm: 12, md: 14, lg: 18, xl: 20, pill: 999 } as const;

/** Minimum touch target, in px. */
export const minTouch = 44;
