// Synthesizes KelFront's original music and alert sound into proprietary/sounds.
// Run: node scripts/generateAudio.mjs   (requires ffmpeg with libmp3lame on PATH)
//
// Everything here is composed from scratch: original chord progressions and
// melodies rendered with simple additive/subtractive synthesis. Loops are
// rendered into a circular buffer so the reverb/decay tails wrap around and
// the track repeats seamlessly.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SR = 44100;
const TAU = Math.PI * 2;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

// Deterministic noise so regenerating gives identical files.
let seed = 1337;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const noise = () => rand() * 2 - 1;

class Track {
  constructor(seconds, loop) {
    this.n = Math.round(seconds * SR);
    this.loop = loop;
    this.L = new Float32Array(this.n);
    this.R = new Float32Array(this.n);
  }
  add(i, l, r) {
    let k = i;
    if (this.loop) k = ((i % this.n) + this.n) % this.n;
    else if (k < 0 || k >= this.n) return;
    this.L[k] += l;
    this.R[k] += r;
  }
}

const panGains = (pan) => {
  const a = ((pan + 1) / 2) * (Math.PI / 2);
  return [Math.cos(a), Math.sin(a)];
};

// Attack/sustain/release envelope.
function asr(t, dur, attack, release) {
  if (t < 0) return 0;
  if (t < attack) return t / attack;
  if (t < dur) return 1;
  const r = 1 - (t - dur) / release;
  return r > 0 ? r * r : 0;
}

// Warm pad: three detuned saws per note through a gently moving low-pass.
function pad(tr, t0, dur, notes, gain, cutoff = 1100) {
  const attack = Math.min(1.4, dur * 0.4);
  const release = 1.8;
  const len = Math.round((dur + release) * SR);
  const start = Math.round(t0 * SR);
  for (const m of notes) {
    [-7, 0, 7].forEach((cents, v) => {
      const f = hz(m) * 2 ** (cents / 1200);
      const [gl, gr] = panGains((v - 1) * 0.6);
      let phase = rand();
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        phase += f / SR;
        phase -= Math.floor(phase);
        const saw = 2 * phase - 1;
        const fc = cutoff * (1 + 0.25 * Math.sin(TAU * 0.13 * (t0 + t)));
        lp += (1 - Math.exp((-TAU * fc) / SR)) * (saw - lp);
        const s = lp * asr(t, dur, attack, release) * gain;
        tr.add(start + i, s * gl, s * gr);
      }
    });
  }
}

// Soft plucked tone (triangle + sine) for arpeggios and melodies.
function pluck(tr, t0, m, gain, pan = 0, decay = 0.45, len = 1.6) {
  const f = hz(m);
  const [gl, gr] = panGains(pan);
  const start = Math.round(t0 * SR);
  const n = Math.round(len * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const p = (f * t) % 1;
    const tri = 1 - 4 * Math.abs(p - 0.5);
    const env = Math.min(1, t / 0.004) * Math.exp(-t / decay);
    const s = (0.7 * tri + 0.3 * Math.sin(TAU * 2 * f * t)) * env * gain;
    tr.add(start + i, s * gl, s * gr);
  }
}

// Lead voice with slow attack and vibrato.
function lead(tr, t0, dur, m, gain, pan = 0.1) {
  const f = hz(m);
  const [gl, gr] = panGains(pan);
  const start = Math.round(t0 * SR);
  const n = Math.round((dur + 0.6) * SR);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const vib = 1 + 0.004 * Math.sin(TAU * 5.2 * t) * Math.min(1, t / 0.4);
    phase += (f * vib) / SR;
    const s =
      (Math.sin(TAU * phase) +
        0.35 * Math.sin(TAU * 2 * phase) +
        0.12 * Math.sin(TAU * 3 * phase)) *
      asr(t, dur, 0.06, 0.6) *
      gain;
    tr.add(start + i, s * gl, s * gr);
  }
}

