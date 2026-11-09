// Matches --vx-fast, --vx-page-fade and --vx-ease in tokens.css.
export const motionTokens = {
  micro: 0.16,
  component: 0.22,
  panel: 0.24,
  ease: [0.2, 0.7, 0.2, 1] as const,
  spring: { type: 'spring' as const, stiffness: 380, damping: 34 },
};
