// All sound is synthesised with the Web Audio API — no audio files to ship, and the
// whole soundtrack lives in this one module: a short looping tune in D Dorian for a
// "hurdy-gurdy and lute at a country fair" feel, plus a handful of UI sound effects
// (tile thock, meeple tick, scoring chime, your-turn ping, end-of-game fanfare).
//
// Browsers refuse to start an AudioContext without a user gesture, so nothing here
// makes a sound until `unlockAudio()` has been called from a click/keypress. Both
// music and effects can be muted independently; the choice sticks in localStorage.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;

const PREF_MUSIC = 'carcassonne.music';
const PREF_SFX = 'carcassonne.sfx';

function readPref(key: string, fallback: boolean): boolean {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v === 'on'; } catch { return fallback; }
}
function writePref(key: string, on: boolean): void {
  try { localStorage.setItem(key, on ? 'on' : 'off'); } catch { /* private mode etc. — just don't remember */ }
}

let musicOn = readPref(PREF_MUSIC, true);
let sfxOn = readPref(PREF_SFX, true);

export function isMusicOn(): boolean { return musicOn; }
export function isSfxOn(): boolean { return sfxOn; }

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.gain.value = 0.7; sfxBus.connect(master);
  musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
  return ctx;
}

/** Call from any user gesture. Idempotent; safe to call on every click. */
export function unlockAudio(): void {
  const c = ensureContext();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();
  if (musicOn) startMusic();
}

export function setMusic(on: boolean): void {
  musicOn = on; writePref(PREF_MUSIC, on);
  if (on) { unlockAudio(); startMusic(); } else stopMusic();
}
export function setSfx(on: boolean): void {
  sfxOn = on; writePref(PREF_SFX, on);
  if (on) unlockAudio();
}

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------
const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Plucked string: a bright attack that quickly mellows, like a lute or gittern. */
function pluck(dest: AudioNode, midi: number, t: number, dur: number, vol: number): void {
  const c = ctx!;
  const f = midiHz(midi);
  const osc = c.createOscillator(); osc.type = 'triangle'; osc.frequency.value = f;
  const osc2 = c.createOscillator(); osc2.type = 'sawtooth'; osc2.frequency.value = f; osc2.detune.value = 4;
  const filt = c.createBiquadFilter(); filt.type = 'lowpass'; filt.Q.value = 0.8;
  filt.frequency.setValueAtTime(Math.min(9000, f * 8), t);
  filt.frequency.exponentialRampToValueAtTime(Math.max(400, f * 1.6), t + 0.25);
  const g = c.createGain();
  const g2 = c.createGain(); g2.gain.value = 0.18;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(vol * 0.35, t + Math.min(0.35, dur * 0.5));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
  osc.connect(filt); osc2.connect(g2); g2.connect(filt); filt.connect(g); g.connect(dest);
  osc.start(t); osc2.start(t);
  osc.stop(t + dur + 0.3); osc2.stop(t + dur + 0.3);
}

/** Breathy sustained tone with a little vibrato — a recorder / shawm-lite. */
function pipe(dest: AudioNode, midi: number, t: number, dur: number, vol: number): void {
  const c = ctx!;
  const f = midiHz(midi);
  const osc = c.createOscillator(); osc.type = 'sine'; osc.frequency.value = f;
  const harm = c.createOscillator(); harm.type = 'triangle'; harm.frequency.value = f * 2;
  const hg = c.createGain(); hg.gain.value = 0.12;
  const vib = c.createOscillator(); vib.frequency.value = 5.5;
  const vibG = c.createGain(); vibG.gain.value = f * 0.006;
  vib.connect(vibG); vibG.connect(osc.frequency);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.06);
  g.gain.setValueAtTime(vol, t + Math.max(0.07, dur - 0.08));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
  osc.connect(g); harm.connect(hg); hg.connect(g); g.connect(dest);
  osc.start(t); harm.start(t); vib.start(t);
  osc.stop(t + dur + 0.1); harm.stop(t + dur + 0.1); vib.stop(t + dur + 0.1);
}

