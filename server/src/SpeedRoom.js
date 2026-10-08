import { Room } from 'colyseus';
import { GameState, PlayerState } from './schema.js';
import {
    getProfile, hasProfile, markDirty, saveProfiles, adoptGuestProgress, loadProfile, releaseProfile,
    topProfiles, claimGrants, queueGrant, USE_DB,
} from './profiles.js';
import { sealProfile, openSave } from './saves.js';
import { verifyBloxityToken, BUX_MODE } from './bloxity.js';
import {
    CFG, LOBBY, STAGES, PRODUCTS, PASSES, BIKES, bikeById, AURAS, auraById, FREE, DAILY, KITS, SKINS,
    GROUP_CHEST, EGG_MINUTES, FREE_BOOST_MINUTES,
    xpFor, maxSpeedFor, speedMult, treadmillAt, stageAt, dailyStatus, dayKey, rewardText, fmt, clamp,
} from '../../shared/config.js';

const GREEN = '#7dff6b', RED = '#ff5a5a', GOLD = '#ffd028', BLUE = '#6fe0ff';

// Empty string when the player left the name box blank
function cleanName(name) {
    return String(name || '').replace(/[^\w .\-]/g, '').trim().slice(0, 20);
}
const randomName = () => 'Player' + Math.floor(1000 + Math.random() * 9000);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
// Guest ids come from the browser; they can never claim a Bloxity identity
const guestUid = (uid, fallback) => String(uid || fallback).replace(/^legion_/, 'guest_').slice(0, 64);
const cleanAvatar = (av) => (typeof av === 'string' && av.length <= 2000 ? av : '');

export const liveRooms = new Set();

// One shared world: the city lobby + the 10-stage race road. Movement is client-side,
// everything that changes progress (Speed, Wins, unlocks, purchases) is decided here.
export class SpeedRoom extends Room {
    maxClients = CFG.maxPlayers;

    onCreate() {
        liveRooms.add(this);
        this.setState(new GameState());
        this.setPatchRate(50);
        this.sessions = new Map();
        this.joinCount = 0;

        this.onMessage('move', (client, m) => this.onMove(client, m));
        this.onMessage('pickup', (client, m) => this.onPickup(client, m));
        this.onMessage('pad', (client, m) => this.onPad(client, m));
        this.onMessage('chest', (client) => this.onChest(client));
        this.onMessage('egg', (client) => this.onEgg(client));
        this.onMessage('freeBoost', (client) => this.onFreeBoost(client));
        this.onMessage('shop', (client, m) => this.onShop(client, m));
        this.onMessage('aura', (client, m) => this.onAura(client, m));
        this.onMessage('rebirth', (client) => this.onRebirth(client));
        this.onMessage('free', (client, m) => this.onFree(client, m));
        this.onMessage('daily', (client) => this.onDaily(client));
        this.onMessage('buy', (client, m) => this.onBuy(client, m));
        this.onMessage('custom', (client, m) => this.onCustom(client, m));
        this.onMessage('auth', (client, m) => this.onBloxityLogin(client, m));
        this.onMessage('avatar', (client, m) => this.onAvatar(client, m));
        this.onMessage('emote', (client, m) => this.onEmote(client, m));
        this.onMessage('chat', (client, m) => this.onChat(client, m));
        this.onMessage('friends', (client, m) => this.onFriends(client, m));
        this.onMessage('raceJoin', (client) => this.onRaceJoin(client));

        this.setSimulationInterval((dt) => this.tick(dt), 100);
        this.clock.setInterval(() => this.broadcastBoards(), 10000);
        this.race = null;
        this.clock.setInterval(() => this.raceTick(), 500);
        // Bux purchases made while the player was on another pod (or offline)
        if (USE_DB) this.clock.setInterval(() => this.applyQueuedGrants(), 5000);
    }

