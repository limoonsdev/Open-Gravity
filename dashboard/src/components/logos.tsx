'use client';
import { LOGOS } from '@/lib/logos';
import { cn } from '@/lib/format';

const BASE = '/ui/logos';

/** The Open Gravity mark (inline so it renders instantly, no request). */
export function AppLogo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" className={className} aria-hidden>
      <defs>
        <linearGradient id="al-bg" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#2a1d6b" />
          <stop offset="0.5" stopColor="#140f38" />
          <stop offset="1" stopColor="#070914" />
        </linearGradient>
        <radialGradient id="al-core" cx="0.36" cy="0.3" r="0.78">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.22" stopColor="#ddd6fe" />
          <stop offset="0.55" stopColor="#8b5cf6" />
          <stop offset="0.85" stopColor="#4c1d95" />
          <stop offset="1" stopColor="#2e1065" />
        </radialGradient>
        <linearGradient id="al-ring" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="0.5" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#f472b6" />
        </linearGradient>
        <radialGradient id="al-sat" cx="0.35" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor="#f9a8d4" />
          <stop offset="1" stopColor="#db2777" />
        </radialGradient>
      </defs>
      <rect x="24" y="24" width="976" height="976" rx="228" fill="url(#al-bg)" />
      <rect x="26" y="26" width="972" height="972" rx="226" fill="none" stroke="#fff" strokeOpacity="0.1" strokeWidth="4" />
      <g transform="rotate(-24 512 512)">
        <ellipse cx="512" cy="512" rx="370" ry="124" fill="none" stroke="url(#al-ring)" strokeWidth="34" opacity="0.4" />
      </g>
      <circle cx="512" cy="512" r="196" fill="url(#al-core)" />
      <g transform="rotate(-24 512 512)">
        <path d="M142 512 A370 124 0 0 0 882 512" fill="none" stroke="url(#al-ring)" strokeWidth="34" />
      </g>
      <circle cx="847" cy="409" r="44" fill="url(#al-sat)" />
    </svg>
  );
}

/**
 * Logo of a provider type or a tool ("tool-<id>"). Monochrome logos follow the
 * text colour (CSS mask) so they stay visible in both themes; unknown ones get
 * a letter tile in the brand colour.
 */
export function ProviderLogo({ type, name, color, size = 36, className, rounded = 'rounded-[11px]' }: {
  type: string; name: string; color?: string; size?: number; className?: string; rounded?: string;
}) {
  const kind = LOGOS[type];
  const inner = Math.round(size * 0.58);
  if (!kind) {
    return (
      <span
        className={cn('inline-flex shrink-0 items-center justify-center font-semibold text-white shadow-sm', rounded, className)}
        style={{ width: size, height: size, background: `linear-gradient(135deg, ${color || '#64748b'}, color-mix(in oklab, ${color || '#64748b'} 70%, black))`, fontSize: size * 0.42 }}
        aria-hidden
      >
        {(name.trim()[0] || '?').toUpperCase()}
      </span>
    );
  }
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center bg-surface-2 ring-1 ring-line', rounded, className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {kind === 'color' ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`${BASE}/${type}.svg`} alt="" width={inner} height={inner} loading="lazy" decoding="async" />
      ) : (
        <span className="logo-mask text-fg" style={{ width: inner, height: inner, WebkitMaskImage: `url(${BASE}/${type}.svg)`, maskImage: `url(${BASE}/${type}.svg)` }} />
      )}
    </span>
  );
}
