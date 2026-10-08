// Procedural soundtrack and sound effects (Web Audio, no asset files).
// The track is an original 118 BPM synthwave ride: four-on-the-floor kick, gated clap, offbeat
// hats, a driving octave bass, a wide detuned pad, a plucky arpeggio and a lead with echo.
// 16 bars, looping. On top of it runs a motorcycle engine whose pitch follows your speed.

let ctx = null, master, musicBus, sfxBus, reverb, delay, engine = null;
let noiseBuf = null;
let musicOn = false, schedTimer = null, step = 0, nextTime = 0;
const settings = { music: 0.6, sfx: 0.8, master: 1 };
try { Object.assign(settings, JSON.parse(localStorage.getItem('pme_audio') || '{}')); } catch (e) { /* defaults */ }

const BPM = 118, STEP = 60 / BPM / 4;
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
// One chord per bar: Am, F, C, G (root, then voicing in MIDI)
const CHORDS = [
    { root: 45, notes: [57, 60, 64, 69] },
    { root: 41, notes: [57, 60, 65, 69] },
    { root: 48, notes: [55, 60, 64, 67] },
    { root: 43, notes: [55, 59, 62, 67] },
];
// Lead phrases, 4 bars x 16 steps: [step, midi, length in steps]
const LEAD_A = [
    [[0, 76, 3], [3, 74, 3], [6, 72, 2], [8, 69, 6], [14, 72, 2]],
    [[0, 72, 3], [3, 74, 3], [6, 77, 4], [10, 76, 6]],
    [[0, 79, 3], [3, 76, 3], [6, 72, 2], [8, 76, 4], [12, 74, 4]],
    [[0, 74, 3], [3, 71, 3], [6, 67, 2], [8, 71, 8]],
];
const LEAD_B = [
    [[0, 81, 2], [2, 79, 2], [4, 76, 4], [8, 81, 2], [10, 84, 6]],
    [[0, 81, 4], [4, 77, 4], [8, 76, 2], [10, 72, 6]],
    [[0, 79, 2], [2, 76, 2], [4, 79, 4], [8, 84, 4], [12, 83, 4]],
    [[0, 79, 4], [4, 74, 2], [6, 76, 2], [8, 74, 8]],
];

export function initAudio() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    master = ctx.createGain(); master.gain.value = 0.9;
    comp.connect(master).connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.connect(comp);
    sfxBus = ctx.createGain(); sfxBus.connect(comp);
    applyVolumes();

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Big hall reverb (generated impulse) and a dotted-eighth echo for the lead and arp
    reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.8, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
        const ch = ir.getChannelData(c);
        for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    reverb.buffer = ir;
    const revGain = ctx.createGain(); revGain.gain.value = 0.32;
    reverb.connect(revGain).connect(musicBus);
    delay = ctx.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const dlGain = ctx.createGain(); dlGain.gain.value = 0.3;
    delay.connect(fb).connect(delay);
    delay.connect(dlGain).connect(musicBus);

    startEngine();
    document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (document.hidden) ctx.suspend(); else ctx.resume();
    });
}

function applyVolumes() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const m = settings.master ?? 1;
    musicBus.gain.setTargetAtTime(settings.music * 0.5 * m, t, 0.05);
    sfxBus.gain.setTargetAtTime(settings.sfx * m, t, 0.05);
}
export function getVolumes() { return { ...settings }; }
export function setVolume(kind, v) {
    settings[kind] = Math.max(0, Math.min(1, v));
    try { localStorage.setItem('pme_audio', JSON.stringify(settings)); } catch (e) { /* ignore */ }
    applyVolumes();
}

