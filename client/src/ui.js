import { $ } from './engine.js';
import { S, actions, net } from './state.js';
import * as BX from './bloxity.js';
import { sfx, getVolumes, setVolume } from './audio.js';
import { QUALITIES, getQuality, setQuality } from './fx.js';
import {
    CFG, STAGES, PRODUCTS, PASSES, OFFERS, AURAS, FREE, DAILY, dailyStatus, rewardText, xpFor, maxSpeedFor, fmt, fmt1, commas, clock, clamp,
} from '../../shared/config.js';

// Bux coin + amount (our own strings only; never user text)
const bux = (n) => '<i class="bx" aria-hidden="true"></i>' + fmt(n);
function setHtml(node, html) { if (node && node.innerHTML !== html) node.innerHTML = html; }

const el = {
    wins: $('#winsVal'), speed: $('#speedVal'), rebStat: $('#rebirthStat'), reb: $('#rebirthVal'), online: $('#onlineVal'),
    xpFill: $('#xpFill'), levelTxt: $('#levelTxt'), xpTxt: $('#xpTxt'), stamFill: $('#stamFill'), stamTxt: $('#stamTxt'),
    maxSpeed: $('#maxSpeedTxt'), input: $('#speedInput'), price2x: $('#price2x'), boost: $('#boost'), freeBadge: $('#freeBadge'), dailyBadge: $('#dailyBadge'),
    offer: $('#offer'), offerIc: $('#offerIc'), offerTitle: $('#offerTitle'), offerSub: $('#offerSub'),
    prompt: $('#promptBtn'), promptTxt: $('#promptTxt'), fboost: $('#friendBoost'), rebBadge: $('#rebirthBadge'),
    rebMult: $('#rebMult'),
};
export const promptEl = el.prompt, promptTxtEl = el.promptTxt;

// ----- HUD -----
const shown = { wins: null, speed: null };
function bump(node) { const s = node.closest('.stat'); s.classList.remove('bump'); void s.offsetWidth; s.classList.add('bump'); }
// Wins and Speed count up smoothly to their new values
export function animateCounters(dt) {
    for (const key of ['wins', 'speed']) {
        const target = S[key];
        if (shown[key] === null) shown[key] = target;
        if (shown[key] === target) continue;
        if (target > shown[key] && key === 'wins') bump(el[key]);
        const diff = target - shown[key];
        shown[key] = Math.abs(diff) < 1 ? target : shown[key] + diff * Math.min(1, dt * 7);
        if (Math.abs(target - shown[key]) < Math.max(1, target * 0.002)) shown[key] = target;
        el[key].textContent = key === 'speed' ? commas(shown[key]) : fmt(shown[key]);
    }
}

export function updateHud(P, online) {
    el.rebStat.hidden = S.rebirths === 0;
    el.reb.textContent = S.rebirths;
    el.online.textContent = online;
    const need = xpFor(Math.min(S.level, CFG.maxLevel));
    el.xpFill.style.width = clamp(S.xp / need * 100, 0, 100) + '%';
    const lvl = S.level >= CFG.maxLevel ? 'Level MAX' : 'Level ' + S.level;
    if (el.levelTxt.textContent !== lvl) el.levelTxt.textContent = lvl;
    el.xpTxt.textContent = fmt1(S.xp) + '/' + fmt1(need);
    el.rebMult.textContent = 'x' + (1 + S.rebirths * CFG.rebirthStep) + '(Rebirth)';
    el.stamFill.style.width = (P.stamina / CFG.staminaMax * 100) + '%';
    el.stamTxt.textContent = '💨 ' + Math.floor(P.stamina) + '/' + CFG.staminaMax;
    const max = maxSpeedFor(S.level, S.rebirths);
    el.maxSpeed.textContent = 'MAX: ' + max;
    if (document.activeElement !== el.input) el.input.value = S.customSpeed > 0 && S.customSpeed <= max ? S.customSpeed : max;
    setHtml(el.price2x, S.passes.DoubleSpeed ? '✅ OWNED' : 'ONLY ' + bux(PASSES.DoubleSpeed.price));
    const fb = Math.round(Math.min(CFG.friendMax, S.friends || 0) * CFG.friendBoost * 100);
    const fbText = 'Friend Boost +' + fb + '% 🏍️';
    if (el.fboost.textContent !== fbText) { el.fboost.textContent = fbText; el.fboost.classList.toggle('on', fb > 0); }
    el.rebBadge.hidden = S.level < CFG.rebirthLevel;
    const boostLeft = (S.boostUntil - net.now()) / 1000;
    el.boost.hidden = boostLeft <= 0;
    if (boostLeft > 0) el.boost.textContent = '⚡ x' + CFG.boostMult + ' SPEED BOOST ' + clock(boostLeft);
    const mins = (net.now() - S.joinedAt) / 60000;
    el.freeBadge.hidden = !FREE.some((r, i) => mins >= r.min && !S.freeClaimed[i]);
    const daily = dailyStatus(S.daily, net.now());
    el.dailyBadge.hidden = !daily.can;
    updateOffer();
    if (!$('#modal').hidden && modalKind === 'free') renderFree();
    if (!$('#daily').hidden) renderDaily();
    if (raceStartAt) updateRace();
}