    // A Bloxity token is verified with the Bloxity API; anyone else joins as a guest
    async onAuth(client, options) {
        const legion = options && options.token ? await verifyBloxityToken(options.token) : null;
        return legion ? { legion } : { guest: true };
    }

    async onJoin(client, options, auth) {
        options = options || {};
        const guest = guestUid(options.uid, client.sessionId);
        let uid = guest, name = cleanName(options.name);
        if (auth && auth.legion) {
            uid = 'legion_' + auth.legion.id;
            name = cleanName(auth.legion.name) || name;
            await adoptGuestProgress(uid, guest, name);
        }
        await loadProfile(uid);
        // A fresh server on a temporary disk restores the browser's signed backup.
        // With a database the profile is never lost, so backups are not accepted at all.
        const restore = !USE_DB && !hasProfile(uid) && openSave(options.save, [uid, guest]);
        const profile = getProfile(uid, name, randomName());
        if (restore) { Object.assign(profile, restore); markDirty(); }
        const player = new PlayerState();
        player.name = profile.name;
        player.av = cleanAvatar(options.av);
        player.x = LOBBY.spawn.x; player.y = LOBBY.spawn.y; player.z = LOBBY.spawn.z; player.ry = 0;
        player.kit = this.joinCount % KITS.length;
        player.skin = (this.joinCount * 3) % SKINS.length;
        this.joinCount++;
        this.state.players.set(client.sessionId, player);
        this.sessions.set(client.sessionId, {
            client, profile, player,
            moving: false, lastMove: 0, gainT: 0, friends: 0, treadMult: 0, treadSeen: 0,
            joinedAt: Date.now(), freeClaimed: {}, cooldowns: new Map(), guest, lastChat: 0, padArmed: true,
        });
        this.syncPublic(client.sessionId);
        client.send('hello', { now: Date.now(), bux: BUX_MODE, bloxity: uid.startsWith('legion_') });
        this.payOffline(this.sessions.get(client.sessionId));
        if (this.race && !this.race.started) client.send('race', { startAt: this.race.startAt });
        this.sendProfile(client.sessionId);
        this.broadcastBoards(client);
        if (USE_DB) this.applyQueuedGrants();
    }

    // A dropped connection keeps the player in the world for 30 s so the client can reconnect
    onDrop(client) {
        this.allowReconnection(client, 30);
    }
    onReconnect(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        s.client = client;
        client.send('hello', { now: Date.now(), bux: BUX_MODE, bloxity: s.profile.uid.startsWith('legion_') });
        this.sendProfile(client.sessionId);
        this.broadcastBoards(client);
    }

    onLeave(client) {
        const s = this.sessions.get(client.sessionId);
        // Left while training: the treadmill keeps earning until they come back (payOffline)
        if (s && Date.now() - s.treadSeen < 3000 && s.treadMult > 0) s.profile.offline = { mult: s.treadMult, at: Date.now() };
        this.state.players.delete(client.sessionId);
        this.sessions.delete(client.sessionId);
        markDirty();
        if (s && !isOnline(s.profile.uid)) releaseProfile(s.profile.uid, isOnline);
    }

    // Colyseus awaits this on SIGTERM, which is how Legion stops a pod on every deploy
    onDispose() { liveRooms.delete(this); markDirty(); return saveProfiles(); }

    async applyQueuedGrants() {
        const uids = [...this.sessions.values()].map((s) => s.profile.uid);
        let grants = [];
        try { grants = await claimGrants(uids); } catch (e) { return console.warn('[DB] grants:', e.message); }
        for (const g of grants) {
            const entry = [...this.sessions].find(([, s]) => s.profile.uid === g.uid);
            if (entry) { this.grant({ ...entry[1], id: entry[0] }, g.kind, g.key); continue; }
            // Left between the query and now: put it back for their next visit
            queueGrant(g.uid, g.name, g.kind, g.key, g.tx).catch(() => {});
        }
        if (grants.length) saveProfiles();
    }

