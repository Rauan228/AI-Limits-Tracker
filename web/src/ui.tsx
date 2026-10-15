import React, { useEffect, useRef, useState } from 'react';
import type { ProviderType } from '../../src/models/types';
import { Colors, PROVIDER_NAMES, remainingColor } from '../../src/constants/theme';
import type { Account } from './api';

/* ---------- Provider logos ---------- */

const CLAUDE_RAYS: Array<[number, number]> = [
  [-90, 10.5], [-58, 9.2], [-28, 10.8], [4, 9.6], [33, 10.6], [62, 9],
  [92, 10.8], [122, 9.4], [150, 10.4], [180, 9.4], [208, 10.8], [238, 9.2],
];
const OPENAI_PATH =
  'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z';

const NATIVE_LOGOS = new Set(['claude', 'chatgpt', 'gemini']);

export const Logo: React.FC<{ type: ProviderType; size?: number }> = ({ type, size = 42 }) => {
  const radius = Math.round(size * 0.28);
  const inner = size - Math.round(size * 0.22) * 2;

  // Monogram for recipe-driven / custom services
  if (!NATIVE_LOGOS.has(type)) {
    const scheme = Colors[type] || Colors.custom;
    const letter = (PROVIDER_NAMES[type] || '?').replace(/^GitHub\s+/, '').charAt(0).toUpperCase();
    return (
      <div className="logo" style={{ width: size, height: size, borderRadius: radius, background: scheme.primary, color: '#fff', fontWeight: 800, fontSize: Math.round(size * 0.46) }}>
        {letter}
      </div>
    );
  }

  const bg = type === 'claude' ? '#e2683c' : type === 'chatgpt' ? '#18181b' : '#eef1fd';
  return (
    <div className="logo" style={{ width: size, height: size, borderRadius: radius, background: bg }}>
      <svg width={inner} height={inner} viewBox="0 0 24 24" aria-hidden>
        {type === 'claude' &&
          CLAUDE_RAYS.map(([a, len], i) => {
            const r = (a * Math.PI) / 180;
            return (
              <line key={i} x1={12 + Math.cos(r) * 1.2} y1={12 + Math.sin(r) * 1.2} x2={12 + Math.cos(r) * len} y2={12 + Math.sin(r) * len} stroke="#fff" strokeWidth={2.1} strokeLinecap="round" />
            );
          })}
        {type === 'chatgpt' && <path d={OPENAI_PATH} fill="#fff" />}
        {type === 'gemini' && (
          <>
            <defs>
              <linearGradient id="gem" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#4f46e5" />
                <stop offset="55%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#06b6d4" />
              </linearGradient>
            </defs>
            <path d="M12 0C12 6.627 6.627 12 0 12C6.627 12 12 17.373 12 24C12 17.373 17.373 12 24 12C17.373 12 12 6.627 12 0Z" fill="url(#gem)" />
          </>
        )}
      </svg>
    </div>
  );
};

/* ---------- Ring ---------- */