// Rotating offer at the top of the screen
let offerIdx = 0, offerT = 0, offerDismissed = false;
function updateOffer() {
    const packLeft = CFG.starterPackDuration - (net.now() - S.firstPlay) / 1000;
    const list = OFFERS.filter((o) => (o.key !== 'StarterPack' || (packLeft > 0 && !S.claimedPack)) && !(o.kind === 'pass' && S.passes[o.key]));
    offerT += 0.1;
    if (offerT > CFG.offerRotate) { offerT = 0; offerIdx++; offerDismissed = false; }
    if (!list.length || offerDismissed) { el.offer.hidden = true; return; }
    const o = list[offerIdx % list.length];
    el.offer.hidden = false;
    el.offerIc.textContent = o.ic;
    el.offerTitle.textContent = o.title;
    const price = o.kind === 'pass' ? PASSES[o.key].price : PRODUCTS[o.key].price;
    setHtml(el.offerSub, (o.key === 'StarterPack' ? '⏰ ' + clock(packLeft) + ' · ' : '') + 'ONLY ' + bux(price));
    el.offer.dataset.kind = o.kind; el.offer.dataset.key = o.key;
}
$('#offerYes').addEventListener('click', () => buy(el.offer.dataset.kind, el.offer.dataset.key));
$('#offerNo').addEventListener('click', () => { offerDismissed = true; el.offer.hidden = true; });

export function toast(text, color) {
    const d = document.createElement('div');
    d.className = 'toast o'; d.textContent = text; d.style.color = color || '#fff';
    const box = $('#toasts');
    box.appendChild(d);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => d.remove(), 2400);
}
export function showGoal(n) {
    const g = $('#goalBanner');
    $('#goalSub').textContent = '+' + fmt(n) + ' Wins';
    g.hidden = false;
    g.classList.remove('show'); void g.offsetWidth; g.classList.add('show');
    clearTimeout(showGoal.t);
    showGoal.t = setTimeout(() => { g.hidden = true; }, 2600);
}
// "Level Up! (1 -> 2)" / "New Speed: 14 -> 16", as in the reference
export function levelUp(a, b, walk) {
    const f = $('#flash');
    f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
    $('#levelA').textContent = 'Level Up! (' + a + ' -> ' + b + ')';
    $('#levelB').textContent = walk ? 'New Speed: ' + walk[0] + ' -> ' + walk[1] : '';
    const d = $('#levelBanner');
    d.classList.remove('show'); void d.offsetWidth; d.classList.add('show');
}
// ----- Race event card: counts down to the start; JOIN signs you up -----
let raceStartAt = 0, raceJoined = false, raceClosed = false;
export function showRace(startAt) {
    raceStartAt = startAt; raceJoined = false; raceClosed = false;
    const j = $('#raceJoin');
    j.disabled = false; j.textContent = 'JOIN';
    updateRace();
}
function updateRace() {
    const left = Math.ceil((raceStartAt - net.now()) / 1000);
    const show = left > 0 && !raceClosed;
    $('#racePop').hidden = !show;
    if (show) $('#raceText').textContent = 'Race starting in ' + left + 's!';
}
$('#raceJoin').addEventListener('click', () => {
    if (raceJoined) return;
    raceJoined = true;
    net.send('raceJoin');
    const j = $('#raceJoin'); j.disabled = true; j.textContent = 'JOINED ✓';
});
$('#raceClose').addEventListener('click', () => { raceClosed = true; $('#racePop').hidden = true; });
// Big "3, 2, 1, GO!" in the middle of the screen
export function raceCountdown(n) {
    const el = $('#raceCount');
    if (n === null) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = n > 0 ? String(n) : 'GO!';
    el.classList.toggle('go', n <= 0);
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}