/** Small hand drum (tabor): a soft thump plus a whisper of skin noise. */
function tabor(dest: AudioNode, t: number, vol: number): void {
  const c = ctx!;
  const osc = c.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(150, t); osc.frequency.exponentialRampToValueAtTime(60, t + 0.09);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  osc.connect(g); g.connect(dest); osc.start(t); osc.stop(t + 0.2);
  const n = noiseSource(0.06);
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.7;
  const ng = c.createGain(); ng.gain.setValueAtTime(vol * 0.35, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  n.connect(bp); bp.connect(ng); ng.connect(dest); n.start(t); n.stop(t + 0.07);
}

let noiseBuf: AudioBuffer | null = null;
function noiseSource(seconds: number): AudioBufferSourceNode {
  const c = ctx!;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource(); src.buffer = noiseBuf; src.loop = seconds > 1;
  return src;
}

/** Bell-ish tone for chimes: sine fundamental with a fading upper partial. */
function bell(dest: AudioNode, midi: number, t: number, dur: number, vol: number): void {
  const c = ctx!;
  const f = midiHz(midi);
  const a = c.createOscillator(); a.type = 'sine'; a.frequency.value = f;
  const b = c.createOscillator(); b.type = 'sine'; b.frequency.value = f * 2.76; // inharmonic partial = metallic
  const bg = c.createGain(); bg.gain.setValueAtTime(0.25, t); bg.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.4);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  a.connect(g); b.connect(bg); bg.connect(g); g.connect(dest);
  a.start(t); b.start(t); a.stop(t + dur + 0.05); b.stop(t + dur + 0.05);
}

// ---------------------------------------------------------------------------
// The tune: about a minute long, in three sections that loop.
//   A (16 bars, D Dorian)  — the village dance on the lute: rises to the fifth, falls home.
//   B (16 bars, D Dorian)  — the answer an octave up, with a harp arpeggio underneath.
//   C (16 bars, G Dorian)  — a slow hymn on the pipe with bells, before A returns.
// Written in 6/8 as [midi, eighths] pairs; each bar is six eighths.
// ---------------------------------------------------------------------------
type Note = [number, number]; // [midi, length in eighths]
const D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69, Bb4 = 70, B4 = 71, C5 = 72, D5 = 74, E5 = 76, F5 = 77, G5 = 79;
const SECTION_A: Note[] = [
  [D4, 2], [E4, 1], [F4, 2], [G4, 1],   [A4, 3], [F4, 3],
  [G4, 2], [A4, 1], [B4, 2], [G4, 1],   [A4, 6],
  [C5, 2], [B4, 1], [A4, 2], [G4, 1],   [F4, 2], [G4, 1], [A4, 3],
  [G4, 2], [F4, 1], [E4, 2], [F4, 1],   [D4, 6],
  [A4, 2], [A4, 1], [C5, 2], [D5, 1],   [E5, 3], [D5, 3],
  [C5, 2], [D5, 1], [C5, 2], [A4, 1],   [G4, 6],
  [F4, 2], [G4, 1], [A4, 2], [C5, 1],   [B4, 3], [G4, 3],
  [A4, 2], [G4, 1], [F4, 2], [E4, 1],   [D4, 6],
];
const SECTION_B: Note[] = [
  [D5, 2], [E5, 1], [F5, 2], [E5, 1],   [D5, 3], [A4, 3],
  [C5, 2], [D5, 1], [E5, 2], [D5, 1],   [C5, 6],
  [B4, 2], [C5, 1], [D5, 2], [C5, 1],   [B4, 3], [G4, 3],
  [A4, 2], [B4, 1], [C5, 2], [B4, 1],   [A4, 6],
  [F5, 2], [E5, 1], [D5, 2], [C5, 1],   [D5, 3], [E5, 3],
  [F5, 2], [G5, 1], [F5, 2], [E5, 1],   [D5, 6],
  [C5, 2], [D5, 1], [E5, 2], [C5, 1],   [A4, 3], [C5, 3],
  [B4, 2], [A4, 1], [G4, 2], [F4, 1],   [E4, 3], [D4, 3],
];
const SECTION_C: Note[] = [
  [G4, 3], [A4, 3],                      [Bb4, 4], [A4, 2],
  [G4, 3], [D5, 3],                      [C5, 6],
  [Bb4, 2], [C5, 1], [D5, 3],            [E5, 3], [D5, 3],
  [C5, 2], [Bb4, 1], [A4, 3],            [G4, 6],
  [D5, 3], [E5, 3],                      [F5, 4], [E5, 2],
  [D5, 3], [C5, 3],                      [Bb4, 6],
  [A4, 2], [Bb4, 1], [C5, 3],            [D5, 3], [A4, 3],
  [Bb4, 2], [A4, 1], [G4, 2], [F4, 1],   [E4, 3], [D4, 3],
];
const MELODY: Note[] = [...SECTION_A, ...SECTION_B, ...SECTION_C];
// One bass root per bar; the fifth above is played on the second big beat.
const BASS_ROOTS = [
  38, 38, 43, 45, 48, 41, 43, 38,  38, 45, 48, 43, 41, 43, 45, 38, // A
  38, 38, 48, 48, 43, 43, 45, 45,  41, 41, 38, 38, 48, 45, 43, 38, // B
  43, 43, 43, 48, 43, 48, 41, 43,  43, 41, 43, 43, 41, 43, 41, 38, // C
];
const BARS = BASS_ROOTS.length;
const EIGHTHS_PER_BAR = 6;
const SONG_EIGHTHS = BARS * EIGHTHS_PER_BAR;
const EIGHTH_SEC = 0.21; // ~95 bpm on the quarter; a relaxed lilt — the whole loop is ~60s
const sectionOf = (bar: number): 'A' | 'B' | 'C' => (bar < 16 ? 'A' : bar < 32 ? 'B' : 'C');

