import { Platform } from 'react-native';

export type BillyTheme = {
  dark: boolean;
  colors: {
    brand: string;
    brandDeep: string;
    brandSoft: string;
    brandMist: string;
    accent: string;
    canvas: string;
    surface: string;
    surfaceRaised: string;
    surfaceMuted: string;
    text: string;
    textMuted: string;
    textSoft: string;
    border: string;
    success: string;
    warning: string;
    danger: string;
    overlay: string;
    white: string;
  };
};

const sharedColors = {
  brand: '#146237',
  brandDeep: '#0B4829',
  brandSoft: '#258F62',
  brandMist: '#E8F5EC',
  accent: '#B8F3CF',
  success: '#0F7547',
  warning: '#B7791F',
  danger: '#C43D3D',
  white: '#FFFFFF',
} as const;

export const lightTheme: BillyTheme = {
  dark: false,
  colors: {
    ...sharedColors,
    canvas: '#F6F8F7',
    surface: '#FFFFFF',
    surfaceRaised: '#FFFFFF',
    surfaceMuted: '#EEF4F0',
    text: '#151A17',
    textMuted: '#657169',
    textSoft: '#8A958E',
    border: '#E2E9E5',
    overlay: 'rgba(7, 39, 24, 0.52)',
  },
};

export const darkTheme: BillyTheme = {
  dark: true,
  colors: {
    ...sharedColors,
    brand: '#45B979',
    brandSoft: '#65CE92',
    brandMist: '#173B29',
    accent: '#85E3AD',
    success: '#72E6A6',
    warning: '#F3C76B',
    danger: '#FF9A9A',
    canvas: '#0C1711',
    surface: '#12241A',
    surfaceRaised: '#183023',
    surfaceMuted: '#1C3628',
    text: '#F5FAF7',
    textMuted: '#B1C1B7',
    textSoft: '#84968B',
    border: '#274536',
    overlay: 'rgba(0, 0, 0, 0.68)',
  },
};

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 56,
} as const;

export const radii = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const layout = {
  bottomTabBarHeight: 64,
  bottomTabDockReserve: 112,
} as const;

export const typography = {
  family: Platform.select({
    ios: 'Avenir Next',
    android: 'sans-serif',
    web: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif',
    default: 'System',
  }),
  familyRounded: Platform.select({
    ios: 'Avenir Next',
    android: 'sans-serif-medium',
    web: 'Inter, ui-rounded, system-ui, sans-serif',
    default: 'System',
  }),
} as const;

export const shadows = {
  card: Platform.select({
    web: {
      boxShadow: '0 18px 48px rgba(15, 66, 39, 0.09)',
    },
    default: {
      shadowColor: '#0B4829',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.1,
      shadowRadius: 24,
      elevation: 5,
    },
  }),
  button: Platform.select({
    web: {
      boxShadow: '0 12px 24px rgba(20, 98, 55, 0.24)',
    },
    default: {
      shadowColor: '#146237',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.22,
      shadowRadius: 16,
      elevation: 4,
    },
  }),
} as const;

export const motion = {
  quick: 180,
  standard: 320,
  relaxed: 520,
} as const;