// Treadmill earnings while the player was away
export function showOffline(m) {
    const h = Math.floor(m.secs / 3600), mm = Math.floor((m.secs % 3600) / 60);
    $('#offlineText').textContent = 'Your x' + m.mult + ' treadmill kept running for ' + (h ? h + 'h ' : '') + mm + 'm while you were away!';
    $('#offlineGain').textContent = '+' + fmt(m.speed) + ' Speed';
    $('#offlinePop').hidden = false;
    sfx('buy');
}
$('#offlineOk').addEventListener('click', () => { $('#offlinePop').hidden = true; });
let titleTimer;
export function showStageTitle(s) {
    $('#stageName').textContent = s.name;
    const sub = $('#stageSub'); sub.textContent = s.sub || ''; sub.style.color = s.subColor || '';
    const t = $('#stageTitle'); t.style.opacity = 1;
    t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
    clearTimeout(titleTimer);
    titleTimer = setTimeout(() => { t.style.opacity = 0; }, 2600);
}

el.input.addEventListener('change', () => net.send('custom', { v: Number(el.input.value) || 0 }));

// ----- purchases (free in the web demo; the server grants them) -----
let pendingBuy = null;
export function buy(kind, key) {
    if (kind === 'pass' && S.passes[key]) { toast(PASSES[key].name + ' already owned!', '#6fe0ff'); return; }
    const item = kind === 'pass' ? PASSES[key] : PRODUCTS[key];
    if (!item) return;
    if (net.bux) { buyBux(kind, key); return; }
    pendingBuy = { kind, key };
    $('#buyItem').textContent = item.name;
    setHtml($('#buyCost'), bux(item.price) + ' Bux');
    $('#buy').hidden = false;
}
// Bloxity shows its own confirm modal; the grant arrives from the server after its webhook
async function buyBux(kind, key) {
    const r = await BX.buyWithBux(kind, key);
    if (r.success) { toast('Purchase complete!', '#7dff6b'); return; }
    if (key === 'Revive') actions.revive(false);
    if (r.error && !/cancel/i.test(r.error)) toast(r.error, '#ff5a5a');
}
$('#buyOk').addEventListener('click', () => {
    $('#buy').hidden = true;
    if (pendingBuy) net.send('buy', pendingBuy);
    pendingBuy = null;
});
$('#buyCancel').addEventListener('click', () => {
    $('#buy').hidden = true;
    if (pendingBuy && pendingBuy.key === 'Revive') actions.revive(false);
    pendingBuy = null;
});
$('#btn2x').addEventListener('click', () => buy('pass', 'DoubleSpeed'));
document.querySelectorAll('[data-product]').forEach((b) => b.addEventListener('click', () => buy('product', b.dataset.product)));

// ----- revive popup: "You were caught! You reached Stage N!" -----
let reviveTimer;
export function showRevive(stage) {
    setHtml($('#revivePrice'), 'ONLY ' + bux(PRODUCTS.Revive.price));
    const s = STAGES[stage];
    $('#reviveReached').textContent = s ? 'You reached Stage ' + (stage + 1) + '!' : 'You fell!';
    $('#revive').hidden = false;
    let left = CFG.reviveTimeout;
    $('#reviveTimer').textContent = 'Back to the checkpoint in ' + left + 's';
    clearInterval(reviveTimer);
    reviveTimer = setInterval(() => {
        left--;
        $('#reviveTimer').textContent = 'Back to the checkpoint in ' + Math.max(0, left) + 's';
        if (left <= 0) { $('#buy').hidden = true; pendingBuy = null; actions.revive(false); }
    }, 1000);
}
export function hideRevive() {
    clearInterval(reviveTimer);
    $('#revive').hidden = true;
}
$('#reviveYes').addEventListener('click', () => { hideRevive(); buy('product', 'Revive'); });
$('#reviveNo').addEventListener('click', () => actions.revive(false));