// FM bell.
function bell(tr, t0, m, gain, pan = 0, decay = 0.9) {
  const f = hz(m);
  const [gl, gr] = panGains(pan);
  const start = Math.round(t0 * SR);
  const n = Math.round(decay * 4 * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const idx = 2.2 * Math.exp(-t / 0.25);
    const s =
      Math.sin(TAU * f * t + idx * Math.sin(TAU * 3.5 * f * t)) *
      Math.min(1, t / 0.002) *
      Math.exp(-t / decay) *
      gain;
    tr.add(start + i, s * gl, s * gr);
  }
}

// Round sub bass.
function bass(tr, t0, dur, m, gain) {
  const f = hz(m);
  const start = Math.round(t0 * SR);
  const n = Math.round((dur + 0.15) * SR);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const sq = Math.sin(TAU * f * t) > 0 ? 1 : -1;
    lp += 0.04 * (sq - lp);
    const s =
      (0.75 * Math.sin(TAU * f * t) + 0.35 * lp) *
      asr(t, dur, 0.01, 0.15) *
      gain;
    tr.add(start + i, s, s);
  }
}

// Taiko-style drum: falling sine plus a short noise skin.
function taiko(tr, t0, gain, pan = 0) {
  const [gl, gr] = panGains(pan);
  const start = Math.round(t0 * SR);
  const n = Math.round(0.9 * SR);
  let phase = 0;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 52 + 90 * Math.exp(-t / 0.045);
    phase += f / SR;
    lp += 0.08 * (noise() - lp);
    const s =
      (Math.sin(TAU * phase) * Math.exp(-t / 0.32) +
        lp * 1.6 * Math.exp(-t / 0.03)) *
      gain;
    tr.add(start + i, s * gl, s * gr);
  }
}

// Short filtered-noise tick (rim/hat).
function tick(tr, t0, gain, pan = 0, decay = 0.025) {
  const [gl, gr] = panGains(pan);
  const start = Math.round(t0 * SR);
  const n = Math.round(decay * 8 * SR);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const x = noise();
    const hp = x - prev;
    prev = x;
    const s = hp * Math.exp(-t / decay) * gain;
    tr.add(start + i, s * gl, s * gr);
  }
}

// Schroeder reverb applied circularly (two passes) for loops.
function reverb(tr, wet = 0.22) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491];
  const allL = [556, 441];
  const allR = [579, 459];
  const cb = combs.map((d) => ({ buf: new Float32Array(d), i: 0, lp: 0 }));
  const mkAll = (ds) => ds.map((d) => ({ buf: new Float32Array(d), i: 0 }));
  const aL = mkAll(allL);
  const aR = mkAll(allR);
  const outL = new Float32Array(tr.n);
  const outR = new Float32Array(tr.n);
  const passes = tr.loop ? 2 : 1;
  for (let pass = 0; pass < passes; pass++) {
    for (let k = 0; k < tr.n; k++) {
      const x = (tr.L[k] + tr.R[k]) * 0.5;
      let acc = 0;
      for (const c of cb) {
        const y = c.buf[c.i];
        c.lp = y * 0.6 + c.lp * 0.4;
        c.buf[c.i] = x + c.lp * 0.82;
        c.i = (c.i + 1) % c.buf.length;
        acc += y;
      }
      acc /= cb.length;
      const ap = (chain, v) => {
        for (const a of chain) {
          const b = a.buf[a.i];
          const y = -v + b;
          a.buf[a.i] = v + b * 0.5;
          a.i = (a.i + 1) % a.buf.length;
          v = y;
        }
        return v;
      };
      outL[k] = ap(aL, acc);
      outR[k] = ap(aR, acc);
    }
  }
  for (let k = 0; k < tr.n; k++) {
    tr.L[k] += outL[k] * wet;
    tr.R[k] += outR[k] * wet;
  }
}