    // ----- helpers -----
    syncPublic(id) {
        const s = this.sessions.get(id);
        if (!s) return;
        const p = s.profile, pl = s.player;
        pl.speed = p.speed; pl.wins = p.wins; pl.level = p.level; pl.xp = p.xp;
        pl.rebirths = p.rebirths; pl.equipped = p.equipped; pl.aura = p.aura || '';
    }
    sendProfile(id) {
        const s = this.sessions.get(id);
        if (!s) return;
        const p = s.profile;
        s.client.send('profile', {
            owned: p.owned, equipped: p.equipped, auras: p.auras, aura: p.aura, passes: p.passes,
            boostUntil: p.boostUntil, customSpeed: p.customSpeed, claimedPack: p.claimedPack,
            firstPlay: p.firstPlay, freeClaimed: s.freeClaimed, joinedAt: s.joinedAt, daily: p.daily,
            chestAt: p.chestAt, freeBoost: !!s.freeBoost, save: sealProfile(p),
        });
    }
    toast(s, text, color) { s.client.send('toast', { text, color }); }
    cooldown(s, key, seconds) {
        const now = Date.now();
        if ((s.cooldowns.get(key) || 0) > now) return false;
        s.cooldowns.set(key, now + seconds * 1000);
        return true;
    }
    changed(id) { this.syncPublic(id); this.sendProfile(id); markDirty(); }

    addSpeed(s, amount, boosted) {
        const p = s.profile;
        if (!(amount > 0)) return 0;
        if (boosted) amount = Math.floor(amount * speedMult(p, Date.now(), s.friends) + 0.5);
        p.speed += amount;
        // XP is earned 1:1 with Speed; at MAX level the bar keeps filling up to its cap
        const old = p.level;
        p.xp += amount;
        while (p.level < CFG.maxLevel && p.xp >= xpFor(p.level)) { p.xp -= xpFor(p.level); p.level++; }
        if (p.level >= CFG.maxLevel) p.xp = Math.min(p.xp, xpFor(CFG.maxLevel));
        if (p.level > old) {
            s.client.send('levelUp', { from: old, to: p.level, walk: [maxSpeedFor(old, p.rebirths), maxSpeedFor(p.level, p.rebirths)] });
        }
        markDirty();
        return amount;
    }
    addWins(s, n, boosted) {
        if (boosted) n *= 1 + (s.profile.rebirths || 0) * CFG.rebirthWins;
        if (boosted && s.profile.passes.DoubleWins) n *= 2;
        s.profile.wins += n;
        markDirty();
        return n;
    }

    // ----- simulation -----
    tick(dt) {
        const now = Date.now();
        for (const [id, s] of this.sessions) {
            const pl = s.player;
            // Speed from running, every 0.5s while the player is moving
            s.gainT += dt / 1000;
            if (s.gainT < CFG.gainInterval) continue;
            s.gainT -= CFG.gainInterval;
            if (!s.moving || now - s.lastMove > 700 || pl.anim === 3) continue;
            let mult = 1;
            const tread = treadmillAt(pl.x, pl.y, pl.z);
            if (tread && !this.treadLocked(s.profile, tread)) { mult = tread.mult; s.treadMult = mult; s.treadSeen = now; }
            const got = this.addSpeed(s, this.stepSpeed(s.profile) * mult, true);
            this.syncPublic(id);
            if (mult > 1) s.client.send('gain', { n: got, tread: 1 });
        }
    }
    // Speed per step before multipliers: the ridden bike's "+N/Speed" (at least +1)
    stepSpeed(p) { return Math.max(1, (bikeById[p.equipped] || { bonus: 1 }).bonus); }