// ----- panels -----
let modalKind = null;
export function openModal(kind) { modalKind = kind; renderModal(); $('#modal').hidden = false; }
export function closeModal() { $('#modal').hidden = true; modalKind = null; }
export function refreshModal() { if (!$('#modal').hidden) renderModal(); }
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal') closeModal(); });
$('#btnRebirth').addEventListener('click', () => openModal('rebirth'));
$('#btnAuras').addEventListener('click', () => openModal('auras'));
$('#btnFree').addEventListener('click', () => openModal('free'));
$('#btnDaily').addEventListener('click', () => openDaily());
$('#btnStore').addEventListener('click', () => openModal('store'));
$('#btnFriends').addEventListener('click', () => openModal('friends'));
$('#btnWardrobe').addEventListener('click', () => {
    if (BX.bloxity.ready) BX.showCustomizer(); else toast('Bloxity avatars are not available right now', '#ffb51c');
});
$('#btnSettings').addEventListener('click', () => openModal('settings'));
// Every chunky button clicks
document.addEventListener('pointerdown', (e) => { if (e.target.closest && e.target.closest('.btn, .rbx, .qb')) sfx('click'); });

function renderSettings(body) {
    const vols = getVolumes();
    const w = document.createElement('div');
    w.className = 'settings';
    w.innerHTML = `
        <label class="set-row o1" for="volMusic"><span>🎵 Music</span><input id="volMusic" type="range" min="0" max="100" value="${Math.round(vols.music * 100)}"></label>
        <label class="set-row o1" for="volSfx"><span>🔊 Sound effects</span><input id="volSfx" type="range" min="0" max="100" value="${Math.round(vols.sfx * 100)}"></label>
        <div class="set-row o1"><span>✨ Graphics</span><div class="seg" role="radiogroup" aria-label="Graphics quality"></div></div>
        <p class="set-note">Low turns off glow and shadows for older phones.</p>`;
    w.querySelector('#volMusic').addEventListener('input', (e) => setVolume('music', e.target.value / 100));
    w.querySelector('#volSfx').addEventListener('input', (e) => setVolume('sfx', e.target.value / 100));
    const seg = w.querySelector('.seg');
    for (const [key, q] of Object.entries(QUALITIES)) {
        const b = document.createElement('button');
        b.className = 'btn o1 ' + (getQuality() === key ? 'g-green' : 'g-grey');
        b.textContent = q.label;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(getQuality() === key));
        b.addEventListener('click', () => { setQuality(key); renderModal(); });
        seg.appendChild(b);
    }
    body.appendChild(w);
}

function rowCard(ic, name, desc, btnText, btnClass, onClick, disabled) {
    const d = document.createElement('div');
    d.className = 'row-card';
    d.innerHTML = '<div class="ic"></div><div><div class="nm o1"></div><div class="ds"></div></div><button class="btn o1"></button>';
    d.querySelector('.ic').textContent = ic;
    d.querySelector('.nm').textContent = name;
    d.querySelector('.ds').textContent = desc;
    const b = d.querySelector('button');
    b.classList.add(btnClass);
    setHtml(b, btnText); b.disabled = !!disabled;
    b.addEventListener('click', onClick);
    return d;
}
function sec(text) { const d = document.createElement('div'); d.className = 'sec'; d.textContent = text; return d; }