function master(tr, peakDb = -1.5) {
  let peak = 0;
  for (let k = 0; k < tr.n; k++) {
    tr.L[k] = Math.tanh(tr.L[k]);
    tr.R[k] = Math.tanh(tr.R[k]);
    peak = Math.max(peak, Math.abs(tr.L[k]), Math.abs(tr.R[k]));
  }
  const g = 10 ** (peakDb / 20) / (peak || 1);
  for (let k = 0; k < tr.n; k++) {
    tr.L[k] *= g;
    tr.R[k] *= g;
  }
}

function writeMp3(tr, outRel, bitrate = "128k") {
  const data = Buffer.alloc(tr.n * 4);
  for (let k = 0; k < tr.n; k++) {
    data.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, tr.L[k])) * 32767),
      k * 4,
    );
    data.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, tr.R[k])) * 32767),
      k * 4 + 2,
    );
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  const wav = path.join(os.tmpdir(), `kelfront-${path.basename(outRel)}.wav`);
  fs.writeFileSync(wav, Buffer.concat([header, data]));
  const out = path.join(root, outRel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    wav,
    "-codec:a",
    "libmp3lame",
    "-b:a",
    bitrate,
    out,
  ]);
  fs.unlinkSync(wav);
  console.log(
    `${outRel}  ${(tr.n / SR).toFixed(1)}s  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`,
  );
}

// ---------------------------------------------------------------------------
// Menu theme — D minor, 80 BPM, 16 bars. Calm and expansive.
function menuTheme() {
  const beat = 60 / 80;
  const bar = beat * 4;
  const tr = new Track(bar * 16, true);
  // [bass root, pad voicing]
  const chords = [
    [38, [57, 62, 65]], // Dm
    [34, [58, 62, 65]], // Bb
    [41, [57, 60, 65]], // F
    [36, [55, 60, 64]], // C
    [38, [57, 62, 65]], // Dm
    [43, [58, 62, 67]], // Gm
    [34, [58, 62, 65]], // Bb
    [33, [57, 61, 64]], // A
  ];
  // Melody: [beat offset within the 8-bar phrase, length in beats, midi]
  const melody = [
    [0, 2, 69],
    [2, 1, 65],
    [3, 1, 67],
    [4, 3, 65],
    [7, 1, 62],
    [8, 2, 72],
    [10, 2, 69],
    [12, 3, 67],
    [15, 1, 64],
    [16, 1, 69],
    [17, 2, 74],
    [19, 1, 72],
    [20, 2, 70],
    [22, 1, 69],
    [23, 1, 67],
    [24, 2, 65],
    [26, 1, 67],
    [27, 1, 69],
    [28, 2, 64],
    [30, 2, 73],
  ];
  for (let b = 0; b < 16; b++) {
    const [root, voicing] = chords[b % 8];
    const t = b * bar;
    pad(tr, t, bar, voicing, 0.05, 900);
    bass(tr, t, bar * 0.9, root, 0.22);
    // Gentle 8th-note arpeggio.
    const arp = [
      voicing[0] + 12,
      voicing[1] + 12,
      voicing[2] + 12,
      voicing[1] + 12,
    ];
    for (let s = 0; s < 8; s++) {
      pluck(
        tr,
        t + s * beat * 0.5,
        arp[s % 4],
        b < 8 ? 0.05 : 0.07,
        s % 2 ? 0.4 : -0.4,
        0.3,
      );
    }
    if (b >= 4) {
      taiko(tr, t, 0.32, -0.1);
      taiko(tr, t + beat * 2.5, 0.18, 0.15);
    }
    if (b === 15) {
      for (let r = 0; r < 4; r++)
        taiko(tr, t + beat * (3 + r * 0.25), 0.1 + r * 0.04);
    }
  }
  // Melody in bars 0-7, then a bell answer over bars 12-15.
  for (const [o, l, m] of melody) lead(tr, o * beat, l * beat * 0.95, m, 0.09);
  for (const [o, , m] of melody.filter(([o]) => o >= 16)) {
    bell(tr, (32 + o) * beat, m + 12, 0.06, 0.3, 0.8);
  }
  reverb(tr, 0.3);
  master(tr);
  return tr;
}

