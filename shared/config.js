// Game data shared by the client and the Colyseus server.
// +1 Motorcycle Evolution: ride your motorcycle, every step is +Speed, break through the stage
// gates of a neon city road, collect Wins and unlock faster bikes.

export const CFG = {
    maxLevel: 200,
    rebirthLevel: 25,
    minWalk: 14,
    walkPerLevel: 2,
    maxWalk: 240,
    gainInterval: 0.5,
    staminaMax: 12,
    staminaDrain: 3,
    staminaRegen: 2,
    staminaDelay: 1,
    sprintMult: 1.35,
    courseWidth: 44,
    wallHeight: 46,
    voidY: -40,
    endZone: 40,
    pickupRespawn: 10,
    maxPickupsPerStage: 40,
    // Race event ("Race starting in 20s! JOIN"): one every `every` seconds on the server clock.
    // Racers start together at the Stage 1 gate; the first to touch the Stage 1 Wins pad wins.
    race: { every: 300, countdown: 20, prizeWins: 5, maxTime: 120 },
    boostMult: 2,
    boostMinutes: 15,
    reviveTimeout: 3,
    shieldTime: 3,
    starterPackDuration: 15 * 60,
    offerRotate: 45,
    rebirthStep: 0.5,
    rebirthWalk: 10,
    // Each rebirth also adds +1x to the Wins you get from the stage pads
    rebirthWins: 1,
    // Friend Boost: +10% Speed per Bloxity friend in the same server, up to 5
    friendBoost: 0.1,
    friendMax: 5,
    // Treadmills keep paying while you're away: Speed for up to 8 hours, at a quarter rate
    offlineHours: 8,
    offlineRate: 0.25,
    maxPlayers: 24,
};

// As in the reference: Level 1 needs 57.5 XP, then 66.1 / 76 / 87.5 ... (x1.15 per level).
// XP is earned 1:1 with Speed.
export const xpFor = (L) => Math.round(50 * Math.pow(1.15, Math.max(1, L)) * 10) / 10;
// "New Speed: 14 -> 16": +2 walk speed per level, +10 per rebirth
export const maxSpeedFor = (L, R) => Math.min(CFG.maxWalk,
    CFG.minWalk + CFG.walkPerLevel * Math.max(0, (L || 1) - 1) + CFG.rebirthWalk * (R || 0));

export const LOBBY = { halfX: 85, halfZ: 70, wallHeight: 30, spawn: { x: 0, y: 0.5, z: -40 } };

