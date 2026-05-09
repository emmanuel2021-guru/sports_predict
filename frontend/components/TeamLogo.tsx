'use client';

import { useState } from 'react';
import clsx from 'clsx';

interface Props {
  teamId: number;
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_MAP = { sm: 28, md: 36, lg: 56 } as const;

/** Deterministic gradient from a string — used as fallback when logo fails to load. */
function colorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `linear-gradient(135deg, hsl(${hue}, 60%, 35%) 0%, hsl(${(hue + 40) % 360}, 60%, 25%) 100%)`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export function TeamLogo({ teamId, name, size = 'md', className }: Props) {
  const px = SIZE_MAP[size];
  const [failed, setFailed] = useState(false);

  if (failed || !teamId) {
    return (
      <div
        className={clsx(
          'flex items-center justify-center rounded-full text-white font-bold ring-1 ring-white/10 shrink-0',
          className,
        )}
        style={{ width: px, height: px, fontSize: px * 0.36, background: colorFromName(name) }}
        aria-label={name}
      >
        {initials(name)}
      </div>
    );
  }

  return (
    <img
      src={`https://api.sofascore.com/api/v1/team/${teamId}/image`}
      alt={name}
      width={px}
      height={px}
      onError={() => setFailed(true)}
      className={clsx(
        'rounded-full bg-white/[0.04] ring-1 ring-white/10 object-contain shrink-0',
        className,
      )}
      style={{ width: px, height: px, padding: px * 0.08 }}
    />
  );
}
