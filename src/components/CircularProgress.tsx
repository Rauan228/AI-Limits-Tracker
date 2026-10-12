import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Colors, remainingColor } from '../constants/theme';
import { ProviderType } from '../models/types';

interface CircularProgressProps {
  size?: number;
  strokeWidth?: number;
  /** 0-100, null when unknown */
  remainingPercent: number | null;
  providerType?: ProviderType;
  colorOverride?: string;
  sublabel?: string;
  dimmed?: boolean;
}

export const CircularProgress: React.FC<CircularProgressProps> = ({
  size = 76,
  strokeWidth = 7,
  remainingPercent,
  providerType,
  colorOverride,
  sublabel = 'осталось',
  dimmed,
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = remainingPercent === null ? null : Math.min(100, Math.max(0, Math.round(remainingPercent)));
  const color = colorOverride || remainingColor(pct, providerType);
  const offset = circumference - (circumference * (pct ?? 0)) / 100;
  const big = size >= 120;

  return (
    <View style={[styles.container, { width: size, height: size, opacity: dimmed ? 0.55 : 1 }]}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={Colors.track}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {pct !== null && pct > 0 && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </Svg>
      <View style={styles.center}>
        <Text style={[styles.value, { fontSize: Math.round(size * (big ? 0.2 : 0.25)) }]}>
          {pct === null ? '—' : `${pct}%`}
        </Text>
        {size >= 60 && (
          <Text style={[styles.sublabel, big && { fontSize: 13, marginTop: 2 }]}>
            {pct === null ? 'нет данных' : sublabel}
          </Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  center: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.6,
  },
  sublabel: {
    fontSize: 9,
    fontWeight: '500',
    color: Colors.textMuted,
    marginTop: -1,
  },
});