// The race road runs along +z out of the lobby: six stages, each harder than the last.
//   1 street   - a city street broken by a pit: jump across floating blocks, then up a purple deck
//   2 bridge   - red brick ground with a raised causeway; concrete barriers to JUMP over and
//                spike traps that shoot up (red light first) - touch them and you crash
//   3 tunnels  - stone tunnels; cars burst out across the road (amber light first): stop, then go
//   4 highway  - a truck sweeping across the road and police cars driving at you
//   5 chase    - a huge open police square: one police car chases you in, another cuts you off
//                from the exit; out-ride them (chase speed) and escape through the EXIT gate
//   6 final    - jump barriers, crossing trucks and a faster police chase, all at once
// Each stage starts at a floating "Stage N" title with a pink see-through wall (a checkpoint you
// ride through) and ends with an "X2 Win!" pad and a "+N Wins / Return" pad. Getting hit by a
// vehicle crashes you (Revive or back to the lobby).
// sub = hint under the stage title; y0 / y1 = road height at the start / end
// theme: palette = building colours, neon = curb / sign glow, haze = sky tint while inside
export const STAGES = [
    { name: 'Stage 1', sub: 'JUMP ACROSS THE FLOATING BLOCKS!', subColor: '#9f8aff', type: 'street', len: 300, w: 44, wins: 1, y0: 0, y1: 4,
        theme: { palette: [0xff5a8c, 0xffb627, 0x3dc6ff, 0x8c5cff, 0x4be08a, 0xff7a45], neon: 0x28d8ff, haze: 0xc8b4ff } },
    { name: 'Stage 2', sub: 'JUMP THE BARRIERS, WATCH THE SPIKES!', subColor: '#7fe8ff', type: 'bridge', len: 380, w: 44, wins: 3, y0: 4, y1: 4,
        theme: { palette: [0xff8fc7, 0xc08bff, 0x7fd6ff, 0xffb13d, 0x9c7bff, 0xff6fae], neon: 0x28e8ff, haze: 0xd8b4ff } },
    { name: 'Stage 3', sub: 'STOP FOR CROSSING CARS!', subColor: '#ffb51c', type: 'tunnels', len: 520, w: 44, wins: 8, y0: 4, y1: 4,
        theme: { palette: [0xff8a3d, 0xffcf4a, 0xe8505b, 0x4ac1ff, 0xb967ff, 0x4be08a], neon: 0xffa028, haze: 0xb8a8ff } },
    { name: 'Stage 4', sub: 'DODGE THE TRAFFIC!', subColor: '#ff6ef0', type: 'highway', len: 420, w: 44, wins: 20, y0: 4, y1: 4,
        theme: { palette: [0xffa8d8, 0xc8a8ff, 0x9fd8ff, 0xffc8e8, 0xb898ff, 0xff9ac8], neon: 0xff4ad8, haze: 0xa496ff } },
    { name: 'Stage 5', sub: 'POLICE CHASE! Escape across the square (28+)!', subColor: '#ff4a5a', type: 'chase', chase: 28, len: 560, w: 44, wins: 50, y0: 4, y1: 4,
        // The open police square: from / to = z offsets into the stage, half = half its width;
        // a second police car comes at you from the exit side once you are in it
        arena: { from: 50, to: 400, half: 120, interceptor: 0.85 },
        theme: { palette: [0x3a6aff, 0x2a3a8a, 0xe8e8f4, 0x4ac1ff, 0x5a5aa8, 0xff4a5a], neon: 0x3a7aff, haze: 0x8aa0ff } },
    { name: 'Stage 6', sub: 'FINAL: JUMP, DODGE, ESCAPE (40+)!', subColor: '#ffd028', type: 'final', chase: 40, len: 560, w: 44, wins: 125, y0: 4, y1: 4,
        theme: { palette: [0x7209b7, 0xf72585, 0x4361ee, 0xb5179e, 0x3a0ca3, 0x4cc9f0], neon: 0xf72585, haze: 0x8a5ac8 } },
];
// Vehicles on the road (server clock, so every player sees them in the same place).
// cross*: cars bursting out of the tunnels (warn = seconds the amber light flashes first)
export const TRAFFIC = { truckPeriod: 7, policeSpeed: 32, policeGap: 70, crossSpeed: 55, crossPeriod: 6, crossWarn: 1.6 };
// Spike traps (Stage 2): one cycle every `period` s: down, red warning, shoot up, stay up, sink
export const SPIKES = { period: 3.4, warnAt: 1.4, upAt: 2.0, downAt: 3.0, height: 2.8 };
{
    let z = 70;
    for (const s of STAGES) {
        s.zS = z;
        s.zE = z + s.len;
        s.cE = s.zE - CFG.endZone;
        z = s.zE;
    }
}
export function stageAt(z) {
    for (let i = 0; i < STAGES.length; i++) if (z >= STAGES[i].zS && z < STAGES[i].zE) return i;
    return -1;
}

// TREADMILLS area on the right of the road (-x), south to north: 3x 9x 25x 100x
export const TREADMILLS = [
    { mult: 3 },
    { mult: 9, req: 25 },
    { mult: 25, req: 250 },
    { mult: 100, pass: 'Treadmill100x', tag: '*SUPER OP*' },
];
// Belt geometry (also used by the server to know who is on a treadmill)
export const TREAD_GEO = { cx: -54, top: 1.5, len: 16, width: 9, z0: -40, step: 15 };
export function treadmillAt(x, y, z) {
    const g = TREAD_GEO;
    if (Math.abs(x - g.cx) > g.len / 2 + 1 || y > g.top + 3 || y < g.top - 0.5) return null;
    for (let i = 0; i < TREADMILLS.length; i++) {
        if (Math.abs(z - (g.z0 + i * g.step)) <= g.width / 2 + 0.5) return TREADMILLS[i];
    }
    return null;
}