export const Ring: React.FC<{
  remaining: number | null;
  size?: number;
  stroke?: number;
  provider?: ProviderType;
  dim?: boolean;
  sub?: string;
}> = ({ remaining, size = 72, stroke = 7, provider, dim, sub = 'осталось' }) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = remaining === null ? null : Math.max(0, Math.min(100, Math.round(remaining)));
  const color = remainingColor(pct, provider);
  return (
    <div className="ring" style={{ width: size, height: size, opacity: dim ? 0.55 : 1 }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--track)" strokeWidth={stroke} fill="none" />
        {pct !== null && pct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${c} ${c}`}
            strokeDashoffset={c - (c * pct) / 100}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dashoffset .6s ease' }}
          />
        )}
      </svg>
      <div className="ring-center">
        <b style={{ fontSize: Math.round(size * (size >= 120 ? 0.2 : 0.24)) }}>{pct === null ? '—' : `${pct}%`}</b>
        {size >= 60 && <span style={{ fontSize: size >= 120 ? 13 : 9 }}>{pct === null ? 'нет данных' : sub}</span>}
      </div>
    </div>
  );
};

/* ---------- Charts ---------- */

export const MiniBars: React.FC<{ values: Array<number | null>; height?: number; color?: string }> = ({ values, height = 18, color = '#c9c6bd' }) => (
  <div className="minibars" style={{ height }}>
    {(values.length ? values : new Array(9).fill(null)).map((v, i) => (
      <i key={i} style={{ height: v === null ? 3 : Math.max(3, (Math.min(100, v) / 100) * height), background: v === null ? 'var(--track)' : color }} />
    ))}
  </div>
);

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => setW(Math.max(200, Math.round(entries[0].contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export interface Series {
  color: string;
  values: Array<number | null>;
  label?: string;
}

export const BarChart: React.FC<{ labels: string[]; series: Series[]; height?: number; max?: number; stacked?: boolean }> = ({
  labels,
  series,
  height = 150,
  max,
  stacked,
}) => {
  const [ref, W] = useWidth();
  const axis = 34;
  const totals = labels.map((_, i) =>
    stacked ? series.reduce((s, x) => s + (x.values[i] ?? 0), 0) : Math.max(0, ...series.map((x) => x.values[i] ?? 0))
  );
  const top = max ?? Math.max(10, Math.ceil(Math.max(0, ...totals) / 10) * 10);
  const slot = (W - axis) / Math.max(1, labels.length);
  const bw = Math.min(18, slot * 0.45);
  const y = (v: number) => height - (v / top) * (height - 10);
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${height + 22}`} width={W} height={height + 22}>
        {[0, top / 2, top].map((t) => (
          <g key={t}>
            <line x1={axis} x2={W} y1={y(t)} y2={y(t)} stroke="var(--border-subtle)" />
            <text x={0} y={y(t) + 4} className="tick">{Math.round(t)}</text>
          </g>
        ))}
        {labels.map((l, i) => {
          const cx = axis + slot * i + slot / 2;
          let acc = 0;
          return (
            <g key={i}>
              {series.map((s, si) => {
                const v = s.values[i];
                if (v === null || v === undefined || v <= 0) return null;
                if (stacked) {
                  const yTop = y(acc + v);
                  const h = y(acc) - yTop;
                  acc += v;
                  return <rect key={si} x={cx - bw / 2} y={yTop} width={bw} height={Math.max(1, h - 1)} rx={2} fill={s.color} />;
                }
                const gw = bw * series.length + 3 * (series.length - 1);
                return <rect key={si} x={cx - gw / 2 + si * (bw + 3)} y={y(Math.min(v, top))} width={bw} height={height - y(Math.min(v, top))} rx={3} fill={s.color} />;
              })}
              <text x={cx} y={height + 17} textAnchor="middle" className="xlabel">{l}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

export const LineChart: React.FC<{ values: Array<number | null>; labels?: string[]; color?: string; height?: number; max?: number }> = ({
  values,
  labels = [],
  color = '#7c6cf0',
  height = 160,
  max = 100,
}) => {
  const [ref, W] = useWidth();
  const axis = 34;
  const n = values.length;
  const pts = values
    .map((v, i) => (v === null ? null : { x: axis + (n <= 1 ? (W - axis) / 2 : (i / (n - 1)) * (W - axis - 4)), y: height - (Math.min(v, max) / max) * (height - 12) - 2 }))
    .filter(Boolean) as Array<{ x: number; y: number }>;
  let d = '';
  pts.forEach((p, i) => {
    if (!i) d = `M${p.x},${p.y}`;
    else {
      const prev = pts[i - 1];
      const mx = (prev.x + p.x) / 2;
      d += ` C${mx},${prev.y} ${mx},${p.y} ${p.x},${p.y}`;
    }
  });
  const last = pts[pts.length - 1];
  const id = `g${color.replace('#', '')}`;
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${height + 22}`} width={W} height={height + 22}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity={0.28} />
            <stop offset="1" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {[0, max / 2, max].map((t) => {
          const yy = height - (t / max) * (height - 12) - 2;
          return (
            <g key={t}>
              <line x1={axis} x2={W} y1={yy} y2={yy} stroke="var(--border-subtle)" />
              <text x={0} y={yy + 4} className="tick">{t}</text>
            </g>
          );
        })}
        {pts.length > 1 && <path d={`${d} L${last.x},${height} L${pts[0].x},${height} Z`} fill={`url(#${id})`} />}
        {pts.length > 1 && <path d={d} stroke={color} strokeWidth={2.4} fill="none" />}
        {last && <circle cx={last.x} cy={last.y} r={5} fill="#fff" stroke={color} strokeWidth={2.5} />}
        {labels.map((l, i) => (
          <text key={i} x={axis + ((i + 0.5) / labels.length) * (W - axis)} y={height + 17} textAnchor="middle" className="xlabel">{l}</text>
        ))}
      </svg>
    </div>
  );
};

export const Donut: React.FC<{ segments: Array<{ value: number; color: string }>; value: string; label: string; size?: number }> = ({
  segments,
  value,
  label,
  size = 140,
}) => {
  const stroke = 20;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0);
  const gap = segments.filter((s) => s.value > 0).length > 1 ? 3 : 0;
  let off = 0;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--track)" strokeWidth={stroke} fill="none" />
        {total > 0 &&
          segments.map((s, i) => {
            if (s.value <= 0) return null;
            const len = (s.value / total) * c;
            const el = (
              <circle key={i} cx={size / 2} cy={size / 2} r={r} stroke={s.color} strokeWidth={stroke} fill="none"
                strokeDasharray={`${Math.max(0, len - gap)} ${c}`} strokeDashoffset={-off} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
            );
            off += len;
            return el;
          })}
      </svg>
      <div className="ring-center">
        <b style={{ fontSize: 24 }}>{value}</b>
        <span style={{ fontSize: 11 }}>{label}</span>
      </div>
    </div>
  );
};

/* ---------- Status ---------- */

export function statusOf(a: Account): { label: string; cls: string } {
  if (!a.isActive) return { label: 'На паузе', cls: 'muted' };
  switch (a.latestSnapshot?.status || a.lastStatus) {
    case 'ok':
      return { label: 'Активен', cls: 'ok' };
    case 'reauth_required':
      return { label: 'Нужен вход', cls: 'bad' };
    case 'rate_limited':
      return { label: 'Пауза API', cls: 'warn' };
    case 'error':
      return { label: 'Ошибка', cls: 'bad' };
    case 'not_configured':
      return { label: 'Не подключён', cls: 'muted' };
    default:
      return { label: 'Обновление…', cls: 'muted' };
  }
}

export const StatusDot: React.FC<{ account: Account; pill?: boolean }> = ({ account, pill }) => {
  const s = statusOf(account);
  return (
    <span className={`status ${s.cls} ${pill ? 'pill' : ''}`}>
      <i />
      {s.label}
    </span>
  );
};

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map(([k, l]) => (
        <button key={k} className={k === value ? 'active' : ''} onClick={() => onChange(k)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/* ---------- Icons (tiny inline set) ---------- */

const ICON_PATHS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  users: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.15a3.5 3.5 0 0 1 0 6.7',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  plus: 'M12 5v14M5 12h14',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  back: 'M15 18l-6-6 6-6',
  arrowLeft: 'M19 12H5M12 19l-7-7 7-7',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  refresh: 'M21 12a9 9 0 0 1-15.4 6.4L3 16M3 12a9 9 0 0 1 15.4-6.4L21 8M21 3v5h-5M3 21v-5h5',
  chevron: 'M9 18l6-6-6-6',
  flame: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z',
  trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
  terminal: 'M4 17l6-6-6-6M12 19h8',
};

export const Icon: React.FC<{ name: keyof typeof ICON_PATHS | string; size?: number; stroke?: number }> = ({ name, size = 20, stroke = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={ICON_PATHS[name] || ''} />
  </svg>
);
