import { Client } from '@colyseus/sdk';
import {
    T, V3, $, canvas, renderer, scene, camera, sun, solids, kills, triggers, prompts, tickers,
    billboard, buildRig, ridePose, buildAuraFx, updateAuraFx, burst, confettiAt,
    floatText, updateEffects, lerpAngle,
} from './engine.js';
import { buildBike, animateBike } from './bike.js';
import { S, actions, net } from './state.js';
import { initAudio, startMusic, sfx, setVolume, setEngine } from './audio.js';
import * as BX from './bloxity.js';
import { createAvatar, loadBase, packAvatar, unpackAvatar, avatarStats } from './avatar.js';
import { updateMaterials } from './textures.js';
import { pad, pollGamepad, rumble, onGamepadConnection } from './gamepad.js';
import { render, setSpeedLines, updateFx, dust, sparkleColumn, ring, fireworks, setQuality, flame, exhaust, sparks, makeTrail } from './fx.js';
import {
    buildWorld, SPAWN, pickups, beltTex, refreshShop, renderBoards, treadLocked, updateLobbySigns, updateWorld, buildPolice,
} from './world.js';
import {
    updateHud, toast, levelUp, showStageTitle, buy, showRevive, hideRevive, closeModal, openModal,
    refreshModal, promptEl, promptTxtEl, showGoal, animateCounters, showOffline, openDailyOnJoin, showRace, raceCountdown,
} from './ui.js';
import {
    CFG, STAGES, TREADMILLS, TREAD_GEO, bikeById, auraById, KITS, SKINS, STARTER_BIKE, maxSpeedFor, stageAt, fmt, clamp,
} from '../../shared/config.js';