// Lobby freebies: the LIKE REWARD chest (once a day), the Mystery Crate (a free bike after
// playing a while) and the "Keep playing" garage's free Speed Boost
export const GROUP_CHEST = { hours: 24, speed: 2500, wins: 2 };
export const EGG_MINUTES = 20;
export const FREE_BOOST_MINUTES = 15;

export const PRODUCTS = {
    Speed100K: { name: '+100K Speed', price: 29, speed: 100000 },
    Speed1M: { name: '+1M Speed', price: 79, speed: 1000000 },
    Speed10M: { name: '+10M Speed', price: 149, speed: 10000000 },
    StarterPack: { name: 'OP Starter Pack', price: 19, speed: 50000, wins: 15 },
    Revive: { name: 'Revive', price: 9 },
    SpeedBoost: { name: 'x2 Speed Boost (15 min)', price: 49 },
    Wins500: { name: '+500 Wins', price: 99, wins: 500 },
    Wins5K: { name: '+5K Wins', price: 399, wins: 5000 },
};
export const PASSES = {
    DoubleSpeed: { name: 'x2 Speed', price: 9, ic: '⚡', desc: 'Double all Speed you earn' },
    DoubleWins: { name: 'x2 Wins', price: 139, ic: '🏆', desc: 'Double Wins from every stage' },
    Treadmill100x: { name: '100x Treadmill', price: 279, ic: '🚀', desc: 'Unlocks the 100x treadmill' },
    CheapBike: { name: 'Pocket Rocket', price: 9, ic: '🛵', desc: '+40 Speed per step' },
    OPBike: { name: 'OP Nitro Dragon', price: 199, ic: '🐉', desc: '+400 Speed per step' },
    RainbowAura: { name: 'Rainbow Aura', price: 99, ic: '🌈', desc: 'x5 Speed aura' },
};
// Bloxity Bux SKUs: create these in the game's IAP catalog on bloxity.io (prices live there)
export const SKUS = {
    product: {
        Speed100K: 'speed_100k', Speed1M: 'speed_1m', Speed10M: 'speed_10m',
        StarterPack: 'starter_pack', Revive: 'revive', SpeedBoost: 'speed_boost',
        Wins500: 'wins_500', Wins5K: 'wins_5k',
    },
    pass: {
        DoubleSpeed: 'pass_double_speed', DoubleWins: 'pass_double_wins', Treadmill100x: 'pass_treadmill_100x',
        CheapBike: 'pass_cheap_bike', OPBike: 'pass_op_bike', RainbowAura: 'pass_rainbow_aura',
    },
};
// Bux price label for 3D text (DOM uses the coin icon instead)
export const buxText = (n) => fmt(n) + ' Bux';
export function skuLookup(sku) {
    for (const kind of ['product', 'pass']) for (const [key, s] of Object.entries(SKUS[kind])) if (s === sku) return { kind, key };
    return null;
}

export const OFFERS = [
    { title: 'OP STARTER PACK', ic: '🎁', kind: 'product', key: 'StarterPack' },
    { title: 'Pocket Rocket x40', ic: '🛵', kind: 'pass', key: 'CheapBike' },
    { title: '10M Speed', ic: '👟', kind: 'product', key: 'Speed10M' },
    { title: 'OP Nitro Dragon', ic: '🐉', kind: 'pass', key: 'OPBike' },
    { title: '100x Treadmill', ic: '🚀', kind: 'pass', key: 'Treadmill100x' },
];

// Motorcycles you ride. bonus = Speed per step ("+N/Speed"), req = Wins to unlock it.
// style picks the model in client/src/bike.js (dirt, street, chopper, sport, hyper, scooter).
// Row 1 is the front row of the MOTORCYCLES showroom (south to north), row 2 the raised back row.
// The Turbo Scooter comes out of the Mystery Crate after EGG_MINUTES of play.
const B_ = (id, name, bonus, req, row, style, body, accent, extra) =>
    Object.assign({ id, name, bonus, req, row, style, body, accent }, extra || {});
