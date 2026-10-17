import type { ClipEvent } from './catalog.ts';

/**
 * Clip clocks for the fixed 30 Hz step. The runtime owns every clip's time
 * (AnimationMixer only evaluates), so events and contacts depend on simulation
 * time alone, never on the render rate or a cat's reduced animation rate.
 */
export function advanceTime(time: number, step: number, duration: number, loop: boolean): number {
  if (duration <= 0) return 0;
  const next = time + step;
  if (loop) return next - Math.floor(next / duration) * duration;
  return Math.min(duration, Math.max(0, next));
}

function visitRange(events: readonly ClipEvent[], start: number, end: number, inclusiveStart: boolean, visit: (event: ClipEvent) => void): number {
  let count = 0;
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if ((inclusiveStart ? event.t >= start : event.t > start) && event.t <= end) { visit(event); count++; }
  }
  return count;
}

/**
 * Calls `visit` for every event whose time lies in (from, from + step]; with
 * `fromStart`, an event at exactly `from` fires too (a clip that has just
 * started). Looping clips wrap, so an event at 0 fires on every loop.
 * Returns the number of events visited.
 */
export function visitCrossedEvents(
  events: readonly ClipEvent[], from: number, step: number, duration: number, loop: boolean,
  fromStart: boolean, visit: (event: ClipEvent) => void,
): number {
  if (!events.length || duration <= 0 || step < 0) return 0;
  if (!loop) return from < duration || fromStart ? visitRange(events, from, Math.min(duration, from + step), fromStart, visit) : 0;
  let count = 0, start = from, remaining = step, inclusive = fromStart;
  // A long step can cover several loops; cap the work at four.
  for (let guard = 0; guard < 4; guard++) {
    const end = start + remaining;
    if (end < duration) { count += visitRange(events, start, end, inclusive, visit); break; }
    count += visitRange(events, start, duration, inclusive, visit);
    remaining = end - duration; start = 0; inclusive = true;
    if (remaining <= 0) break;
  }
  return count;
}
