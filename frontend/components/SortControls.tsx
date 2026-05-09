'use client';

import { ArrowDownAZ, Clock, Layers, ListIcon } from 'lucide-react';
import clsx from 'clsx';

export type SortMode = 'time' | 'league';
export type GroupMode = 'flat' | 'by-league';

interface Props {
  sort: SortMode;
  onSortChange: (s: SortMode) => void;
  group: GroupMode;
  onGroupChange: (g: GroupMode) => void;
}

const SORTS: { key: SortMode; label: string; Icon: typeof Clock }[] = [
  { key: 'time', label: 'Time', Icon: Clock },
  { key: 'league', label: 'League', Icon: ArrowDownAZ },
];

const GROUPS: { key: GroupMode; label: string; Icon: typeof ListIcon }[] = [
  { key: 'flat', label: 'Flat', Icon: ListIcon },
  { key: 'by-league', label: 'Group', Icon: Layers },
];

function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { key: T; label: string; Icon: typeof Clock }[];
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.12em] text-white/35 font-semibold">
        {label}
      </span>
      <div className="inline-flex items-center bg-white/[0.03] border border-white/[0.08] rounded-lg p-0.5">
        {options.map(({ key, label, Icon }) => {
          const active = value === key;
          return (
            <button
              key={key}
              onClick={() => onChange(key)}
              className={clsx(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition-all',
                active
                  ? 'bg-white/10 text-white shadow-sm'
                  : 'text-white/55 hover:text-white/85',
              )}
            >
              <Icon className="w-3 h-3" />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SortControls({ sort, onSortChange, group, onGroupChange }: Props) {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <Segmented value={sort} onChange={onSortChange} options={SORTS} label="Sort" />
      <Segmented value={group} onChange={onGroupChange} options={GROUPS} label="View" />
    </div>
  );
}
