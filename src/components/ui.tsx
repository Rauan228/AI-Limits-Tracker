import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { CardShadow, Colors, Radius } from '../constants/theme';
import { AccountEntity, UsageSnapshot } from '../models/types';

/* ---------- Header ---------- */

export const ScreenHeader: React.FC<{
  title: string;
  subtitle?: string;
  large?: boolean;
  right?: React.ReactNode;
  onBack?: () => void;
  hideBack?: boolean;
}> = ({ title, subtitle, large, right, onBack, hideBack }) => {
  const router = useRouter();
  const back = onBack || (() => (router.canGoBack() ? router.back() : router.replace('/')));

  if (large) {
    return (
      <View style={styles.largeHeader}>
        <View style={styles.largeTopRow}>
          {hideBack ? <View /> : (
            <TouchableOpacity onPress={back} hitSlop={12}>
              <ArrowLeft size={22} color={Colors.text} />
            </TouchableOpacity>
          )}
          {right || <View />}
        </View>
        <Text style={styles.largeTitle}>{title}</Text>
        {subtitle ? <Text style={styles.largeSubtitle}>{subtitle}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.smallHeader}>
      {!hideBack && (
        <TouchableOpacity onPress={back} hitSlop={12} style={{ marginRight: 10 }}>
          <ChevronLeft size={24} color={Colors.text} />
        </TouchableOpacity>
      )}
      <Text style={styles.smallTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={{ marginLeft: 'auto' }}>{right}</View>
    </View>
  );
};

/* ---------- Card ---------- */

export const Card: React.FC<{ style?: StyleProp<ViewStyle>; children: React.ReactNode; onPress?: () => void }> = ({
  style,
  children,
  onPress,
}) => {
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.card, style, pressed && styles.cardPressed]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
};

/* ---------- Segmented control ---------- */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: Array<{ key: T; label: string }>;
  value: T;
  onChange: (key: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.segmented, style]}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <TouchableOpacity
            key={o.key}
            style={[styles.segment, active && styles.segmentActive]}
            onPress={() => onChange(o.key)}
            activeOpacity={0.8}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1}>
              {o.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/* ---------- Status ---------- */

export type DisplayStatus = { label: string; color: string; bg: string };

export function accountStatus(account: AccountEntity, snapshot?: UsageSnapshot): DisplayStatus {
  const status = snapshot?.status || account.lastStatus;
  if (!account.isActive) return { label: 'На паузе', color: Colors.textMuted, bg: Colors.cardHighlight };
  switch (status) {
    case 'ok':
      return { label: 'Активен', color: Colors.normal, bg: Colors.normalSoft };
    case 'reauth_required':
      return { label: 'Нужен вход', color: Colors.exhausted, bg: Colors.exhaustedSoft };
    case 'rate_limited':
      return { label: 'Пауза API', color: Colors.warning, bg: '#fdf3e1' };
    case 'error':
      return { label: 'Ошибка', color: Colors.exhausted, bg: Colors.exhaustedSoft };
    case 'not_configured':
      return { label: 'Не подключён', color: Colors.textMuted, bg: Colors.cardHighlight };
    default:
      return { label: 'Обновление…', color: Colors.textMuted, bg: Colors.cardHighlight };
  }
}

export const StatusDot: React.FC<{ status: DisplayStatus; size?: 'sm' | 'md' }> = ({ status, size = 'md' }) => (
  <View style={styles.statusRow}>
    <View style={[styles.dot, { backgroundColor: status.color }]} />
    <Text style={[styles.statusText, { color: status.color, fontSize: size === 'sm' ? 10 : 11 }]}>{status.label}</Text>
  </View>
);

export const StatusPill: React.FC<{ status: DisplayStatus }> = ({ status }) => (
  <View style={[styles.pill, { backgroundColor: status.bg }]}>
    <View style={[styles.dot, { backgroundColor: status.color }]} />
    <Text style={[styles.pillText, { color: status.color }]}>{status.label}</Text>
  </View>
);

/* ---------- Menu rows ---------- */

export const MenuRow: React.FC<{
  icon: React.ReactNode;
  title: string;
  value?: string;
  danger?: boolean;
  onPress?: () => void;
  last?: boolean;
}> = ({ icon, title, value, danger, onPress, last }) => (
  <TouchableOpacity style={[styles.menuRow, !last && styles.menuRowBorder]} onPress={onPress} activeOpacity={0.7}>
    <View style={styles.menuIcon}>{icon}</View>
    <Text style={[styles.menuTitle, danger && { color: Colors.exhausted }]}>{title}</Text>
    {value ? <Text style={styles.menuValue}>{value}</Text> : null}
    <ChevronRight size={16} color={danger ? Colors.exhausted : Colors.textSubtle} />
  </TouchableOpacity>
);

export const SectionTitle: React.FC<{ children: React.ReactNode; right?: React.ReactNode }> = ({ children, right }) => (
  <View style={styles.sectionRow}>
    <Text style={styles.sectionTitle}>{children}</Text>
    {right}
  </View>
);

export const EmptyState: React.FC<{ title: string; text: string; action?: React.ReactNode }> = ({ title, text, action }) => (
  <View style={styles.empty}>
    <Text style={styles.emptyTitle}>{title}</Text>
    <Text style={styles.emptyText}>{text}</Text>
    {action}
  </View>
);

export const PrimaryButton: React.FC<{
  label: string;
  icon?: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  variant?: 'dark' | 'light' | 'danger';
}> = ({ label, icon, onPress, disabled, style, variant = 'dark' }) => (
  <TouchableOpacity
    style={[
      styles.primaryBtn,
      variant === 'light' && styles.primaryBtnLight,
      variant === 'danger' && styles.primaryBtnDanger,
      disabled && { opacity: 0.5 },
      style,
    ]}
    onPress={onPress}
    disabled={disabled}
    activeOpacity={0.85}
  >
    {icon}
    <Text
      style={[
        styles.primaryBtnText,
        variant === 'light' && { color: Colors.text },
        variant === 'danger' && { color: Colors.exhausted },
      ]}
    >
      {label}
    </Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  largeHeader: {
    paddingTop: 8,
    marginBottom: 18,
  },
  largeTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    minHeight: 28,
  },
  largeTitle: {
    fontSize: 30,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.9,
  },
  largeSubtitle: {
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: 4,
  },
  smallHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    marginBottom: 12,
  },
  smallTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: -0.3,
    flexShrink: 1,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    ...CardShadow,
  },
  cardPressed: {
    transform: [{ scale: 0.985 }],
    backgroundColor: '#f7f6f2',
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: Colors.cardHighlight,
    borderRadius: Radius.full,
    padding: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: Radius.full,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: Colors.ink,
  },
  segmentText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: Colors.text,
  },
  segmentTextActive: {
    color: Colors.inkText,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontWeight: '600',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.full,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    gap: 12,
  },
  menuRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },
  menuIcon: {
    width: 22,
    alignItems: 'center',
  },
  menuTitle: {
    flex: 1,
    fontSize: 14.5,
    fontWeight: '500',
    color: Colors.text,
  },
  menuValue: {
    fontSize: 12,
    color: Colors.textSubtle,
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 22,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: -0.2,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 36,
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  emptyText: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 8,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.ink,
    borderRadius: Radius.lg,
    paddingVertical: 15,
    paddingHorizontal: 18,
  },
  primaryBtnLight: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  primaryBtnDanger: {
    backgroundColor: Colors.exhaustedSoft,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.inkText,
  },
});