// Gameplay — E minor, 100 BPM, 32 bars. Steady pulse that stays out of the way.
function gameplay() {
  const beat = 60 / 100;
  const bar = beat * 4;
  const tr = new Track(bar * 32, true);
  const chords = [
    [40, [59, 64, 67]], // Em
    [36, [60, 64, 67]], // C
    [43, [59, 62, 67]], // G
    [38, [57, 62, 66]], // D
    [40, [59, 64, 67]], // Em
    [36, [60, 64, 67]], // C
    [45, [57, 60, 64]], // Am
    [35, [59, 63, 66]], // B
  ];
  const melody = [
    [0, 2, 71],
    [2, 1, 67],
    [3, 1, 69],
    [4, 3, 64],
    [7, 1, 67],
    [8, 2, 74],
    [10, 2, 71],
    [12, 3, 69],
    [15, 1, 66],
    [16, 1, 71],
    [17, 2, 76],
    [19, 1, 74],
    [20, 2, 72],
    [22, 1, 71],
    [23, 1, 69],
    [24, 2, 71],
    [26, 1, 69],
    [27, 1, 67],
    [28, 2, 66],
    [30, 2, 75],
  ];
  for (let b = 0; b < 32; b++) {
    const [root, voicing] = chords[b % 8];
    const t = b * bar;
    const section = Math.floor(b / 8); // 0 intro, 1 build, 2 full, 3 settle
    pad(tr, t, bar, voicing, 0.045, section === 2 ? 1300 : 950);
    // Bass: 8ths, root/octave pattern.
    const pat = [0, 0, 12, 0, 0, 7, 12, 0];
    for (let s = 0; s < 8; s++) {
      if (section === 0 && s % 2) continue;
      bass(tr, t + s * beat * 0.5, beat * 0.42, root + pat[s], 0.16);
    }
    if (section >= 1) {
      const arp = [
        voicing[0] + 12,
        voicing[2] + 12,
        voicing[1] + 12,
        voicing[2] + 12,
      ];
      for (let s = 0; s < 8; s++) {
        pluck(
          tr,
          t + s * beat * 0.5,
          arp[s % 4],
          0.045,
          s % 2 ? 0.5 : -0.5,
          0.22,
          0.8,
        );
      }
    }
    if (section >= 1 && section <= 3) {
      taiko(tr, t, 0.28);
      taiko(tr, t + beat * 2, 0.22, 0.1);
      if (section === 2) taiko(tr, t + beat * 3.5, 0.12, -0.2);
    }
    for (let s = 0; s < 8; s++) {
      if (section >= 1) tick(tr, t + s * beat * 0.5, s % 2 ? 0.05 : 0.025, 0.3);
    }
    if (section >= 2) {
      tick(tr, t + beat, 0.12, -0.15, 0.04);
      tick(tr, t + beat * 3, 0.12, -0.15, 0.04);
    }
  }
  for (const [o, l, m] of melody)
    lead(tr, 16 * bar + o * beat, l * beat * 0.95, m, 0.08);
  for (const [o, , m] of melody.slice(0, 9)) {
    bell(tr, 24 * bar + o * beat * 2, m + 12, 0.045, -0.3, 0.7);
  }
  reverb(tr, 0.25);
  master(tr, -2);
  return tr;
}

// Game-start alert — a bright rising chime.
function gameStartAlert() {
  const tr = new Track(2.2, false);
  [76, 80, 83, 88].forEach((m, i) => {
    bell(tr, 0.02 + i * 0.11, m, 0.35, (i - 1.5) * 0.3, 0.55);
  });
  bell(tr, 0.46, 88, 0.2, 0, 0.9);
  reverb(tr, 0.18);
  master(tr, -1);
  return tr;
}

writeMp3(menuTheme(), "proprietary/sounds/music/menu-theme.mp3", "128k");
writeMp3(gameplay(), "proprietary/sounds/music/gameplay.mp3", "128k");
writeMp3(
  gameStartAlert(),
  "proprietary/sounds/effects/game-start-alert.mp3",
  "160k",
);
