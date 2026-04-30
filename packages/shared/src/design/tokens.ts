// OKLCH Color Palette
export const colors = {
  // Primary colors
  primary: {
    50: 'oklch(96.9% 0.04 270)',
    100: 'oklch(93.9% 0.08 270)',
    200: 'oklch(85.9% 0.13 270)',
    300: 'oklch(76.4% 0.17 270)',
    400: 'oklch(65.6% 0.19 270)',
    500: 'oklch(55.1% 0.2 270)',
    600: 'oklch(49.4% 0.18 270)',
    700: 'oklch(42.2% 0.16 270)',
    800: 'oklch(35.8% 0.13 270)',
    900: 'oklch(28.4% 0.11 270)',
  },
  
  // Neutral/Surface
  neutral: {
    50: 'oklch(99.5% 0.003 200)',
    100: 'oklch(97% 0.008 200)',
    200: 'oklch(92% 0.01 200)',
    300: 'oklch(85% 0.015 200)',
    400: 'oklch(75% 0.02 200)',
    500: 'oklch(65% 0.02 200)',
    600: 'oklch(50% 0.02 200)',
    700: 'oklch(35% 0.02 200)',
    800: 'oklch(25% 0.02 200)',
    900: 'oklch(15% 0.015 200)',
  },
  
  // Success
  success: {
    50: 'oklch(96.9% 0.04 130)',
    100: 'oklch(93% 0.08 130)',
    200: 'oklch(85.5% 0.12 130)',
    300: 'oklch(76% 0.16 130)',
    400: 'oklch(70.1% 0.18 130)',
    500: 'oklch(63.7% 0.2 130)',
    600: 'oklch(56% 0.18 130)',
    700: 'oklch(47.2% 0.16 130)',
    800: 'oklch(38.5% 0.13 130)',
    900: 'oklch(28.6% 0.11 130)',
  },
  
  // Warning
  warning: {
    50: 'oklch(97.5% 0.04 70)',
    100: 'oklch(93.9% 0.08 70)',
    200: 'oklch(87.9% 0.12 70)',
    300: 'oklch(79.8% 0.16 70)',
    400: 'oklch(75.1% 0.18 70)',
    500: 'oklch(69.9% 0.2 70)',
    600: 'oklch(62% 0.18 70)',
    700: 'oklch(53% 0.16 70)',
    800: 'oklch(42.2% 0.14 70)',
    900: 'oklch(30.3% 0.12 70)',
  },
  
  // Error/Danger
  error: {
    50: 'oklch(97.1% 0.04 20)',
    100: 'oklch(92.9% 0.08 20)',
    200: 'oklch(85.8% 0.12 20)',
    300: 'oklch(77.2% 0.16 20)',
    400: 'oklch(66.5% 0.2 20)',
    500: 'oklch(59.7% 0.25 20)',
    600: 'oklch(52.4% 0.23 20)',
    700: 'oklch(44.7% 0.2 20)',
    800: 'oklch(36.8% 0.17 20)',
    900: 'oklch(28% 0.14 20)',
  },
  
  // Accent
  accent: {
    50: 'oklch(96.8% 0.04 300)',
    100: 'oklch(93% 0.08 300)',
    200: 'oklch(85.5% 0.12 300)',
    300: 'oklch(76.5% 0.15 300)',
    400: 'oklch(70% 0.17 300)',
    500: 'oklch(64.8% 0.18 300)',
    600: 'oklch(57% 0.16 300)',
    700: 'oklch(48.8% 0.15 300)',
    800: 'oklch(40.2% 0.12 300)',
    900: 'oklch(30.8% 0.1 300)',
  },
};

// Typography
export const typography = {
  fontSans: 'var(--font-sans, system-ui, sans-serif)',
  fontSerif: 'var(--font-serif, Georgia, serif)',
  fontMono: 'var(--font-mono, monospace)',
  
  sizes: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '1.875rem',
    '4xl': '2.25rem',
    '5xl': '3rem',
  },
  
  lineHeights: {
    tight: '1.25',
    snug: '1.375',
    normal: '1.5',
    relaxed: '1.625',
    loose: '2',
  },
};

// Startup Phases (colors)
export const startupPhases = {
  idea: 'oklch(75% 0.18 300)', // Accent purple
  pre_revenue: 'oklch(69.9% 0.2 70)', // Warning yellow
  early_revenue: 'oklch(70.1% 0.18 130)', // Success green
  growth: 'oklch(55.1% 0.2 270)', // Primary blue
  scale: 'oklch(59.7% 0.25 20)', // Error red (passionate)
  exit: 'oklch(50% 0.02 200)', // Neutral dark
};

// Spacing
export const spacing = {
  xs: '0.25rem',
  sm: '0.5rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2rem',
  '2xl': '3rem',
  '3xl': '4rem',
};