// =====================================================================================
// Local player
// =====================================================================================
const HW = 1, PH = 5, STEP = 1.7, GRAV = 196.2, JUMP_V = 50;
const P = {
    pos: SPAWN.clone(), vel: new V3(), push: new V3(), onGround: false, ground: null, facing: 0,
    dead: false, shield: 0, stamina: CFG.staminaMax, staminaIdle: 0, sprinting: false,
    lastSafe: SPAWN.clone(), safeTimer: 0, stage: -1, moving: false, animPhase: 0, lockToastT: -9,
    squash: 1, squashV: 0, airTime: 0, lastStep: 0, slowUntil: 0, tinyUntil: 0, frozenUntil: 0,
    lean: 0,
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let shake = 0;
function addShake(a) { if (!reduceMotion) shake = Math.min(1.2, shake + a); }
let rig, auraFx, headLabel, nameLabelText = '';

// ----- riders -----
// A rider is a group at the player's feet: the motorcycle they ride, and their body sitting on
// its seat (userData.body). Labels and the aura hang off the outer group.
const HIP = 2; // the blocky rig and the Bloxity body both have the hip about 2 studs up
function buildRider(kit, skin, name) {
    const g = new T.Group();
    const k = KITS[kit % KITS.length];
    const body = buildRig({ ...k, skin: SKINS[skin % SKINS.length], hair: 0x3a2618, hairStyle: ['short', 'buzz', 'curly', 'fade', 'quiff'][skin % 5], num: 1 + (kit % 99), numC: '#ffffff', label: (name || '').toUpperCase() });
    g.add(body);
    g.userData.body = body;
    return g;
}
// Swaps the bike under a rider and moves the body (and the head label) onto its seat
function setMount(g, id, label) {
    const d = bikeById[id] || bikeById[STARTER_BIKE];
    if (g.userData.mountId === d.id) return;
    if (g.userData.mount) g.remove(g.userData.mount);
    const bike = buildBike(d);
    g.add(bike);
    g.userData.mount = bike; g.userData.mountId = d.id; g.userData.bike = d;
    const y = bike.userData.seat - HIP + 0.15;
    g.userData.body.position.set(0, y, bike.userData.seatZ);
    if (label) label.position.y = y + 7.6;
}
const pipeAt = new V3(), backDir = new V3(), fireVel = new V3();
// Roll the bike, keep the rider on its seat leaning with it, puff exhaust smoke while riding,
// flames out of the pipe on the fire bikes and sparks off the road in hard leans
function animateRider(g, dt, t, moving, blox, speed, onGround, lean) {
    const u = g.userData;
    if (u.mount) {
        const bu = u.mount.userData;
        animateBike(u.mount, dt, moving, speed, lean || 0);
        const a = bu.inner.rotation.z, h = bu.seat - HIP + 0.15 + bu.inner.position.y;
        u.body.position.set(-Math.sin(a) * h, h * Math.cos(a), bu.seatZ);
        u.body.rotation.z = a;
    }
    ridePose(u.body, t, moving);
    if (blox) blox.update(dt, { moving, ride: true, speed, t });
    if (!u.mount || !g.visible) return;
    const bu = u.mount.userData;
    backDir.set(-Math.sin(g.rotation.y), 0, -Math.cos(g.rotation.y));
    if (Math.random() < dt * (moving ? 10 : 2.5)) {
        bu.exhaust.getWorldPosition(pipeAt);
        exhaust(pipeAt, backDir, 1);
    }
    if (bu.fire && moving && Math.random() < dt * 30) {
        bu.exhaust.getWorldPosition(pipeAt);
        fireVel.copy(backDir).multiplyScalar(10);
        flame(pipeAt, 0.3, 0.7, fireVel);
    }
    if (moving && onGround !== false && Math.abs(bu.inner.rotation.z) > 0.25 && speed > 40 && Math.random() < dt * 20) sparks(g.position, bu.glowColor, 2);
}

// ----- Bloxity avatars -----
// The Bloxity body replaces the blocky body's meshes; the bike, labels and aura stay.
function dressRig(group, avatar) {
    const body = group.userData.body;
    body.children.forEach((c) => { c.visible = false; });
    body.add(avatar.root);
    group.userData.blox = avatar;
}
let localAvatar = null, localAvatarReq = 0;
async function setupLocalAvatar() {
    const req = ++localAvatarReq;
    const a = await createAvatar(BX.currentAvatar(), BX.getSkinTextureUrl());
    if (!a) return;
    if (req !== localAvatarReq || !rig) { a.dispose(); return; }
    if (localAvatar) localAvatar.dispose();
    localAvatar = a;
    dressRig(rig, a);
}
function syncMyAvatar() {
    const av = BX.currentAvatar();
    if (localAvatar && av) { localAvatar.setProportions(av.proportions); localAvatar.setEquipped(av, BX.getSkinTextureUrl()); }
    net.send('avatar', { av: packAvatar(av) });
}
async function playEmoteOn(avatar, id) {
    if (!avatar) return;
    const cat = await BX.loadEmotes();
    const e = cat.get(id);
    if (e && e.clip) avatar.playEmote(e.clip);
}
// Chat bubble above a rig for a few seconds
function chatBubble(group, text) {
    if (!group) return;
    if (group.userData.bubble) { group.remove(group.userData.bubble); group.userData.bubble.material.map.dispose(); }
    const b = billboard([{ t: '💬 ' + text, c: '#ffffff', s: '#16121f', px: 44 }], 9, 1024, new V3(0, 9.4, 0), group);
    group.userData.bubble = b;
    setTimeout(() => { if (group.userData.bubble === b) { group.remove(b); b.material.map.dispose(); group.userData.bubble = null; } }, 5000);
}

function buildPlayer(kit, skin) {
    if (rig) scene.remove(rig);
    rig = buildRider(kit, skin, S.name);
    scene.add(rig);
    nameLabelText = '';
    // Name above the rider (the Speed count lives in the HUD, as in the reference)
    headLabel = billboard([{ t: S.name || ' ', c: '#ffffff', s: '#16121f', px: 64 }], 7, 512, new V3(0, 10, 0), rig);
    headLabel.material.depthTest = false; headLabel.renderOrder = 10;
    setMount(rig, S.equipped, headLabel);
    auraFx = buildAuraFx(rig);
    rig.position.copy(P.pos);
    localAvatar = null;
    setupLocalAvatar();
}
function overlapsBox(c, x, y, z) {
    return c.max.x > x - HW && c.min.x < x + HW && c.max.y > y && c.min.y < y + PH && c.max.z > z - HW && c.min.z < z + HW;
}
function freeAt(x, y, z) {
    for (const c of solids) if (overlapsBox(c, x, y, z)) return false;
    return true;
}
function moveAxis(axis, d) {
    if (d === 0) return;
    const p = P.pos;
    p[axis] += d;
    for (const c of solids) {
        if (!overlapsBox(c, p.x, p.y, p.z)) continue;
        if (axis === 'y') {
            if (d < 0) { p.y = c.max.y; P.vel.y = Math.max(0, P.vel.y); P.onGround = true; P.ground = c; }
            else { p.y = c.min.y - PH - 1e-4; if (P.vel.y > 0) P.vel.y = 0; }
        } else {
            const rise = c.max.y - p.y;
            if (rise > 0 && rise <= STEP && (P.onGround || P.vel.y <= 0) && freeAt(p.x, c.max.y + 0.01, p.z)) { p.y = c.max.y + 0.001; continue; }
            if (d > 0) p[axis] = c.min[axis] - HW - 1e-4; else p[axis] = c.max[axis] + HW + 1e-4;
        }
    }
}
function walkSpeed() {
    const max = maxSpeedFor(S.level, S.rebirths);
    let s = S.customSpeed > 0 && S.customSpeed <= max ? S.customSpeed : max;
    if (P.sprinting) s *= CFG.sprintMult;
    if (clockT < P.slowUntil) s *= 0.5;
    if (qaWalk) s = qaWalk;
    return s;
}

function teleport(pos, yaw) {
    P.pos.copy(pos); P.vel.set(0, 0, 0); P.push.set(0, 0, 0);
    P.lastSafe.copy(pos);
    P.facing = yaw || 0; cam.yaw = (yaw || 0) + Math.PI;
    for (const t of triggers) t.inside = overlapsBox(t, pos.x, pos.y, pos.z);
    sendMove(true);
}
function teleportLobby() { P.stage = -1; teleport(SPAWN, 0); }

// Auto Train: stand on the best unlocked treadmill and keep running while AFK.
// The belts push toward the red carpet (+x), so the rider faces -x.
const TRAIN_YAW = -Math.PI / 2;
let autoTrain = false;
function setAutoTrain(on) {
    autoTrain = on;
    $('#btnAuto').classList.toggle('on', on);
    if (!on) return;
    let best = -1;
    TREADMILLS.forEach((d, i) => { if (!treadLocked(d) && (best < 0 || d.mult > TREADMILLS[best].mult)) best = i; });
    if (P.dead) actions.revive(false);
    P.stage = -1;
    teleport(new V3(TREAD_GEO.cx, TREAD_GEO.top + 0.7, TREAD_GEO.z0 + best * TREAD_GEO.step), TRAIN_YAW);
    toast('Auto Train ON - x' + TREADMILLS[best].mult + ' treadmill', '#c28cff');
}
$('#btnAuto').addEventListener('click', () => { if (running) setAutoTrain(!autoTrain); });

// Dying bursts the rider and shows the Revive popup: revive where you fell (Bux)
// with a few seconds of shield, or go back to the lobby.
let deaths = 0;
// A crash never costs you the run: you respawn at the last checkpoint a moment later (or
// right where you crashed with a Revive). The server logs where and why, for the stats.
function die(cause) {
    if (P.dead || P.shield > 0) return;
    P.dead = true; deaths++;
    burst(P.pos.clone().add(new V3(0, 2.5, 0)), 0xff5a3c);
    sfx('death'); addShake(0.9); rumble(1, 400);
    sendMove(true);
    const stage = Math.max(P.stage, stageAt(P.pos.z));
    net.send('died', { s: stage, c: cause || 'crash' });
    showRevive(stage);
}
// The last checkpoint at or behind z (stage starts and mid-stage points from world.js)
function checkpointAt(z) {
    let best = null;
    for (let i = 0; i < STAGES.length; i++) {
        const s = STAGES[i];
        // A crash just past a gate still counts the checkpoint a few studs ahead of it
        const ahead = z >= s.zS ? 9 : 1;
        for (const cz of s.checkpoints || [s.zS + 8]) if (cz <= z + ahead && (!best || cz > best.z)) best = { z: cz, y: s.y0, i };
    }
    return best;
}
actions.revive = (atSpot) => {
    hideRevive();
    if (!P.dead) return;
    P.dead = false;
    const stage = P.stage;
    if (atSpot) {
        teleport(P.lastSafe.clone(), P.facing);
    } else {
        const cp = checkpointAt(P.pos.z);
        if (!cp) { teleportLobby(); return; }
        teleport(new V3(0, cp.y + 0.5, cp.z), 0);
        toast('Back to the checkpoint! 🏁', '#7dff6b');
    }
    P.stage = stage;
    P.shield = CFG.shieldTime;
};

// =====================================================================================
// Police chase (Stages 5 and 6). Police cars home in on you at the stage's chase speed, turning
// at a limited rate: out-ride them (level up your MAX Speed, or sprint), or swerve hard so they
// overshoot. They hop the barriers just like you. In the Stage 5 police square a second car comes
// at you from the exit side. They give up once you reach the Wins pads.
// =====================================================================================
const POLICE_TURN = 2.1;      // radians per second a police car can turn
const chase = { cars: [], on: false, stage: -1, sirenT: 0, interceptor: false };
function policeCar(i) {
    if (!chase.cars[i]) chase.cars[i] = { car: buildPolice(), x: 0, z: 0, h: 0, speed: 0, on: false };
    return chase.cars[i];
}
function launchPolice(c, x, z, h, speed) {
    Object.assign(c, { x, z, h, speed, on: true });
    c.car.visible = true;
}
function stopChase() {
    chase.on = false; chase.interceptor = false;
    for (const c of chase.cars) { c.on = false; c.car.visible = false; }
    $('#chaseWarn').hidden = true; $('#chaseVignette').style.opacity = 0;
}
// Height of the hop over any barrier the car is crossing
function policeHop(s, c) {
    let hop = 0;
    for (const b of s.barriers || []) {
        if (Math.abs(c.x - b.x) > b.w / 2 + 3) continue;
        const d = Math.abs(c.z - b.z);
        if (d < 9) hop = Math.max(hop, Math.sin((1 - d / 9) * Math.PI / 2) * 3.4);
    }
    return hop;
}
function updateChase(dt) {
    const s = STAGES[P.stage];
    const active = running && !P.dead && s && s.chase && P.pos.z < s.cE + 2;
    if (!active) { if (chase.on) stopChase(); return; }
    if (!chase.on || chase.stage !== P.stage) {
        stopChase();
        chase.on = true; chase.stage = P.stage;
        // Starts well behind you, so there is always a moment to get going
        launchPolice(policeCar(0), P.pos.x, P.pos.z - 50, 0, s.chase);
        toast('🚨 POLICE CHASE! Ride faster than ' + s.chase + '!', '#ff4a5a');
        sfx('siren'); chase.sirenT = 1.4;
    }
    // Stage 5: a second car comes out from the exit side as you enter the square
    const A = s.arena;
    if (A && !chase.interceptor && P.pos.z > s.zS + A.from + 8) {
        chase.interceptor = true;
        const side = P.pos.x > 0 ? -1 : 1;
        launchPolice(policeCar(1), side * (A.half - 30), s.zS + A.to - 25, Math.PI, s.chase * A.interceptor);
        toast('🚨 More police ahead! Find a way round!', '#ff4a5a');
    }
    let nearest = Infinity;
    for (const c of chase.cars) {
        if (!c.on) continue;
        // Turn toward you (limited turn rate), then drive forward
        const want = Math.atan2(P.pos.x - c.x, P.pos.z - c.z);
        let d = want - c.h;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        c.h += clamp(d, -POLICE_TURN * dt, POLICE_TURN * dt);
        c.x += Math.sin(c.h) * c.speed * dt;
        c.z += Math.cos(c.h) * c.speed * dt;
        // Stay inside the square / on the street
        const half = A && c.z > s.zS + A.from - 4 && c.z < s.zS + A.to + 4 ? A.half - 4 : s.w / 2 + 8;
        c.x = clamp(c.x, -half, half);
        const hop = policeHop(s, c);
        c.car.position.set(c.x, s.y0 + 0.2 + hop, c.z);
        c.car.rotation.y = c.h + Math.PI;
        const dist = Math.hypot(P.pos.x - c.x, P.pos.z - c.z);
        nearest = Math.min(nearest, dist - 5.5);
        if (dist < 5 && P.pos.y < s.y0 + 6 + hop) {
            addShake(1); die('police');
            if (walkSpeed() <= s.chase) setTimeout(() => toast('🚨 Too slow! Level up (or train on the treadmills) to ride faster than ' + s.chase, '#ffd028'), 600);
            return;
        }
    }
    chase.sirenT -= dt;
    if (nearest < 40 && chase.sirenT <= 0) { sfx('siren'); chase.sirenT = 1.4; }
    const warn = $('#chaseWarn');
    warn.hidden = nearest > 40;
    if (!warn.hidden) {
        warn.textContent = '🚨 POLICE ' + Math.max(0, Math.round(nearest)) + 'm AWAY!';
        warn.classList.toggle('danger', nearest < 12);
    }
    $('#chaseVignette').style.opacity = nearest < 30 ? Math.min(1, (30 - nearest) / 25).toFixed(2) : 0;
}

// =====================================================================================
// Actions triggered by world objects
// =====================================================================================
actions.enterStage = (idx) => {
    if (P.stage === idx) return;
    P.stage = idx;
    const s = STAGES[idx];
    showStageTitle(s);
    sfx('whoosh'); sfx('gate');
    baseFov += reduceMotion ? 0 : 14;
    const fl = $('#flash'); fl.classList.remove('show', 'gate'); void fl.offsetWidth; fl.classList.add('show', 'gate');
};
actions.pad = (idx) => {
    sendMove(true);
    net.send('pad', { s: idx });
    teleportLobby();
};
actions.chest = () => net.send('chest');
actions.egg = () => net.send('egg');
actions.freeBoost = () => { if (!S.freeBoost) net.send('freeBoost'); };
actions.buy = (kind, key) => {
    if (kind === 'pass' && key === 'DoubleWins' && S.passes.DoubleWins) { toast('x2 Wins is active!', '#e27bff'); return; }
    buy(kind, key);
};
actions.shop = (d) => {
    if (!S.owned[d.id] && d.pass) { buy('pass', d.pass); return; }
    if (!S.owned[d.id] && S.wins < d.req) { toast('Not Enough Wins!', '#ff5a5a'); sfx('denied'); return; }
    net.send('shop', { id: d.id });
};

// Race start: everyone who joined lines up in front of the Stage 1 gate, frozen for a
// 3-2-1 countdown, then GO (the server pays the first to touch the Stage 1 Wins pad)
function startRace() {
    if (autoTrain) setAutoTrain(false);
    if (P.dead) actions.revive(false);
    P.stage = -1;
    teleport(new V3((Math.random() * 2 - 1) * 8, 0.5, STAGES[0].zS - 12), 0);
    P.frozenUntil = clockT + 3;
    for (let n = 3; n >= 0; n--) setTimeout(() => { raceCountdown(n); sfx(n ? 'click' : 'gate'); }, (3 - n) * 1000);
    setTimeout(() => raceCountdown(null), 4200);
}

// Friend Boost: tell the server which of our Bloxity friends are in this server
let friendNames = [], friendsT = 3, friendSyncT = 5;
async function refreshFriends() {
    if (!BX.bloxity.ready || !BX.identity().loggedIn) return;
    const list = await BX.getFriends();
    friendNames = list.map((f) => f.displayName || f.username).filter(Boolean);
    syncFriends();
}
function syncFriends() {
    const room = net.room;
    if (!room || !room.state || !room.state.players || !friendNames.length) return;
    const here = [];
    room.state.players.forEach((p, id) => { if (id !== room.sessionId && friendNames.includes(p.name)) here.push(p.name); });
    net.send('friends', { names: here });
}

// =====================================================================================
// Other players
// =====================================================================================
const remotes = new Map();
let joinSynced = false;
class Remote {
    constructor(p) {
        this.rig = buildRider(p.kit, p.skin, p.name);
        this.rig.position.set(p.x, p.y, p.z);
        this.rig.rotation.y = p.ry;
        scene.add(this.rig);
        this.labelText = '';
        this.label = billboard([{ t: p.name, c: '#ffffff', s: '#16121f', px: 56 }], 6, 512, new V3(0, 10, 0), this.rig);
        setMount(this.rig, p.equipped, this.label);
        this.aura = buildAuraFx(this.rig);
        this.av = null; this.blox = null; this.dead = false; this.tinyUntil = 0;
        this.lastX = p.x; this.lastZ = p.z; this.lastRy = p.ry; this.vel = 0; this.lean = 0;
        this.setAvatar(p.av);
    }
    setAvatar(av) {
        this.av = av;
        const data = av ? unpackAvatar(av) : null;
        if (this.blox) { this.blox.setProportions(data && data.proportions); this.blox.setEquipped(data || {}); return; }
        if (this.loading) return;
        this.loading = true;
        createAvatar(data).then((a) => {
            this.loading = false;
            if (!a) return;
            if (this.dead) { a.dispose(); return; }
            this.blox = a;
            dressRig(this.rig, a);
            if (this.av !== av) this.setAvatar(this.av);
        });
    }
    update(p, dt, t) {
        const r = this.rig;
        const k = 1 - Math.exp(-dt * 12);
        const tx = p.x, ty = p.y, tz = p.z;
        if ((r.position.x - tx) ** 2 + (r.position.z - tz) ** 2 > 900) r.position.set(tx, ty, tz);
        else { r.position.x += (tx - r.position.x) * k; r.position.y += (ty - r.position.y) * k; r.position.z += (tz - r.position.z) * k; }
        r.rotation.y = lerpAngle(r.rotation.y, p.ry, k);
        r.visible = p.anim !== 3;
        if (p.av !== this.av) this.setAvatar(p.av);
        setMount(r, p.equipped, this.label);
        const tiny = clockT < this.tinyUntil ? 0.45 : 1;
        r.scale.x += (tiny - r.scale.x) * k; r.scale.y = r.scale.z = r.scale.x;
        // Ground speed and lean from how the drawn rider moved and turned this frame
        const moved = Math.hypot(r.position.x - this.lastX, r.position.z - this.lastZ);
        this.vel += ((dt > 0 ? moved / dt : 0) - this.vel) * Math.min(1, dt * 6);
        const turn = dt > 0 ? lerpAngle(0, r.rotation.y - this.lastRy, 1) / dt : 0;
        this.lean = clamp(-turn * 0.1 * Math.min(1, this.vel / 30), -0.4, 0.4);
        this.lastX = r.position.x; this.lastZ = r.position.z; this.lastRy = r.rotation.y;
        animateRider(r, dt, t, p.anim === 1 || p.anim === 2, this.blox, this.vel, p.anim !== 2, this.lean);
        const text = p.name + '|' + fmt(p.speed);
        if (text !== this.labelText) {
            this.labelText = text;
            this.label.userData.set([{ t: p.name, c: '#ffffff', s: '#16121f', px: 50 }, { t: fmt(p.speed) + ' Speed', c: '#7dff6b', s: '#16121f', px: 56 }]);
        }
        updateAuraFx(this.aura, auraById[p.aura], t);
    }
    dispose() {
        this.dead = true;
        if (this.blox) this.blox.dispose();
        scene.remove(this.rig);
    }
}
// "+1" with a blue shoe pops up beside the rider every time Speed goes up, like the reference.
// Small step gains pop at most a few times a second; big ones (treadmills, purchases) always do.
let speedSeen = false, popT = 0, popAcc = 0;
function popGain(n) {
    popAcc += n;
    if (clockT - popT < 0.3 && n < 1000) return;
    popT = clockT;
    // Screen-right of a rider facing f (seen from behind) is -x when f = 0
    const side = new V3(-Math.cos(P.facing) * 3.2, 7 + Math.random() * 1.5, Math.sin(P.facing) * 3.2);
    floatText('👟+' + fmt(popAcc), '#2a8cff', P.pos.clone().add(side));
    popAcc = 0;
    sfx('gain');
}
function syncRemotes(dt, t) {
    const room = net.room;
    if (!room || !room.state || !room.state.players) return 1;
    const seen = new Set();
    room.state.players.forEach((p, id) => {
        if (id === room.sessionId) {
            // Our own public stats come from the server
            const oldLevel = S.level;
            if (speedSeen && p.speed > S.speed) popGain(p.speed - S.speed);
            speedSeen = true;
            S.name = p.name; S.speed = p.speed; S.wins = p.wins; S.level = p.level; S.xp = p.xp; S.rebirths = p.rebirths; S.friends = p.friends;
            if (!rig || rig.userData.kit !== p.kit) { buildPlayer(p.kit, p.skin); rig.userData.kit = p.kit; }
            if (oldLevel !== S.level) refreshModal();
            return;
        }
        seen.add(id);
        let r = remotes.get(id);
        if (!r) {
            r = new Remote(p); remotes.set(id, r);
            if (joinSynced) BX.playerJoined(p.name); else BX.playerInRoom(p.name);
        }
        r.update(p, dt, t);
    });
    for (const [id, r] of remotes) if (!seen.has(id)) { r.dispose(); remotes.delete(id); }
    joinSynced = true;
    return room.state.players.size;
}

// =====================================================================================
// Networking
// =====================================================================================
// Hosted on Bloxity (VITE_BLOXITY_GAME_ID set at build time): the client is served from
// <id>.play.bloxity.io and the server pods are found through the Bloxity matchmaker.
const BLOXITY_GAME_ID = import.meta.env.VITE_BLOXITY_GAME_ID || '';
// <id>.play.bloxity.io -> <id>.host.bloxity.io, <id>.dev.play.bloxity.io -> <id>.dev.host.bloxity.io
const ON_BLOXITY_HOST = /\.play\.bloxity\.io$/.test(location.hostname);
const DEV_CHANNEL = /\.dev\.play\.bloxity\.io$/.test(location.hostname);
const SERVER_URL = import.meta.env.VITE_SERVER_URL
    || (ON_BLOXITY_HOST ? `https://${location.hostname.replace(/\.play\.bloxity\.io$/, '.host.bloxity.io')}`
        : BLOXITY_GAME_ID ? `https://${BLOXITY_GAME_ID}.host.bloxity.io`
        : import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2593` : location.origin);
async function serverEndpoint() {
    let url = SERVER_URL;
    if (BLOXITY_GAME_ID) {
        const r = await BX.resolveEndpoint(BLOXITY_GAME_ID, DEV_CHANNEL ? 'preview' : undefined);
        if (r && r.cold) $('#loading').textContent = 'Waking up a server…';
        url = (r && r.endpoint) || SERVER_URL;
    }
    // The matchmaker hands back a wss:// room proxy (wss://play.bloxity.io/v1/ws/<room>): Colyseus
    // joins through it directly and it has no /health, so only plain http(s) servers are polled
    if (!/^https?:/i.test(url)) return url;
    // A scaled-to-zero server takes a while to boot: poll /health (every 2 s, up to 60 s) before joining
    if (!(await serverUp(url))) {
        $('#loading').textContent = 'Waking up a server…';
        const until = Date.now() + 60000;
        while (Date.now() < until) {
            await new Promise((res) => setTimeout(res, 2000));
            if (await serverUp(url)) break;
        }
    }
    return url;
}
async function serverUp(url) {
    try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 4000);
        const r = await fetch(url.replace(/\/$/, '') + '/health', { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t);
        return r.ok;
    } catch (e) { return false; }
}
let lastMoveSent = 0, lastMoveKey = '';
function sendMove(force) {
    const now = performance.now();
    if (!force && now - lastMoveSent < 66) return;
    const a = P.dead ? 3 : !P.onGround ? 2 : P.moving ? 1 : 0;
    const m = { x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2), ry: +P.facing.toFixed(3), a, mv: P.moving ? 1 : 0 };
    const key = m.x + ',' + m.y + ',' + m.z + ',' + m.ry + ',' + a + ',' + m.mv;
    if (!force && key === lastMoveKey && now - lastMoveSent < 500) return;
    lastMoveKey = key; lastMoveSent = now;
    net.send('move', m);
}

function storageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
function playerUid() {
    let uid = storageGet('pme_uid');
    if (!uid) {
        uid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
        storageSet('pme_uid', uid);
    }
    return uid;
}

async function connect(name) {
    const client = new Client(await serverEndpoint());
    const id = BX.identity();
    const room = await client.joinOrCreate('speed', {
        uid: playerUid(), name: name || id.name, token: id.token, av: packAvatar(BX.currentAvatar()),
        save: storageGet('pme_save') || '',
    });
    net.room = room;
    joinSynced = false;
    room.onMessage('hello', (m) => { net.offset = m.now - Date.now(); net.bux = !!m.bux; net.bloxity = !!m.bloxity; });
    room.onMessage('authed', () => { net.bloxity = true; });
    room.onMessage('emote', (m) => { const r = remotes.get(m.s); if (r) playEmoteOn(r.blox, m.id); });
    room.onMessage('chat', (m) => {
        toast(m.name + ': ' + m.text, '#ffffff');
        chatBubble(m.s === room.sessionId ? rig : remotes.get(m.s) && remotes.get(m.s).rig, m.text);
    });
    BX.updateRoom(room.roomId);
    BX.gameplayStart();
    room.onMessage('profile', (m) => {
        // Signed backup of this player's progress, handed back if the server restarts
        if (m.save) storageSet('pme_save', m.save);
        delete m.save;
        Object.assign(S, m);
        refreshShop(); refreshModal();
        if (rig) setMount(rig, S.equipped, headLabel);
        openDailyOnJoin();
    });
    room.onMessage('toast', (m) => toast(m.text, m.color));
    room.onMessage('offline', (m) => showOffline(m));
    room.onMessage('race', (m) => showRace(m.startAt));
    room.onMessage('raceGo', () => startRace());
    room.onMessage('raceEnd', (m) => {
        raceCountdown(null);
        if (m.winner) { toast('🏁 ' + m.winner + ' won the race! +' + m.prize + ' Wins', '#ffd028'); if (m.winner === S.name) { sfx('cheer'); fireworks(P.pos, 6, () => sfx('firework')); } }
        else toast('🏁 Race over - nobody finished!', '#ffb51c');
    });
    room.onMessage('levelUp', (m) => {
        levelUp(m.from, m.to, m.walk);
        sfx('levelUp'); rumble(0.3, 150);
        ring(P.pos, 0x28d8ff, 10, 0.8);
        sparkleColumn(P.pos, 0x7dff6b);
    });
    room.onMessage('gain', (m) => {
        if (m.pickup) { floatText('+' + fmt(m.n) + ' Speed', '#7dff6b', P.pos.clone().add(new V3(0, 6, 0))); sfx('pickup'); }
    });
    room.onMessage('wins', (m) => {
        refreshShop();
        showGoal(m.n);
        sfx('cheer'); rumble(0.7, 500);
        confettiAt(P.pos.clone().add(new V3(0, 4, 0)));
        fireworks(P.pos, 6, () => sfx('firework'));
    });
    room.onMessage('revived', () => actions.revive(true));
    room.onMessage('fx', () => {
        confettiAt(P.pos.clone().add(new V3(0, 4, 0)));
        sparkleColumn(P.pos, 0xffd028);
        sfx('buy');
    });
    room.onMessage('boards', renderBoards);
    room.onLeave((code, reason) => {
        console.warn('[net] left room', code, reason || '');
        net.room = null;
        if (code !== 1000) {
            $('#offline').hidden = false;
        }
    });
    return room;
}

// =====================================================================================
// Camera & input
// =====================================================================================
const cam = { yaw: Math.PI, pitch: 0.42, dist: 24, target: new V3() };
let camSens = 1;
const keys = {};
const touchMove = { x: 0, y: 0 };
let touchSprint = false, touchJump = false, running = false;

addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') { if (e.key === 'Enter') e.target.blur(); return; }
    keys[e.code] = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.code === 'KeyE' && running) usePrompt();
    if (e.code === 'Escape') {
        if (!$('#daily').hidden) $('#daily').hidden = true;
        else if (!$('#offlinePop').hidden) $('#offlinePop').hidden = true;
        else if (!$('#modal').hidden) closeModal();
        else if (running && BX.isEmbedded()) BX.showPortalMenu();
    }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const drags = new Map();
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); drags.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.focus(); });
canvas.addEventListener('pointermove', (e) => {
    const d = drags.get(e.pointerId);
    if (!d) return;
    const k = (e.pointerType === 'touch' ? 0.008 : 0.005) * camSens;
    cam.yaw -= (e.clientX - d.x) * k;
    cam.pitch = clamp(cam.pitch + (e.clientY - d.y) * k, -0.25, 1.35);
    d.x = e.clientX; d.y = e.clientY;
});
const endDrag = (e) => drags.delete(e.pointerId);
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => { cam.dist = clamp(cam.dist + Math.sign(e.deltaY) * 2, 8, 45); e.preventDefault(); }, { passive: false });

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
(function joystick() {
    const stick = $('#stick'), knob = $('#knob');
    let id = null;
    const set = (e) => {
        const r = stick.getBoundingClientRect();
        let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        const max = r.width / 2, l = Math.hypot(dx, dy);
        if (l > max) { dx *= max / l; dy *= max / l; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        touchMove.x = dx / max; touchMove.y = dy / max;
    };
    stick.addEventListener('pointerdown', (e) => { id = e.pointerId; stick.setPointerCapture(id); set(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; touchMove.x = touchMove.y = 0; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
    const jb = $('#jumpBtn');
    jb.addEventListener('pointerdown', (e) => { e.preventDefault(); touchJump = true; });
    jb.addEventListener('pointerup', () => { touchJump = false; });
    jb.addEventListener('pointercancel', () => { touchJump = false; });
    const sb = $('#sprintBtn');
    sb.addEventListener('click', () => { touchSprint = !touchSprint; sb.classList.toggle('on', touchSprint); });
})();

function rayHit(o, d, maxT) {
    let best = maxT;
    for (const c of solids) {
        let t0 = 0, t1 = best, hit = true;
        for (const a of ['x', 'y', 'z']) {
            if (Math.abs(d[a]) < 1e-9) { if (o[a] < c.min[a] || o[a] > c.max[a]) { hit = false; break; } continue; }
            let ta = (c.min[a] - o[a]) / d[a], tb = (c.max[a] - o[a]) / d[a];
            if (ta > tb) { const q = ta; ta = tb; tb = q; }
            t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
            if (t0 > t1) { hit = false; break; }
        }
        if (hit && t0 > 0 && t0 < best) best = t0;
    }
    return best;
}
const camDir = new V3(), camGoal = new V3(), camPos = new V3(), lookTmp = new V3();
const ATTRACT_LOOK = new V3(0, 8, 10);
let intro = null, baseFov = camera.fov;
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
function updateCamera(dt) {
    if (!running) {
        const t = performance.now() / 1000;
        camera.position.set(Math.sin(t * 0.08) * 55, 22, Math.cos(t * 0.08) * 45 - 5);
        camera.lookAt(ATTRACT_LOOK);
        baseFov = camera.fov;
        return;
    }
    cam.target.lerp(camGoal.set(P.pos.x, P.pos.y + 6.5, P.pos.z), 1 - Math.exp(-dt * 18));
    const cp = Math.cos(cam.pitch);
    camDir.set(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);
    const dist = Math.max(3, rayHit(cam.target, camDir, cam.dist) - 0.8);
    camPos.copy(cam.target).addScaledVector(camDir, dist);
    if (intro) {
        // Fly from the menu orbit down to the player
        intro.t += dt;
        const k = ease(Math.min(1, intro.t / intro.dur));
        camera.position.lerpVectors(intro.from, camPos, k);
        camera.lookAt(lookTmp.lerpVectors(ATTRACT_LOOK, cam.target, k));
        if (intro.t >= intro.dur) intro = null;
    } else {
        camera.position.copy(camPos);
        camera.lookAt(cam.target);
    }
    if (shake > 0.001) {
        const s = shake * shake * 0.9;
        camera.position.x += (Math.random() * 2 - 1) * s;
        camera.position.y += (Math.random() * 2 - 1) * s;
        shake = Math.max(0, shake - dt * 2.2);
    }
    // Field of view widens with speed and sprint
    const fovBase = innerWidth < innerHeight ? 85 : 70;
    const speedKick = P.moving ? Math.min(8, Math.max(0, walkSpeed() - 30) * 0.08) : 0;
    const want = fovBase + speedKick + (P.sprinting && !reduceMotion ? 9 : 0);
    baseFov += (want - baseFov) * Math.min(1, dt * 5);
    if (Math.abs(camera.fov - baseFov) > 0.01) { camera.fov = baseFov; camera.updateProjectionMatrix(); }
    sun.position.set(P.pos.x + 40, P.pos.y + 90, P.pos.z - 30);
    sun.target.position.copy(P.pos);
}

// Proximity prompts ("E  Equip Saka")
let activePrompt = null;
const projV = new V3();
function updatePrompt() {
    let best = null, bd = Infinity;
    if (!P.dead) for (const p of prompts) {
        const d = p.pos.distanceTo(P.pos);
        if (d < p.r && d < bd) { bd = d; best = p; }
    }
    activePrompt = best;
    if (!best) { promptEl.hidden = true; return; }
    projV.copy(best.pos).setY(best.pos.y + 2).project(camera);
    if (projV.z > 1) { promptEl.hidden = true; return; }
    promptEl.hidden = false;
    promptEl.style.left = ((projV.x + 1) / 2 * innerWidth) + 'px';
    promptEl.style.top = ((1 - projV.y) / 2 * innerHeight) + 'px';
    const txt = best.label();
    if (promptTxtEl.textContent !== txt) promptTxtEl.textContent = txt;
    const key = usingPad() ? 'X' : 'E';
    if (promptKey.textContent !== key) promptKey.textContent = key;
}
function usePrompt() { if (activePrompt) activePrompt.act(); }
const promptKey = promptEl.querySelector('kbd');
const usingPad = () => pad.connected && performance.now() - pad.lastUsed < 8000;

// Controller buttons: popups and panels first, then gameplay shortcuts
const shown = (sel) => { const e = $(sel); return !!e && !e.hidden; };
function focusStep(container, dir) {
    const items = [...container.querySelectorAll('button:not(:disabled), input[type=range]')];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    const next = items[i < 0 ? 0 : (i + dir + items.length) % items.length];
    next.focus({ preventScroll: false });
    next.scrollIntoView({ block: 'nearest' });
}
function padButtons() {
    const p = pad.pressed;
    if (!p.size) return;
    const overlay = ['#start', '#offline', '#buy', '#revive', '#offlinePop', '#daily', '#modal'].find(shown);
    if (overlay) pad.jump = false;
    if (overlay === '#start') { if ((p.has('A') || p.has('START')) && shown('#playBtn')) play(); return; }
    if (overlay === '#offline') { if (p.has('A')) $('#reconnectBtn').click(); return; }
    if (overlay === '#revive') { if (p.has('A')) $('#reviveYes').click(); else if (p.has('B')) $('#reviveNo').click(); return; }
    if (overlay === '#offlinePop') { if (p.has('A') || p.has('B')) $('#offlineOk').click(); return; }
    if (overlay === '#daily') {
        if (p.has('A') && !$('#dailyClaim').disabled) $('#dailyClaim').click();
        else if (p.has('A') || p.has('B')) $('#dailyClose').click();
        return;
    }
    if (overlay === '#buy') { if (p.has('A')) $('#buyOk').click(); else if (p.has('B')) $('#buyCancel').click(); return; }
    if (overlay === '#modal') {
        const body = $('#modal');
        const el = document.activeElement;
        const onSlider = el && el.type === 'range' && body.contains(el);
        if (onSlider && (p.has('LEFT') || p.has('RIGHT'))) {
            el.value = Number(el.value) + (p.has('RIGHT') ? 5 : -5);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return;
        }
        if (p.has('DOWN') || p.has('RIGHT')) focusStep(body, 1);
        else if (p.has('UP') || p.has('LEFT')) focusStep(body, -1);
        else if (p.has('A') && el && body.contains(el) && el.tagName === 'BUTTON') el.click();
        else if (['B', 'Y', 'LB', 'RB', 'BACK', 'START'].some((b) => p.has(b))) { closeModal(); canvas.focus(); }
        return;
    }
    if (!running) return;
    if (p.has('X')) usePrompt();
    if (p.has('Y')) openModal('store');
    if (p.has('LB')) openModal('rebirth');
    if (p.has('RB')) openModal('auras');
    if (p.has('BACK')) openModal('free');
    if (p.has('START')) openModal('settings');
    if (p.has('UP')) cam.dist = clamp(cam.dist - 4, 8, 45);
    if (p.has('DOWN')) cam.dist = clamp(cam.dist + 4, 8, 45);
    if (['Y', 'LB', 'RB', 'BACK', 'START'].some((b) => p.has(b))) focusStep($('#modal'), 1);
}
onGamepadConnection((g, on) => {
    if (running) toast(on ? '🎮 Controller connected' : '🎮 Controller disconnected', on ? '#7dff6b' : '#ffb51c');
});
let sprintHintPad = null;
function updateSprintHint() {
    const p = usingPad();
    if (p === sprintHintPad) return;
    sprintHintPad = p;
    $('#sprintHint').textContent = p ? 'HOLD RT TO SPRINT!' : 'HOLD SHIFT TO SPRINT!';
}
promptEl.addEventListener('click', usePrompt);

// =====================================================================================
// Main update
// =====================================================================================
// Dev-only test input (the QA hook drives it); always zero in a real game
const botInput = { f: 0, r: 0, jump: false, sprint: false };
let qaWalk = 0; // dev QA walk-speed override
let clockT = 0, hudT = 0, online = 1;
const tmpF = new V3(), tmpR = new V3(), mv = new V3();
const trail = makeTrail(0x28d8ff), trailAt = new V3();

function update(dt) {
    clockT += dt;
    const t = clockT;
    let f = botInput.f, r = botInput.r;
    if (keys.KeyW || keys.ArrowUp) f += 1;
    if (keys.KeyS || keys.ArrowDown) f -= 1;
    if (keys.KeyD || keys.ArrowRight) r += 1;
    if (keys.KeyA || keys.ArrowLeft) r -= 1;
    f -= touchMove.y + pad.ly; r += touchMove.x + pad.lx;
    cam.yaw -= pad.rx * 2.8 * dt;
    cam.pitch = clamp(cam.pitch + pad.ry * 1.8 * dt, -0.25, 1.35);
    tmpF.set(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
    tmpR.set(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
    mv.set(0, 0, 0).addScaledVector(tmpF, f).addScaledVector(tmpR, r);
    if (mv.lengthSq() > 1) mv.normalize();
    if (P.dead || clockT < P.frozenUntil) mv.set(0, 0, 0);
    // Any movement input hands control back to the player (small dead zone for stick drift)
    if (autoTrain && (Math.abs(f) > 0.2 || Math.abs(r) > 0.2)) { setAutoTrain(false); toast('Auto Train OFF', '#c28cff'); }
    const tread = P.onGround && P.ground && P.ground.tread;
    const training = autoTrain && !P.dead && tread && !treadLocked(tread);
    P.moving = mv.lengthSq() > 0.01 || !!training;

    const wantSprint = keys.ShiftLeft || keys.ShiftRight || touchSprint || pad.sprint || botInput.sprint;
    P.sprinting = wantSprint && P.moving && P.stamina > 0;
    if (P.sprinting) { P.stamina = Math.max(0, P.stamina - CFG.staminaDrain * dt); P.staminaIdle = 0; }
    else { P.staminaIdle += dt; if (P.staminaIdle > CFG.staminaDelay) P.stamina = Math.min(CFG.staminaMax, P.stamina + CFG.staminaRegen * dt); }

    if (!P.dead) {
        const ws = walkSpeed();
        if ((keys.Space || touchJump || pad.jump || botInput.jump) && P.onGround) {
            P.vel.y = JUMP_V; P.onGround = false;
            sfx('jump'); P.squashV += 5; dust(P.pos, 4, 0.6);
        }
        P.vel.y -= GRAV * dt;
        P.push.multiplyScalar(Math.exp(-(P.onGround ? 4 : 1.2) * dt));
        let vx = mv.x * ws + P.push.x, vz = mv.z * ws + P.push.z;
        if (P.onGround && P.ground && P.ground.belt && !training) { vx += P.ground.belt.x; vz += P.ground.belt.z; }
        const dist = Math.max(Math.abs(vx), Math.abs(vz), Math.abs(P.vel.y)) * dt;
        const n = Math.max(1, Math.ceil(dist / 0.6));
        const sdt = dt / n;
        const wasGround = P.ground;
        P.onGround = false; P.ground = null;
        for (let i = 0; i < n; i++) {
            moveAxis('x', vx * sdt);
            moveAxis('z', vz * sdt);
            moveAxis('y', P.vel.y * sdt);
        }
        if (!P.onGround && wasGround && P.vel.y <= 0 && P.vel.y > -40) {
            // Stick to the ground when walking down small steps
            const y0 = P.pos.y;
            moveAxis('y', -0.3);
            if (!P.onGround) P.pos.y = y0;
        }
        if (P.onGround) {
            if (P.airTime > 0.3) {
                sfx('land');
                dust(P.pos, P.airTime > 0.7 ? 12 : 7, P.airTime > 0.7 ? 1.4 : 1);
                P.squashV -= Math.min(9, 3 + P.airTime * 6);
                if (P.airTime > 0.9) { ring(P.pos, 0xffffff, 5, 0.45); addShake(0.35); rumble(0.4, 120); }
            }
            P.airTime = 0;
        } else P.airTime += dt;
        if (training) P.facing = lerpAngle(P.facing, TRAIN_YAW, 1 - Math.exp(-dt * 14));
        else if (P.moving) P.facing = lerpAngle(P.facing, Math.atan2(mv.x, mv.z), 1 - Math.exp(-dt * 14));

        if (P.shield > 0) P.shield -= dt;
        // Falling: measured from the floor of the stage you are actually standing in
        const here = stageAt(P.pos.z);
        if (here >= 0 && here < P.stage) P.stage = here; // walked back down into an earlier stage
        if (P.pos.y < (here >= 0 ? STAGES[here].y0 : 0) + CFG.voidY) { P.shield = 0; die('fall'); }
        for (const k of kills) {
            if (!k.active) continue;
            if (k.max.x > P.pos.x - HW + 0.2 && k.min.x < P.pos.x + HW - 0.2 && k.max.y > P.pos.y + 0.1 && k.min.y < P.pos.y + PH && k.max.z > P.pos.z - HW + 0.2 && k.min.z < P.pos.z + HW - 0.2) { die(k.cause); break; }
        }
        P.safeTimer -= dt;
        if (P.onGround && P.safeTimer <= 0 && !(P.ground && (P.ground.belt || P.ground.unsafe))) { P.lastSafe.copy(P.pos); P.safeTimer = 0.3; }

        for (const tr of triggers) {
            const inside = overlapsBox(tr, P.pos.x, P.pos.y, P.pos.z);
            if (inside && !tr.inside && tr.enter) tr.enter();
            tr.inside = inside;
            if (P.dead) break;
        }
        if (P.pos.z < STAGES[0].zS && P.stage !== -1) P.stage = -1;

        // Shoe pickups: collected locally, Speed granted by the server
        for (const p of pickups) {
            if (p.respawnAt > t) continue;
            if (!p.g.visible) p.g.visible = true;
            if (Math.abs(p.g.position.x - P.pos.x) < 2.8 && Math.abs(p.g.position.z - P.pos.z) < 2.8 && Math.abs(p.g.position.y - (P.pos.y + 1.8)) < 3.5) {
                sendMove(true);
                net.send('pickup', { id: p.id, s: p.stage });
                p.g.visible = false; p.respawnAt = t + CFG.pickupRespawn;
            }
        }

        // Locked treadmill: offer the pass / explain the requirement
        const tread = P.onGround && P.ground && P.ground.tread;
        if (tread && P.moving && treadLocked(tread) && t - P.lockToastT > 3) {
            P.lockToastT = t;
            if (tread.pass) buy('pass', tread.pass); else toast('Need ' + tread.req + ' Wins for this treadmill!', '#ff5a5a');
        }
    }

    if (S.name && S.name !== nameLabelText) { nameLabelText = S.name; headLabel.userData.set([{ t: S.name, c: '#ffffff', s: '#16121f', px: 64 }]); }
    updateWorld(dt, P.pos.z);
    updateChase(dt);
    updateEffects(dt);
    updateFx(dt);
    updateMaterials(dt);
    for (const fn of tickers) fn(dt, t);
    beltTex.offset.x = (beltTex.offset.x + dt * 0.75) % 1;
    for (const p of pickups) {
        if (!p.g.visible) continue;
        p.g.rotation.y += dt * 2;
        p.g.position.y = p.base + Math.sin(t * 3 + p.phase) * 0.4;
    }

    online = syncRemotes(dt, t);
    // Friend list every 30 s, who of them is here every 5 s
    friendsT -= dt; friendSyncT -= dt;
    if (friendsT <= 0) { friendsT = 30; friendSyncT = 5; refreshFriends(); }
    else if (friendSyncT <= 0) { friendSyncT = 5; syncFriends(); }

    rig.position.copy(P.pos);
    rig.rotation.y = P.facing;
    const hs = P.moving ? walkSpeed() : 0;
    P.animPhase += dt * (P.onGround ? Math.min(18, 4 + hs * 0.2) : 0);
    // Lean into turns: the faster you ride, the deeper the lean
    const turn = dt > 0 ? lerpAngle(0, P.facing - (P.prevFacing ?? P.facing), 1) / dt : 0;
    P.prevFacing = P.facing;
    P.lean = clamp(-turn * 0.1 * Math.min(1, hs / 30), -0.4, 0.4);
    animateRider(rig, dt, t, P.moving, localAvatar, hs, P.onGround, P.lean);
    setEngine(P.moving && !P.dead, hs);
    // Light trail streaming from the tail light in the bike's accent colour
    const bike = rig.userData.bike;
    if (bike && trail.color !== (bike.glow || bike.accent)) trail.setColor(bike.glow || bike.accent);
    trailAt.set(-Math.sin(P.facing) * 2.7, 2.6 * (P.tiny || 1), -Math.cos(P.facing) * 2.7).add(P.pos);
    trail.update(trailAt, P.moving && !P.dead && rig.visible && hs > 20, dt);
    const stepN = Math.floor(P.animPhase / Math.PI);
    if (P.onGround && P.moving && !P.dead && stepN !== P.lastStep && (P.sprinting || hs > 45) && stepN % 2 === 0) dust(P.pos, 1, 0.5);
    P.lastStep = stepN;
    // Squash & stretch spring around 1
    P.squashV += (1 - P.squash) * 180 * dt;
    P.squashV *= Math.exp(-12 * dt);
    P.squash = clamp(P.squash + P.squashV * dt, 0.7, 1.3);
    // Shrink effect (tinyUntil): shrink smoothly, grow back when it wears off
    P.tiny = (P.tiny || 1) + ((clockT < P.tinyUntil ? 0.45 : 1) - (P.tiny || 1)) * Math.min(1, dt * 6);
    rig.scale.set(P.tiny / Math.sqrt(P.squash), P.tiny * P.squash, P.tiny / Math.sqrt(P.squash));
    setSpeedLines(!P.dead && P.moving && (P.sprinting || hs > 60) && !reduceMotion ? (P.sprinting ? 1 : 0.5) : 0, dt);
    rig.visible = !P.dead && (P.shield <= 0 || Math.floor(t * 12) % 2 === 0);
    updateAuraFx(auraFx, auraById[S.aura], t);

    sendMove(false);
    updatePrompt();
    animateCounters(dt);
    hudT -= dt;
    if (hudT <= 0) { hudT = 0.1; updateHud(P, online); refreshShop(); updateLobbySigns(); }
}

// =====================================================================================
// Boot
// =====================================================================================
let lastFrame = 0, loadingSignaled = false, fpsAcc = 0, fpsFrames = 0, showFps = false;
function frame(now) {
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    fpsAcc += (now - (lastFrame || now)) / 1000; fpsFrames++;
    if (fpsAcc >= 0.5) { if (showFps) $('#fps').textContent = Math.round(fpsFrames / fpsAcc) + ' FPS'; fpsAcc = 0; fpsFrames = 0; }
    lastFrame = now;
    if (!loadingSignaled) {
        // First frame after setup: apply portal settings and lift the Bloxity loading overlay
        loadingSignaled = true;
        BX.triggerAllSettings();
    }
    pollGamepad();
    padButtons();
    if (running) { update(dt); updateSprintHint(); }
    else beltTex.offset.x = (beltTex.offset.x + dt * 0.75) % 1;
    updateCamera(dt);
    render();
    requestAnimationFrame(frame);
}

// Straight into the game: no menu. Joins with the Bloxity name (or guest name) automatically.
let joining = false;
async function play() {
    if (joining || running) return;
    joining = true;
    const err = $('#connectErr'), retry = $('#playBtn');
    err.hidden = true; retry.hidden = true;
    $('#loading').hidden = false;
    $('#loading').textContent = 'Joining…';
    BX.loadingStep('Joining a server…');
    initAudio();
    try {
        await waitForLogin(1500);
        const saved = (storageGet('pme_name') || '').slice(0, 20);
        // A hosted server can be asleep or still starting: retry the join (2, 4, 6, 8 s) before giving up
        let room = null;
        for (let attempt = 0; !room; attempt++) {
            try { room = await connect(BX.identity().loggedIn ? '' : saved); } catch (e) {
                if (attempt >= 4) throw e;
                console.warn('[join] attempt', attempt + 1, 'failed:', e && e.message);
                $('#loading').textContent = 'Waking up a server…';
                await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
            }
        }
        const me = room.state.players && room.state.players.get(room.sessionId);
        S.name = me ? me.name : S.name;
    } catch (e) {
        console.error(e);
        joining = false;
        $('#loading').hidden = true;
        err.hidden = false;
        err.textContent = 'Could not reach the game server. Check your connection and try again.';
        retry.hidden = false;
        BX.loadingEnd();
        return;
    }
    joining = false;
    intro = { t: 0, dur: 2.2, from: camera.position.clone() };
    running = true;
    startMusic();
    sfx('rev');
    $('#start').hidden = true;
    $('#hud').hidden = false;
    $('#touch').hidden = !isTouch;
    if (!rig) buildPlayer(0, 0);
    teleportLobby();
    showTips();
    toast('Every step = +Speed! Ride through the stages!', '#7dff6b');
    canvas.focus();
    BX.loadingEnd();
}
// Embedded games get the Bloxity user from the portal handshake a moment after init
function waitForLogin(ms) {
    if (!BX.bloxity.ready || BX.identity().loggedIn) return Promise.resolve();
    return new Promise((res) => {
        const t0 = performance.now();
        (function check() { if (BX.identity().loggedIn || performance.now() - t0 > ms) res(); else setTimeout(check, 100); })();
    });
}
// Controls reminder for the first seconds of play
function showTips() {
    const el = $('#tips');
    const k = (key, what) => `<span><kbd>${key}</kbd>${what}</span>`;
    el.innerHTML = pad.connected
        ? k('L', 'Move') + k('A', 'Jump') + k('RT', 'Sprint') + k('X', 'Interact') + k('R', 'Camera')
        : isTouch
            ? '<span>Joystick to move · JUMP · SPRINT · drag to look</span>'
            : k('WASD', 'Move') + k('Space', 'Jump') + k('Shift', 'Sprint') + k('E', 'Interact') + k('Drag', 'Camera') + k('Wheel', 'Zoom');
    el.hidden = false; el.style.opacity = 1;
    setTimeout(() => { el.style.opacity = 0; }, 9000);
    setTimeout(() => { el.hidden = true; }, 9900);
}
// Browsers only start audio after a user gesture
function unlockAudioOnGesture() {
    const unlock = () => { initAudio(); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); removeEventListener('touchstart', unlock); };
    addEventListener('pointerdown', unlock); addEventListener('keydown', unlock); addEventListener('touchstart', unlock);
}

// Portal settings only apply when the game runs inside bloxity.io (standalone has its own panel)
function wirePortalSettings() {
    const embedded = (fn) => (v) => { if (BX.isEmbedded()) fn(v); };
    const pct = (v) => clamp((parseInt(v, 10) || 0) / 100, 0, 1);
    BX.listenSetting('master_volume', embedded((v) => setVolume('master', pct(v))));
    BX.listenSetting('music_volume', embedded((v) => setVolume('music', pct(v))));
    BX.listenSetting('graphics_quality', embedded((v) => setQuality(v === 'Low' ? 'low' : v === 'Medium' ? 'medium' : 'high')));
    BX.listenSetting('camera_sensitivity', embedded((v) => { camSens = clamp(parseFloat(v) || 1, 0.1, 5); }));
    BX.listenSetting('show_fps', (v) => { showFps = v === 'true'; $('#fps').hidden = !showFps; });
}
function wirePortalEvents() {
    BX.onPortalEvent((event, data) => {
        if (event === 'respawn_request') { if (P.dead) actions.revive(false); else if (running) teleportLobby(); }
        else if (event === 'chat_message_sent' && data) net.send('chat', { text: String(data) });
        else if (event === 'play_emote' && data) { playEmoteOn(localAvatar, String(data)); net.send('emote', { id: String(data) }); }
    });
    BX.onAvatarChanged(() => syncMyAvatar());
    BX.onProportionsChanged(() => syncMyAvatar());
}
// Account chip in the HUD
function showIdentity(id) {
    const avail = BX.bloxity.ready;
    $('#acct').hidden = !avail;
    if (!avail) return;
    const label = id.name || 'Guest';
    $('#acctName').textContent = label;
    $('#acctBtn').textContent = id.loggedIn ? 'Log out' : 'Log in';
    const pfp = $('#acctPfp');
    pfp.hidden = !id.pfp;
    if (id.pfp) pfp.src = id.pfp;
}
function toggleLogin() { if (BX.identity().loggedIn) BX.logout(); else BX.login(); }

async function boot() {
    BX.initBloxity();
    BX.loadingStep('Loading fonts…');
    try { await Promise.race([document.fonts.load('700 40px Fredoka'), new Promise((r) => setTimeout(r, 2500))]); } catch (e) { /* fallback font */ }
    BX.loadingStep('Building the city…');
    buildWorld();
    loadBase().catch(() => {}); // warm up the Bloxity body model
    wirePortalSettings();
    wirePortalEvents();
    BX.loadCatalogPrices().then((changed) => { if (changed) refreshShop(); });
    BX.onIdentity((id) => {
        showIdentity(id);
        // Logged in after joining: move this session onto the Bloxity profile
        if (net.room && id.loggedIn && id.token && !net.bloxity) net.send('auth', { token: id.token });
        if (net.room) { setupLocalAvatar(); syncMyAvatar(); }
    });
    $('#acctBtn').addEventListener('click', toggleLogin);
    $('#acctPfp').addEventListener('error', (e) => { e.target.hidden = true; });
    $('#playBtn').addEventListener('click', play);
    $('#reconnectBtn').addEventListener('click', () => location.reload());
    unlockAudioOnGesture();
    requestAnimationFrame(frame);
    play();
}
boot();

// Dev-only hooks for automated QA runs (stripped from production builds)
if (import.meta.env.DEV) {
    window.__qa = {
        input: (o) => Object.assign(botInput, o), solids, cam,
        P, S, STAGES, avatarStats, scene, renderer, camera,
        teleport: (x, y, z) => teleport(new V3(x, y, z), 0),
        enter: (i) => actions.enterStage(i),
        buildBike, bikeById, net, buy, deaths: () => deaths, walk: (n) => { qaWalk = n; },
        look: (yaw, pitch, dist) => { cam.yaw = yaw; cam.pitch = pitch; cam.dist = dist; },
        state: () => ({ x: P.pos.x, y: P.pos.y, z: P.pos.z, dead: P.dead, stage: P.stage, wins: S.wins, level: S.level, speed: S.speed, aura: S.aura, equipped: S.equipped, rebirths: S.rebirths }),
    };
}
