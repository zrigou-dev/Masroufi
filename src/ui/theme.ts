export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 40 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;
export const touch = { min: 44 } as const;

export const fontFamily = {
  regular: 'IBMPlexSansArabic_400Regular',
  medium: 'IBMPlexSansArabic_500Medium',
  semibold: 'IBMPlexSansArabic_600SemiBold',
  bold: 'IBMPlexSansArabic_700Bold',
} as const;

export type FontWeightName = keyof typeof fontFamily;

/** Arabic needs taller lines than Latin text, so every size carries a generous line height. */
export const type = {
  caption: { fontSize: 12, lineHeight: 18 },
  small: { fontSize: 13, lineHeight: 20 },
  body: { fontSize: 15, lineHeight: 23 },
  title: { fontSize: 17, lineHeight: 26 },
  heading: { fontSize: 21, lineHeight: 31 },
  display: { fontSize: 32, lineHeight: 44 },
} as const;

export type TypeName = keyof typeof type;

export type Palette = {
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  primary: string;
  primarySoft: string;
  onPrimary: string;
  positive: string;
  positiveSoft: string;
  negative: string;
  negativeSoft: string;
  warning: string;
  warningSoft: string;
  overlay: string;
};

export const light: Palette = {
  background: '#F6F7F5',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  border: '#E4E8E4',
  text: '#16201C',
  textMuted: '#55635D',
  textFaint: '#7A8780',
  primary: '#0F5C4D',
  primarySoft: '#E2F0EB',
  onPrimary: '#FFFFFF',
  positive: '#12704F',
  positiveSoft: '#E1F3EA',
  negative: '#B3261E',
  negativeSoft: '#FBE9E7',
  warning: '#8A5A00',
  warningSoft: '#FBF0D9',
  overlay: 'rgba(10, 16, 14, 0.45)',
};

export const dark: Palette = {
  background: '#0E1412',
  surface: '#161E1B',
  surfaceRaised: '#1D2723',
  border: '#2A3531',
  text: '#ECF1EE',
  textMuted: '#A7B4AE',
  textFaint: '#85938C',
  primary: '#4CC2A4',
  primarySoft: '#183630',
  onPrimary: '#06201A',
  positive: '#5AD19F',
  positiveSoft: '#16322A',
  negative: '#FF8A80',
  negativeSoft: '#3A1E1C',
  warning: '#F2C14E',
  warningSoft: '#3A2F14',
  overlay: 'rgba(0, 0, 0, 0.6)',
};
