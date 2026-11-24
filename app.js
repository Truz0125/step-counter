/* =====================================================================
   app.js — The page: guided tour, drawing, controls, real sensor,
   engineer challenge. Uses SIM (signals.js) and DETECT (detector.js).
   ===================================================================== */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const { SECONDS, PRESETS } = SIM;
  const C = { mint: "#3ee0a1", coral: "#ff6b6b", amber: "#ffc04d", muted: "#9aa0c3", ink: "#f3f4fb",
              line: "#2b3056", panel: "#111427", x: "#ff8fab", y: "#7aa2ff", z: "#c792ea" };
  const HEAVY = { speed: 1.0, strength: 8 };
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ================= 1. Guided tour ================= */
  const FIXED = { mode: "fixed", threshold: 1.5, gap: 300, sensitivity: 0.6, rhythm: false };
  const TOUR = [
    { title: "Every step makes a bump",
      text: "Watch the person walk. Each time a foot lands, the phone in their pocket gets a jolt. The <b>green line</b> below shows how big each jolt is. One footstep = one big bump.",
      src: "walk", rules: { ...FIXED }, show: [] },
    { title: "Rule 1: count bumps that cross the line",
      text: "The phone draws a <b>yellow line</b>. Every bump that pokes above it counts as one step. Drag the line too high and the phone misses steps. Too low, and it counts tiny wobbles.",
      src: "walk", rules: { ...FIXED }, show: ["line"], focus: "cLine" },
    { title: "Rule 2: each step makes two bumps",
      text: "Your heel lands (big bump), then your toes push off (small bump). With the line a little lower, the phone counts both, so you get <b>double the steps</b>. Fix it: drag \"Wait after each step\" up to about 300 ms.",
      src: "walk", rules: { ...FIXED, threshold: 1.2, gap: 0 }, show: ["line", "gap"], focus: "cGap" },
    { title: "A bumpy bus ride counts as walking",
      text: "With the line set low to catch gentle walkers, potholes on the bus count as steps. Real phones fix this with <b>Rule 3: a steady rhythm</b>. Switch it on and watch the fake steps vanish.",
      src: "bus", rules: { ...FIXED, threshold: 0.8 }, show: ["line", "gap", "rhythm"], focus: "cRhythm" },
    { title: "But you can still fool it",
      text: "Shaking your phone in your hand makes bumps in a perfectly steady rhythm, so even Rule 3 can't tell. Zero real steps, lots counted. <b>People really use this trick</b> to cheat fitness challenges.",
      src: "shake", rules: { ...FIXED, rhythm: true }, show: ["line", "gap", "rhythm"] },
    { title: "Smarter: rules that adapt to you",
      text: "This person walks slowly with heavy steps. Their toe push-off is big <i>and</i> late, so the fixed rules count it: double steps. Switch to <b>Adaptive</b>: the line rises to 60% of their biggest recent bump, and the wait follows their own rhythm.",
      src: "walk", person: HEAVY, rules: { ...FIXED }, show: ["line", "gap", "rhythm", "mode"], focus: "cMode" },
    { title: "Your turn: the engineering lab",
      text: "Change the walker, the activity, or where the phone is carried. Look <b>inside the phone</b> to see each processing stage, try the <b>engineer challenge</b>, or open this page on a phone and take the 10-step test with your own feet.",
      src: "walk", rules: { ...FIXED, mode: "adaptive", rhythm: true }, show: ["line", "gap", "rhythm", "mode", "acts", "pipe", "eng"] }
  ];

  /* ================= 2. State ================= */
  const state = { tour: 0, source: "walk", orientation: "pocket", person: { ...PRESETS.walk }, rules: { ...FIXED } };
  let sim = null;                                   // the current simulated recording and its results
  const play = { on: !reduceMotion, speed: 1, t: reduceMotion ? SECONDS : 0, last: null };
  const live = { on: false, pre: null, dec: null, samples: [], lastStepAt: 0, startedAt: 0, gotData: false };
  let lastMap = null;                               // where things were drawn, for tap-to-explain

  function buildSim() {
    const sig = SIM.generate(state.source, { person: state.person, orientation: state.orientation });
    const pre = DETECT.preprocessAll(sig);
    sim = { sig, samples: pre.samples, peaks: pre.peaks };
    decide();
  }
  function decide() {
    const r = DETECT.decideAll(sim.peaks, state.rules);
    sim.events = r.events; sim.gap = r.gap; sim.cadence = r.cadence;
    sim.result = DETECT.evaluate(sim.events, sim.sig.stepTimes);
  }

  /* ================= 3. Tour navigation ================= */
  function showTour() {
    const s = TOUR[state.tour];
    $("badge").textContent = state.tour + 1;
    $("gTitle").textContent = s.title; $("gText").innerHTML = s.text;
    $("dots").innerHTML = TOUR.map((_, i) => `<i class="${i === state.tour ? "on" : ""}"></i>`).join("");
    $("back").hidden = state.tour === 0;
    $("next").textContent = state.tour === TOUR.length - 1 ? "Start again" : "Next";
    const has = k => s.show.includes(k);
    $("rulesCard").classList.toggle("hidden", !has("line"));
    $("cGap").classList.toggle("hidden", !has("gap"));
    $("cRhythm").classList.toggle("hidden", !has("rhythm"));
    $("cMode").classList.toggle("hidden", !has("mode"));
    $("cActs").classList.toggle("hidden", !has("acts"));
    $("cPipe").classList.toggle("hidden", !has("pipe"));
    $("cEng").classList.toggle("hidden", !has("eng"));
    document.querySelectorAll(".need-line").forEach(e => e.classList.toggle("hidden", !has("line")));
    document.querySelectorAll(".need-gap").forEach(e => e.classList.toggle("hidden", !has("gap")));
    document.querySelectorAll(".need-rhythm").forEach(e => e.classList.toggle("hidden", !has("rhythm")));
    for (const id of ["cLine", "cGap", "cRhythm", "cMode"]) $(id).classList.toggle("focus", s.focus === id);
    Object.assign(state.rules, s.rules);
    state.orientation = "pocket";
    selectSource(s.src, s.person);
  }
  $("next").onclick = () => { state.tour = (state.tour + 1) % TOUR.length; showTour(); };
  $("back").onclick = () => { state.tour = Math.max(0, state.tour - 1); showTour(); };

  /* ================= 4. Numbers and controls ================= */
  const word = (v, list) => list.find(([lim]) => v < lim)[1];
  function setFill(id, min, max, v) { $(id).style.setProperty("--p", ((v - min) / (max - min) * 100) + "%"); }

  function syncControls() {
    const r = state.rules, adaptive = r.mode === "adaptive";
    $("threshold").value = r.threshold; $("gap").value = r.gap; $("sensitivity").value = r.sensitivity; $("rhythm").checked = r.rhythm;
    $("speed").value = state.person.speed; $("strength").value = state.person.strength;
    $("modeFixed").setAttribute("aria-pressed", !adaptive); $("modeAdaptive").setAttribute("aria-pressed", adaptive);
    $("r1Fixed").classList.toggle("hidden", adaptive); $("r1Adaptive").classList.toggle("hidden", !adaptive);
    $("gap").disabled = adaptive;
    $("thresholdVal").innerHTML = `${word(r.threshold, [[1, "tiny"], [2.5, "medium"], [5, "big"], [99, "huge"]])}<small>${r.threshold.toFixed(1)} m/s²</small>`;
    $("sensitivityVal").innerHTML = `${Math.round(r.sensitivity * 100)}%<small>of the biggest recent bump</small>`;
    const gapMs = adaptive ? Math.round(currentGap() * 1000) : r.gap;
    $("gapVal").innerHTML = adaptive ? `auto<small>${gapMs} ms now</small>` : `${r.gap} ms`;
    $("gapHelp").textContent = adaptive ? "Automatic: 60% of this person's usual time between steps, so it fits slow and fast walkers." : "Bumps that come sooner than this are ignored.";
    $("speedVal").textContent = word(state.person.speed, [[1.3, "slow stroll"], [2, "normal walk"], [2.5, "fast walk"], [99, "running"]]);
    $("strengthVal").textContent = word(state.person.strength, [[3.5, "gentle"], [7, "normal"], [99, "stomping"]]);
    setFill("threshold", .5, 9, r.threshold); setFill("gap", 0, 800, r.gap); setFill("sensitivity", .3, .9, r.sensitivity);
    setFill("speed", .8, 3.2, state.person.speed); setFill("strength", 2, 10, state.person.strength);
    $("personCtrls").classList.toggle("hidden", !(state.source === "walk" || state.source === "run") || live.on);
    document.querySelectorAll(".act").forEach(b => b.setAttribute("aria-pressed", live.on ? b.dataset.src === "live" : b.dataset.src === state.source));
    document.querySelectorAll("#orientSeg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.orient === state.orientation));
    $("orientSeg").classList.toggle("hidden", live.on);
  }
  function currentGap() { return live.on && live.dec ? live.dec.currentGap() : sim ? sim.gap : 0.3; }

  function updateNumbers() {
    const v = $("verdict");
    const cadence = live.on ? (live.dec && live.dec.cadence()) : sim.cadence;
    const lineNow = state.rules.mode === "adaptive" ? "follows you" : state.rules.threshold.toFixed(1) + " m/s²";
    const rate = live.on && live.pre ? live.pre.rate : 50;
    $("readouts").innerHTML = `<span>sample rate <b>${Math.round(rate)} Hz</b></span><span>filter <b>5 Hz low-pass</b></span>` +
      `<span>line <b>${lineNow}</b></span><span>wait <b>${Math.round(currentGap() * 1000)} ms</b></span>` +
      `<span>cadence <b>${cadence ? Math.round(cadence) + " steps/min" : "–"}</b></span><span>rules <b>${state.rules.mode}${state.rules.rhythm ? " + rhythm" : ""}</b></span>`;
    if (live.on) {
      $("counted").textContent = live.dec ? live.dec.count : 0; $("right").textContent = "?"; $("fake").textContent = "?";
      v.className = "verdict live"; v.textContent = "Count your steps out loud and compare";
      return;
    }
    const e = sim.result;
    $("counted").textContent = e.counted; $("right").textContent = e.tp; $("fake").textContent = e.fp;
    const parts = [];
    if (e.fp) parts.push(`${e.fp} fake`);
    if (e.fn) parts.push(`${e.fn} missed`);
    v.className = "verdict " + (parts.length ? "bad" : "good");
    v.textContent = parts.length ? parts.join(", ") : e.truth ? `Perfect: all ${e.truth} steps` : "Perfect: no steps taken";
  }

  function refresh(rebuild) {
    if (!live.on) { if (rebuild) buildSim(); else decide(); }
    syncControls(); updateNumbers(); updateEngineer();
    hideTip();
  }

  /* ================= 5. Drawing ================= */
  function setupCanvas(c) {
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    return { g, w, h };
  }
  const font = () => getComputedStyle(document.body).fontFamily;

  // What to draw right now: simulated recording, or the last 10 s of the real sensor.
  function view() {
    if (live.on) {
      const now = live.samples.length ? live.samples[live.samples.length - 1].t : 0;
      const events = live.dec ? live.dec.events.filter(e => e.t >= now - SECONDS) : [];
      return { samples: live.samples, events, t0: now - SECONDS, t1: now, now, stepTimes: [], missed: [] };
    }
    return { samples: sim.samples, events: sim.events, t0: 0, t1: SECONDS, now: play.t, stepTimes: sim.sig.stepTimes, missed: sim.result.missed };
  }

  function drawStage() {
    const { g, w, h } = setupCanvas($("stage"));
    const V = view(), showLine = TOUR[state.tour].show.includes("line");
    const left = 24, right = 24, ground = 150, top = 185, bottom = 30;
    const vals = V.samples.map(s => s.filt);
    const lines = V.samples.map(s => DETECT.lineFor(state.rules, s.recentMax));
    const max = Math.max(5, ...vals, ...lines) + 0.6, min = Math.min(-2.5, ...vals) - 0.4;
    const X = t => left + ((t - V.t0) / (V.t1 - V.t0)) * (w - left - right);
    const Y = v => top + (1 - (v - min) / (max - min)) * (h - top - bottom);
    lastMap = { X, Y, V };
    const f = font(), x = X(V.now);

    g.strokeStyle = C.line; g.lineWidth = 2; g.beginPath(); g.moveTo(left, ground); g.lineTo(w - right, ground); g.stroke();

    // footprints: grey = counted, red = missed
    const missedSet = new Set(V.missed);
    V.stepTimes.forEach((s, n) => { if (s > V.now) return;
      g.fillStyle = missedSet.has(s) ? C.coral : "rgba(154,160,195,.45)";
      g.beginPath(); g.ellipse(X(s), ground + (n % 2 ? 6 : 12), 6, 3, 0, 0, Math.PI * 2); g.fill();
      if (missedSet.has(s) && V.now - s < 1.5) { g.font = `700 11px ${f}`; g.fillText("missed", X(s) - 18, ground + 28); }
    });

    // the walker, the shaking phone, or the bus, above "now"
    const nowSample = nearestSample(V.samples, V.now), here = nowSample ? nowSample.filt : 0;
    g.strokeStyle = C.ink; g.fillStyle = C.ink; g.lineWidth = 5; g.lineCap = "round";
    if (live.on || state.source === "shake") drawPhone(g, x, ground, here);
    else if (state.source === "bus") drawBus(g, x, ground, here);
    else drawPerson(g, x, ground, V.now);

    // "+1" pops
    if (!live.on) for (const e of V.events) {
      if (e.status !== "step") continue;
      const age = (V.now - e.t) * 50; if (age < 0 || age > 30) continue;
      g.globalAlpha = 1 - age / 30; g.fillStyle = e.truth === "fake" ? C.coral : C.mint;
      g.font = `800 22px ${f}`; g.fillText("+1", X(e.t) + 18, 40 - age * 0.6); g.globalAlpha = 1;
    }

    g.font = `12px ${f}`; g.fillStyle = C.muted; g.fillText("Bumps the phone feels (filtered)  ↑ bigger", left, top - 10);

    // the line a bump must cross (flat when fixed, moving when adaptive)
    if (showLine) {
      g.setLineDash([8, 6]); g.strokeStyle = C.amber; g.lineWidth = 2; g.beginPath();
      V.samples.forEach((s, i) => { const px = X(s.t), py = Y(lines[i]); i ? g.lineTo(px, py) : g.moveTo(px, py); });
      g.stroke(); g.setLineDash([]);
    }

    // the bump line: bright up to "now", faded after
    const path = new Path2D(); V.samples.forEach((s, i) => i ? path.lineTo(X(s.t), Y(s.filt)) : path.moveTo(X(s.t), Y(s.filt)));
    g.lineWidth = 2.5; g.lineJoin = "round";
    g.save(); g.beginPath(); g.rect(0, 0, x, h); g.clip(); g.strokeStyle = C.mint; g.stroke(path); g.restore();
    g.save(); g.beginPath(); g.rect(x, 0, w - x, h); g.clip(); g.strokeStyle = "rgba(62,224,161,.22)"; g.stroke(path); g.restore();

    // decisions on each peak
    if (showLine) for (const e of V.events) {
      if (e.t > V.now + 1e-6) continue;
      const ex = X(e.t), ey = Y(e.value);
      if (e.status === "tooSoon") { g.strokeStyle = C.muted; g.lineWidth = 2; g.beginPath(); g.moveTo(ex - 5, ey - 5); g.lineTo(ex + 5, ey + 5); g.moveTo(ex + 5, ey - 5); g.lineTo(ex - 5, ey + 5); g.stroke(); }
      else if (e.status === "noRhythm") { g.strokeStyle = C.muted; g.lineWidth = 2; g.beginPath(); g.arc(ex, ey, 6, 0, Math.PI * 2); g.stroke(); }
      else if (e.status === "pending") { g.strokeStyle = C.mint; g.lineWidth = 2; g.beginPath(); g.arc(ex, ey, 6, 0, Math.PI * 2); g.stroke(); }
      else if (e.status === "step") { g.fillStyle = e.truth === "fake" ? C.coral : C.mint; g.beginPath(); g.arc(ex, ey, 7, 0, Math.PI * 2); g.fill(); g.strokeStyle = C.panel; g.lineWidth = 2; g.stroke(); }
    }

    g.strokeStyle = "rgba(243,244,251,.25)"; g.lineWidth = 1; g.setLineDash([3, 4]);
    g.beginPath(); g.moveTo(x, ground + 18); g.lineTo(x, h - bottom); g.stroke(); g.setLineDash([]);
    g.fillStyle = C.muted; g.font = `12px ${f}`;
    for (let s = 0; s <= SECONDS; s += 2) g.fillText(live.on ? (s - SECONDS) + "s" : s + "s", X(V.t0 + s) - 8, h - 9);
  }

  function nearestSample(samples, t) {
    if (!samples.length) return null;
    let lo = 0, hi = samples.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (samples[mid].t < t) lo = mid + 1; else hi = mid; }
    return samples[lo];
  }

  function drawPerson(g, x, ground, t) {
    const times = sim.sig.stepTimes, run = state.person.speed >= 2.5;
    let k = times.findIndex(s => s > t); if (k === -1) k = times.length;
    const prev = k > 0 ? times[k - 1] : 0, next = k < times.length ? times[k] : prev + 0.5;
    const phase = Math.min(1, (t - prev) / (next - prev || 1));
    const swing = (run ? 0.75 : 0.45) * Math.cos(Math.PI * phase) * (k % 2 ? 1 : -1);
    const leg = 42, bob = (2 + state.person.strength * 0.4) * Math.sin(Math.PI * phase);
    const hipY = ground - leg - bob, lean = run ? 8 : 2, sx = x + lean, sy = hipY - 40;
    g.beginPath();
    g.moveTo(x, hipY); g.lineTo(x + Math.sin(swing) * leg, hipY + Math.cos(swing) * leg);
    g.moveTo(x, hipY); g.lineTo(x - Math.sin(swing) * leg, hipY + Math.cos(swing) * leg);
    g.moveTo(x, hipY); g.lineTo(sx, sy);
    g.moveTo(sx, sy + 4); g.lineTo(sx - Math.sin(swing) * 26, sy + 4 + Math.cos(swing) * 26);
    g.moveTo(sx, sy + 4); g.lineTo(sx + Math.sin(swing) * 26, sy + 4 + Math.cos(swing) * 26);
    g.stroke();
    g.beginPath(); g.arc(sx + 2, sy - 13, 11, 0, Math.PI * 2); g.fill();
    g.fillStyle = C.mint;
    if (state.orientation === "hand") g.fillRect(sx + 14, sy + 14, 9, 14);           // phone in hand
    else if (state.orientation === "bag") { g.strokeStyle = C.mint; g.lineWidth = 2; g.strokeRect(x - 16, hipY - 6, 16, 14); g.fillRect(x - 12, hipY - 3, 6, 8); }
    else g.fillRect(x - 5, hipY - 12, 9, 14);                                         // phone in pocket
  }
  function drawPhone(g, x, ground, v) {
    const y = ground - 60 - Math.max(-8, Math.min(8, v)) * 4;
    g.lineWidth = 3; g.strokeStyle = live.on ? C.amber : C.mint; g.strokeRect(x - 12, y - 22, 24, 44);
    g.strokeStyle = "rgba(243,244,251,.5)"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x - 22, y - 8); g.lineTo(x - 22, y + 8); g.moveTo(x + 22, y - 8); g.lineTo(x + 22, y + 8); g.stroke();
  }
  function drawBus(g, x, ground, v) {
    const y = ground - 12 - Math.max(0, v) * 3;
    g.fillStyle = C.ink; g.beginPath(); g.roundRect(x - 40, y - 34, 80, 30, 6); g.fill();
    g.fillStyle = C.panel; for (let k = 0; k < 4; k++) g.fillRect(x - 33 + k * 18, y - 29, 12, 10);
    g.fillStyle = C.muted; g.beginPath(); g.arc(x - 24, ground - 6, 6, 0, Math.PI * 2); g.arc(x + 24, ground - 6, 6, 0, Math.PI * 2); g.fill();
  }

  // Small pipeline charts
  function drawMini(id, series, opts = {}) {
    const c = $(id); if (!c.offsetParent) return;
    const { g, w, h } = setupCanvas(c), V = view(), pad = 8;
    let min = Infinity, max = -Infinity;
    for (const s of series) for (const p of V.samples) { const v = s.get(p); if (v < min) min = v; if (v > max) max = v; }
    if (!isFinite(min)) return;
    if (opts.zero) { min = Math.min(min, -1); max = Math.max(max, 1); }
    const span = Math.max(1, max - min); min -= span * 0.08; max += span * 0.08;
    const X = t => pad + ((t - V.t0) / (V.t1 - V.t0)) * (w - 2 * pad), Y = v => pad + (1 - (v - min) / (max - min)) * (h - 2 * pad - 12);
    g.font = `10px ${font()}`; g.fillStyle = C.muted;
    g.fillText(`${max.toFixed(1)}`, pad, pad + 8); g.fillText(`${min.toFixed(1)} m/s²`, pad, h - 4);
    for (const s of series) {
      g.strokeStyle = s.color; g.lineWidth = s.width || 1.5; g.setLineDash(s.dash || []); g.beginPath();
      V.samples.forEach((p, i) => i ? g.lineTo(X(p.t), Y(s.get(p))) : g.moveTo(X(p.t), Y(s.get(p))));
      g.stroke(); g.setLineDash([]);
    }
    const x = X(V.now);
    g.strokeStyle = "rgba(243,244,251,.3)"; g.lineWidth = 1; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
  }
  function drawPipeline() {
    if ($("cPipe").classList.contains("hidden")) return;
    drawMini("mRaw", [{ get: p => p.x, color: C.x }, { get: p => p.y, color: C.y }, { get: p => p.z, color: C.z }]);
    drawMini("mMag", [{ get: p => p.mag, color: C.ink }, { get: p => p.gravity, color: C.mint, dash: [6, 4], width: 2 }]);
    drawMini("mFilt", [{ get: p => p.dyn, color: "rgba(154,160,195,.6)", width: 1 }, { get: p => p.filt, color: C.mint, width: 2 }], { zero: true });
  }

  /* ================= 6. Tap a dot to see why ================= */
  function hideTip() { $("tip").classList.add("hidden"); }
  $("stage").addEventListener("click", ev => {
    if (!lastMap || !TOUR[state.tour].show.includes("line")) return;
    const r = $("stage").getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top;
    let best = null, bestD = 18;
    for (const e of lastMap.V.events) {
      if (e.status === "small" || e.t > lastMap.V.now) continue;
      const d = Math.hypot(lastMap.X(e.t) - px, lastMap.Y(e.value) - py);
      if (d < bestD) { best = e; bestD = d; }
    }
    if (!best) return hideTip();
    const title = best.status === "step" ? (best.truth === "fake" ? "Counted, but it's a fake step" : "Counted as a step")
      : best.status === "tooSoon" ? "Ignored by Rule 2" : best.status === "noRhythm" ? "Ignored by Rule 3" : "Waiting for rhythm";
    const tip = $("tip");
    tip.innerHTML = `<b>${title}</b>${best.reason}<br><span style="color:var(--muted)">Bump size ${best.value.toFixed(1)} m/s² · line ${best.line.toFixed(1)} · at ${(best.t - lastMap.V.t0).toFixed(2)} s</span>`;
    tip.classList.remove("hidden");
    tip.style.left = Math.min(r.width - 270, Math.max(4, px - 130)) + "px";
    tip.style.top = Math.max(4, py - tip.offsetHeight - 14) + "px";
  });

  /* ================= 7. Playback and sound ================= */
  let audio = null, soundOn = false;
  function beep(isReal) {
    if (!soundOn || !audio) return;
    const o = audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime;
    o.type = isReal ? "sine" : "square"; o.frequency.value = isReal ? 880 : 160;
    gain.gain.setValueAtTime(isReal ? 0.25 : 0.12, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    o.connect(gain).connect(audio.destination); o.start(now); o.stop(now + 0.13);
  }
  function frame(now) {
    if (play.last === null) play.last = now;
    const dt = Math.min(0.1, (now - play.last) / 1000); play.last = now;
    if (!live.on && sim && play.on) {
      const before = play.t;
      play.t += dt * play.speed;
      if (play.t >= SECONDS) play.t -= SECONDS;
      for (const e of sim.events) {
        if (e.status !== "step") continue;
        const passed = play.t >= before ? (e.t > before && e.t <= play.t) : (e.t > before || e.t <= play.t);
        if (passed) beep(e.truth !== "fake");
      }
    }
    if (sim || live.on) { drawStage(); drawPipeline(); }
    if (live.on) updateLive();
    requestAnimationFrame(frame);
  }
  $("play").onclick = () => { play.on = !play.on; $("play").textContent = play.on ? "Pause" : "Play"; };
  document.querySelectorAll("[data-speed]").forEach(b => b.onclick = () => {
    play.speed = +b.dataset.speed;
    document.querySelectorAll("[data-speed]").forEach(x => x.setAttribute("aria-pressed", x === b));
  });
  $("sound").onclick = () => {
    soundOn = !soundOn;
    try { if (soundOn && !audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio) audio.resume(); } catch (e) { soundOn = false; }
    $("sound").setAttribute("aria-pressed", soundOn); $("sound").textContent = "Footstep sounds: " + (soundOn ? "on" : "off");
  };

  /* ================= 8. Real phone sensor (streaming) ================= */
  function onMotion(e) {
    const a = (e.accelerationIncludingGravity && e.accelerationIncludingGravity.x != null) ? e.accelerationIncludingGravity : e.acceleration;
    if (!a || a.x == null) return;
    live.gotData = true;
    const t = (e.timeStamp || performance.now()) / 1000;
    const s = live.pre.push(t, a.x, a.y, a.z);
    live.samples.push(s);
    while (live.samples.length && live.samples[0].t < t - SECONDS) live.samples.shift();
    if (s.peak) {
      const before = live.dec.count;
      live.dec.consider(s.peak);
      if (live.dec.count > before) { live.lastStepAt = t; beep(true); }
      if (live.dec.events.length > 400) live.dec.events.splice(0, 100);
    }
  }
  function resetLiveCount() {
    live.dec = new DETECT.StepDecider(state.rules);
    live.lastStepAt = 0; live.startedAt = performance.now() / 1000;
    $("liveMsg").textContent = "Walk exactly 10 steps at a normal pace, then stand still.";
  }
  function updateLive() {
    const n = live.dec ? live.dec.count : 0;
    $("liveCount").textContent = n;
    updateNumbers();
    if (state.rules.mode === "adaptive") $("gapVal").innerHTML = `auto<small>${Math.round(currentGap() * 1000)} ms now</small>`;
    const nowT = live.samples.length ? live.samples[live.samples.length - 1].t : 0;
    if (!live.gotData) return;
    if (n > 0 && nowT - live.lastStepAt > 2.5) {
      const off = Math.abs(n - 10);
      $("liveMsg").textContent = off === 0 ? "The phone counted exactly 10. If you walked 10 steps, it got it right!"
        : `The phone counted ${n}. If you walked 10, it was off by ${off}. Try changing the rules and walk again.`;
    } else if (state.rules.rhythm && n === 0 && live.dec && live.dec.pending.length) {
      $("liveMsg").textContent = "Rule 3 is waiting for 5 steady steps, then it adds them all at once.";
    }
  }
  async function startLive() {
    $("actMsg").textContent = "Starting your phone's motion sensor…";
    try {
      if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
        if (await DeviceMotionEvent.requestPermission() !== "granted") throw new Error("denied");   // iPhone asks first
      }
    } catch (err) {
      $("actMsg").textContent = "Motion access was not allowed. On iPhone, tap the button again and choose Allow.";
      return selectSource("walk");
    }
    live.on = true; live.gotData = false; live.samples = [];
    live.pre = new DETECT.Preprocessor(50);
    resetLiveCount();
    window.addEventListener("devicemotion", onMotion);
    $("liveCard").classList.remove("hidden");
    $("actMsg").textContent = "Live: put your phone in your pocket or hold it, then walk.";
    refresh(false);
    setTimeout(() => { if (live.on && !live.gotData)
      $("actMsg").textContent = "No motion data arrived. This needs a phone, and the page must be opened from its own https link (for example GitHub Pages), not inside a preview."; }, 2500);
  }
  function stopLive() {
    if (!live.on) return;
    live.on = false; window.removeEventListener("devicemotion", onMotion);
    $("liveCard").classList.add("hidden");
  }
  $("liveReset").onclick = resetLiveCount;

  /* ================= 9. Controls ================= */
  function selectSource(kind, person) {
    stopLive();
    if (kind === "live") { startLive(); return; }
    state.source = kind;
    if (person) Object.assign(state.person, person);
    else if (PRESETS[kind]) Object.assign(state.person, PRESETS[kind]);
    $("actMsg").textContent = "";
    play.t = reduceMotion ? SECONDS : 0;
    refresh(true);
  }
  document.querySelectorAll(".act").forEach(b => b.onclick = () => selectSource(b.dataset.src));
  document.querySelectorAll("#orientSeg button").forEach(b => b.onclick = () => { state.orientation = b.dataset.orient; refresh(true); });
  for (const id of ["threshold", "gap", "sensitivity"]) $(id).addEventListener("input", e => { state.rules[id] = +e.target.value; refresh(false); });
  $("rhythm").addEventListener("change", e => { state.rules.rhythm = e.target.checked; refresh(false); });
  $("modeFixed").onclick = () => { state.rules.mode = "fixed"; refresh(false); };
  $("modeAdaptive").onclick = () => { state.rules.mode = "adaptive"; refresh(false); };
  for (const id of ["speed", "strength"]) $(id).addEventListener("input", e => { state.person[id] = +e.target.value; refresh(true); });
  window.addEventListener("resize", () => { if (sim) drawStage(); });

  /* ================= 10. Engineer challenge: robust testing ================= */
  const OPT = createOPT(SIM, DETECT);
  const PER_SCENARIO = 10;
  const eng = { seed: 2026, practice: null, unseen: null, result: null, running: false, worker: null };

  function ensureSets() {
    if (eng.practice && eng.practice.seed === eng.seed) return;
    eng.practice = OPT.makeTestSet(eng.seed, PER_SCENARIO, true);
    eng.unseen = OPT.makeTestSet(eng.seed + 7919, PER_SCENARIO, false);
  }
  const rulesText = r => r.mode === "adaptive"
    ? `adaptive · line ${Math.round(r.sensitivity * 100)}% of biggest bump · wait auto · rhythm ${r.rhythm ? "on" : "off"}`
    : `fixed · line ${r.threshold.toFixed(1)} m/s² · wait ${r.gap} ms · rhythm ${r.rhythm ? "on" : "off"}`;
  const colorFor = v => v >= 90 ? "var(--mint)" : v >= 60 ? "var(--amber)" : "var(--coral)";

  function updateEngineer() {
    if ($("cEng").classList.contains("hidden")) return;
    ensureSets();
    const mine = OPT.evaluate(state.rules, eng.practice), mineNew = OPT.evaluate(state.rules, eng.unseen);
    const avg = Math.round(mine.average);
    $("total").innerHTML = `${avg}<small> / 100</small>`;
    $("testset").innerHTML = `<b>${mine.recordings} practice recordings</b>: 6 situations × ${PER_SCENARIO} variations. Each variation changes the walking speed or step strength, where the phone is carried, the amount of sensor noise, how the phone is shaken, or how rough the road is. Seed <b>${eng.seed}</b>.`;
    $("sRecs").textContent = mine.recordings;
    $("sAvg").textContent = avg; $("sAvg").style.color = colorFor(mine.average);
    $("sWorst").textContent = Math.round(mine.worst.score); $("sWorst").style.color = colorFor(mine.worst.score);
    $("sWorstL").textContent = `worst recording: ${mine.worst.name} #${mine.worst.variant}`;
    $("sUnseen").textContent = Math.round(mineNew.average); $("sUnseen").style.color = colorFor(mineNew.average);
    $("rows").innerHTML = mine.scenarios.map(x => {
      const c = colorFor(x.avg);
      return `<div class="row"><span class="name">${x.name}</span><span class="bar"><i style="width:${x.avg}%; background:${c}"></i></span>
        <span class="cnt">average ${Math.round(x.avg)} · worst ${Math.round(x.worst.score)} (#${x.worst.variant})<small>${x.n} recordings · fake ${x.fp} · missed ${x.fn}</small></span><span class="pts" style="color:${c}">${Math.round(x.avg)}</span></div>`;
    }).join("");
    const weak = mine.worstScenario;
    $("engTip").textContent = eng.result && mine.average >= Math.max(eng.result.fixed.practice.average, eng.result.adaptive.practice.average) - 0.5
      ? `You matched the best tuned rules! "${weak.name}" still loses points: no set of rules works perfectly everywhere.`
      : `Weakest situation: "${weak.name}" (average ${Math.round(weak.avg)}). Its worst recording was: ${weak.worst.label}. Move a slider and watch which rows change.`;
  }

  function renderBests() {
    const r = eng.result; if (!r) return;
    const card = (title, rules, a, aLabel, b, note, key, warn) => `
      <div class="bestcard${warn ? " warn" : ""}"><h4>${title}</h4><span class="rules">${rulesText(rules)}</span>
        <div class="pair"><div><span class="v" style="color:${colorFor(a)}">${Math.round(a)}</span><span class="l">${aLabel}</span></div><span class="arrow">→</span>
        <div><span class="v" style="color:${colorFor(b)}">${Math.round(b)}</span><span class="l">new recordings</span></div></div>
        <p>${note}</p><button class="btn small" data-use="${key}">Use these rules</button></div>`;
    const f = r.fixed, ad = r.adaptive, nv = r.naive;
    $("bests").innerHTML =
      card("Best fixed rules", f.rules, f.practice.average, `${r.practiceCount} practice`, f.unseen.average,
        `Worst new recording: ${Math.round(f.unseen.worst.score)} (${f.unseen.worst.name}).`, "fixed") +
      card("Best adaptive rules", ad.rules, ad.practice.average, `${r.practiceCount} practice`, ad.unseen.average,
        `Worst new recording: ${Math.round(ad.unseen.worst.score)} (${ad.unseen.worst.name}).`, "adaptive") +
      card("Tuned on only 6 recordings", nv.rules, nv.single.average, "6 practice", nv.unseen.average,
        `Looks great in practice, then drops ${Math.max(0, Math.round(nv.single.average - nv.unseen.average))} points on new recordings: it memorized its 6 recordings.`, "naive", true);
    document.querySelectorAll("[data-use]").forEach(b => b.onclick = () => {
      const k = b.dataset.use; Object.assign(state.rules, k === "naive" ? r.naive.rules : r[k].rules); refresh(false);
    });
  }

  // The search runs in a background worker built from the same engine code, so the page never freezes.
  function makeWorker() {
    try {
      const src = `"use strict";
const SIM = (${createSIM.toString()})();
const DETECT = (${createDETECT.toString()})();
const OPT = (${createOPT.toString()})(SIM, DETECT);
self.onmessage = e => { const r = OPT.runExperiment(e.data, p => self.postMessage({ type: "progress", p })); self.postMessage({ type: "done", r }); };`;
      return new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    } catch (err) { return null; }
  }

  function runExperiment() {
    if (eng.running) return;
    const seed = Math.max(1, Math.min(999999, Math.round(+$("seed").value) || 2026));
    $("seed").value = seed; eng.seed = seed; eng.running = true; eng.result = null;
    $("runExp").disabled = true; $("bests").innerHTML = ""; $("expBar").style.width = "0%";
    $("expStatus").textContent = "Building recordings…";
    updateEngineer();
    const job = { seed, perScenario: PER_SCENARIO };
    const finish = r => {
      eng.result = r; eng.running = false; $("runExp").disabled = false; $("expBar").style.width = "100%";
      $("expStatus").textContent = `Done: ${r.tested.toLocaleString()} rule settings tested on ${r.practiceCount} practice recordings, then checked on ${r.unseenCount} new ones (${(r.ms / 1000).toFixed(1)} s). Seed ${r.seed}: run it again and you get exactly the same result.`;
      renderBests(); updateEngineer();
    };
    const progress = p => { $("expBar").style.width = Math.round(p.fraction * 100) + "%"; $("expStatus").textContent = `${p.phase}… ${Math.round(p.fraction * 100)}%`; };
    const fallback = () => {                         // no worker available: run on the page, after the screen updates
      $("expStatus").textContent = "Running (this browser can't use a background worker, so the page may pause for a second)…";
      setTimeout(() => finish(OPT.runExperiment(job, null)), 50);
    };
    if (!eng.worker) eng.worker = makeWorker();
    if (!eng.worker) return fallback();
    eng.worker.onmessage = e => e.data.type === "progress" ? progress(e.data.p) : finish(e.data.r);
    eng.worker.onerror = ev => { ev.preventDefault(); eng.worker = null; fallback(); };
    eng.worker.postMessage(job);
  }
  $("runExp").onclick = runExperiment;
  $("newSeed").onclick = () => { $("seed").value = 1 + Math.floor(Math.random() * 999999); runExperiment(); };

  /* ================= Start ================= */
  showTour();
  requestAnimationFrame(frame);
  setTimeout(runExperiment, 300);
  window.__app = { state, get sim() { return sim; }, eng, OPT };   // for testing
})();