// Diatonic transposition inside the mode, for a harmony line that never leaves it.
const DORIAN = [0, 2, 3, 5, 7, 9, 10]; // semitones above the tonic
function diatonicUp(midi: number, degrees: number, tonic = 62): number {
  const rel = ((midi - tonic) % 12 + 12) % 12;
  const deg = DORIAN.indexOf(rel);
  if (deg === -1) return midi + 4;
  const oct = Math.floor((midi - tonic) / 12);
  const nd = deg + degrees;
  return tonic + (oct + Math.floor(nd / 7)) * 12 + DORIAN[((nd % 7) + 7) % 7]!;
}

/** Harp: a clean, ringing pluck for arpeggios under the B and C sections. */
function harp(dest: AudioNode, midi: number, t: number, vol: number): void {
  const c = ctx!;
  const f = midiHz(midi);
  const a = c.createOscillator(); a.type = 'sine'; a.frequency.value = f;
  const b = c.createOscillator(); b.type = 'triangle'; b.frequency.value = f * 2;
  const bg = c.createGain(); bg.gain.setValueAtTime(0.35, t); bg.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
  a.connect(g); b.connect(bg); bg.connect(g); g.connect(dest);
  a.start(t); b.start(t); a.stop(t + 1.35); b.stop(t + 1.35);
}

interface MelodyEvent { at: number; midi: number; len: number }
const MELODY_EVENTS: MelodyEvent[] = (() => {
  const out: MelodyEvent[] = []; let at = 0;
  for (const [midi, len] of MELODY) { out.push({ at, midi, len }); at += len; }
  return out;
})();

let musicTimer: number | null = null;
let songStart = 0;       // ctx time at which the current pass began
let nextEighth = 0;      // next eighth index (within the whole song) to schedule
let passCount = 0;       // how many times through — controls which voices join
let droneNodes: AudioNode[] = [];

