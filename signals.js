/* =====================================================================
   signals.js — Simulated phone accelerometer
   ---------------------------------------------------------------------
   A real phone reports acceleration on 3 axes (X, Y, Z) about 50 times a
   second. The numbers include GRAVITY (9.81 m/s²), which shows up on
   whichever axis points down. On top of gravity comes the movement:
   foot impacts, body bounce, sway, engine vibration, and sensor noise.

   This file builds that same kind of data for 4 activities, so the
   detector in detector.js has to do exactly what a real phone does.
   ===================================================================== */
(function (global) {
  "use strict";

// Everything lives inside createSIM() so the optimizer's background worker
// can build its own copy of the simulator from this exact same code.
function createSIM() {
  "use strict";
  const RATE = 50;            // readings per second
  const SECONDS = 10;         // length of each recording
  const N = RATE * SECONDS;   // 500 readings
  const G = 9.81;             // gravity, m/s²

  // How the phone is carried decides which axis gravity sits on.
  const ORIENTATIONS = {
    pocket: { label: "Trouser pocket", gravity: [1.2, 9.5, 2.0], impact: 1.0,  noise: 0.10 },
    hand:   { label: "In your hand",   gravity: [0.4, 6.4, 7.4], impact: 0.8,  noise: 0.10 },
    bag:    { label: "Loose in a bag", gravity: [4.6, 3.1, 8.1], impact: 0.65, noise: 0.25 }
  };

  const PRESETS = {
    walk:   { speed: 1.8, strength: 5.5 },   // steps per second, impact size (m/s²)
    run:    { speed: 2.8, strength: 9 },
    gentle: { speed: 1.2, strength: 3 }
  };

  // ---------- small helpers ----------
  function randomGen(seed) {                 // repeatable random numbers
    return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  }
  function gaussian(rnd) {                   // bell-curve noise (Box–Muller)
    const u = Math.max(1e-9, rnd()), v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const pulse = (t, center, width) => Math.exp(-((t - center) ** 2) / (2 * width * width));
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = a => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  // Directions "up", "forward" and "sideways" as seen from inside the phone.
  function bodyFrame(gravity) {
    const up = norm(gravity);
    const helper = Math.abs(up[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const forward = norm(sub(helper, scale(up, dot(helper, up))));
    const side = cross(up, forward);
    return { up, forward, side };
  }

  /* -------------------------------------------------------------------
     generate(kind, options)
       kind:    "walk" | "run" | "shake" | "bus"
       options: { person: {speed, strength}, orientation, noise, seed,
                  shake: {freq, amp},              // how fast and how hard the hand shakes
                  vehicle: {bumpiness, sway} }     // how rough the road is, how much the bus sways
     returns  { x, y, z, stepTimes, rate, seconds, kind }
       stepTimes = the moments a heel really hit the ground (ground truth)
     ------------------------------------------------------------------- */
  function generate(kind, options = {}) {
    const orient = ORIENTATIONS[options.orientation || "pocket"];
    const person = options.person || PRESETS[kind] || PRESETS.walk;
    const rnd = randomGen((options.seed || 0) + { walk: 11, run: 23, shake: 37, bus: 41 }[kind]);
    const noiseLevel = options.noise != null ? options.noise : orient.noise;
    const { up, forward, side } = bodyFrame(orient.gravity);

    // Movement in body directions (gravity is added later).
    const V = new Float64Array(N), F = new Float64Array(N), S = new Float64Array(N);
    const stepTimes = [];

    if (kind === "walk" || kind === "run") {
      const running = kind === "run" || person.speed >= 2.5;
      const every = 1 / person.speed;                     // seconds per step
      const hit = person.strength * orient.impact;        // impact size
      for (let t = 0.3; t < SECONDS - 0.2; t += every * (0.96 + rnd() * 0.08)) stepTimes.push(t);

      for (let i = 0; i < N; i++) {
        const t = i / RATE;
        for (const s of stepTimes) {
          if (Math.abs(t - s) > 1.2) continue;
          // Up/down: sharp heel impact, a dip as the body rises, then a softer toe push-off.
          V[i] += 1.3 * hit * pulse(t, s, running ? 0.035 : 0.05)
                - 0.3 * hit * pulse(t, s + 0.12, 0.07)
                + 0.88 * hit * pulse(t, s + every * 0.42, running ? 0.05 : 0.06);
          // Forward: braking when the heel lands, pushing when the toes leave.
          F[i] += 0.25 * hit * (pulse(t, s + 0.06, 0.07) - pulse(t, s + every * 0.42, 0.08));
        }
        // Gentle body bounce once per step, and side-to-side sway once per stride.
        V[i] += 0.08 * hit * Math.cos(2 * Math.PI * person.speed * (t - 0.3));
        S[i] += 0.6 * Math.sin(Math.PI * person.speed * (t - 0.3));
      }
    }

    if (kind === "shake") {
      // A hand waving the phone back and forth, tilted from vertical: a smooth
      // wave with no heel or toe shape, but a perfectly steady beat.
      const freq = (options.shake && options.shake.freq) || 2.0;
      const amp = (options.shake && options.shake.amp) || 7;
      for (let i = 0; i < N; i++) {
        const t = i / RATE;
        const a = amp * Math.sin(2 * Math.PI * freq * t) * (0.85 + 0.15 * Math.sin(0.7 * t));
        V[i] += 0.65 * a;
        F[i] += 0.76 * a;
      }
    }

    if (kind === "bus") {
      // Slow swaying in turns, speeding up and braking, fast engine buzz,
      // and potholes that make the suspension bounce and fade.
      const bumpiness = (options.vehicle && options.vehicle.bumpiness) || 1;
      const sway = (options.vehicle && options.vehicle.sway) || 1;
      const bumps = [];
      for (let t = 0.2; t < SECONDS; t += 0.3 + rnd() * 1.3) bumps.push([t, (0.8 + rnd() * 2.4) * bumpiness]);
      for (let i = 0; i < N; i++) {
        const t = i / RATE;
        S[i] += 0.9 * sway * Math.sin(2 * Math.PI * 0.25 * t + 1);
        F[i] += 1.2 * sway * Math.sin(2 * Math.PI * 0.08 * t);
        V[i] += 0.35 * Math.sin(2 * Math.PI * 18 * t) + 0.2 * Math.sin(2 * Math.PI * 11.3 * t);
        for (const [tb, h] of bumps) {
          if (t < tb || t > tb + 1.5) continue;
          V[i] += h * Math.exp(-(t - tb) / 0.15) * Math.sin(2 * Math.PI * 1.6 * (t - tb) + 0.6);
        }
      }
    }

    // Over time the body doesn't fly off or sink into the ground, so the
    // average movement in each direction must be zero.
    for (const arr of [V, F, S]) {
      let mean = 0; for (let i = 0; i < N; i++) mean += arr[i];
      mean /= N; for (let i = 0; i < N; i++) arr[i] -= mean;
    }

    // Turn body movement into phone X/Y/Z, add gravity and sensor noise.
    const g = scale(up, G);
    const bias = [gaussian(rnd) * 0.05, gaussian(rnd) * 0.05, gaussian(rnd) * 0.05];
    const x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < 3; k++) {
        const v = g[k] + V[i] * up[k] + F[i] * forward[k] + S[i] * side[k] + bias[k] + gaussian(rnd) * noiseLevel;
        if (k === 0) x[i] = v; else if (k === 1) y[i] = v; else z[i] = v;
      }
    }
    return { kind, x, y, z, stepTimes, rate: RATE, seconds: SECONDS };
  }

  return { RATE, SECONDS, N, G, ORIENTATIONS, PRESETS, generate };
}

  const SIM = createSIM();
  SIM.createSIM = createSIM;
  if (typeof module !== "undefined" && module.exports) module.exports = SIM;
  else { global.SIM = SIM; global.createSIM = createSIM; }
})(typeof window !== "undefined" ? window : globalThis);
