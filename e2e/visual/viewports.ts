/**
 * Snapshot viewports of FRONTEND_ACCEPTANCE / ARCHITECTURE_MVP_v2 §25 stage 3,
 * plus the exact frame of hero-approved.png (1440×873) for anchor checks and
 * the portrait composition on a short phone and at the end of its scroll.
 */
export const viewports = [
  { name: 'reference-1440', width: 1440, height: 873 },
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-390-end', width: 390, height: 844, scroll: 'end' },
  { name: 'mobile-375-short', width: 375, height: 667 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'wide-1920', width: 1920, height: 1080 },
] as const