function renderModal() {
    const body = $('#modalBody');
    const title = $('#modalTitle');
    body.innerHTML = '';
    if (modalKind === 'rebirth') {
        title.textContent = 'Rebirth';
        const cur = 1 + S.rebirths * CFG.rebirthStep, next = cur + CFG.rebirthStep;
        const ready = S.level >= CFG.rebirthLevel;
        const w = document.createElement('div');
        w.className = 'rebirth-box';
        w.innerHTML = `<div class="big o">🔄 ${S.rebirths} Rebirths</div>
            <div class="mult o"><span style="color:#6fe0ff">x${cur}</span><span>➜</span><span style="color:#7dff6b">x${next}</span></div>
            <p>Each rebirth adds +50% to all Speed you earn and +${CFG.rebirthWalk} riding speed. Your level resets to 1. You keep Speed, Wins and motorcycles.</p>
            <p style="color:${ready ? '#7dff6b' : '#ffb51c'};font-weight:700">${ready ? 'Ready to rebirth!' : 'Reach Level ' + CFG.rebirthLevel + ' to rebirth (now Level ' + S.level + ')'}</p>`;
        const b = document.createElement('button');
        b.className = 'btn o ' + (ready ? 'g-green' : 'g-grey');
        b.textContent = 'REBIRTH';
        b.disabled = !ready;
        b.addEventListener('click', () => net.send('rebirth'));
        w.appendChild(b);
        body.appendChild(w);
    } else if (modalKind === 'auras') {
        title.textContent = 'Auras';
        for (const a of AURAS) {
            const owned = S.auras[a.id] || (a.pass ? S.passes[a.pass] : S.wins >= a.req);
            const on = S.aura === a.id;
            const desc = 'x' + a.mult + ' Speed · ' + (a.pass ? 'Game pass' : '🏆 ' + fmt(a.req) + ' Wins');
            let btn, cls, fn;
            if (on) { btn = 'Unequip'; cls = 'g-grey'; fn = () => net.send('aura', { id: '' }); }
            else if (owned) { btn = 'Equip'; cls = 'g-green'; fn = () => net.send('aura', { id: a.id }); }
            else if (a.pass) { btn = bux(PASSES[a.pass].price); cls = 'g-pink'; fn = () => buy('pass', a.pass); }
            else { btn = '🔒 Locked'; cls = 'g-grey'; fn = () => toast('Need ' + fmt(a.req - S.wins) + ' more Wins!', '#ff5a5a'); }
            body.appendChild(rowCard(a.ic, a.name, desc, btn, cls, fn));
        }
    } else if (modalKind === 'free') {
        title.textContent = 'FREE Rewards';
        renderFree();
    } else if (modalKind === 'friends') {
        title.textContent = 'Friends';
        renderFriends(body);
    } else if (modalKind === 'settings') {
        title.textContent = 'Settings';
        renderSettings(body);
    } else if (modalKind === 'store') {
        title.textContent = 'Store';
        body.appendChild(sec('Speed'));
        for (const k of ['Speed100K', 'Speed1M', 'Speed10M']) {
            const p = PRODUCTS[k];
            body.appendChild(rowCard('👟', p.name, 'Instant Speed', bux(p.price), 'g-yellow', () => buy('product', k)));
        }
        body.appendChild(rowCard('⏱️', 'x2 Speed Boost', '15 minutes of double Speed', bux(PRODUCTS.SpeedBoost.price), 'g-yellow', () => buy('product', 'SpeedBoost')));
        body.appendChild(sec('Wins'));
        for (const k of ['Wins500', 'Wins5K']) {
            const p = PRODUCTS[k];
            body.appendChild(rowCard('🏆', p.name, 'Unlock motorcycles in the showroom', bux(p.price), 'g-yellow', () => buy('product', k)));
        }
        body.appendChild(sec('Game passes'));
        for (const k of Object.keys(PASSES)) {
            const p = PASSES[k], owned = !!S.passes[k];
            body.appendChild(rowCard(p.ic, p.name, p.desc, owned ? 'OWNED' : bux(p.price), owned ? 'g-grey' : 'g-green', () => buy('pass', k), owned));
        }
    }
}
// ----- Daily Reward popup (seven cards, a day track, CLAIM REWARD, time left) -----
// Opens by itself once per session when a reward is waiting, like the reference
let dailyAuto = false;
export function openDailyOnJoin() {
    if (dailyAuto || !S.daily || !net.room) return;
    dailyAuto = true;
    if (dailyStatus(S.daily, net.now()).can) setTimeout(openDaily, 1200);
}
function openDaily() { renderDaily(true); $('#daily').hidden = false; }
$('#dailyClose').addEventListener('click', () => { $('#daily').hidden = true; });
$('#daily').addEventListener('pointerdown', (e) => { if (e.target.id === 'daily') $('#daily').hidden = true; });
$('#dailyClaim').addEventListener('click', () => { net.send('daily'); setTimeout(() => { $('#daily').hidden = true; }, 700); });
let dailySig = '';
function renderDaily(force) {
    const st = dailyStatus(S.daily, net.now());
    const sig = st.can + '|' + st.streak + '|' + st.day;
    if (force || sig !== dailySig) {
        dailySig = sig;
        const cards = $('#dailyCards'), track = $('#dailyTrack');
        cards.innerHTML = ''; track.innerHTML = '';
        DAILY.forEach((r, i) => {
            const done = i < st.streak && (i < st.day || !st.can);
            const d = document.createElement('div');
            d.className = 'dcard' + (done ? ' done' : '') + (i === st.day && st.can ? ' today' : '');
            d.innerHTML = '<span class="di"></span><span class="dr o"></span>';
            d.querySelector('.di').textContent = r.rebirths ? '🔄' : r.wins ? '🏆' : '👟';
            d.querySelector('.dr').textContent = r.rebirths ? r.rebirths : '+' + fmt(r.speed || r.wins);
            d.title = 'Day ' + (i + 1) + ': ' + rewardText(r);
            cards.appendChild(d);
            const dot = document.createElement('div');
            dot.className = 'dot o1' + (i < st.streak + (st.can ? 1 : 0) ? ' on' : '');
            dot.innerHTML = '<i></i><span></span>';
            dot.querySelector('span').textContent = 'Day ' + (i + 1);
            track.appendChild(dot);
        });
        const b = $('#dailyClaim');
        b.disabled = !st.can;
        b.textContent = st.can ? 'CLAIM REWARD' : 'CLAIMED!';
    }
    // Time until the next UTC day (the claim window rolls over at midnight UTC)
    const now = net.now(), next = Math.ceil((now + 1) / 86400000) * 86400000;
    $('#dailyLeft').textContent = (st.can ? 'Time left to claim: ' : 'Next reward in: ') + clock((next - now) / 1000);
}

