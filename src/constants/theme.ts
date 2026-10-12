import { ProviderType } from '../models/types';

export const Colors = {
  // Warm light palette from the design mockup
  background: '#f2f1ed',
  backgroundWarm: '#ebe9e3',
  card: '#fbfaf8',
  cardElevated: '#ffffff',
  cardHighlight: '#eceae4',
  border: '#e8e6e0',
  borderActive: '#18181b',
  borderSubtle: '#efede8',
  track: '#e9e7e1',

  text: '#18181b',
  textMuted: '#71717a',
  textSubtle: '#a1a1aa',
  textDisabled: '#d4d4d8',

  ink: '#18181b',
  inkText: '#ffffff',

  normal: '#16a34a',
  normalSoft: '#e7f6ec',
  warning: '#f59e0b',
  critical: '#f97316',
  exhausted: '#ef4444',
  exhaustedSoft: '#fdecec',
  unavailable: '#a1a1aa',
  ring: '#1f9d74',
  ringBlue: '#3b5bdb',

  claude: {
    primary: '#e2683c',
    accent: '#ea580c',
    surface: 'rgba(226, 104, 60, 0.10)',
    border: 'rgba(226, 104, 60, 0.25)',
    glow: 'rgba(226, 104, 60, 0.2)',
    chart: '#e8743f',
    chartAlt: '#f4a259',
  },
  chatgpt: {
    primary: '#18181b',
    accent: '#10a37f',
    surface: 'rgba(24, 24, 27, 0.06)',
    border: 'rgba(24, 24, 27, 0.15)',
    glow: 'rgba(16, 163, 127, 0.2)',
    chart: '#27272a',
    chartAlt: '#52525b',
  },
  gemini: {
    primary: '#4f46e5',
    accent: '#3b82f6',
    surface: 'rgba(79, 70, 229, 0.08)',
    border: 'rgba(79, 70, 229, 0.2)',
    glow: 'rgba(59, 130, 246, 0.2)',
    chart: '#7c6cf0',
    chartAlt: '#a99ff5',
  },
  custom: {
    primary: '#8b5cf6',
    accent: '#a78bfa',
    surface: 'rgba(139, 92, 246, 0.08)',
    border: 'rgba(139, 92, 246, 0.2)',
    glow: 'rgba(139, 92, 246, 0.2)',
    chart: '#8b5cf6',
    chartAlt: '#c4b5fd',
  },
};

export const PROVIDER_NAMES: Record<ProviderType, string> = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  custom: 'Другое',
};

export const PROVIDER_COMPANY: Record<ProviderType, string> = {
  claude: 'Anthropic',
  chatgpt: 'OpenAI',
  gemini: 'Google',
  custom: '',
};

/** Distinct chart colors per account: provider hue, alternating shade for 2nd+ account. */
export function accountChartColor(providerType: ProviderType, indexWithinProvider: number): string {
  const scheme = Colors[providerType] || Colors.custom;
  return indexWithinProvider % 2 === 0 ? scheme.chart : scheme.chartAlt;
}

/** Ring color by remaining percent, as in the mockup (green → orange → red). */
export function remainingColor(remaining: number | null, providerType?: ProviderType): string {
  if (remaining === null) return Colors.unavailable;
  if (remaining <= 15) return Colors.exhausted;
  if (remaining <= 35) return Colors.critical;
  if (providerType === 'gemini') return Colors.ringBlue;
  return Colors.ring;
}

export const Typography = {
  familyMono: 'monospace',
  fontSize: {
    xs: 11,
    sm: 13,
    base: 15,
    lg: 17,
    xl: 20,
    '2xl': 24,
    '3xl': 30,
  },
};

export const Radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22,
  full: 9999,
};

export const CardShadow = {
  shadowColor: '#3f3a2e',
  shadowOffset: { width: 0, height: 3 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
};
