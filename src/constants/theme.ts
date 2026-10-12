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
  cursor: {
    primary: '#18181b',
    accent: '#6b7280',
    surface: 'rgba(24, 24, 27, 0.06)',
    border: 'rgba(24, 24, 27, 0.15)',
    glow: 'rgba(24, 24, 27, 0.15)',
    chart: '#3f3f46',
    chartAlt: '#71717a',
  },
  copilot: {
    primary: '#1f6feb',
    accent: '#388bfd',
    surface: 'rgba(31, 111, 235, 0.08)',
    border: 'rgba(31, 111, 235, 0.2)',
    glow: 'rgba(31, 111, 235, 0.2)',
    chart: '#1f6feb',
    chartAlt: '#79b8ff',
  },
  perplexity: {
    primary: '#20808d',
    accent: '#22b8cf',
    surface: 'rgba(32, 128, 141, 0.09)',
    border: 'rgba(32, 128, 141, 0.22)',
    glow: 'rgba(34, 184, 207, 0.2)',
    chart: '#20808d',
    chartAlt: '#5bc0ce',
  },
  grok: {
    primary: '#18181b',
    accent: '#52525b',
    surface: 'rgba(24, 24, 27, 0.06)',
    border: 'rgba(24, 24, 27, 0.15)',
    glow: 'rgba(24, 24, 27, 0.15)',
    chart: '#27272a',
    chartAlt: '#6b7280',
  },
  mistral: {
    primary: '#fa520f',
    accent: '#ff7a3c',
    surface: 'rgba(250, 82, 15, 0.09)',
    border: 'rgba(250, 82, 15, 0.22)',
    glow: 'rgba(250, 82, 15, 0.2)',
    chart: '#fa520f',
    chartAlt: '#ff9a68',
  },
  deepseek: {
    primary: '#4d6bfe',
    accent: '#6b84ff',
    surface: 'rgba(77, 107, 254, 0.09)',
    border: 'rgba(77, 107, 254, 0.22)',
    glow: 'rgba(77, 107, 254, 0.2)',
    chart: '#4d6bfe',
    chartAlt: '#93a4ff',
  },
  poe: {
    primary: '#5d3fd3',
    accent: '#7c5cf0',
    surface: 'rgba(93, 63, 211, 0.09)',
    border: 'rgba(93, 63, 211, 0.22)',
    glow: 'rgba(93, 63, 211, 0.2)',
    chart: '#5d3fd3',
    chartAlt: '#a98bf5',
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
  cursor: 'Cursor',
  copilot: 'GitHub Copilot',
  perplexity: 'Perplexity',
  grok: 'Grok',
  mistral: 'Mistral',
  deepseek: 'DeepSeek',
  poe: 'Poe',
  custom: 'Другой сервис',
};

export const PROVIDER_COMPANY: Record<ProviderType, string> = {
  claude: 'Anthropic',
  chatgpt: 'OpenAI',
  gemini: 'Google',
  cursor: 'Anysphere',
  copilot: 'GitHub',
  perplexity: 'Perplexity',
  grok: 'xAI',
  mistral: 'Mistral AI',
  deepseek: 'DeepSeek',
  poe: 'Quora',
  custom: 'Произвольный endpoint',
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