// ----- instruments -----
function env(g, t, a, peak, d, sustain, r, end) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
    if (end) { g.gain.setValueAtTime(Math.max(0.0001, sustain), end); g.gain.exponentialRampToValueAtTime(0.0001, end + r); }
}
function noise(t, dur, type, freq, q, gain, out) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out || musicBus);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    return g;
}
function kick(t, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(gain || 0.7, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(musicBus); o.start(t); o.stop(t + 0.36);
}
// Gated 80s clap: a burst of noise into the big reverb
function clap(t) {
    for (let i = 0; i < 3; i++) noise(t + i * 0.012, 0.08, 'bandpass', 1400, 1.1, 0.17, musicBus);
    noise(t, 0.25, 'bandpass', 1600, 0.9, 0.12, reverb);
}
function hat(t, gain, open) { noise(t, open ? 0.16 : 0.04, 'highpass', 7500, 0.8, gain, musicBus); }
// Driving bass: saw through a resonant lowpass that snaps shut on each note
function bass(t, n, dur) {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = midi(n);
    f.type = 'lowpass'; f.Q.value = 6; f.frequency.setValueAtTime(1100, t); f.frequency.exponentialRampToValueAtTime(180, t + dur);
    env(g, t, 0.005, 0.22, dur * 0.6, 0.1, 0.05, t + dur);
    o.connect(f).connect(g).connect(musicBus); o.start(t); o.stop(t + dur + 0.1);
}
// Wide pad: two detuned saws per note, slow swell, soft lowpass, into the reverb
function pad(t, notes, dur) {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.frequency.value = 1500; f.Q.value = 0.5;
    env(g, t, dur * 0.35, 0.05, dur * 0.3, 0.035, 0.4, t + dur);
    f.connect(g); g.connect(musicBus); g.connect(reverb);
    for (const n of notes) for (const det of [-9, 9]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(n); o.detune.value = det;
        o.connect(f); o.start(t); o.stop(t + dur + 0.5);
    }
}
// Plucky arp: square blip into the echo
function pluck(t, n, gain) {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = midi(n);
    f.type = 'lowpass'; f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(500, t + 0.15);
    g.gain.setValueAtTime(gain || 0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(f).connect(g); g.connect(musicBus); g.connect(delay);
    o.start(t); o.stop(t + 0.22);
}
// Lead: saw + square an octave apart with vibrato, into echo and reverb
function lead(t, n, dur) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 2600; f.Q.value = 2;
    env(g, t, 0.02, 0.07, 0.12, 0.05, 0.15, t + dur);
    f.connect(g); g.connect(musicBus); g.connect(delay); g.connect(reverb);
    const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 5.2; vg.gain.value = 9;
    vib.connect(vg);
    for (const [type, mul, det] of [['sawtooth', 1, 0], ['square', 0.5, 6]]) {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = midi(n) * mul; o.detune.value = det;
        vg.connect(o.detune); o.connect(f); o.start(t); o.stop(t + dur + 0.25);
    }
    vib.start(t); vib.stop(t + dur + 0.25);
}

// One 16th-note step of the song. 16 bars: 2-bar intro (pad + arp), the groove from bar 2, lead
// in bars 4-7 and 10-15; bars 8-9 break down to pad, arp and hats.
function playStep(s, t) {
    const bar = Math.floor(s / 16) % 16, i = s % 16, chord = CHORDS[bar % 4];
    const intro = bar < 2, brk = bar === 8 || bar === 9;
    if (i === 0) pad(t, chord.notes, STEP * 16);
    if (!intro && !brk) {
        if (i % 4 === 0) kick(t, 0.7);
        if (i === 4 || i === 12) clap(t);
        if (i % 2 === 0) bass(t, chord.root + (i % 4 === 2 ? 12 : 0), STEP * 1.8);
    }
    if (!intro) hat(t, i % 4 === 2 ? 0.07 : 0.03, i % 8 === 6);
    // Arp climbs the chord over two octaves
    const arp = chord.notes.concat(chord.notes.map((n) => n + 12));
    if (i % 2 === 0) pluck(t, arp[(i / 2) % arp.length] + 12, brk ? 0.06 : 0.04);
    const melody = (bar >= 4 && bar < 8) || bar >= 10;
    if (melody) {
        const phrase = bar >= 12 ? LEAD_B : LEAD_A;
        for (const [at, n, l] of phrase[bar % 4]) if (at === i) lead(t, n, STEP * l);
    }
}

function scheduler() {
    while (nextTime < ctx.currentTime + 0.12) {
        playStep(step, nextTime);
        nextTime += STEP;
        step++;
    }
}
export function startMusic() {
    if (!ctx || musicOn) return;
    musicOn = true;
    step = 0; nextTime = ctx.currentTime + 0.1;
    schedTimer = setInterval(scheduler, 25);
}
export function stopMusic() { musicOn = false; clearInterval(schedTimer); }

// ----- motorcycle engine -----
// Two detuned oscillators (saw + square a fifth down) through a lowpass, with a fast LFO for
// the piston chug. setEngine() glides pitch, filter and volume with your speed.
function startEngine() {
    const out = ctx.createGain(); out.gain.value = 0;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 3;
    const chug = ctx.createGain(); chug.gain.value = 0.6;
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 18; lg.gain.value = 0.4;
    lfo.connect(lg).connect(chug.gain);
    const a = ctx.createOscillator(); a.type = 'sawtooth'; a.frequency.value = 45;
    const b = ctx.createOscillator(); b.type = 'square'; b.frequency.value = 30; b.detune.value = 8;
    const bg = ctx.createGain(); bg.gain.value = 0.5;
    a.connect(chug); b.connect(bg).connect(chug);
    chug.connect(f).connect(out).connect(sfxBus);
    a.start(); b.start(); lfo.start();
    engine = { out, f, a, b, lfo };
}
// moving: throttle open; speed: walk speed in studs/s
export function setEngine(moving, speed) {
    if (!engine) return;
    const t = ctx.currentTime, k = Math.min(1, (speed || 0) / 120);
    const rev = moving ? 1 : 0;
    const base = 38 + rev * (30 + k * 110);
    engine.a.frequency.setTargetAtTime(base, t, 0.15);
    engine.b.frequency.setTargetAtTime(base * 0.667, t, 0.15);
    engine.lfo.frequency.setTargetAtTime(14 + rev * (10 + k * 30), t, 0.15);
    engine.f.frequency.setTargetAtTime(380 + rev * (500 + k * 1600), t, 0.2);
    engine.out.gain.setTargetAtTime(0.05 + rev * 0.06, t, 0.25);
}

// ----- sound effects -----
function tone(t, type, f0, f1, dur, gain, out) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out || sfxBus); o.start(t); o.stop(t + dur + 0.05);
}
const SFX = {
    click(t) { tone(t, 'triangle', 900, 500, 0.06, 0.25); },
    jump(t) { tone(t, 'sine', 260, 620, 0.14, 0.25); },
    land(t) { noise(t, 0.12, 'lowpass', 500, 1, 0.35, sfxBus); tone(t, 'sine', 120, 60, 0.1, 0.3); },
    step() { /* the engine covers footsteps on a bike */ },
    pickup(t) { tone(t, 'sine', midi(84), null, 0.12, 0.3); tone(t + 0.07, 'sine', midi(91), null, 0.22, 0.3); },
    gain(t) { tone(t, 'triangle', midi(84), null, 0.06, 0.07); },
    hit(t) { tone(t, 'sine', 180, 50, 0.25, 0.7); noise(t, 0.25, 'lowpass', 1200, 1, 0.5, sfxBus); },
    death(t) { tone(t, 'sawtooth', 420, 60, 0.7, 0.25); noise(t, 0.5, 'lowpass', 800, 1, 0.3, sfxBus); },
    // Throttle blip: the engine screams up and back down
    rev(t) {
        const f = ctx.createBiquadFilter(), g = ctx.createGain();
        f.type = 'lowpass'; f.Q.value = 4; f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(3000, t + 0.35); f.frequency.exponentialRampToValueAtTime(500, t + 1.1);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
        f.connect(g).connect(sfxBus);
        for (const [type, mul] of [['sawtooth', 1], ['square', 0.5]]) {
            const o = ctx.createOscillator(); o.type = type;
            o.frequency.setValueAtTime(60 * mul, t); o.frequency.exponentialRampToValueAtTime(220 * mul, t + 0.35); o.frequency.exponentialRampToValueAtTime(55 * mul, t + 1.1);
            o.connect(f); o.start(t); o.stop(t + 1.25);
        }
    },
    levelUp(t) { [72, 76, 79, 84].forEach((n, i) => tone(t + i * 0.08, 'square', midi(n), null, 0.25, 0.12)); tone(t + 0.32, 'triangle', midi(88), null, 0.6, 0.2); },
    buy(t) { [79, 84, 88, 91, 96].forEach((n, i) => tone(t + i * 0.05, 'sine', midi(n), null, 0.3, 0.16)); },
    whoosh(t) {
        const src = ctx.createBufferSource(); src.buffer = noiseBuf;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
        f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3000, t + 0.35);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        src.connect(f).connect(g).connect(sfxBus); src.start(t); src.stop(t + 0.55);
    },
    cheer(t) {
        // Drum roll into a fanfare
        for (let i = 0; i < 6; i++) tone(t + i * 0.04, 'sine', 180 - i * 8, 90, 0.08, 0.2);
        [72, 76, 79, 84, 88].forEach((n, i) => tone(t + 0.25 + i * 0.07, 'square', midi(n), null, 0.3, 0.08));
        noise(t + 0.25, 0.6, 'highpass', 4000, 0.7, 0.12, sfxBus);
    },
    gate(t) {
        [84, 88, 91, 96, 100].forEach((n, i) => tone(t + i * 0.035, 'sine', midi(n), null, 0.5, 0.09));
        tone(t, 'triangle', 220, 880, 0.35, 0.12);
    },
    // Police siren: two-tone wail
    siren(t) {
        for (let i = 0; i < 2; i++) {
            const o = ctx.createOscillator(), g = ctx.createGain(), s = t + i * 0.6;
            o.type = 'square'; o.frequency.setValueAtTime(960, s); o.frequency.setValueAtTime(720, s + 0.3);
            g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.06, s + 0.03); g.gain.setValueAtTime(0.06, s + 0.55); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.6);
            o.connect(g).connect(sfxBus); o.start(s); o.stop(s + 0.62);
        }
    },
    // Low buzz when something blocks you
    denied(t) { tone(t, 'square', 140, 90, 0.25, 0.18); tone(t + 0.12, 'square', 120, 80, 0.25, 0.16); },
    firework(t) { tone(t, 'sine', 900, 200, 0.35, 0.06); noise(t + 0.35, 0.4, 'lowpass', 2500, 0.8, 0.35, sfxBus); },
};
export function sfx(name) {
    if (!ctx || !SFX[name] || settings.sfx <= 0) return;
    SFX[name](ctx.currentTime + 0.005);
}
