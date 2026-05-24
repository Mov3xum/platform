/*
 * Movexum brand tokens i TypeScript.
 *
 * Färgvärdena speglar exakt den grafiska profilen och hålls i synk med
 * `tokens.css`. Hex är källan-av-sanning eftersom profilen anger hex/CMYK/RGB.
 */

export const movexumPalette = {
  morkbla: '#002c40',
  djupbla: '#005470',
  bla: '#00a8de',
  pastellBla: '#ebfafc',

  morklila: '#452e75',
  lila: '#6138b5',
  ljuslila: '#8e6fd6',
  pastellLila: '#e4dbfe',

  morkgron: '#1d3a1f',
  gron: '#4a7d4a',
  ljusgron: '#88b48b',
  pastellGron: '#d9eddd',

  morkorange: '#4b2718',
  orange: '#d67e47',
  pastellOrange: '#f1e5df',

  morkgul: '#ca9323',
  gul: '#f0d22e',
  pastellGul: '#f8f1da',

  svart: '#121212',
  vit: '#f2f2f2',
} as const;

export const colors = {
  primary: {
    50: '#f3eefe',
    100: '#e4dbfe',
    200: '#c9b6fb',
    300: '#a98ce8',
    400: '#8e6fd6',
    500: '#6138b5',
    600: '#532ea0',
    700: '#452e75',
    800: '#36215a',
    900: '#221339',
  },
  accent: {
    50: '#ebfafc',
    100: '#c8eef9',
    200: '#8fdcf2',
    300: '#4fc4ea',
    400: '#00a8de',
    500: '#008abb',
    600: '#006d96',
    700: '#005470',
    800: '#003d54',
    900: '#002c40',
  },
  success: {
    50: '#d9eddd',
    100: '#b6dab9',
    200: '#88b48b',
    300: '#6a9c6e',
    400: '#4a7d4a',
    500: '#3c6a3c',
    600: '#2f5530',
    700: '#244524',
    800: '#1d3a1f',
    900: '#112112',
  },
  warning: {
    50: '#f8f1da',
    100: '#f1e5df',
    200: '#f0d22e',
    300: '#ca9323',
    400: '#d67e47',
    500: '#b86432',
    600: '#8b4a26',
    700: '#6b381c',
    800: '#4b2718',
    900: '#2e160d',
  },
  error: {
    50: '#f1e5df',
    100: '#e9c5b3',
    200: '#d67e47',
    300: '#b86432',
    400: '#a04f24',
    500: '#8b4a26',
    600: '#6b381c',
    700: '#4b2718',
    800: '#36190f',
    900: '#1f0d07',
  },
  neutral: {
    50: '#f2f2f2',
    100: '#e6e6e6',
    200: '#cccccc',
    300: '#a8a8a8',
    400: '#828282',
    500: '#5d5d5d',
    600: '#404040',
    700: '#2a2a2a',
    800: '#1c1c1c',
    900: '#121212',
  },
} as const;

export const typography = {
  fontHeading: 'var(--font-heading, "Sora Variable", system-ui, sans-serif)',
  fontBody: 'var(--font-body, "Nunito Sans Variable", system-ui, sans-serif)',
  fontMono: 'var(--font-mono, "JetBrains Mono Variable", monospace)',

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
} as const;

export const startupPhases = {
  paus: '#5d5d5d',
  inflode: movexumPalette.djupbla,
  lead: movexumPalette.lila,
  boost_chamber: movexumPalette.gron,
  incubation: movexumPalette.gul,
  prescale: movexumPalette.orange,
  acceleration: movexumPalette.bla,
  alumni: '#5d5d5d',
} as const;

export const spacing = {
  xs: '0.25rem',
  sm: '0.5rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2rem',
  '2xl': '3rem',
  '3xl': '4rem',
} as const;
