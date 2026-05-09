'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { RefreshCw, AlertTriangle, Brain } from 'lucide-react';
import { api } from '@/lib/api';

type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

type Rates = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

type StreamEvent =
  | { type: 'open'; model: string; thinking: string; rates: Rates }
  | { type: 'meta'; inputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }
  | { type: 'thinking'; chars: number }
  | { type: 'chunk'; text: string }
  | { type: 'done'; stopReason: string | null; fullText: string; usage: Usage; costUsd: number }
  | { type: 'error'; message: string };

// Reset on any received event. If 30s pass with no events at all (not even a
// thinking heartbeat), the backend is wedged.
const NO_ACTIVITY_TIMEOUT_MS = 30_000;

// Fallback rates if the backend doesn't send them (Sonnet 4.6).
const DEFAULT_RATES: Rates = {
  input: 3.0,
  output: 15.0,
  cacheRead: 0.30,
  cacheWrite: 3.75,
};

function estimateCost(
  rates: Rates,
  p: {
    inputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    outputTokensEstimate: number;
  },
): number {
  return (
    (p.inputTokens * rates.input +
      p.cacheReadTokens * rates.cacheRead +
      p.cacheCreationTokens * rates.cacheWrite +
      p.outputTokensEstimate * rates.output) /
    1_000_000
  );
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `${(usd * 100).toFixed(2)}¢`;
  return `$${usd.toFixed(3)}`;
}

interface Props {
  matchId: string;
  /** When the user re-fetches the parent /api/match endpoint, increment this to retrigger */
  refreshKey: number;
}

