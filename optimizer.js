/* =====================================================================
   optimizer.js — Robust testing and automatic tuning
   ---------------------------------------------------------------------
   Problem: rules tuned on ONE recording per situation can "memorize"
   those recordings and fail on slightly different ones.

   Fix (the way engineers do it):
     1. Build a PRACTICE set: 6 situations × 10 variations = 60 recordings
        with different speeds, step strengths, phone positions, sensor
        noise, shaking styles and roads.
     2. Search for the rules that do best on the practice set.
     3. Check those rules on a separate set of NEW, UNSEEN recordings.
        A good algorithm scores well on recordings it was never tuned on.

   Everything is driven by one seed number, so the same seed always
   produces the same recordings and the same results (reproducible).
   ===================================================================== */
(function (global) {
  "use strict";

function createOPT(SIM, DETECT) {
  "use strict";

  // The six situations and how much each one is allowed to vary.
  const SCENARIOS = [
    { id: "walk",   name: "Walking",           kind: "walk",  speed: [1.5, 2.1],  strength: [4.5, 6.5], nominal: { speed: 1.8, strength: 5.5 } },
    { id: "run",    name: "Running",           kind: "run",   speed: [2.5, 3.1],  strength: [7.5, 10],  nominal: { speed: 2.8, strength: 9 } },
    { id: "gentle", name: "Gentle walker",     kind: "walk",  speed: [1.0, 1.4],  strength: [2.5, 3.5], nominal: { speed: 1.2, strength: 3 } },
    { id: "heavy",  name: "Slow, heavy steps", kind: "walk",  speed: [0.9, 1.15], strength: [7, 9],     nominal: { speed: 1.0, strength: 8 } },
    { id: "shake",  name: "Shaking it",        kind: "shake", freq: [1.6, 3.0],   amp: [4, 9],          nominal: { freq: 2.0, amp: 7 } },
    { id: "bus",    name: "Bumpy bus",         kind: "bus",   bumpiness: [0.6, 1.5], sway: [0.5, 1.5],  nominal: { bumpiness: 1, sway: 1 } }
  ];
  const ORIENTS = Object.keys(SIM.ORIENTATIONS);
  const ORIENT_WORD = { pocket: "pocket", hand: "hand", bag: "bag" };

  // Repeatable random numbers (mulberry32): same seed → same sequence.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- 1. Build a set of test recordings ---------- */
  // includeNominal: variation #1 of each situation is the standard one used in the tour.
  function makeTestSet(seed, perScenario, includeNominal) {
    const r = rng(seed);
    const recordings = [];
    for (const sc of SCENARIOS) {
      for (let v = 0; v < perScenario; v++) {
        // Draw every random value every time, so the sequence never shifts.
        const draw = {
          orientation: ORIENTS[Math.floor(r() * ORIENTS.length)],
          noise: 0.05 + r() * 0.3,
          seed: Math.floor(r() * 1e6),
          a: r(), b: r()
        };
        const nominal = includeNominal && v === 0;
        const opts = nominal ? { orientation: "pocket" } : { orientation: draw.orientation, noise: draw.noise, seed: draw.seed };
        let label;
        if (sc.kind === "walk" || sc.kind === "run") {
          opts.person = nominal ? sc.nominal : { speed: sc.speed[0] + draw.a * (sc.speed[1] - sc.speed[0]), strength: sc.strength[0] + draw.b * (sc.strength[1] - sc.strength[0]) };
          label = `${(opts.person.speed * 60).toFixed(0)} steps/min, strength ${opts.person.strength.toFixed(1)}`;
        } else if (sc.kind === "shake") {
          opts.shake = nominal ? sc.nominal : { freq: sc.freq[0] + draw.a * (sc.freq[1] - sc.freq[0]), amp: sc.amp[0] + draw.b * (sc.amp[1] - sc.amp[0]) };
          label = `${opts.shake.freq.toFixed(1)} shakes/s, strength ${opts.shake.amp.toFixed(1)}`;
        } else {
          opts.vehicle = nominal ? sc.nominal : { bumpiness: sc.bumpiness[0] + draw.a * (sc.bumpiness[1] - sc.bumpiness[0]), sway: sc.sway[0] + draw.b * (sc.sway[1] - sc.sway[0]) };
          label = `road roughness ${opts.vehicle.bumpiness.toFixed(1)}×, sway ${opts.vehicle.sway.toFixed(1)}×`;
        }
        const noiseText = nominal ? "standard" : opts.noise > 0.25 ? "noisy sensor" : opts.noise > 0.15 ? "some noise" : "clean sensor";
        label += `, ${ORIENT_WORD[opts.orientation]}, ${noiseText}`;
        const sig = SIM.generate(sc.kind, opts);
        recordings.push({ scenario: sc.id, name: sc.name, variant: v + 1, nominal, label,
                          peaks: DETECT.preprocessAll(sig).peaks, stepTimes: sig.stepTimes });
      }
    }
    return { seed, perScenario, recordings };
  }

  /* ---------- 2. Score one recording (0–100) ----------
     Stage 1 keeps the existing scoring rule:
       with real steps:  100 × (1 − (fake + missed) ÷ real steps)
       with no steps:    100 × (1 − fake ÷ 20)
     (Stage 2 will replace this with precision, recall and F1.) */
  function recordingScore(e) {
    return e.truth ? 100 * Math.max(0, 1 - (e.fp + e.fn) / e.truth) : 100 * Math.max(0, 1 - e.fp / 20);
  }

  function runOne(rules, rec) {
    const e = DETECT.evaluate(DETECT.decideAll(rec.peaks, rules).events, rec.stepTimes);
    return { counted: e.counted, truth: e.truth, tp: e.tp, fp: e.fp, fn: e.fn, score: recordingScore(e) };
  }

  /* ---------- 3. Test one set of rules on every recording ---------- */
  function evaluate(rules, set) {
    const byScenario = {}, all = [];
    for (const rec of set.recordings) {
      const res = runOne(rules, rec);
      const row = byScenario[rec.scenario] || (byScenario[rec.scenario] = { id: rec.scenario, name: rec.name, n: 0, sum: 0, worst: null, counted: 0, truth: 0, fp: 0, fn: 0 });
      row.n++; row.sum += res.score; row.counted += res.counted; row.truth += res.truth; row.fp += res.fp; row.fn += res.fn;
      if (!row.worst || res.score < row.worst.score) row.worst = { score: res.score, variant: rec.variant, label: rec.label };
      all.push({ ...res, name: rec.name, variant: rec.variant, label: rec.label });
    }
    const scenarios = SCENARIOS.filter(s => byScenario[s.id]).map(s => { const r = byScenario[s.id]; r.avg = r.sum / r.n; return r; });
    const scores = all.map(a => a.score);
    const average = scores.reduce((a, b) => a + b, 0) / scores.length;
    const spread = Math.sqrt(scores.reduce((a, b) => a + (b - average) ** 2, 0) / scores.length);
    const worst = all.reduce((a, b) => b.score < a.score ? b : a);
    const worstScenario = scenarios.reduce((a, b) => b.avg < a.avg ? b : a);
    return { recordings: all.length, average, spread, worst, worstScenario, scenarios };
  }

  // A faster version used inside the search: only the numbers needed to rank rules.
  function quickScore(rules, set) {
    let sum = 0, worst = 100;
    for (const rec of set.recordings) { const s = runOne(rules, rec).score; sum += s; if (s < worst) worst = s; }
    return { average: sum / set.recordings.length, worst };
  }
  const better = (a, b) => !b || a.average > b.average + 1e-9 || (Math.abs(a.average - b.average) <= 1e-9 && a.worst > b.worst);

  /* ---------- 4. Search for the best rules (coarse grid, then zoom in) ----------
     Fixed rules: a coarse grid of 35 line heights × 33 waits × rhythm on/off
     (2,310 settings), then a fine search around the 8 best. Much faster than
     trying all 13,932 fine settings, and in practice it finds the same top area.
     Adaptive rules: every line height from 30% to 90% × rhythm on/off. */
  function search(set, onProgress) {
    const coarse = [];
    for (let th = 0.5; th <= 9.001; th += 0.25) for (let gap = 0; gap <= 800; gap += 25) for (const rhythm of [false, true])
      coarse.push({ mode: "fixed", threshold: +th.toFixed(2), gap, sensitivity: 0.6, rhythm });
    const adaptiveList = [];
    for (let s = 0.3; s <= 0.901; s += 0.05) for (const rhythm of [false, true])
      adaptiveList.push({ mode: "adaptive", threshold: 1.5, gap: 300, sensitivity: +s.toFixed(2), rhythm });

    const total = coarse.length + 8 * 25 + adaptiveList.length;
    let done = 0;
    const tick = () => { done++; if (onProgress && done % 50 === 0) onProgress(done, total); };

    const ranked = [];
    for (const rules of coarse) { ranked.push({ rules, ...quickScore(rules, set) }); tick(); }
    ranked.sort((a, b) => b.average - a.average || b.worst - a.worst);

    let bestFixed = null; const seen = new Set();
    for (const top of ranked.slice(0, 8)) {
      for (let dt = -0.2; dt <= 0.201; dt += 0.1) for (let dg = -20; dg <= 20; dg += 10) {
        const rules = { ...top.rules, threshold: +Math.max(0.5, top.rules.threshold + dt).toFixed(1), gap: Math.max(0, top.rules.gap + dg) };
        const key = `${rules.threshold}|${rules.gap}|${rules.rhythm}`;
        tick(); if (seen.has(key)) continue; seen.add(key);
        const s = { rules, ...quickScore(rules, set) };
        if (better(s, bestFixed)) bestFixed = s;
      }
    }
    let bestAdaptive = null;
    for (const rules of adaptiveList) { const s = { rules, ...quickScore(rules, set) }; if (better(s, bestAdaptive)) bestAdaptive = s; tick(); }
    if (onProgress) onProgress(total, total);
    return { fixed: bestFixed.rules, adaptive: bestAdaptive.rules, tested: coarse.length + seen.size + adaptiveList.length };
  }

  /* ---------- 5. The full experiment ---------- */
  function runExperiment({ seed, perScenario }, onProgress) {
    const t0 = Date.now();
    const practice = makeTestSet(seed, perScenario, true);
    const unseen = makeTestSet(seed + 7919, perScenario, false);           // different seed: new recordings
    const single = { seed, perScenario: 1, recordings: practice.recordings.filter(r => r.nominal) };

    const report = (phase, weight, offset) => (d, t) => onProgress && onProgress({ phase, fraction: offset + weight * d / t });
    const robust = search(practice, report("Tuning on 60 practice recordings", 0.85, 0));
    const naive = search(single, report("Tuning on 1 recording per situation", 0.15, 0.85));

    const pack = rules => ({ rules, practice: evaluate(rules, practice), unseen: evaluate(rules, unseen) });
    return {
      seed, perScenario,
      practiceCount: practice.recordings.length, unseenCount: unseen.recordings.length,
      tested: robust.tested + naive.tested,
      fixed: pack(robust.fixed),
      adaptive: pack(robust.adaptive),
      naive: { rules: naive.fixed, single: evaluate(naive.fixed, single), unseen: evaluate(naive.fixed, unseen) },
      ms: Date.now() - t0
    };
  }

  return { SCENARIOS, rng, makeTestSet, recordingScore, evaluate, quickScore, search, runExperiment };
}

  if (typeof module !== "undefined" && module.exports) module.exports = { createOPT };
  else global.createOPT = createOPT;
})(typeof window !== "undefined" ? window : globalThis);