function startDrone(): void {
  if (!ctx || !musicBus || droneNodes.length) return;
  const c = ctx;
  const out = c.createGain(); out.gain.value = 0.05;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 1.2;
  const lfo = c.createOscillator(); lfo.frequency.value = 0.11;
  const lfoG = c.createGain(); lfoG.gain.value = 180;
  lfo.connect(lfoG); lfoG.connect(lp.frequency);
  for (const [midi, det] of [[38, -3], [45, 4], [38, 2]] as [number, number][]) {
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midiHz(midi); o.detune.value = det;
    o.connect(lp); o.start(); droneNodes.push(o);
  }
  lp.connect(out); out.connect(musicBus); lfo.start();
  droneNodes.push(lfo, lp, out);
}

function stopDrone(): void {
  for (const n of droneNodes) { try { (n as OscillatorNode).stop?.(); } catch { /* not an oscillator */ } try { n.disconnect(); } catch { /* already gone */ } }
  droneNodes = [];
}

function scheduleEighth(i: number, t: number): void {
  const bus = musicBus!;
  const inSong = i % SONG_EIGHTHS;
  const bar = Math.floor(inSong / EIGHTHS_PER_BAR);
  const beat = inSong % EIGHTHS_PER_BAR;
  const section = sectionOf(bar);
  const tonic = section === 'C' ? 67 : 62;
  const later = passCount >= 1; // second time round, the harmony voice and drum join in

  for (const ev of MELODY_EVENTS) {
    if (ev.at !== inSong) continue;
    const dur = ev.len * EIGHTH_SEC;
    if (section === 'C') {
      pipe(bus, ev.midi, t + 0.01, dur * 0.96, 0.075);               // the hymn is sung by the pipe
      if (later) pluck(bus, ev.midi - 12, t, dur, 0.14);            // lute doubles it an octave down
    } else {
      pluck(bus, ev.midi, t, dur, 0.28);
      if (later && ev.len >= 2) pipe(bus, diatonicUp(ev.midi, ev.len >= 3 ? 4 : 2, tonic), t + 0.01, dur * 0.95, 0.04);
    }
  }
  const root = BASS_ROOTS[bar]!;
  if (beat === 0) pluck(bus, root, t, 3 * EIGHTH_SEC, 0.22);
  if (beat === 3) pluck(bus, root + 7, t, 3 * EIGHTH_SEC, 0.14);
  // Harp arpeggio: broken chord over the bar in B, a slower roll in C.
  if (section === 'B') {
    const arp = [12, 19, 24, 19, 12, 7];
    harp(bus, root + arp[beat]!, t, 0.07);
  } else if (section === 'C' && (beat === 0 || beat === 2 || beat === 4)) {
    harp(bus, root + [12, 19, 24][beat / 2]!, t, 0.06);
  }
  // Bells mark each four-bar phrase of the hymn.
  if (section === 'C' && beat === 0 && bar % 4 === 0) bell(bus, root + 24, t, 1.6, 0.05);
  if (later && section !== 'C') {
    if (beat === 0) tabor(bus, t, 0.5);
    if (beat === 3) tabor(bus, t, 0.28);
    if (beat === 5 && bar % 2 === 1) tabor(bus, t, 0.18);
  }
}

function tick(): void {
  if (!ctx) return;
  const lookahead = 0.3;
  // Background tabs throttle timers, so we can wake up seconds (or minutes) behind.
  // Scheduling every missed note at once would freeze the page and play them all in
  // one burst — instead, jump the song forward to now and carry on from there.
  const behind = ctx.currentTime - (songStart + nextEighth * EIGHTH_SEC);
  if (behind > 1) {
    const skipped = Math.ceil(behind / EIGHTH_SEC);
    nextEighth += skipped;
    passCount = Math.floor(nextEighth / SONG_EIGHTHS);
  }
  let budget = 12; // never schedule more than a handful of eighths per tick
  while (budget-- > 0 && songStart + nextEighth * EIGHTH_SEC < ctx.currentTime + lookahead) {
    scheduleEighth(nextEighth, songStart + nextEighth * EIGHTH_SEC);
    nextEighth++;
    if (nextEighth % SONG_EIGHTHS === 0) passCount++;
  }
}