    // "Get Speed While Offline!": time away after leaving on a treadmill pays out at a reduced rate
    payOffline(s) {
        const p = s && s.profile, off = p && p.offline;
        if (!off) return;
        delete p.offline;
        const secs = Math.min(CFG.offlineHours * 3600, (Date.now() - (off.at || 0)) / 1000);
        if (!(secs > 60)) return markDirty();
        const steps = secs / CFG.gainInterval;
        const amount = Math.floor(steps * this.stepSpeed(p) * clamp(off.mult | 0, 1, 100) * CFG.offlineRate * speedMult(p, Date.now(), 0));
        if (amount <= 0) return markDirty();
        this.addSpeed(s, amount, false);
        s.client.send('offline', { speed: amount, secs: Math.floor(secs), mult: off.mult | 0 });
    }

    treadLocked(p, def) {
        if (def.pass) return !p.passes[def.pass];
        if (def.req) return p.wins < def.req;
        return false;
    }

    broadcastBoards(target) {
        // Database leaders (every pod) merged with the players online here
        const top = (key) => topProfiles(key).map((p) => ({ n: p.name, v: Math.floor(p[key] || 0) }));
        const msg = { speed: top('speed'), wins: top('wins') };
        if (target) target.send('boards', msg); else this.broadcast('boards', msg);
    }

