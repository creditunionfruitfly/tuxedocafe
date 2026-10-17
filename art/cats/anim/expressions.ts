// Morph-weight curves (time -> weight 0..1) for every catalogued expression,
// plus curve sets keyed by clip name for clips that list morphs. Shapes that
// also drive bones (the yawn and hiss jaw, ear flattening) are shared with
// the clip code so mouth morphs and jaw rotation stay in step.
import type { Catalog } from './catalog.ts';
import { bump, clamp, curve, smooth } from './math.ts';

export const EXPRESSION_FPS = 60;

/** Yawn: slow build, very wide hold, quick close, then a small lip lick (shared with the jaw). */
export const yawnOpen = curve([[0, 0], [0.22, 0.06], [0.46, 0.82], [0.62, 1], [0.96, 0.94], [1.12, 0.1], [1.2, 0], [1.6, 0]]);
export const yawnLick = (t: number) => 0.14 * (bump(t, 1.22, 1.28, 1.3, 1.36) + 0.7 * bump(t, 1.38, 1.43, 1.45, 1.5));
/** Hiss: mouth snaps open, holds wide, eases toward a guarded gape (shared with the jaw). */
export const hissOpen = curve([[0, 0], [0.15, 0.1], [0.24, 1], [0.85, 0.9], [1.05, 0.25], [1.2, 0.15]]);
/** Ears flattening during the hiss (shared with the ear bones). */
export const hissEars = curve([[0, 0], [0.12, 0.85], [0.2, 1], [0.95, 1], [1.2, 0.7]]);
/** Slow blink (trust signal): slow close, about half a second closed, slow open. */
export const slowBlink = curve([[0, 0], [0.2, 0.12], [0.55, 0.85], [0.68, 1], [1.18, 1], [1.4, 0.7], [1.8, 0]]);

type Curve = [number, number][];
const sample = (f: (t: number) => number, T: number, fps = EXPRESSION_FPS): Curve => {
  const n = Math.max(2, Math.round(T * fps));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * T;
    return [Math.round(t * 10000) / 10000, Math.round(clamp(f(t), 0, 1) * 10000) / 10000];
  });
};
/** Attack, hold and release envelope over T with an eased rise and a slower fall. */
const envelope = (T: number, attack: number, release: number, peak = 1) => (t: number) =>
  peak * smooth(t / attack) * (1 - smooth((t - (T - release)) / release));

/** A curve that starts `delay` seconds late but still ends at T (the trailing eye or ear). */
const lagged = (f: (t: number) => number, delay: number, T: number) => (t: number) => t <= delay ? f(0) : f((t - delay) * T / (T - delay));

/** Expression shapes by catalog name: per-morph functions of time. */
function expressionCurves(name: string, T: number): Record<string, (t: number) => number> | null {
  switch (name) {
    case 'blink': {
      // Upper lid drops fast, a two-frame hold, then opens a little slower; the right eye trails by a hair.
      const f = curve([[0, 0], [0.02, 0.15], [0.055, 1], [0.075, 1], [0.13, 0.35], [0.18, 0]]);
      return { blink_L: f, blink_R: lagged(f, 0.006, T) };
    }
    case 'slow_blink': { const f = (t: number) => slowBlink(t * 1.8 / T); return { blink_L: f, blink_R: lagged(f, 0.02, T) }; }
    case 'squint_content': {
      const f = curve([[0, 0], [0.35, 0.5], [0.9, 0.62], [1.4, 0.56], [1.75, 0.3], [2.0, 0]]);
      const g = (t: number) => f(t * 2 / T); return { squint_L: g, squint_R: lagged(g, 0.03, T) };
    }
    case 'ears_flat': { const f = envelope(T, 0.12, 0.14); return { earFlatten_L: f, earFlatten_R: lagged(f, 0.015, T) }; }
    case 'whiskers_forward': return { whiskerForward: envelope(T, 0.14, 0.18) };
    case 'whiskers_back': return { whiskerBack: envelope(T, 0.1, 0.18) };
    case 'snarl': return { noseWrinkle: envelope(T, 0.1, 0.18), mouthOpen: lagged(envelope(T, 0.12, 0.16, 0.85), 0.06, T) };
    case 'flehmen': {
      // Grimace: the upper lip lifts (nose wrinkle) and the mouth hangs slightly open, held while scenting.
      return { noseWrinkle: envelope(T, 0.3, 0.3, 0.9), mouthOpen: lagged(envelope(T, 0.35, 0.25, 0.4), 0.08, T) };
    }
    default: return null;
  }
}