// While the tab is hidden nothing is audible anyway; stop the scheduler so it has
// nothing to catch up on, and resume cleanly when the tab comes back.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (musicTimer !== null) { clearInterval(musicTimer); musicTimer = null; } }
    else if (musicOn && ctx && ctx.state === 'running' && droneNodes.length) { musicTimer = window.setInterval(tick, 90); tick(); }
  });
}

function startMusic(): void {
  const c = ensureContext();
  if (!c || !musicBus || musicTimer !== null) return;
  songStart = c.currentTime + 0.1;
  nextEighth = 0; passCount = 0;
  musicBus.gain.cancelScheduledValues(c.currentTime);
  musicBus.gain.setValueAtTime(0.0001, c.currentTime);
  musicBus.gain.exponentialRampToValueAtTime(0.5, c.currentTime + 2.5);
  startDrone();
  musicTimer = window.setInterval(tick, 90);
  tick();
}

function stopMusic(): void {
  if (musicTimer !== null) { clearInterval(musicTimer); musicTimer = null; }
  if (ctx && musicBus) {
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
    musicBus.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
  }
  stopDrone();
}

// ---------------------------------------------------------------------------
// Sound effects
// ---------------------------------------------------------------------------
function sfxReady(): AudioContext | null {
  if (!sfxOn) return null;
  const c = ensureContext();
  if (!c || c.state !== 'running') return null;
  return c;
}

/** A tile landing on the table: a woody thock. */
export function sfxTilePlaced(): void {
  const c = sfxReady(); if (!c) return;
  const t = c.currentTime;
  const osc = c.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(210, t); osc.frequency.exponentialRampToValueAtTime(95, t + 0.07);
  const g = c.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  osc.connect(g); g.connect(sfxBus!); osc.start(t); osc.stop(t + 0.16);
  const n = noiseSource(0.05);
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 1.1;
  const ng = c.createGain(); ng.gain.setValueAtTime(0.35, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
  n.connect(bp); bp.connect(ng); ng.connect(sfxBus!); n.start(t); n.stop(t + 0.06);
}

/** A meeple set down: a small, lighter tick. */
export function sfxMeeplePlaced(): void {
  const c = sfxReady(); if (!c) return;
  const t = c.currentTime;
  const osc = c.createOscillator(); osc.type = 'triangle';
  osc.frequency.setValueAtTime(620, t); osc.frequency.exponentialRampToValueAtTime(390, t + 0.05);
  const g = c.createGain(); g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
  osc.connect(g); g.connect(sfxBus!); osc.start(t); osc.stop(t + 0.12);
}

/** Points scored: a rising chime, longer and brighter for bigger hauls. */
export function sfxScore(points: number, mine: boolean): void {
  const c = sfxReady(); if (!c) return;
  const t = c.currentTime;
  const base = mine ? 74 : 69; // D5 for you, A4 for anyone else
  const run = points >= 10 ? [0, 4, 7, 12, 16] : points >= 5 ? [0, 4, 7, 12] : [0, 4, 7];
  run.forEach((iv, i) => bell(sfxBus!, base + iv, t + i * 0.09, 0.7, 0.22));
  if (points >= 10) bell(sfxBus!, base + 19, t + run.length * 0.09, 1.2, 0.18);
}

/** It's your move: a gentle two-note ping. */
export function sfxYourTurn(): void {
  const c = sfxReady(); if (!c) return;
  const t = c.currentTime;
  bell(sfxBus!, 81, t, 0.35, 0.16);
  bell(sfxBus!, 86, t + 0.13, 0.6, 0.16);
}

/** Game over: a little fanfare on the lute and pipe. */
export function sfxGameOver(): void {
  const c = sfxReady(); if (!c) return;
  const t = c.currentTime;
  const chord = [62, 66, 69, 74, 78];
  chord.forEach((m, i) => pluck(sfxBus!, m, t + i * 0.07, 1.2, 0.28));
  pipe(sfxBus!, 81, t + 0.4, 0.5, 0.06);
  pipe(sfxBus!, 86, t + 0.9, 1.1, 0.07);
}

