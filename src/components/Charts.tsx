import React, { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { Colors } from '../constants/theme';

function useWidth(initial = 300): [number, (e: LayoutChangeEvent) => void] {
  const [w, setW] = useState(initial);
  return [w, (e) => setW(Math.round(e.nativeEvent.layout.width))];
}

/* ---------- Mini bars (card sparkline) ---------- */

export const MiniBars: React.FC<{ values: Array<number | null>; color?: string; height?: number }> = ({
  values,
  color = '#c9c6bd',
  height = 18,
}) => {
  const bars = values.length ? values : new Array(9).fill(null);
  return (
    <View style={[styles.miniRow, { height }]}>
      {bars.map((v, i) => (
        <View
          key={i}
          style={{
            width: 3.5,
            borderRadius: 2,
            height: v === null ? 3 : Math.max(3, Math.round((Math.min(100, v) / 100) * height)),
            backgroundColor: v === null ? Colors.track : color,
          }}
        />
      ))}
    </View>
  );
};

/* ---------- Mini line (stat tile sparkline) ---------- */

export const MiniLine: React.FC<{ values: number[]; color?: string; height?: number }> = ({
  values,
  color = Colors.text,
  height = 34,
}) => {
  const [width, onLayout] = useWidth(120);
  if (values.length < 2) {
    return <View style={{ height }} onLayout={onLayout} />;
  }
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const d = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(height - 3 - ((v - min) / span) * (height - 6)).toFixed(1)}`)
    .join(' ');
  return (
    <View onLayout={onLayout} style={{ height }}>
      <Svg width={width} height={height}>
        <Path d={d} stroke={color} strokeWidth={1.8} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      </Svg>
    </View>
  );
};

/* ---------- Bar chart with optional stacking ---------- */

export interface BarSeries {
  color: string;
  values: Array<number | null>;
}

interface BarChartProps {
  labels: string[];
  series: BarSeries[];
  height?: number;
  max?: number;
  stacked?: boolean;
  ticks?: number[];
}

export const BarChart: React.FC<BarChartProps> = ({ labels, series, height = 130, max, stacked, ticks }) => {
  const [width, onLayout] = useWidth();
  const axisW = 30;
  const plotW = Math.max(10, width - axisW);
  const n = labels.length;
  const totals = labels.map((_, i) =>
    stacked
      ? series.reduce((s, ser) => s + (ser.values[i] ?? 0), 0)
      : Math.max(0, ...series.map((ser) => ser.values[i] ?? 0))
  );
  const top = max ?? Math.max(10, Math.ceil(Math.max(...totals, 0) / 10) * 10);
  const tickValues = ticks ?? [0, Math.round(top / 2), top];
  const slot = plotW / Math.max(1, n);
  const barW = Math.min(14, slot * 0.42);

  return (
    <View onLayout={onLayout}>
      <Svg width={width} height={height}>
        {tickValues.map((t) => {
          const y = height - (t / top) * (height - 8);
          return (
            <Line key={t} x1={axisW} x2={width} y1={y} y2={y} stroke={Colors.borderSubtle} strokeWidth={1} />
          );
        })}
        {labels.map((_, i) => {
          const cx = axisW + slot * i + slot / 2;
          if (stacked) {
            let acc = 0;
            return series.map((ser, si) => {
              const v = ser.values[i] ?? 0;
              if (v <= 0) return null;
              const h = (v / top) * (height - 8);
              const y = height - ((acc + v) / top) * (height - 8);
              acc += v;
              return <Rect key={`${i}-${si}`} x={cx - barW / 2} y={y} width={barW} height={Math.max(1, h - 1)} rx={2} fill={ser.color} />;
            });
          }
          const groupW = barW * series.length + 2 * (series.length - 1);
          return series.map((ser, si) => {
            const v = ser.values[i];
            if (v === null || v === undefined) return null;
            const h = Math.max(2, (Math.min(v, top) / top) * (height - 8));
            const x = cx - groupW / 2 + si * (barW + 2);
            return <Rect key={`${i}-${si}`} x={x} y={height - h} width={barW} height={h} rx={3} fill={ser.color} />;
          });
        })}
      </Svg>
      {tickValues.map((t) => (
        <Text key={t} style={[styles.tick, { top: height - (t / top) * (height - 8) - 7 }]}>
          {t}
        </Text>
      ))}
      <View style={[styles.xLabels, { paddingLeft: axisW }]}>
        {labels.map((l, i) => (
          <Text key={i} style={[styles.xLabel, { width: slot }]} numberOfLines={1}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
};

/* ---------- Area line chart ---------- */

interface LineChartProps {
  labels: string[];
  values: Array<number | null>;
  color?: string;
  height?: number;
  max?: number;
  highlightIndex?: number;
  highlightLabel?: string;
}

export const LineChart: React.FC<LineChartProps> = ({
  labels,
  values,
  color = '#7c6cf0',
  height = 150,
  max = 100,
  highlightIndex,
  highlightLabel,
}) => {
  const [width, onLayout] = useWidth();
  const axisW = 30;
  const plotW = Math.max(10, width - axisW - 6);
  const n = values.length;
  const pts = values
    .map((v, i) => (v === null ? null : { x: axisW + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW), y: height - (Math.min(v, max) / max) * (height - 14) - 2 }))
    .filter(Boolean) as { x: number; y: number }[];

  let line = '';
  pts.forEach((p, i) => {
    if (i === 0) line += `M${p.x},${p.y}`;
    else {
      const prev = pts[i - 1];
      const mx = (prev.x + p.x) / 2;
      line += ` C${mx},${prev.y} ${mx},${p.y} ${p.x},${p.y}`;
    }
  });
  const area = pts.length > 1 ? `${line} L${pts[pts.length - 1].x},${height} L${pts[0].x},${height} Z` : '';
  const hl = highlightIndex !== undefined && values[highlightIndex] !== null ? highlightIndex : undefined;
  const hp =
    hl !== undefined
      ? { x: axisW + (n <= 1 ? plotW / 2 : (hl / (n - 1)) * plotW), y: height - (Math.min(values[hl]!, max) / max) * (height - 14) - 2 }
      : null;
  const ticks = [0, max / 2, max];

  return (
    <View onLayout={onLayout}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="area" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={0.28} />
            <Stop offset="1" stopColor={color} stopOpacity={0.02} />
          </LinearGradient>
        </Defs>
        {ticks.map((t) => {
          const y = height - (t / max) * (height - 14) - 2;
          return <Line key={t} x1={axisW} x2={width} y1={y} y2={y} stroke={Colors.borderSubtle} strokeWidth={1} />;
        })}
        {area ? <Path d={area} fill="url(#area)" /> : null}
        {pts.length > 1 ? <Path d={line} stroke={color} strokeWidth={2.2} fill="none" /> : null}
        {pts.length === 1 ? <Circle cx={pts[0].x} cy={pts[0].y} r={4} fill={color} /> : null}
        {hp && (
          <>
            <Line x1={hp.x} x2={hp.x} y1={0} y2={height} stroke={color} strokeDasharray="3 3" strokeWidth={1} />
            <Circle cx={hp.x} cy={hp.y} r={5} fill="#fff" stroke={color} strokeWidth={2.5} />
          </>
        )}
      </Svg>
      {ticks.map((t) => (
        <Text key={t} style={[styles.tick, { top: height - (t / max) * (height - 14) - 9 }]}>
          {Math.round(t)}
        </Text>
      ))}
      {hp && highlightLabel ? (
        <View style={[styles.tooltip, { left: Math.min(Math.max(hp.x - 50, 0), width - 100), top: Math.max(0, hp.y - 52) }]}>
          <Text style={styles.tooltipValue}>{Math.round(values[hl!]!)}%</Text>
          <Text style={styles.tooltipLabel}>{highlightLabel}</Text>
        </View>
      ) : null}
      <View style={[styles.xLabels, { paddingLeft: axisW }]}>
        {labels.map((l, i) => (
          <Text key={i} style={[styles.xLabel, { width: plotW / Math.max(1, labels.length) }]} numberOfLines={1}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
};

/* ---------- Donut ---------- */

export interface DonutSegment {
  value: number;
  color: string;
}

export const Donut: React.FC<{
  segments: DonutSegment[];
  size?: number;
  stroke?: number;
  centerValue: string;
  centerLabel: string;
}> = ({ segments, size = 130, stroke = 18, centerValue, centerLabel }) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0);
  const gap = segments.filter((s) => s.value > 0).length > 1 ? 3 : 0;
  let offset = 0;
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={Colors.track} strokeWidth={stroke} fill="none" />
        {total > 0 &&
          segments.map((s, i) => {
            if (s.value <= 0) return null;
            const len = (s.value / total) * c;
            const el = (
              <Circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                stroke={s.color}
                strokeWidth={stroke}
                fill="none"
                strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            );
            offset += len;
            return el;
          })}
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        <Text style={styles.donutValue}>{centerValue}</Text>
        <Text style={styles.donutLabel}>{centerLabel}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  miniRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2.5,
  },
  tick: {
    position: 'absolute',
    left: 0,
    width: 26,
    fontSize: 10,
    color: Colors.textSubtle,
    textAlign: 'left',
  },
  xLabels: {
    flexDirection: 'row',
    marginTop: 6,
  },
  xLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  tooltip: {
    position: 'absolute',
    width: 100,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tooltipValue: {
    fontSize: 13,
    fontWeight: '800',
    color: Colors.text,
  },
  tooltipLabel: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  donutValue: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.6,
  },
  donutLabel: {
    fontSize: 11,
    color: Colors.textMuted,
  },
});