// Bloxity friends with presence, a shareable invite link and per-friend invites
function renderFriends(body) {
    const note = (text) => { const p = document.createElement('p'); p.className = 'set-note'; p.textContent = text; body.appendChild(p); return p; };
    if (!BX.bloxity.ready) { note('Bloxity is not available right now.'); return; }
    const id = BX.identity();
    const link = document.createElement('div');
    link.className = 'invite-row';
    link.innerHTML = '<input id="inviteLink" readonly aria-label="Invite link"><button class="btn g-green o1" id="copyInvite">Copy link</button>';
    body.appendChild(link);
    const input = link.querySelector('input');
    input.value = BX.getInviteLink();
    link.querySelector('button').addEventListener('click', async () => {
        input.select();
        try { await navigator.clipboard.writeText(input.value); toast('Invite link copied!', '#7dff6b'); }
        catch (e) { document.execCommand && document.execCommand('copy'); toast('Select the link and copy it', '#ffb51c'); }
    });
    if (!id.loggedIn) {
        note('Log in with Bloxity to see your friends and invite them into this server.');
        const b = document.createElement('button');
        b.className = 'btn g-blue o1'; b.textContent = 'Log in with Bloxity';
        b.addEventListener('click', () => BX.login());
        body.appendChild(b);
        return;
    }
    const loading = note('Loading friends…');
    BX.getFriends().then((friends) => {
        if (modalKind !== 'friends') return;
        loading.remove();
        if (!friends.length) { note('No friends yet. Share the invite link above!'); return; }
        const order = { 'in-game': 0, online: 1, away: 2, offline: 3 };
        friends.sort((a, b) => (order[a.presence && a.presence.status] ?? 4) - (order[b.presence && b.presence.status] ?? 4));
        for (const f of friends) {
            const st = (f.presence && f.presence.status) || 'offline';
            const where = st === 'in-game' && f.presence.gameName ? 'Playing ' + f.presence.gameName : st;
            const dot = st === 'offline' ? '⚫' : st === 'away' ? '🟡' : '🟢';
            body.appendChild(rowCard(dot, f.displayName || f.username, where, 'Invite', 'g-green', async (e) => {
                e.currentTarget.disabled = true;
                const ok = await BX.inviteFriend(f._id);
                toast(ok ? 'Invite sent to ' + (f.displayName || f.username) : 'Could not send the invite', ok ? '#7dff6b' : '#ff5a5a');
            }));
        }
    });
}

function renderFree() {
    const body = $('#modalBody');
    body.innerHTML = '';
    const mins = (net.now() - S.joinedAt) / 60000;
    FREE.forEach((r, i) => {
        const claimed = !!S.freeClaimed[i];
        const ready = mins >= r.min;
        const name = r.speed ? '+' + fmt(r.speed) + ' Speed' : '+' + r.wins + ' Wins';
        const btn = claimed ? 'Claimed' : ready ? 'CLAIM' : clock(r.min * 60 - mins * 60);
        body.appendChild(rowCard(r.speed ? '👟' : '🏆', name, 'Play for ' + r.min + ' min', btn,
            claimed ? 'g-grey' : ready ? 'g-green' : 'g-blue', () => { if (!claimed && ready) net.send('free', { i }); }, claimed || !ready));
    });
}

