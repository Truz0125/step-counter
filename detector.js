/* =====================================================================
   detector.js — How the phone turns X/Y/Z readings into steps
   ---------------------------------------------------------------------
   The SAME code runs on simulated data and on your real phone's sensor.
   It works one reading at a time ("streaming"), like a real phone:

     X,Y,Z ─► 1. strength  √(x²+y²+z²)      works however the phone is held
           ─► 2. remove gravity              subtract a slow running average
           ─► 3. low-pass filter (5 Hz)      remove fast jitter and engine buzz
           ─► 4. find peaks                  tops of bumps that clearly stand out
           ─► 5. decide: is this peak a step?
                 Rule 1  big enough?          fixed line, or adaptive line
                 Rule 2  not too soon?        fixed wait, or based on your rhythm
                 Rule 3  steady rhythm?       5 steady steps before counting
   ===================================================================== */
(function (global) {
  "use strict";

// Everything lives inside createDETECT() so the optimizer's background worker
// can build its own copy of the detector from this exact same code.
function createDETECT() {
  "use strict";
  const SETTINGS = {
    gravitySeconds: 1.0,   // how slowly the gravity estimate follows the signal
    cutoffHz: 5,           // low-pass filter: keep slower changes than this
    windowSeconds: 2.0,    // how far back the adaptive line looks
    minProminence: 0.3,    // a peak must rise this much above the dip before it (m/s²)
    floor: 1.0,            // adaptive line never drops below this (ignore tiny wobbles)
    rhythmSteps: 5,        // steady steps needed before Rule 3 starts counting
    rhythmTolerance: 0.3,  // a gap may differ this much (30%) from the usual gap
    matchSeconds: 0.15     // for scoring: a counted step this close to a real heel strike is "real"
  };

  /* ---------- Low-pass filter: 2nd-order Butterworth (a "biquad") ---------- */
  class LowPass {
    constructor(cutoff, rate) { this.cutoff = cutoff; this.setRate(rate); this.reset(0); }
    setRate(rate) {
      this.rate = rate;
      const w0 = 2 * Math.PI * Math.min(this.cutoff, rate * 0.45) / rate;
      const c = Math.cos(w0), alpha = Math.sin(w0) / Math.SQRT2, a0 = 1 + alpha;
      this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0;
      this.a1 = -2 * c / a0; this.a2 = (1 - alpha) / a0;
    }
    reset(v) { this.x1 = this.x2 = this.y1 = this.y2 = v; }
    step(x) {
      const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
      return y;
    }
  }

  /* ---------- Stages 1–4: clean the signal and find peaks ---------- */
  class Preprocessor {
    constructor(rate = 50, initialGravity = null) {
      this.rate = rate;
      this.filter = new LowPass(SETTINGS.cutoffHz, rate);
      this.gravity = initialGravity; this.lastT = null;
      this.prev1 = null; this.prev2 = null; this.prevSample = null;
      this.valley = Infinity;
      this.window = [];          // recent filtered values for the adaptive line
      this.maxQueue = [];        // keeps the window's maximum cheaply
      this.count = 0;
    }

    push(t, x, y, z) {
      // Real phones don't report at a perfectly steady rate, so use the real time gaps.
      let dt = 1 / this.rate;
      if (this.lastT !== null) {
        dt = Math.min(0.2, Math.max(0.002, t - this.lastT));
        this.rate = 0.95 * this.rate + 0.05 * (1 / dt);
        if (Math.abs(this.rate - this.filter.rate) / this.filter.rate > 0.1) this.filter.setRate(this.rate);
      }
      this.lastT = t;

      const mag = Math.sqrt(x * x + y * y + z * z);                       // 1. strength
      if (this.gravity === null) this.gravity = mag;
      this.gravity += (dt / (SETTINGS.gravitySeconds + dt)) * (mag - this.gravity);   // 2. gravity
      const dyn = mag - this.gravity;
      const filt = this.filter.step(dyn);                                  // 3. filter

      // Window maximum over the last 2 seconds (for the adaptive line).
      while (this.maxQueue.length && this.maxQueue[this.maxQueue.length - 1].v <= filt) this.maxQueue.pop();
      this.maxQueue.push({ t, v: filt });
      while (this.maxQueue[0].t < t - SETTINGS.windowSeconds) this.maxQueue.shift();
      const recentMax = this.maxQueue[0].v;

      const sample = { t, x, y, z, mag, gravity: this.gravity, dyn, filt, recentMax, index: this.count++ };

      // 4. Peak: the previous reading was higher than both neighbours,
      //    and it rose clearly above the lowest point since the last peak.
      let peak = null;
      if (this.prev2 !== null && this.prev1.filt > this.prev2.filt && this.prev1.filt >= filt) {
        const prominence = this.prev1.filt - this.valley;
        if (prominence >= SETTINGS.minProminence) {
          peak = { t: this.prev1.t, index: this.prev1.index, value: this.prev1.filt, prominence, recentMax };
          this.valley = this.prev1.filt;
        }
      }
      this.valley = Math.min(this.valley, filt);
      this.prev2 = this.prev1; this.prev1 = sample;
      sample.peak = peak;
      return sample;
    }
  }

  /* ---------- Stage 5: decide which peaks are steps ---------- */
  // rules = { mode: "fixed" | "adaptive", threshold, gap (ms), sensitivity (0–1), rhythm (true/false) }
  function lineFor(rules, recentMax) {
    return rules.mode === "adaptive" ? Math.max(SETTINGS.floor, rules.sensitivity * recentMax) : rules.threshold;
  }

  class StepDecider {
    constructor(rules) {
      this.rules = rules;
      this.events = [];          // every peak, with what happened to it and why
      this.count = 0;            // confirmed steps
      this.lastCandidate = -Infinity;
      this.intervals = [];       // recent gaps between candidate steps (for cadence)
      this.pending = [];         // Rule 3: steps waiting for a steady rhythm
      this.locked = false;       // Rule 3: rhythm already confirmed
      this.gapNow = rules.gap / 1000;
    }

    cadence() {                  // steps per minute, from recent gaps
      if (this.intervals.length < 2) return null;
      const sorted = [...this.intervals].sort((a, b) => a - b);
      return 60 / sorted[Math.floor(sorted.length / 2)];
    }

    currentGap() {
      if (this.rules.mode !== "adaptive") return this.rules.gap / 1000;
      const c = this.cadence();
      if (!c) return 0.3;                                   // no rhythm yet: a safe default
      return Math.min(0.8, Math.max(0.2, 0.6 * 60 / c));    // 60% of your usual step gap
    }

    consider(peak) {
      const line = lineFor(this.rules, peak.recentMax);
      const ev = { ...peak, line, status: null, reason: "" };
      this.events.push(ev);

      // Rule 1: big enough?
      if (peak.value < line) {
        ev.status = "small";
        ev.reason = `Too small: ${peak.value.toFixed(1)} is below the line (${line.toFixed(1)}).`;
        return ev;
      }
      // Rule 2: not too soon after the last step?
      const gap = this.currentGap(); this.gapNow = gap;
      const since = peak.t - this.lastCandidate;
      if (since < gap) {
        ev.status = "tooSoon";
        ev.reason = `Too soon: only ${Math.round(since * 1000)} ms after the last step (needs ${Math.round(gap * 1000)} ms).`;
        return ev;
      }
      if (since < 2) { this.intervals.push(since); if (this.intervals.length > 6) this.intervals.shift(); }
      this.lastCandidate = peak.t;

      if (!this.rules.rhythm) { this.confirm(ev, "Counted: big enough and not too soon."); return ev; }

      // Rule 3: steady rhythm. Compare this gap with the average gap of the current run.
      const run = this.pending.length ? this.pending : (this.locked ? this.lastRun : []);
      let steady = false;
      if (run && run.length) {
        const last = run[run.length - 1];
        const gapNow = peak.t - last.t;
        const gaps = []; for (let k = 1; k < run.length; k++) gaps.push(run[k].t - run[k - 1].t);
        const usual = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : gapNow;
        steady = gapNow >= 0.25 && gapNow <= 2 && Math.abs(gapNow - usual) <= SETTINGS.rhythmTolerance * usual;
      }

      if (this.locked && steady) {
        this.lastRun.push(ev); if (this.lastRun.length > 6) this.lastRun.shift();
        this.confirm(ev, "Counted: big enough, not too soon, and in a steady rhythm.");
        return ev;
      }
      if (!this.locked && steady) {
        this.pending.push(ev); ev.status = "pending"; ev.reason = "Waiting: checking for a steady rhythm.";
        if (this.pending.length >= SETTINGS.rhythmSteps) {        // rhythm found: count them all at once
          for (const p of this.pending) this.confirm(p, `Counted: part of ${SETTINGS.rhythmSteps}+ steady steps (added all at once, like real phones do).`);
          this.locked = true; this.lastRun = this.pending.slice(-6); this.pending = [];
        }
        return ev;
      }
      // Rhythm broken: anything still waiting is thrown away; start a new run.
      this.rejectPending();
      this.locked = false;
      this.pending = [ev]; ev.status = "pending"; ev.reason = "Waiting: checking for a steady rhythm.";
      return ev;
    }

    confirm(ev, reason) { ev.status = "step"; ev.reason = reason; this.count++; }
    rejectPending() {
      for (const p of this.pending) { p.status = "noRhythm"; p.reason = "Ignored: not part of a steady rhythm of 5 or more steps."; }
      this.pending = [];
    }
    finish() { this.rejectPending(); return this.events; }
  }

  /* ---------- Helpers for whole recordings ---------- */
  function preprocessAll(sig) {
    // A recording starts with the phone already running, so start the gravity
    // estimate at the recording's average strength instead of its first reading.
    let avg = 0;
    for (let i = 0; i < sig.x.length; i++) avg += Math.hypot(sig.x[i], sig.y[i], sig.z[i]);
    avg /= sig.x.length;
    const pre = new Preprocessor(sig.rate, avg), samples = [], peaks = [];
    for (let i = 0; i < sig.x.length; i++) {
      const s = pre.push(i / sig.rate, sig.x[i], sig.y[i], sig.z[i]);
      samples.push(s); if (s.peak) peaks.push(s.peak);
    }
    return { samples, peaks };
  }

  function decideAll(peaks, rules) {
    const d = new StepDecider(rules);
    for (const p of peaks) d.consider(p);
    d.finish();
    return { events: d.events, count: d.count, gap: d.gapNow, cadence: d.cadence() };
  }

  // Compare counted steps with real heel strikes.
  function evaluate(events, stepTimes) {
    const steps = events.filter(e => e.status === "step");
    const used = new Set();
    for (const e of steps) {
      let best = -1, bestD = SETTINGS.matchSeconds;
      stepTimes.forEach((s, k) => { const d = Math.abs(e.t - s); if (!used.has(k) && d <= bestD) { best = k; bestD = d; } });
      e.truth = best >= 0 ? "real" : "fake";
      if (best >= 0) used.add(best);
    }
    const missed = stepTimes.filter((_, k) => !used.has(k));
    const tp = used.size, fp = steps.length - tp, fn = missed.length;
    return { counted: steps.length, truth: stepTimes.length, tp, fp, fn, missed };
  }

  return { SETTINGS, LowPass, Preprocessor, StepDecider, lineFor, preprocessAll, decideAll, evaluate };
}

  const DETECT = createDETECT();
  DETECT.createDETECT = createDETECT;
  if (typeof module !== "undefined" && module.exports) module.exports = DETECT;
  else { global.DETECT = DETECT; global.createDETECT = createDETECT; }
})(typeof window !== "undefined" ? window : globalThis);