export const BIKES = [
    B_('Dirt', 'Dirt Rider', 1, 0, 1, 'dirt', 0x8a5a3a, 0xffc440),
    B_('Street', 'Street Runner', 2, 3, 1, 'street', 0x28bed2, 0xffffff),
    B_('Crimson', 'Crimson Fang', 5, 15, 1, 'dirt', 0xdc2834, 0xffe6e6),
    B_('Comet', 'Blue Comet', 25, 100, 1, 'sport', 0x286eff, 0x78e6ff),
    B_('Shadow', 'Shadow Chopper', 50, 500, 1, 'chopper', 0x26262e, 0xbe5aff),
    B_('Rocket', 'Pocket Rocket', 40, 0, 1, 'scooter', 0xff5aa0, 0xfff07a, { pass: 'CheapBike', tagline: 'Cheap Bike!' }),
    B_('Dragon', 'OP Nitro Dragon', 400, 0, 1, 'hyper', 0x8a2aff, 0xffd028, { pass: 'OPBike', tagline: 'OP BIKE!', glow: 0xc46aff }),
    B_('Viper', 'Neon Viper', 100, 2500, 2, 'sport', 0x1edc6e, 0xc8ff50),
    B_('Golden', 'Golden Thunder', 250, 15000, 2, 'chopper', 0xffbe28, 0xfffac8, { glow: 0xffd028 }),
    B_('Cyber', 'Cyber Blade', 500, 50000, 2, 'hyper', 0xebebf5, 0x00e6ff, { glow: 0x00e6ff }),
    B_('Inferno', 'Inferno', 1000, 250000, 2, 'hyper', 0xff5a14, 0xffdc3c, { glow: 0xff6e14, fire: true }),
    B_('Frost', 'Frost Phantom', 2000, 500000, 2, 'sport', 0xaae6ff, 0xffffff, { glow: 0x9fe8ff, fire: true }),
    B_('Galaxy', 'Galaxy Hyper', 5000, 1000000, 2, 'hyper', 0x5a1ebe, 0xff50e6, { glow: 0xff50e6, fire: true, size: 1.1 }),
    B_('Void', 'Void Reaper', 10000, 2000000, 2, 'chopper', 0x0c0c10, 0xff1e3c, { glow: 0xff1e3c, fire: true, size: 1.1 }),
    B_('Celestial', 'Celestial God', 25000, 5000000, 2, 'hyper', 0xffffff, 0xffd75a, { glow: 0xffe68a, fire: true, size: 1.15 }),
    B_('Turbo', 'Turbo Scooter', 150, 0, 0, 'scooter', 0x46e03c, 0xffffff, { timed: true }),
];
export const bikeById = Object.fromEntries(BIKES.map((d) => [d.id, d]));
export const STARTER_BIKE = 'Dirt';

export const AURAS = [
    { id: 'Neon', name: 'Neon Glow', req: 10, mult: 1.1, color: 0x28d8ff, ic: '💠' },
    { id: 'Nitro', name: 'Nitro', req: 50, mult: 1.25, color: 0xffb51c, ic: '🔥' },
    { id: 'Plasma', name: 'Plasma', req: 250, mult: 1.5, color: 0xff4ad8, ic: '🟣' },
    { id: 'Lightning', name: 'Lightning', req: 1000, mult: 2, color: 0x5ae6ff, ic: '⚡' },
    { id: 'Galaxy', name: 'Galaxy', req: 5000, mult: 3, color: 0xaa46ff, ic: '🌌' },
    { id: 'Rainbow', name: 'Rainbow', pass: 'RainbowAura', mult: 5, color: 0xff50c8, ic: '🌈' },
];
export const auraById = Object.fromEntries(AURAS.map((a) => [a.id, a]));

// Session playtime rewards (minutes since joining)
export const FREE = [
    { min: 2, speed: 500 }, { min: 5, wins: 2 }, { min: 10, speed: 5000 },
    { min: 15, wins: 5 }, { min: 25, speed: 25000 }, { min: 40, wins: 15 },
];