    // ----- messages -----
    onMove(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || !finite(m.x) || !finite(m.y) || !finite(m.z)) return;
        const pl = s.player;
        pl.x = clamp(m.x, -200, 200);
        pl.y = clamp(m.y, -100, 600);
        pl.z = clamp(m.z, -200, 4000);
        pl.ry = finite(m.ry) ? m.ry : 0;
        pl.anim = clamp(m.a | 0, 0, 3);
        s.moving = !!m.mv;
        s.lastMove = Date.now();
        if (pl.z < STAGES[0].zS - 2) s.padArmed = true;
    }

    onPickup(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m) return;
        const idx = m.s | 0, st = STAGES[idx];
        if (!st || stageAt(s.player.z) !== idx) return;
        // Ids are 'stage:n' as built by world.js; anything else could farm endless cooldown keys
        const id = String(m.id);
        const mt = /^(\d+):(\d{1,2})$/.exec(id);
        if (!mt || (mt[1] | 0) !== idx || (mt[2] | 0) >= CFG.maxPickupsPerStage) return;
        if (!this.cooldown(s, 'pickup:' + id, CFG.pickupRespawn - 0.5)) return;
        const got = this.addSpeed(s, st.pickup, true);
        this.syncPublic(client.sessionId);
        client.send('gain', { n: got, pickup: 1 });
    }

    onPad(client, m) {
        const s = this.sessions.get(client.sessionId);
        const st = m && STAGES[m.s | 0];
        if (!s || !st) return;
        const z = s.player.z;
        if (z < st.cE - 5 || z > st.zE + 5) return;
        // One claim per run: the pad is re-armed once the player is back in the lobby
        if (!s.padArmed || !this.cooldown(s, 'pad', 2)) return;
        s.padArmed = false;
        const got = this.addWins(s, st.wins, true);
        this.syncPublic(client.sessionId);
        client.send('wins', { n: got });
        const r = this.race;
        if ((m.s | 0) === 0 && r && r.started && !r.done && r.racers.has(client.sessionId)) {
            r.done = true;
            this.addWins(s, CFG.race.prizeWins, false);
            this.syncPublic(client.sessionId);
            this.broadcast('raceEnd', { winner: s.profile.name, prize: CFG.race.prizeWins });
        }
    }

    // ----- Race event: announced on the server clock, racers start together at the Stage 1 gate,
    // the first racer to touch the Stage 1 Wins pad wins the prize -----
    raceTick() {
        const R = CFG.race, now = Date.now();
        const cycle = Math.floor(now / 1000 / R.every), startAt = (cycle * R.every + R.countdown) * 1000;
        if (now < startAt && (!this.race || this.race.cycle !== cycle)) {
            this.race = { cycle, startAt, racers: new Set(), started: false, done: false };
            this.broadcast('race', { startAt });
        }
        const r = this.race;
        if (!r) return;
        for (const id of r.racers) if (!this.sessions.has(id)) r.racers.delete(id);
        if (!r.started && now >= r.startAt) {
            r.started = true;
            if (!r.racers.size) { r.done = true; return; }
            for (const id of r.racers) this.sessions.get(id).client.send('raceGo', { racers: r.racers.size });
        }
        if (r.started && !r.done && now > r.startAt + R.maxTime * 1000) {
            r.done = true;
            this.broadcast('raceEnd', { winner: null });
        }
    }
    onRaceJoin(client) {
        const r = this.race, s = this.sessions.get(client.sessionId);
        if (!s || !r || r.started || Date.now() >= r.startAt) return;
        r.racers.add(client.sessionId);
        this.toast(s, 'Joined the race! Get ready...', GOLD);
    }

    // Group Chest in the lobby: once every GROUP_CHEST.hours
    onChest(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile, left = (p.chestAt || 0) + GROUP_CHEST.hours * 3600000 - Date.now();
        if (left > 0) return this.toast(s, 'Chest refills in ' + Math.ceil(left / 3600000) + 'h', BLUE);
        p.chestAt = Date.now();
        this.addSpeed(s, GROUP_CHEST.speed, false);
        this.addWins(s, GROUP_CHEST.wins, false);
        this.toast(s, 'Group Chest! +' + fmt(GROUP_CHEST.speed) + ' Speed & +' + GROUP_CHEST.wins + ' Wins', GOLD);
        client.send('fx', { kind: 'confetti' });
        this.changed(client.sessionId);
    }
    // The Mystery Crate opens after EGG_MINUTES of play in this session: a free Turbo Scooter
    onEgg(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile;
        if (p.owned.Turbo) return this.onShop(client, { id: 'Turbo' });
        if ((Date.now() - s.joinedAt) / 60000 < EGG_MINUTES) return this.toast(s, 'Keep playing to open the crate!', BLUE);
        p.owned.Turbo = true;
        p.equipped = 'Turbo';
        this.toast(s, 'The crate had a Turbo Scooter! +' + bikeById.Turbo.bonus + '/Speed', GREEN);
        client.send('fx', { kind: 'confetti' });
        this.changed(client.sessionId);
    }
    // "Keep playing" hut: one free timed Speed Boost per session
    onFreeBoost(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s || s.freeBoost) return;
        if ((Date.now() - s.joinedAt) / 60000 < FREE_BOOST_MINUTES) return;
        s.freeBoost = true;
        const p = s.profile;
        p.boostUntil = Math.max(Date.now(), p.boostUntil) + CFG.boostMinutes * 60000;
        this.toast(s, 'FREE x2 Speed Boost!', GOLD);
        client.send('fx', { kind: 'confetti' });
        this.changed(client.sessionId);
    }

    onShop(client, m) {
        const s = this.sessions.get(client.sessionId);
        const d = m && bikeById[m.id];
        if (!s || !d) return;
        const p = s.profile;
        if (p.owned[d.id]) {
            if (p.equipped !== d.id) { p.equipped = d.id; this.toast(s, 'Equipped ' + d.name + '!', BLUE); }
        } else if (d.pass || d.timed) {
            return;
        } else if (p.wins < d.req) {
            return this.toast(s, 'Not Enough Wins!', RED);
        } else {
            p.owned[d.id] = true;
            p.equipped = d.id;
            this.toast(s, 'Equipped +' + fmt(d.bonus) + ' Motorcycle!', GREEN);
        }
        this.changed(client.sessionId);
    }

    onAura(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile;
        const a = m && m.id ? auraById[m.id] : null;
        if (!a) { p.aura = ''; return this.changed(client.sessionId); }
        const unlocked = p.auras[a.id] || (a.pass ? p.passes[a.pass] : p.wins >= a.req);
        if (!unlocked) return this.toast(s, 'Need ' + fmt((a.req || 0) - p.wins) + ' more Wins!', RED);
        p.auras[a.id] = true;
        p.aura = a.id;
        this.toast(s, a.name + ' equipped!', '#' + a.color.toString(16).padStart(6, '0'));
        this.changed(client.sessionId);
    }

    onRebirth(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile;
        if (p.level < CFG.rebirthLevel) return this.toast(s, 'Reach Level ' + CFG.rebirthLevel + ' to Rebirth!', RED);
        p.rebirths++;
        p.level = 1; p.xp = 0; p.customSpeed = 0;
        this.toast(s, 'REBIRTH! Speed boost is now x' + (1 + p.rebirths * CFG.rebirthStep), BLUE);
        client.send('fx', { kind: 'confetti' });
        this.changed(client.sessionId);
    }

    onFree(client, m) {
        const s = this.sessions.get(client.sessionId);
        const i = m ? m.i | 0 : -1;
        const r = FREE[i];
        if (!s || !r || s.freeClaimed[i]) return;
        if ((Date.now() - s.joinedAt) / 60000 < r.min) return;
        s.freeClaimed[i] = true;
        if (r.speed) this.addSpeed(s, r.speed, false); else this.addWins(s, r.wins, false);
        this.toast(s, 'Claimed ' + (r.speed ? '+' + fmt(r.speed) + ' Speed' : '+' + r.wins + ' Wins') + '!', GREEN);
        client.send('fx', { kind: 'confetti' });
        this.changed(client.sessionId);
    }

    onDaily(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile, now = Date.now();
        const st = dailyStatus(p.daily, now);
        if (!st.can) return this.toast(s, 'Come back tomorrow for more!', BLUE);
        const r = DAILY[st.day];
        p.daily = { last: dayKey(now), streak: st.streak + 1 };
        if (r.speed) this.addSpeed(s, r.speed, false);
        if (r.wins) this.addWins(s, r.wins, false);
        if (r.rebirths) p.rebirths += r.rebirths;
        this.toast(s, 'Day ' + p.daily.streak + ' streak! ' + rewardText(r), GREEN);
        client.send('fx', { kind: 'confetti' });
        this.changed(client.sessionId);
    }

    // Demo mode grants for free. In Bux mode (LEGION_WEBHOOK_SECRET set) only the webhook grants.
    onBuy(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m) return;
        if (BUX_MODE) return this.toast(s, 'Purchases use Bux - log in to Bloxity', BLUE);
        this.grant({ ...s, id: client.sessionId }, m.kind, m.key);
    }

    // s is a live session, or a stand-in { profile, client: { send() {} } } for offline players
    grant(s, kind, key) {
        const m = { kind, key };
        const client = s.client;
        const p = s.profile;
        if (m.kind === 'pass') {
            const pass = PASSES[m.key];
            if (!pass) return false;
            if (p.passes[m.key]) { this.toast(s, pass.name + ' already owned!', BLUE); return true; }
            p.passes[m.key] = true;
            const d = BIKES.find((x) => x.pass === m.key);
            if (d) { p.owned[d.id] = true; p.equipped = d.id; }
            const a = AURAS.find((x) => x.pass === m.key);
            if (a) { p.auras[a.id] = true; p.aura = a.id; }
            this.toast(s, pass.name + ' unlocked!', GREEN);
        } else {
            const prod = PRODUCTS[m.key];
            if (!prod) return false;
            if (m.key === 'Revive') { client.send('revived', {}); return true; }
            if (m.key === 'SpeedBoost') {
                p.boostUntil = Math.max(Date.now(), p.boostUntil) + CFG.boostMinutes * 60000;
                this.toast(s, 'x2 Speed Boost active!', GOLD);
            }
            if (m.key === 'StarterPack') {
                if (p.claimedPack) { this.toast(s, 'Starter Pack already claimed!', BLUE); return true; }
                p.claimedPack = true;
            }
            if (prod.speed) { this.addSpeed(s, prod.speed, false); this.toast(s, '+' + fmt(prod.speed) + ' Speed!', GREEN); }
            if (prod.wins) { this.addWins(s, prod.wins, false); this.toast(s, '+' + prod.wins + ' Wins!', GOLD); }
        }
        client.send('fx', { kind: 'confetti' });
        if (s.id) this.changed(s.id); else markDirty();
        return true;
    }

    onCustom(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m) return;
        const p = s.profile;
        const max = maxSpeedFor(p.level, p.rebirths);
        const v = Math.floor(Number(m.v) || 0);
        p.customSpeed = v <= 0 || v >= max ? 0 : clamp(v, CFG.minWalk, max);
        this.toast(s, 'Walk speed set to ' + (p.customSpeed || max), BLUE);
        this.changed(client.sessionId);
    }

    // ----- Bloxity -----
    // Logged in to Bloxity after joining: move this session onto the Bloxity profile
    async onBloxityLogin(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || s.authing) return;
        s.authing = true;
        const legion = await verifyBloxityToken(m.token);
        s.authing = false;
        if (!legion || !this.sessions.has(client.sessionId)) return;
        const uid = 'legion_' + legion.id;
        if (s.profile.uid === uid) return;
        const name = cleanName(legion.name) || s.profile.name;
        const guestProfile = s.profile;
        await adoptGuestProgress(uid, guestProfile.uid, name);
        await loadProfile(uid);
        if (!this.sessions.has(client.sessionId)) return;
        s.profile = getProfile(uid, name, randomName());
        if (!isOnline(guestProfile.uid)) releaseProfile(guestProfile.uid, isOnline);
        s.player.name = s.profile.name;
        this.changed(client.sessionId);
        client.send('authed', { name: s.profile.name });
        this.toast(s, 'Logged in as ' + s.profile.name, GREEN);
        this.broadcastBoards();
    }
    onAvatar(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (s && m) s.player.av = cleanAvatar(m.av);
    }
    // Emote ids are opaque catalogue ids; other players play the same clip
    onEmote(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || typeof m.id !== 'string' || m.id.length > 40) return;
        this.broadcast('emote', { s: client.sessionId, id: m.id }, { except: client });
    }
    onChat(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || typeof m.text !== 'string') return;
        const now = Date.now();
        if (now - s.lastChat < 800) return;
        s.lastChat = now;
        const text = m.text.replace(/\s+/g, ' ').trim().slice(0, 120);
        if (text) this.broadcast('chat', { s: client.sessionId, name: s.profile.name, text });
    }
    // Friend Boost: the client counts its Bloxity friends among the names in this room.
    // Only names actually present here are counted, and the bonus is capped.
    onFriends(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || !Array.isArray(m.names)) return;
        const here = new Set([...this.sessions.values()].filter((o) => o !== s).map((o) => o.profile.name));
        const n = new Set(m.names.slice(0, 50).map(String).filter((x) => here.has(x))).size;
        const friends = Math.min(CFG.friendMax, n);
        if (friends === s.friends) return;
        s.friends = friends;
        s.player.friends = friends;
    }
}

function isOnline(uid) {
    for (const room of liveRooms) for (const s of room.sessions.values()) if (s.profile.uid === uid) return true;
    return false;
}

// Grants a Bux purchase confirmed by the Bloxity webhook, whether or not the player is online
export async function grantPurchase(uid, name, kind, key, tx) {
    for (const room of liveRooms) {
        for (const [id, s] of room.sessions) {
            if (s.profile.uid === uid) return room.grant({ ...s, id }, kind, key);
        }
    }
    // Not on this pod: the pod hosting them (or their next join) applies it
    if (USE_DB) { await queueGrant(uid, name, kind, key, tx); return true; }
    await loadProfile(uid);
    const profile = getProfile(uid, name, randomName());
    const stub = { profile, client: { send() {} } };
    const proto = SpeedRoom.prototype;
    return proto.grant.call({ toast() {}, addSpeed: proto.addSpeed, addWins: proto.addWins, changed() {} }, stub, kind, key);
}