export function ClaudeAnalysis({ matchId, refreshKey }: Props) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'streaming' | 'done' | 'error' | 'empty'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stopReason, setStopReason] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingChars, setThinkingChars] = useState(0);
  const [meta, setMeta] = useState<{ inputTokens: number; cacheReadTokens: number; cacheCreationTokens: number } | null>(null);
  const [rates, setRates] = useState<Rates>(DEFAULT_RATES);
  const [model, setModel] = useState<string | null>(null);
  const [finalCost, setFinalCost] = useState<number | null>(null);
  const [finalUsage, setFinalUsage] = useState<Usage | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Live cost estimate during streaming. Switches to exact final cost on 'done'.
  const liveCostEstimate = (() => {
    if (finalCost !== null) return finalCost;
    if (!meta) return null;
    // ~4 chars per token in English. Output tokens = thinking + visible text.
    const outputTokensEstimate = (thinkingChars + text.length) / 4;
    return estimateCost(rates, {
      inputTokens: meta.inputTokens,
      cacheReadTokens: meta.cacheReadTokens,
      cacheCreationTokens: meta.cacheCreationTokens,
      outputTokensEstimate,
    });
  })();

  useEffect(() => {
    setText('');
    setStatus('streaming');
    setErrorMessage(null);
    setStopReason(null);
    setIsThinking(false);
    setThinkingChars(0);
    setMeta(null);
    setRates(DEFAULT_RATES);
    setModel(null);
    setFinalCost(null);
    setFinalUsage(null);

    let receivedAnyText = false;
    let finalized = false;
    let activityTimeout: ReturnType<typeof setTimeout> | null = null;
    const es = new EventSource(api.claudeStreamUrl(matchId));
    eventSourceRef.current = es;

    const resetActivityTimeout = () => {
      if (activityTimeout) clearTimeout(activityTimeout);
      activityTimeout = setTimeout(() => {
        if (!finalized) {
          setStatus('error');
          setErrorMessage(
            'Backend went silent for 30 seconds — no thinking heartbeat or text. The backend may be wedged or the API key may be invalid.',
          );
          es.close();
        }
      }, NO_ACTIVITY_TIMEOUT_MS);
    };

    // Arm the initial timeout — backend should send the 'open' event almost immediately.
    resetActivityTimeout();

    es.onmessage = (ev) => {
      try {
        const data: StreamEvent = JSON.parse(ev.data);
        // Any event resets the activity timer — we know the backend is alive.
        resetActivityTimeout();

        if (data.type === 'open') {
          if (data.rates) setRates(data.rates);
          if (data.model) setModel(data.model);
        } else if (data.type === 'meta') {
          setMeta({
            inputTokens: data.inputTokens,
            cacheReadTokens: data.cacheReadTokens,
            cacheCreationTokens: data.cacheCreationTokens,
          });
        } else if (data.type === 'thinking') {
          setIsThinking(true);
          setThinkingChars(data.chars);
        } else if (data.type === 'chunk') {
          receivedAnyText = true;
          setIsThinking(false);
          setText((prev) => prev + data.text);
        } else if (data.type === 'done') {
          finalized = true;
          if (activityTimeout) clearTimeout(activityTimeout);
          setIsThinking(false);
          setStopReason(data.stopReason);
          setFinalUsage(data.usage);
          setFinalCost(data.costUsd);
          setStatus(data.fullText.trim() ? 'done' : 'empty');
          es.close();
        } else if (data.type === 'error') {
          finalized = true;
          if (activityTimeout) clearTimeout(activityTimeout);
          setIsThinking(false);
          setErrorMessage(data.message);
          setStatus('error');
          es.close();
        }
      } catch (err) {
        console.error('Failed to parse SSE event', err);
      }
    };

    es.onerror = () => {
      // EventSource auto-retries on transient drops. Only escalate if we
      // never received any data AND we haven't already finalized.
      if (!receivedAnyText && !finalized) {
        setStatus('error');
        setErrorMessage('Connection lost. Make sure the backend is running on localhost:8000.');
        if (activityTimeout) clearTimeout(activityTimeout);
        es.close();
      }
    };

    return () => {
      if (activityTimeout) clearTimeout(activityTimeout);
      es.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, refreshKey, reloadTick]);

  const retry = () => setReloadTick((t) => t + 1);

  return (
    <div className="glass p-6 animate-slide-up">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Brain className="w-5 h-5 text-indigo-400 shrink-0" />
          <h2 className="text-lg font-bold tracking-tight">AI Analyst Read</h2>
          {status === 'streaming' && !isThinking && text !== '' && (
            <span className="text-xs text-indigo-300/80 font-medium ml-2 animate-pulse-slow">
              ● Streaming…
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {liveCostEstimate !== null && (
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold border bg-white/[0.04] border-white/10 text-white/70"
              title={
                finalUsage
                  ? `${model ?? 'claude'} · Input: ${finalUsage.inputTokens} · Output: ${finalUsage.outputTokens} · Cache read: ${finalUsage.cacheReadTokens} · Cache write: ${finalUsage.cacheCreationTokens}`
                  : `${model ?? 'claude'} · Live estimate — refines on completion`
              }
            >
              <span className="text-white/40">{finalCost !== null ? '' : '≈'}</span>
              <span className="text-emerald-300">{formatCost(liveCostEstimate)}</span>
              {model && (
                <span className="text-white/35 text-[10px] hidden sm:inline ml-1">
                  · {model.replace('claude-', '').replace('-', ' ')}
                </span>
              )}
            </span>
          )}
          {(status === 'done' || status === 'empty' || status === 'error') && (
            <button onClick={retry} className="btn !py-1.5 !text-xs">
              <RefreshCw className="w-3.5 h-3.5" />
              Regenerate
            </button>
          )}
        </div>
      </div>

      {status === 'streaming' && text === '' && !isThinking && (
        <div className="text-white/50 text-sm flex items-center gap-2 py-4">
          <div className="w-4 h-4 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
          Connecting to Claude…
        </div>
      )}

      {status === 'streaming' && text === '' && isThinking && (
        <div className="flex items-center gap-3 py-4">
          <div className="flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse [animation-delay:0ms]"></span>
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse [animation-delay:200ms]"></span>
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse [animation-delay:400ms]"></span>
          </div>
          <div className="text-white/65 text-sm">
            Claude is reading the matchup…
            <span className="text-white/35 ml-2 font-mono text-xs">
              {(thinkingChars / 1000).toFixed(1)}k thinking tokens
            </span>
          </div>
        </div>
      )}

      {text && (
        <div className="prose-claude">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          {status === 'streaming' && <span className="streaming-cursor" />}
        </div>
      )}

      {status === 'empty' && (
        <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-200">
            Claude returned an empty response{stopReason ? ` (stop_reason: ${stopReason})` : ''}.
            {' '}This usually clears on retry.
          </div>
        </div>
      )}

      {status === 'error' && errorMessage && (
        <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="text-sm text-red-200">{errorMessage}</div>
        </div>
      )}
    </div>
  );
}