// Daily Reward: seven days (+20, +100, +10K, +1K, +100K, +10K, 2 Rebirths).
// One claim per UTC day; missing a day resets the streak. Day 7 repeats past a week.
export const DAILY = [
    { speed: 20 }, { wins: 100 }, { speed: 10000 }, { wins: 1000 }, { speed: 100000 }, { wins: 10000 }, { rebirths: 2 },
];
export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
// Daily state at time now: can = claimable, streak = days claimed in a row, day = DAILY index of the next (or last) claim
export function dailyStatus(d, now) {
    d = d || {};
    const today = dayKey(now), yesterday = dayKey(now - 86400000);
    const can = d.last !== today;
    const streak = d.last === today || d.last === yesterday ? d.streak || 0 : 0;
    return { can, streak, day: Math.min(DAILY.length - 1, can ? streak : Math.max(0, streak - 1)) };
}
export const rewardText = (r) => [
    r.speed ? '+' + fmt(r.speed) + ' Speed' : '',
    r.wins ? '+' + fmt(r.wins) + ' Wins' : '',
    r.rebirths ? '+' + r.rebirths + ' Rebirths' : '',
].filter(Boolean).join(' & ');

// Rider outfits (biker jackets) cycle by join order so players look different from each other
export const KITS = [
    { shirt: 0x14141e, shorts: 0x2a3a6a, socks: 0x14141e },
    { shirt: 0x2f7bff, shorts: 0x1e2a44, socks: 0x2f7bff },
    { shirt: 0xe82434, shorts: 0x14141e, socks: 0xe82434 },
    { shirt: 0x28c43c, shorts: 0x1e2a44, socks: 0x28c43c },
    { shirt: 0xffb51c, shorts: 0x1e3caa, socks: 0xffb51c },
    { shirt: 0x8a1cff, shorts: 0x1e2a44, socks: 0x8a1cff },
    { shirt: 0xff3fa0, shorts: 0x1e2a44, socks: 0xff3fa0 },
    { shirt: 0x1ec8b4, shorts: 0x14141e, socks: 0x1ec8b4 },
];
export const SKINS = [0xe1af87, 0xc88c5f, 0x8c5a3c, 0x5f3c28, 0xf0c8a0];

// Combined multiplier for earned Speed: rebirths, aura, 2x pass, timed boost, friends here
export function speedMult(p, now, friends) {
    let m = 1 + (p.rebirths || 0) * CFG.rebirthStep;
    const a = auraById[p.aura];
    if (a) m *= a.mult;
    if (p.passes && p.passes.DoubleSpeed) m *= 2;
    if ((now || Date.now()) < (p.boostUntil || 0)) m *= CFG.boostMult;
    m *= 1 + CFG.friendBoost * Math.min(CFG.friendMax, friends || 0);
    return m;
}

const SUF = ['K', 'M', 'B', 'T', 'Qa', 'Qi'];
// 2700 -> "2.7K", 1000000 -> "1M", 950 -> "950"
export function fmt(v) {
    v = Math.floor(v || 0);
    if (v < 1000) return String(v);
    let i = -1, s = v;
    while (s >= 1000 && i < SUF.length - 1) { s /= 1000; i++; }
    const t = s >= 100 ? String(Math.floor(s)) : (Math.floor(s * 10) / 10).toFixed(1).replace(/\.0$/, '');
    return t + SUF[i];
}
// XP style: 57.5, 1,234.5 -> "1.2K"
export function fmt1(v) {
    v = v || 0;
    if (v >= 1000) return fmt(v);
    return (Math.floor(v * 10) / 10).toFixed(1).replace(/\.0$/, '');
}
// "2,527": the reference shows the Speed counter with thousands separators
export function commas(v) {
    v = Math.floor(v || 0);
    return v >= 1e9 ? fmt(v) : v.toLocaleString('en-US');
}
// Leaderboard style: 6700000 -> "6.7e+6"
export function sci(v) {
    v = Math.floor(v || 0);
    if (v < 100000) return fmt(v);
    const e = Math.floor(Math.log10(v));
    return (Math.floor(v / Math.pow(10, e) * 10) / 10).toFixed(1) + 'e+' + e;
}
export function clock(s) {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + sec : m + ':' + sec;
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function rngFrom(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
