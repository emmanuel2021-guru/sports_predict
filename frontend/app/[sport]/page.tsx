'use client';

import { useParams } from 'next/navigation';
import { notFound } from 'next/navigation';
import { SlateView } from '@/components/SlateView';
import type { SportKey } from '@/lib/types';

const VALID_SPORTS: SportKey[] = ['football', 'basketball', 'tennis'];

export default function SportPage() {
  const params = useParams<{ sport: string }>();
  const sport = params.sport as SportKey;
  if (!VALID_SPORTS.includes(sport)) {
    notFound();
  }
  return <SlateView sport={sport} />;
}
