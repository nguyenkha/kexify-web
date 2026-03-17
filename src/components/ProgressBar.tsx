import { useState, useEffect, useRef } from "react";

/**
 * Time-based progress bar hook.
 *
 * - Linearly fills 0→99% over `totalMs`.
 * - When `done` flips to true, animates remaining → 100% over 1 second.
 * - If it reaches 99% before done, holds at 99% until done.
 * - Resets to 0 when `done` goes back to false (new operation).
 */
export function useProgressBar(totalMs: number, done: boolean): number {
  const [pct, setPct] = useState(0);
  const pctRef = useRef(0);
  const doneTriggered = useRef(false);
  const prevDone = useRef(done);

  // Keep ref in sync
  useEffect(() => {
    pctRef.current = pct;
  }, [pct]);

  // Reset when done goes from true → false (new operation)
  useEffect(() => {
    if (prevDone.current && !done) {
      setPct(0);
      pctRef.current = 0;
      doneTriggered.current = false;
    }
    prevDone.current = done;
  }, [done]);

  // Phase 1: linear 0→99 over totalMs
  useEffect(() => {
    if (done) return;
    const msPerPct = totalMs / 99;
    const iv = setInterval(() => {
      setPct((p) => {
        if (p >= 99) return 99;
        return p + 1;
      });
    }, msPerPct);
    return () => clearInterval(iv);
  }, [totalMs, done]);

  // Phase 2: when done, animate remaining → 100 over 1s
  useEffect(() => {
    if (!done || doneTriggered.current) return;
    doneTriggered.current = true;
    const startPct = pctRef.current;
    const remaining = 100 - startPct;
    if (remaining <= 0) {
      setPct(100);
      return;
    }
    const msPerPct = 1000 / remaining;
    const iv = setInterval(() => {
      setPct((p) => {
        if (p >= 100) {
          clearInterval(iv);
          return 100;
        }
        return p + 1;
      });
    }, msPerPct);
    return () => clearInterval(iv);
  }, [done]);

  return pct;
}

/** Signing: 4s base + 5s per additional signature */
export function signingDurationMs(signatureCount: number): number {
  return 4000 + Math.max(0, signatureCount - 1) * 5000;
}

/** Wallet creation: 8s */
export const CREATING_DURATION_MS = 8000;

/** Shared progress bar visual component */
export function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="w-full max-w-[240px] mx-auto">
      <div className="h-1.5 bg-surface-tertiary rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[10px] text-text-muted text-center mt-1.5">{pct}%</p>
    </div>
  );
}