/** Curve sets for clips that list morphs (their bone motion uses the same shapes). */
function clipCurves(name: string): Record<string, (t: number) => number> | null {
  switch (name) {
    case 'cat.rest.yawn': {
      const squint = curve([[0, 0], [0.3, 0.2], [0.5, 0.9], [1.0, 1], [1.18, 0.3], [1.35, 0], [1.6, 0]]);
      return { mouthOpen: (t: number) => yawnOpen(t) + 0.6 * yawnLick(t), squint_L: squint, squint_R: (t: number) => squint(t - 0.02) };
    }
    case 'cat.social.slow_blink': return { blink_L: slowBlink, blink_R: (t: number) => slowBlink(t - 0.02) };
    case 'cat.react.hiss': return {
      mouthOpen: hissOpen, noseWrinkle: (t: number) => 0.95 * hissOpen(t + 0.04),
      earFlatten_L: hissEars, earFlatten_R: (t: number) => hissEars(t - 0.01),
    };
    case 'cat.layer.ears_back': {
      // Held flat with a slight restless flutter that closes on the 1 s loop.
      const f = (t: number) => 0.86 + 0.06 * Math.sin(2 * Math.PI * t) + 0.02 * Math.sin(4 * Math.PI * t + 1);
      return { earFlatten_L: f, earFlatten_R: (t: number) => f(t + 0.13) };
    }
    default: return null;
  }
}

export function makeExpressions(catalog: Catalog) {
  const problems: string[] = [];
  const known = new Set(catalog.morphTargets);
  const expressions = catalog.expressions.map(e => {
    const fns = expressionCurves(e.name, e.durationS);
    if (!fns) { problems.push(`no curves for expression ${e.name}`); return null; }
    for (const m of e.morphs) if (!fns[m]) problems.push(`expression ${e.name} lacks morph ${m}`);
    for (const m of Object.keys(fns)) if (!e.morphs.includes(m) || !known.has(m)) problems.push(`expression ${e.name} drives uncatalogued morph ${m}`);
    const curves = Object.fromEntries(Object.entries(fns).map(([m, f]) => [m, sample(f, e.durationS)]));
    return { name: e.name, durationS: e.durationS, morphs: e.morphs, curves };
  }).filter(x => x !== null);
  const clips: Record<string, { durationS: number; loop: boolean; morphs: string[]; curves: Record<string, Curve> }> = {};
  for (const c of catalog.clips.filter(c => c.morphs?.length)) {
    const fns = clipCurves(c.name);
    if (!fns) { problems.push(`no morph curves for clip ${c.name}`); continue; }
    for (const m of c.morphs!) if (!fns[m]) problems.push(`clip ${c.name} lacks morph ${m}`);
    for (const m of Object.keys(fns)) if (!c.morphs!.includes(m) || !known.has(m)) problems.push(`clip ${c.name} drives uncatalogued morph ${m}`);
    const curves = Object.fromEntries(Object.entries(fns).map(([m, f]) => [m, sample(f, c.durationS)]));
    if (c.loop) for (const [m, k] of Object.entries(curves)) if (Math.abs(k[0]![1] - k[k.length - 1]![1]) > 1e-3) problems.push(`clip ${c.name} ${m} does not loop`);
    clips[c.name] = { durationS: c.durationS, loop: c.loop, morphs: c.morphs!, curves };
  }
  for (const e of expressions) for (const [m, k] of Object.entries(e.curves)) {
    if (k[0]![1] > 1e-3 || k[k.length - 1]![1] > 1e-3) problems.push(`expression ${e.name} ${m} must start and end at rest`);
    if (!k.some(([, w]) => w > 0.3)) problems.push(`expression ${e.name} ${m} barely moves`);
  }
  if (problems.length) throw new Error(`cat expressions:\n  - ${problems.join('\n  - ')}`);
  return {
    version: 1, fps: EXPRESSION_FPS,
    notes: 'Morph-target weight curves as [seconds, weight] keys (linear between keys). expressions: one-shot shapes by catalog expression name (start and end at rest). clips: curves to play with the bone clip of the same name.',
    morphTargets: catalog.morphTargets, expressions, clips,
  };
}
