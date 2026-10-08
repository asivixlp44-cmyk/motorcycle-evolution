import {
    T, V3, scene, mat, paint, glass, chrome, box, aabb, UNIT, solids, kills, triggers, tickers,
    texFrom, billboard, textPlane, camera, signBoard, FOG, mergeChildren,
} from './engine.js';
import { S, actions, net } from './state.js';
import { facadeMaterial, asphaltMaterial, forceFieldTexture, tileMaterial, studWallMaterial, brickMaterial } from './textures.js';
import { emitTread } from './fx.js';
import { buildBike, animateBike } from './bike.js';
import {
    CFG, LOBBY, STAGES, TREADMILLS, TREAD_GEO, PASSES, BIKES, EGG_MINUTES, FREE_BOOST_MINUTES, TRAFFIC, SPIKES,
    bikeById, fmt, sci, clock, rngFrom, buxText,
} from '../../shared/config.js';

const HX = LOBBY.halfX, HZ = LOBBY.halfZ;
// Road layout: asphalt down the middle, raised sidewalks either side, buildings beyond
const SW = 12;                       // sidewalk width
const EDGE = STAGES[0].w / 2 + SW;   // building line (34)
// Colours read off the reference: lavender plaza, bright city blocks with warm yellow windows,
// dark asphalt with white dashes and yellow edge lines, grey sidewalks
const LC = {
    plaza: 0xbab2e6, plazaDark: 0x8a82c0, road: 0x4a4860, line: 0xf4f4ff, edge: 0xffd23c,
    walk: 0xc4c0dc, curb: 0x9a96b8, gold: 0xf2c230, trunk: 0x7a5236, leaf: 0x3cd25a, leafDark: 0x22a83a,
    pole: 0x34344a, red: 0xe8182c, cyan: 0x28d8ff,
};

export const SPAWN = new V3(LOBBY.spawn.x, LOBBY.spawn.y, LOBBY.spawn.z);
export const pickups = [];
export let beltTex;
const shopItems = [];
const treadItems = [];
const boards = {};
const signs = {};

// =====================================================================================
// Decor batching: thousands of little scenery boxes (windows, trees, lamps, skyline) merged
// into one vertex-coloured mesh, plus one unlit HDR batch for everything that glows, so the
// whole city costs two draw calls
// =====================================================================================
const batch = [], glowBatch = [];
function deco(sx, sy, sz, x, y, z, color, ry) { batch.push({ sx, sy, sz, x, y, z, color, ry: ry || 0 }); }
function glow(sx, sy, sz, x, y, z, color, ry) { glowBatch.push({ sx, sy, sz, x, y, z, color, ry: ry || 0 }); }
function mergeBoxes(list, material, hdr) {
    if (!list.length) return;
    const base = new T.BoxGeometry(1, 1, 1).toNonIndexed();
    const n = base.attributes.position.count;
    const pos = new Float32Array(list.length * n * 3), nor = new Float32Array(list.length * n * 3), col = new Float32Array(list.length * n * 3);
    const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), v = new T.Vector3(), nm = new T.Matrix3(), c = new T.Color();
    list.forEach((b, i) => {
        m4.compose(new T.Vector3(b.x, b.y, b.z), q.setFromEuler(e.set(0, b.ry, 0)), new T.Vector3(b.sx, b.sy, b.sz));
        nm.getNormalMatrix(m4);
        c.set(b.color);
        for (let k = 0; k < n; k++) {
            v.fromBufferAttribute(base.attributes.position, k).applyMatrix4(m4);
            pos.set([v.x, v.y, v.z], (i * n + k) * 3);
            v.fromBufferAttribute(base.attributes.normal, k).applyMatrix3(nm).normalize();
            nor.set([v.x, v.y, v.z], (i * n + k) * 3);
            // Tops a touch lighter; glowing boxes are pushed past 1.0 so bloom picks them up
            const shade = hdr || (v.y > 0.5 ? 1.08 : 1);
            col.set([c.r * shade, c.g * shade, c.b * shade], (i * n + k) * 3);
        }
    });
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.BufferAttribute(nor, 3));
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    g.computeBoundingSphere();
    const mesh = new T.Mesh(g, material);
    mesh.receiveShadow = !hdr;
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    list.length = 0;
}
function flushDecor() {
    flushStatics();
    mergeBoxes(batch, new T.MeshLambertMaterial({ vertexColors: true }), 0);
    mergeBoxes(glowBatch, new T.MeshBasicMaterial({ vertexColors: true }), 1.45);
}

// =====================================================================================
// Shared helpers
// =====================================================================================
// Static textured boxes are batched: at the end every face is merged into one mesh per base
// material, with the texture repeat baked into the UVs (so hundreds of slabs, roads and
// buildings cost a few dozen draw calls). uvScale(face) can override the repeat per face.
const statics = [];
function texturedBox(sx, sy, sz, x, y, z, material, uvScale) {
    statics.push({ sx, sy, sz, x, y, z, mats: Array.isArray(material) ? material : [material, material, material, material, material, material], uvScale });
}
const baseMats = new Map();
function baseMaterial(src) {
    if (!src.map) return src;
    const key = src.type + '|' + src.color.getHex() + '|' + src.map.source.uuid + '|' + src.transparent;
    if (!baseMats.has(key)) {
        const m = src.clone();
        m.map = src.map.clone(); m.map.repeat.set(1, 1); m.map.offset.set(0, 0); m.map.needsUpdate = true;
        baseMats.set(key, m);
    }
    return baseMats.get(key);
}
function flushStatics() {
    const box = new T.BoxGeometry(1, 1, 1).toNonIndexed();
    const P = box.attributes.position.array, N = box.attributes.normal.array, U = box.attributes.uv.array;
    const buckets = new Map();
    for (const b of statics) {
        for (let f = 0; f < 6; f++) {
            const src = b.mats[f], mat0 = baseMaterial(src);
            const sc = b.uvScale ? b.uvScale(f) : src.map ? [src.map.repeat.x, src.map.repeat.y] : [1, 1];
            if (!buckets.has(mat0)) buckets.set(mat0, { pos: [], nor: [], uv: [] });
            const k = buckets.get(mat0);
            for (let v = f * 6; v < f * 6 + 6; v++) {
                k.pos.push(P[v * 3] * b.sx + b.x, P[v * 3 + 1] * b.sy + b.y, P[v * 3 + 2] * b.sz + b.z);
                k.nor.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
                k.uv.push(U[v * 2] * sc[0], U[v * 2 + 1] * sc[1]);
            }
        }
    }
    for (const [material, k] of buckets) {
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(k.pos, 3));
        g.setAttribute('normal', new T.Float32BufferAttribute(k.nor, 3));
        g.setAttribute('uv', new T.Float32BufferAttribute(k.uv, 2));
        g.computeBoundingSphere();
        const mesh = new T.Mesh(g, material);
        mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
        scene.add(mesh);
    }
    statics.length = 0;
}
// Solid slab whose top is at `top`, reaching down to `bottom`
function slab(sx, sz, x, z, top, bottom, material) {
    texturedBox(sx, top - bottom, sz, x, (top + bottom) / 2, z, material);
    solids.push(aabb(x, (top + bottom) / 2, z, sx, top - bottom, sz));
}
function wall(sx, sy, sz, x, y, z) { solids.push(aabb(x, y, z, sx, sy, sz)); }
const shade = (c, k) => new T.Color(c).multiplyScalar(k).getHex();
const lighten = (c, k) => new T.Color(c).lerp(new T.Color(0xffffff), k).getHex();

// Leafy round-ish tree on a sidewalk planter
function tree(x, y, z, s, rng) {
    s = s || 1;
    const lc = rng && rng() < 0.4 ? LC.leafDark : LC.leaf;
    deco(2.6 * s, 0.6, 2.6 * s, x, y + 0.3, z, LC.curb);
    deco(0.9 * s, 5 * s, 0.9 * s, x, y + 2.5 * s, z, LC.trunk);
    deco(5.2 * s, 3.4 * s, 5.2 * s, x, y + 6 * s, z, lc);
    deco(4 * s, 2.4 * s, 4 * s, x + 0.3 * s, y + 8.2 * s, z - 0.2 * s, lc === LC.leaf ? LC.leafDark : LC.leaf);
    deco(2.4 * s, 1.4 * s, 2.4 * s, x, y + 9.8 * s, z, lc);
}
// Street lamp leaning over the road with a glowing head (dir = -1 / 1: which way it faces)
function lamp(x, y, z, dir, color) {
    deco(0.6, 14, 0.6, x, y + 7, z, LC.pole);
    deco(4.2, 0.45, 0.5, x + dir * 2, y + 14, z, LC.pole);
    glow(2, 0.45, 1.2, x + dir * 3.8, y + 13.65, z, color);
}
function cloud(x, y, z, s, rng) {
    deco(14 * s, 3.4 * s, 8 * s, x, y, z, 0xffffff);
    deco(8 * s, 3.4 * s, 6 * s, x - 3.5 * s, y + 2.3 * s, z + rng() * 2, 0xffffff);
    deco(7 * s, 3 * s, 6 * s, x + 4 * s, y + 1.8 * s, z - rng() * 2, 0xf6f2ff);
}
// Parked car on the road shoulder (solid)
function car(x, y, z, color) {
    deco(5.4, 2.2, 11, x, y + 1.6, z, color);
    deco(4.8, 1.9, 6, x, y + 3.6, z - 0.4, lighten(color, 0.15));
    deco(4.9, 1.5, 5.6, x, y + 3.6, z - 0.4, 0x9fd4ff);
    deco(5.0, 0.35, 6.2, x, y + 4.65, z - 0.4, color);
    for (const [ox, oz] of [[2.6, 3.5], [-2.6, 3.5], [2.6, -3.5], [-2.6, -3.5]]) deco(0.8, 2, 2, x + ox, y + 1, z + oz, 0x18181c);
    glow(4.4, 0.5, 0.2, x, y + 2.1, z + 5.55, 0xfff2c8);
    glow(4.4, 0.45, 0.2, x, y + 2.1, z - 5.55, 0xff2a3c);
    wall(5.4, 5, 11, x, y + 2.5, z);
}
// Red octagonal STOP sign on a pole, facing -z (toward riders coming up the road)
function stopSign(x, y, z) {
    deco(0.35, 9, 0.35, x, y + 4.5, z, 0xb8b8c8);
    const sign = new T.Mesh(new T.CylinderGeometry(1.8, 1.8, 0.25, 8), mat(0xe0202e));
    sign.rotation.x = Math.PI / 2; sign.rotation.y = Math.PI / 8; sign.position.set(x, y + 9.6, z - 0.2);
    scene.add(sign);
    textPlane([{ t: 'STOP', c: '#ffffff', px: 120 }], 2.6, 256, new V3(x, y + 9.6, z - 0.4), new V3(x, y + 9.6, z - 10));
}

// A city building: textured facade box (yellow-window or glass-band style), darker cornice,
// rooftop props and sometimes a neon sign. cx/cz = centre, w along x, d along z.
function building(cx, cz, w, d, h, y0, color, rng, neon) {
    const style = rng() < 0.55 ? 0 : 1;
    const fac = facadeMaterial(color, style, 1, 1);
    const roof = mat(shade(color, 0.7));
    // One window bay per ~8 studs across each face, one floor per ~10 studs up
    texturedBox(w, h, d, cx, y0 + h / 2, cz, [fac, fac, roof, roof, fac, fac], (f) => (f < 2 ? [Math.max(1, Math.round(d / 8)), Math.max(1, Math.round(h / 10))] : f > 3 ? [Math.max(1, Math.round(w / 8)), Math.max(1, Math.round(h / 10))] : [1, 1]));
    deco(w + 1.4, 1.6, d + 1.4, cx, y0 + h + 0.8, cz, shade(color, 0.72));
    deco(w + 0.6, 6.5, d + 0.6, cx, y0 + 3.25, cz, shade(color, 0.55));
    if (rng() < 0.45) deco(4, 2.6, 3.6, cx + (rng() - 0.5) * w * 0.5, y0 + h + 2.9, cz + (rng() - 0.5) * d * 0.4, 0xc8cad8);
    if (rng() < 0.25) deco(1.2, 4, 1.2, cx + w * 0.3, y0 + h + 3.6, cz, 0x9a9aaa);
    if (rng() < 0.18) glow(0.9, 0.9, 0.9, cx + w * 0.3, y0 + h + 6, cz, 0xff2a3c);
    if (neon && rng() < 0.35) glow(Math.min(w, d) * 0.6, 1.2, Math.min(w, d) * 0.6, cx, y0 + 7.2, cz, neon);
}
// Row of buildings along z between z0 and z1, front face at x = xFront (side = -1 left, 1 right)
function buildingRow(rng, side, xFront, z0, z1, y0, palette, neon, hMin, hMax) {
    let z = z0;
    while (z < z1 - 6) {
        const w = Math.min(z1 - z, 18 + rng() * 14);
        const d = 20 + rng() * 10, h = hMin + rng() * (hMax - hMin);
        building(xFront + side * d / 2, z + w / 2, d, w, h, y0, palette[Math.floor(rng() * palette.length)], rng, neon);
        z += w + rng() * 1.2;
    }
}
// Row of buildings along x between x0 and x1, front face at z = zFront (dir = -1 / 1: which way the backs go)
function buildingRowX(rng, dir, zFront, x0, x1, y0, palette, neon, hMin, hMax) {
    let x = x0;
    while (x < x1 - 6) {
        const w = Math.min(x1 - x, 18 + rng() * 14);
        const d = 20 + rng() * 10, h = hMin + rng() * (hMax - hMin);
        building(x + w / 2, zFront + dir * d / 2, w, d, h, y0, palette[Math.floor(rng() * palette.length)], rng, neon);
        x += w + rng() * 1.2;
    }
}

// White ">" arrow painted on the floor, pointing down the road (+z)
function chevron(x, y, z, color) {
    for (const s of [-1, 1]) glow(6, 0.06, 1.4, x + s * 2.1, y, z, color, s * 0.6);
}
// Flat board whose canvas can be redrawn (garage sign, leaderboards)
function canvasPlane(w, h, pxW, pxH, pos, face) {
    const cv = document.createElement('canvas'); cv.width = pxW; cv.height = pxH;
    const tex = texFrom(cv);
    const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
    m.position.copy(pos); m.rotation.y = Math.atan2(face.x, face.z);
    scene.add(m);
    return { cv, tex, m };
}
// Floating title: gradient text with an outline, optional yellow subtitle
function gradientBanner(text, colors, w, pos, face, sub) {
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = sub ? 300 : 200;
    const x = cv.getContext('2d');
    x.font = '700 120px Fredoka, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineJoin = 'round'; x.lineWidth = 16; x.strokeStyle = '#16121f'; x.strokeText(text, 512, 100);
    const g = x.createLinearGradient(0, 40, 0, 160);
    g.addColorStop(0, colors[0]); g.addColorStop(1, colors[1]);
    x.fillStyle = g; x.fillText(text, 512, 100);
    if (sub) {
        x.font = '700 58px Fredoka, sans-serif'; x.lineWidth = 12; x.strokeText(sub, 512, 232);
        x.fillStyle = '#ffd028'; x.fillText(sub, 512, 232);
    }
    const m = new T.Mesh(new T.PlaneGeometry(w, w * cv.height / 1024), new T.MeshBasicMaterial({ map: texFrom(cv), transparent: true, depthWrite: false, side: T.DoubleSide, toneMapped: false }));
    m.position.copy(pos); m.rotation.y = Math.atan2(face.x, face.z);
    scene.add(m);
    return m;
}
// Round pad that opens a purchase when stepped on (+100K SPEED, +500 WINS ...)
function buyPad(x, z, color, lines, kind, key) {
    const pad = new T.Mesh(new T.CylinderGeometry(2.6, 2.6, 0.3, 28), mat(color, { neon: true }));
    pad.position.set(x, 0.15, z); scene.add(pad);
    const rim = new T.Mesh(new T.CylinderGeometry(3, 3, 0.2, 28), mat(0x16121f));
    rim.position.set(x, 0.1, z); scene.add(rim);
    billboard(lines, 7, 512, new V3(x, 4, z));
    const tr = aabb(x, 2, z, 5, 4, 5);
    tr.enter = () => actions.buy(kind, key);
    triggers.push(tr);
}

// =====================================================================================
// Lobby pieces
// =====================================================================================
// LIKE REWARD chest: a gold-trimmed chest with a big thumbs-up, free Speed and Wins once a day
function likeChest(pos) {
    const g = new T.Group(); g.position.copy(pos); g.rotation.y = Math.PI / 2 + 0.3; scene.add(g);
    const part = (sx, sy, sz, x, y, z, c, o) => { const m = new T.Mesh(UNIT, mat(c, o)); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
    part(11, 1, 9, 0, 0.5, 0, 0x3a3456);
    part(8, 5, 6, 0, 3.5, 0, 0x7a2ad8);
    for (const x of [-3.4, 0, 3.4]) part(0.6, 5.1, 6.1, x, 3.5, 0, 0xffc828);
    const lid = part(8.2, 2.4, 6.2, 0, 6.8, -0.4, 0x8a3ae8); lid.rotation.x = -0.25;
    part(1.4, 1.4, 0.4, 0, 4.9, 3.1, 0xffd23a, { neon: true });
    solids.push(aabb(pos.x, 4, pos.z, 10, 8, 10));
    const tr = aabb(pos.x, 3, pos.z, 14, 6, 14);
    tr.enter = () => actions.chest();
    triggers.push(tr);
    gradientBanner('LIKE REWARD', ['#fff6a0', '#ffb51c'], 26, new V3(pos.x, 17, pos.z), new V3(1, 0, 0.6).normalize(), '👍 Like + claim every day!');
}
// Mystery Crate: opens after playing a while and gives a free Turbo Scooter; it shakes when ready
function mysteryCrate(pos) {
    const pad = new T.Mesh(new T.CylinderGeometry(6, 6, 0.4, 6), mat(0x46ec50, { neon: true }));
    pad.position.set(pos.x, 0.2, pos.z); scene.add(pad);
    const crate = new T.Group(); crate.position.set(pos.x, 0.4, pos.z); scene.add(crate);
    const c1 = new T.Mesh(UNIT, mat(0xb07a3a)); c1.scale.set(5, 5, 5); c1.position.y = 2.5; c1.castShadow = true; crate.add(c1);
    for (const y of [0.4, 4.6]) { const b = new T.Mesh(UNIT, mat(0x5a3a1a)); b.scale.set(5.2, 0.6, 5.2); b.position.y = y; crate.add(b); }
    for (const s of [-1, 1]) { const b = new T.Mesh(UNIT, mat(0x5a3a1a)); b.scale.set(0.6, 5.2, 5.2); b.position.set(s * 2.3, 2.5, 0); crate.add(b); }
    const q = textPlane([{ t: '?', c: '#ffd028', s: '#16121f', px: 200 }], 3.6, 256, new V3(), new V3(0, 0, 1));
    scene.remove(q); q.position.set(0, 2.6, 2.62); crate.add(q);
    const bike = buildBike(bikeById.Turbo); bike.position.set(pos.x, 0.4, pos.z); bike.rotation.y = 2.3; bike.visible = false; scene.add(bike);
    tickers.push((dt, t) => {
        const owned = !!S.owned.Turbo;
        crate.visible = !owned; bike.visible = owned;
        if (owned) { animateBike(bike, dt, false); return; }
        const ready = (net.now() - S.joinedAt) / 60000 >= EGG_MINUTES;
        crate.rotation.z = ready ? Math.sin(t * 12) * 0.08 * (Math.sin(t * 1.3) > 0 ? 1 : 0) : 0;
    });
    signs.egg = billboard(crateLines(), 11, 512, new V3(pos.x, 10.5, pos.z));
    const tr = aabb(pos.x, 3, pos.z, 10, 6, 10);
    tr.enter = () => actions.egg();
    triggers.push(tr);
}
function crateLines() {
    const left = EGG_MINUTES * 60 - (net.now() - S.joinedAt) / 1000;
    const status = S.owned.Turbo ? { t: 'OWNED', c: '#6fe0ff' } : left > 0 ? { t: 'Opens In: ' + clock(left), c: '#7dff6b' } : { t: 'OPEN!', c: '#7dff6b' };
    return [{ t: 'Mystery Crate +' + bikeById.Turbo.bonus + '/Speed', c: '#6fe0ff', s: '#16121f', px: 60 }, { ...status, s: '#16121f', px: 56 }];
}
// "Keep playing for ... Free SPEED BOOST" garage
function boostGarage(pos) {
    const col = 0x6a6a88;
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) box(1.2, 9, 1.2, pos.x + sx * 3, 4.5, pos.z + sz * 5, col, { decor: true });
    box(7, 8, 0.6, pos.x, 4.5, pos.z + 5.2, 0xd8d4ec);
    box(0.6, 8, 10, pos.x - 3.4, 4.5, pos.z, 0xd8d4ec);
    box(9, 0.8, 13, pos.x, 9.4, pos.z, 0xff4ad8, { decor: true, neon: true });
    signs.hut = canvasPlane(5.6, 4, 256, 184, new V3(pos.x - 3.05, 5, pos.z), new V3(1, 0, 0));
    drawHut();
    const tr = aabb(pos.x, 3, pos.z, 7, 6, 9);
    tr.enter = () => actions.freeBoost();
    triggers.push(tr);
}
function hutText() {
    const left = FREE_BOOST_MINUTES * 60 - (net.now() - S.joinedAt) / 1000;
    if (S.freeBoost) return 'Enjoy your boost!';
    return left > 0 ? Math.floor(left / 60) + ' min ' + Math.floor(left % 60) + ' sec' : 'Step in to claim!';
}
function drawHut() {
    const h = signs.hut, x = h.cv.getContext('2d');
    x.fillStyle = '#1e1a3a'; x.fillRect(0, 0, 256, 184);
    x.strokeStyle = '#ff4ad8'; x.lineWidth = 8; x.strokeRect(4, 4, 248, 176);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#ffffff'; x.font = '700 26px Fredoka, sans-serif'; x.fillText('Keep playing for:', 128, 44);
    x.font = '700 30px Fredoka, sans-serif'; x.fillText(hutText(), 128, 92);
    x.fillStyle = '#7dff6b'; x.font = '700 26px Fredoka, sans-serif'; x.fillText('Free SPEED BOOST', 128, 142);
    h.tex.needsUpdate = true;
    h.last = hutText();
}
// Timers on the crate and garage signs; cheap to call often, redraws only when the text changes
export function updateLobbySigns() {
    if (signs.hut && hutText() !== signs.hut.last) drawHut();
    if (signs.egg) {
        const lines = crateLines(), key = lines.map((l) => l.t).join('|');
        if (key !== signs.egg.key) { signs.egg.key = key; signs.egg.userData.set(lines); }
    }
}

// TOP WINS / TOP SPEED: dark screen in a neon frame with a big icon on top
function leaderboard(pos, title, icon, face) {
    const g = new T.Group(); g.position.copy(pos); g.rotation.y = Math.atan2(face.x, face.z); scene.add(g);
    const part = (sx, sy, sz, x, y, z, c, o) => { const m = new T.Mesh(UNIT, mat(c, o)); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = !(o && o.neon); g.add(m); return m; };
    part(17, 2, 4, 0, 1, 0, LC.plazaDark);
    part(16, 24, 1.6, 0, 14, 0, 0x22223a);
    for (const sx of [-1, 1]) part(1.2, 26, 2, sx * 8.4, 14, 0, LC.cyan, { neon: true });
    part(18, 1.2, 2, 0, 27, 0, LC.cyan, { neon: true }); part(18, 1.2, 2, 0, 1.6, 0, LC.cyan, { neon: true });
    solids.push(aabb(pos.x, 14, pos.z, 12, 28, 12));
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 720;
    const tex = texFrom(cv);
    const scr = new T.Mesh(new T.PlaneGeometry(15, 21), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
    scr.position.set(0, 14.5, 0.85); g.add(scr);
    const head = textPlane([{ t: icon + ' ' + title, c: '#ffd028', s: '#16121f', px: 96 }], 18, 1024, new V3(), new V3(0, 0, 1));
    scene.remove(head); head.position.set(0, 30.5, 0.3); g.add(head);
    return { cv, tex };
}
function drawBoard(b, rows, kind) {
    const x = b.cv.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 720);
    g.addColorStop(0, '#3a2a8a'); g.addColorStop(1, '#1a1446');
    x.fillStyle = g; x.fillRect(0, 0, 512, 720);
    x.font = '700 34px Fredoka, sans-serif'; x.textBaseline = 'middle';
    if (!rows.length) { x.textAlign = 'center'; x.fillStyle = '#ffffff'; x.fillText('Be the first!', 256, 360); }
    rows.forEach((r, i) => {
        const y = 40 + i * 68;
        if (i % 2 === 0) { x.fillStyle = 'rgba(255,255,255,0.06)'; x.fillRect(0, y - 34, 512, 68); }
        x.textAlign = 'left'; x.fillStyle = r.you ? '#7dff6b' : i < 3 ? ['#ffd028', '#e0e6f0', '#e8a060'][i] : '#ffffff';
        x.fillText('#' + (r.rank || i + 1), 14, y);
        x.fillText(r.n.slice(0, 13), 84, y);
        x.textAlign = 'right'; x.fillStyle = '#7dff6b';
        x.fillText(kind === 'speed' ? sci(r.v) : fmt(r.v), 500, y);
    });
    b.tex.needsUpdate = true;
}
// msg = { speed: [{n, v}], wins: [...] } from the server, top 10 each
export function renderBoards(msg) {
    if (!boards.speed || !msg) return;
    for (const kind of ['speed', 'wins']) {
        const rows = (msg[kind] || []).map((r, i) => ({ n: r.n, v: r.v, rank: i + 1, you: r.n === S.name }));
        drawBoard(boards[kind], rows, kind);
    }
}

// ----- MOTORCYCLES showroom: a glowing pad you ride onto, the bike turning slowly on it -----
// Reference style: "+5/Speed" over "15 Wins Required"
function pedestalLines(d) {
    let sub;
    if (S.equipped === d.id) sub = { t: 'EQUIPPED', c: '#6fe0ff' };
    else if (S.owned[d.id]) sub = { t: 'OWNED · Ride onto the pad', c: '#7dff6b' };
    else if (d.pass) sub = { t: d.tagline + ' ' + buxText(PASSES[d.pass].price), c: '#ffd028' };
    else sub = { t: fmt(d.req) + ' Wins Required', c: S.wins >= d.req ? '#7dff6b' : '#ffffff' };
    return [{ t: '+' + fmt(d.bonus) + '/Speed', c: '#ffffff', s: '#16121f', px: 72 }, { ...sub, s: '#16121f', px: 48 }, { t: d.name, c: '#c8b4ff', s: '#16121f', px: 40 }];
}
function buildPedestal(d, pos, face) {
    const glowC = d.glow || d.accent;
    box(8, 0.4, 8, pos.x, pos.y + 0.2, pos.z, glowC, { neon: true, decor: true });
    box(8.8, 0.25, 8.8, pos.x, pos.y + 0.12, pos.z, 0x16121f, { decor: true });
    const bike = buildBike(d);
    bike.position.set(pos.x, pos.y + 0.4, pos.z);
    bike.rotation.y = face;
    scene.add(bike);
    mergeChildren(bike.userData.inner);
    const at = new V3(pos.x, pos.y + 1, pos.z);
    tickers.push((dt) => {
        if (camera.position.distanceToSquared(at) > 150 * 150) return;
        bike.rotation.y += dt * 0.5;
        animateBike(bike, dt, false);
    });
    const sp = billboard(pedestalLines(d), 12, 512, new V3(pos.x, pos.y + 9.5 * (d.size || 1), pos.z));
    shopItems.push({ d, sp, sig: '' });
    const tr = aabb(pos.x, pos.y + 2, pos.z, 8, 4, 8);
    tr.enter = () => actions.shop(d);
    triggers.push(tr);
}

export function treadLocked(def) {
    if (def.pass) return !S.passes[def.pass];
    if (def.req) return S.wins < def.req;
    return false;
}
// Treadmill looks: 3x yellow, 9x icy cyan, 25x magenta, 100x hot red
const TREAD_LOOK = {
    100: { frame: 0xff2a50, belt: 0x4a1020, label: '#ff6a80', glow: 0xff3c5a },
    25: { frame: 0xc428ff, belt: 0x3a1a4a, label: '#ff6ef0', glow: 0xff3ce0 },
    9: { frame: 0x28d8ff, belt: 0x1a4a5a, label: '#6fe0ff', glow: 0x6ff6ff },
    3: { frame: 0xffc414, belt: 0x5a4210, label: '#ffd028', glow: 0xffd028 },
};
function treadLines(def) {
    const lines = [{ t: def.mult + 'x Steps', c: TREAD_LOOK[def.mult].label, s: '#16121f', px: 76 }];
    if (def.tag) lines.push({ t: def.tag, c: '#ffffff', s: '#16121f', px: 40 });
    if (treadLocked(def)) lines.push({ t: def.pass ? '🔒 ' + buxText(PASSES[def.pass].price) : '🔒 ' + fmt(def.req) + ' Wins', c: '#ffd028', s: '#16121f', px: 48 });
    return lines;
}
export function refreshShop() {
    for (const it of shopItems) {
        const sig = S.equipped + (S.owned[it.d.id] ? 1 : 0) + (it.d.pass ? PASSES[it.d.pass].price : '') + (S.wins >= it.d.req ? 'w' : '');
        if (sig !== it.sig) { it.sig = sig; it.sp.userData.set(pedestalLines(it.d)); }
    }
    for (const t of treadItems) {
        const sig = (treadLocked(t.def) ? 'l' : 'u') + (t.def.pass ? PASSES[t.def.pass].price : '');
        if (sig !== t.sig) { t.sig = sig; t.sp.userData.set(treadLines(t.def)); }
    }
}
// Treadmill: glowing running strip with a gem spinning above it; the belt pushes toward the road
// (+x) so you can ride in place
const GEM = new T.OctahedronGeometry(1.4, 0);
function buildTreadmill(def, cx, top, cz) {
    const L = TREAD_GEO.len, W = TREAD_GEO.width, look = TREAD_LOOK[def.mult];
    const beltMat = new T.MeshBasicMaterial({ map: beltTex, color: look.glow });
    beltMat.color.multiplyScalar(0.95);
    const belt = new T.Mesh(UNIT, beltMat);
    belt.scale.set(L, 0.6, W); belt.position.set(cx, top + 0.3, cz); scene.add(belt);
    const c = aabb(cx, top + 0.3, cz, L, 0.6, W); c.belt = new V3(12, 0, 0); c.tread = def; solids.push(c);
    for (const s of [-1, 1]) box(L + 1, 0.9, 0.6, cx, top + 0.45, cz + s * (W / 2 + 0.3), look.frame, { neon: true });
    for (const s of [-1, 1]) box(0.6, 0.9, W + 1.2, cx + s * (L / 2 + 0.3), top + 0.45, cz, look.frame, { neon: true });
    // Console at the back with a screen showing the multiplier
    box(1.2, 5, W, cx - L / 2 - 1.2, top + 2.5, cz, 0x2a2a3a, { decor: true });
    const scr = textPlane([{ t: def.mult + 'x', c: look.label, s: '#16121f', px: 160 }], 4, 256, new V3(cx - L / 2 - 0.55, top + 4, cz), new V3(cx + 10, top + 4, cz));
    scr.renderOrder = 2;
    const gem = new T.Mesh(GEM, mat(look.glow, { neon: true }));
    gem.position.set(cx - 3, top + 7, cz); gem.scale.set(1, 1.4, 1); scene.add(gem);
    const ph = Math.random() * 6;
    tickers.push((dt, t) => { gem.rotation.y += dt * 1.6; gem.position.y = top + 7 + Math.sin(t * 2 + ph) * 0.5; });
    const sp = billboard(treadLines(def), 12, 512, new V3(cx + 2, top + 11, cz));
    treadItems.push({ def, sp, sig: '' });
    const at = new V3(cx, top + 0.7, cz);
    let acc = Math.random();
    tickers.push((dt) => { acc += dt * 14; while (acc > 1) { acc -= 1; emitTread(at, def.mult, L, W); } });
}

// Giant glowing "+1" floating over the plaza, slowly turning
function plusOneSign(pos) {
    const g = new T.Group(); g.position.copy(pos); scene.add(g);
    const gold = mat(0xffc828, { neon: true }), rim = mat(0xff7a14);
    const part = (sx, sy, sz, x, y, rz, m) => { const p = new T.Mesh(UNIT, m); p.scale.set(sx, sy, sz); p.position.set(x, y, 0); p.rotation.z = rz || 0; g.add(p); return p; };
    for (const [m, k, d] of [[rim, 0.5, 1.6], [gold, 0, 2.2]]) {
        part(9 + k, 2.6 + k, d, -5, 0, 0, m); part(2.6 + k, 9 + k, d, -5, 0, 0, m);
        part(2.8 + k, 13 + k, d, 4.5, 0, 0, m); part(4 + k, 2.4 + k, d, 2.6, 4.6, 0.6, m); part(7 + k, 1.6 + k, d, 4.5, -6.1, 0, m);
    }
    tickers.push((dt, t) => { g.rotation.y = t * 0.6; g.position.y = pos.y + Math.sin(t * 1.4) * 1.2; });
}

// =====================================================================================
// Lobby: a lavender city plaza. Facing the road (north, +z): the MOTORCYCLES showroom on the
// left (+x), TREADMILLS, leaderboards and freebies on the right (-x), city blocks all round and
// the asphalt road running out through the STAGE 1 gate.
// =====================================================================================
function buildLobby() {
    const rng = rngFrom(7);
    const pal = STAGES[0].theme.palette;
    // Polished tiled plaza floor, the road down the middle with dashes and glowing edges
    slab(HX * 2, HZ * 2, 0, 0, 0, -2, tileMaterial(LC.plaza, HX / 4, HZ / 4));
    texturedBox(22, 0.1, HZ + 64, 0, 0.05, (HZ - 64) / 2, asphaltMaterial(LC.road, 4, 24));
    for (let z = -58; z < HZ; z += 12) deco(0.7, 0.06, 6, 0, 0.12, z, LC.line);
    for (const sx of [-1, 1]) glow(0.5, 0.08, HZ + 64, sx * 11.2, 0.12, (HZ - 64) / 2, LC.cyan);

    // City blocks round the plaza with a gap for the road; invisible walls keep everyone in
    const half = EDGE;
    wall(4, 80, HZ * 2 + 8, HX + 2, 40, 0);
    wall(4, 80, HZ * 2 + 8, -HX - 2, 40, 0);
    wall(HX * 2 + 8, 80, 4, 0, 40, -HZ - 2);
    for (const sx of [-1, 1]) wall(HX - half + 2, 80, 4, sx * (half + (HX - half + 2) / 2), 40, HZ + 2);
    buildingRow(rng, 1, HX + 4, -HZ - 30, HZ + 30, 0, pal, LC.cyan, 40, 95);
    buildingRow(rng, -1, -HX - 4, -HZ - 30, HZ + 30, 0, pal, LC.cyan, 40, 95);
    buildingRowX(rng, -1, -HZ - 4, -HX - 4, HX + 4, 0, pal, LC.cyan, 45, 110);
    // North corners only beyond the first stage's own buildings (which start at the road gap)
    for (const sx of [-1, 1]) buildingRowX(rng, 1, HZ + 4, sx > 0 ? 68 : -HX - 4, sx > 0 ? HX + 4 : -68, 0, pal, LC.cyan, 40, 80);
    for (let i = 0; i < 18; i++) cloud((rng() * 2 - 1) * 240, 90 + rng() * 60, (rng() * 2 - 1) * 260 + 300, 1 + rng() * 1.6, rng);

    // Spawn: neon ring pad on the road
    box(14, 0.3, 14, SPAWN.x, 0.15, SPAWN.z, 0x16121f, { decor: true });
    box(13, 0.36, 13, SPAWN.x, 0.18, SPAWN.z, LC.cyan, { neon: true, decor: true });
    box(11, 0.42, 11, SPAWN.x, 0.21, SPAWN.z, 0x2a2a44, { decor: true });
    plusOneSign(new V3(0, 30, 10));

    // Trees and lamps along the plaza road
    for (let z = -56, k = 0; z < HZ - 6; z += 18, k++) for (const sx of [-1, 1]) {
        if ((k + (sx > 0 ? 1 : 0)) % 2 === 0) lamp(sx * 13.5, 0, z, -sx, LC.cyan);
        else tree(sx * 15, 0, z, 0.8, rng);
    }

    // MOTORCYCLES showroom (left, +x): front row on the floor, back row raised on a ledge
    const FX = 30, BX = 52, TOPY = 5;
    slab(30, 122, 70, -4, TOPY, 0, tileMaterial(LC.plazaDark, 8, 30));
    glow(0.4, 0.15, 122, 55.2, TOPY + 0.05, -4, 0xff4ad8);
    // Steps up to the back row at both ends (each under the auto-step height)
    for (const sz of [-60, 52]) for (let i = 0; i < 4; i++) {
        const h = (i + 1) * (TOPY / 4);
        box(3, h, 8, 44.5 + i * 3, h / 2, sz, LC.plazaDark);
    }
    const front = BIKES.filter((d) => d.row === 1), back = BIKES.filter((d) => d.row === 2);
    front.forEach((d, i) => buildPedestal(d, new V3(FX, 0, -48 + i * 15), -Math.PI / 2 - 0.4));
    back.forEach((d, i) => buildPedestal(d, new V3(BX + 9, TOPY, -52 + i * 14.5), -Math.PI / 2 - 0.4));
    gradientBanner('MOTORCYCLES!', ['#ffffff', '#ffe36b'], 42, new V3(58, 36, 0), new V3(-1, 0, 0), 'Ride onto a pad • Wins unlock faster bikes!');

    // TREADMILLS (right, -x) on a low ledge
    const bc = document.createElement('canvas'); bc.width = 64; bc.height = 64;
    const bx = bc.getContext('2d');
    bx.fillStyle = '#ffffff'; bx.fillRect(0, 0, 64, 64);
    bx.fillStyle = '#b8b8c4'; for (let i = 0; i < 4; i++) bx.fillRect(i * 16, 0, 6, 64);
    beltTex = texFrom(bc); beltTex.wrapS = beltTex.wrapT = T.RepeatWrapping; beltTex.repeat.set(4, 1);
    const top = TREAD_GEO.top, tz0 = TREAD_GEO.z0 - 9, tz1 = TREAD_GEO.z0 + (TREADMILLS.length - 1) * TREAD_GEO.step + 9;
    slab(26, tz1 - tz0, TREAD_GEO.cx - 2, (tz0 + tz1) / 2, top, 0, tileMaterial(LC.plazaDark, 6, 18));
    TREADMILLS.forEach((def, i) => buildTreadmill(def, TREAD_GEO.cx, top, TREAD_GEO.z0 + i * TREAD_GEO.step));
    gradientBanner('TREADMILLS', ['#ffffff', '#9ff0ff'], 38, new V3(TREAD_GEO.cx - 16, 28, (tz0 + tz1) / 2), new V3(1, 0, 0), 'Increase your speed automatically!');

    // Back right: leaderboards; front right: speed pads; south: garage, like chest and crate
    boards.wins = leaderboard(new V3(-40, 0, 50), 'TOP WINS', '🏆', new V3(0.6, 0, -1).normalize());
    boards.speed = leaderboard(new V3(-64, 0, 44), 'TOP SPEED', '👟', new V3(1, 0, -0.5).normalize());
    buyPad(-24, 26, 0xffb51c, [{ t: '+100K SPEED', c: '#ffffff', s: '#16121f', px: 60 }], 'product', 'Speed100K');
    buyPad(-24, 34, 0xffb51c, [{ t: '+1M SPEED', c: '#ffffff', s: '#16121f', px: 60 }], 'product', 'Speed1M');
    buyPad(-24, 42, 0xc428ff, [{ t: '+10M SPEED', c: '#ff8af0', s: '#16121f', px: 60 }], 'product', 'Speed10M');
    buyPad(22, 60, 0xffd028, [{ t: '+500 WINS', c: '#ffd028', s: '#16121f', px: 60 }], 'product', 'Wins500');
    buyPad(30, 64, 0xffd028, [{ t: '+5K WINS', c: '#ffd028', s: '#16121f', px: 60 }], 'product', 'Wins5K');
    boostGarage(new V3(-72, 0, -60));
    likeChest(new V3(-48, 0, -60));
    mysteryCrate(new V3(-24, 0, -58));
    signBoard(new V3(20, 9, 66), new V3(0, 0, -1), 16, 9, [{ t: 'NEXT UPDATE!', c: '#ff3c50', s: '#ffffff', px: 110 }, { t: '6 Stages + Police Chase!', c: '#1a1f5c', px: 76 }, { t: '+ Spikes & Floating Blocks!', c: '#8a1cff', px: 70 }], 0xfff4dc);
}

// =====================================================================================
// Race road, built after the reference video's four stages (see STAGES in shared/config.js):
// a city street climbing a purple deck, a red-brick bridge with a raised causeway, a street of
// stone tunnels and STOP signs, and an open highway with police cars. Every stage starts at a
// floating "Stage N" title with a pink see-through wall and ends with the two Wins pads.
// =====================================================================================
const STEP_RISE = 0.8;
const ROAD_BOTTOM = 8;
function roadSection(s, z0, z1, top, theme) {
    const W = s.w, len = z1 - z0, zc = (z0 + z1) / 2, bottom = top - ROAD_BOTTOM;
    slab(W, len, 0, zc, top, bottom, asphaltMaterial(LC.road, W / 8, len / 8));
    for (const sx of [-1, 1]) {
        slab(SW, len, sx * (W / 2 + SW / 2), zc, top + 0.5, bottom, tileMaterial(LC.walk, SW / 4, len / 4));
        glow(0.5, 0.3, len, sx * (W / 2 + 0.25), top + 0.35, zc, theme.neon);
        deco(0.6, 0.06, len, sx * (W / 2 - 2), top + 0.04, zc, LC.edge);
    }
}
// White centre dashes along a stretch of road
function dashes(z0, z1, y) {
    for (let z = z0 + 6; z < z1 - 4; z += 16) deco(0.8, 0.06, 7, 0, y + 0.04, z, LC.line);
}
// Full-width studded slab (the purple deck, the brick ground) whose top is at `top`
function groundSection(z0, z1, top, material) {
    slab(EDGE * 2, z1 - z0, 0, (z0 + z1) / 2, top, top - ROAD_BOTTOM, material);
}
// Flight of steps along +z: n steps of `depth`, each STEP_RISE higher (or lower when dir = -1)
function stairs(z0, n, depth, fromY, dir, width, material, edge) {
    for (let k = 1; k <= n; k++) {
        const top = fromY + dir * STEP_RISE * k;
        slab(width, depth, 0, z0 + (k - 0.5) * depth, top, top - ROAD_BOTTOM, material);
        if (edge) for (const sx of [-1, 1]) glow(0.4, 0.25, depth, sx * (width / 2 - 0.2), top + 0.1, z0 + (k - 0.5) * depth, edge);
    }
    return z0 + n * depth;
}
// Concrete road barrier with red / white stripes and reflectors: 2.4 studs tall, too high to
// ride over (the auto-step is 1.7) so it has to be jumped. Remembered on the stage for the chaser.
const BARRIER_H = 2.4;
const barrierMat = new T.MeshLambertMaterial({ color: 0xd8d4e4 });
function barrier(s, x, z, base, width) {
    slab(width, 1.6, x, z, base + BARRIER_H, base, barrierMat);
    const n = Math.max(1, Math.round(width / 2.4));
    for (let k = 0; k < n; k++) deco(width / n - 0.05, 0.55, 1.66, x - width / 2 + (k + 0.5) * width / n, base + BARRIER_H - 0.45, z, k % 2 ? 0xe8182c : 0xffffff);
    glow(width, 0.18, 1.7, x, base + 0.5, z, 0xffb51c);
    (s.barriers = s.barriers || []).push({ x, z, w: width });
}
// A full-width line of barriers (road + both sidewalks)
function barrierLine(s, z, base) { barrier(s, 0, z, base, EDGE * 2); }

// Buildings either side of a stage, a hazy skyline behind them and clouds overhead
function cityBlocks(s, rng, hMin, hMax, setBack) {
    const th = s.theme, x = EDGE + 1 + (setBack || 0);
    buildingRow(rng, 1, x, s.zS, s.zE, s.y0 - 2, th.palette, th.neon, hMin, hMax);
    buildingRow(rng, -1, -x, s.zS, s.zE, s.y0 - 2, th.palette, th.neon, hMin, hMax);
    for (const sx of [-1, 1]) for (let bz = s.zS + 10; bz < s.zE; bz += 34 + rng() * 16) {
        const h = 120 + rng() * 120, w = 26 + rng() * 16;
        deco(w, h, w, sx * (95 + setBack + rng() * 45), s.y0 + h / 2 - 10, bz, new T.Color(th.palette[Math.floor(rng() * th.palette.length)]).lerp(new T.Color(th.haze), 0.45).getHex());
    }
    for (let k = 0; k < 4; k++) cloud((rng() * 2 - 1) * 200, s.y1 + 95 + rng() * 50, s.zS + rng() * s.len, 1 + rng() * 1.6, rng);
    // Pavement out to set-back buildings, so there is no gap to the sky
    if (setBack) for (const sx of [-1, 1]) {
        deco(setBack + 2, 1, s.len, sx * (EDGE + setBack / 2), s.y0 - 0.5, (s.zS + s.zE) / 2, LC.plazaDark);
        for (let tz = s.zS + 20; tz < s.zE - 10; tz += 26) tree(sx * (EDGE + setBack / 2 + 1), s.y0, tz, 1.1, rng);
    }
    // Invisible walls along the building line
    for (const sx of [-1, 1]) wall(2, 160, s.len, sx * (EDGE + 1), s.y0 + 60, (s.zS + s.zE) / 2);
}
// Lamps and trees alternating along the sidewalks between z0 and z1
function streetFurniture(s, rng, z0, z1, y) {
    let n = 0;
    for (let lz = z0 + 10; lz < z1 - 10; lz += 30) {
        n++;
        for (const sx of [-1, 1]) {
            if ((n + (sx > 0 ? 1 : 0)) % 2 === 0) lamp(sx * (s.w / 2 + 1.8), y + 0.5, lz, -sx, s.theme.neon);
            else tree(sx * (s.w / 2 + SW / 2 + 1), y + 0.5, lz, 0.85 + rng() * 0.3, rng);
        }
    }
}

// ----- Stage 1: city street, climbing a purple deck at the end -----
const DECK = 0x5a3cc8;
// Floating blocks over the pit: [z offset from the pit edge, x, top height, depth along z].
// Each hop is at most 4 studs across and 1.4 up, so the starter bike (14 Speed) can make it.
const FLOATERS = [
    [7.5, 0, 1.0, 7], [18.5, -6, 2.4, 7], [29.5, -10, 3.8, 7], [40.5, -4, 5.0, 10], [52.5, 4, 6.2, 7],
    [63.5, 10, 7.2, 7], [74.5, 4, 6.0, 7], [85.5, -2, 4.5, 7], [96.5, 0, 2.5, 7],
];
const PIT_LEN = 104;
const FLOAT_COLORS = [0xff5a8c, 0xffb627, 0x3dc6ff, 0x8c5cff, 0x4be08a, 0xff7a45];
function buildStreet(i, s, rng) {
    const y0 = s.y0, y1 = s.y1, rampZ = s.zE - 80, steps = Math.round((y1 - y0) / STEP_RISE);
    const pitZ = s.zS + 70, pitEnd = pitZ + PIT_LEN;
    // Street, then the pit with its floating blocks, then street again up to the purple deck
    roadSection(s, s.zS, pitZ, y0, s.theme);
    roadSection(s, pitEnd, rampZ, y0, s.theme);
    dashes(s.zS, pitZ, y0);
    dashes(pitEnd, rampZ, y0);
    // Yellow double centre line out of the lobby, as in the reference
    for (const dx of [-0.6, 0.6]) deco(0.4, 0.06, 40, dx, y0 + 0.05, s.zS + 20, LC.edge);
    buildPit(s, pitZ, pitEnd, y0, rng);
    const deckMat = studWallMaterial(DECK, EDGE / 2, 10);
    const top = stairs(rampZ, steps, 4, y0, 1, EDGE * 2, deckMat, 0x9f8aff);
    groundSection(top, s.zE, y1, deckMat);
    for (const sx of [-1, 1]) glow(0.5, 0.3, s.zE - top, sx * (EDGE - 0.3), y1 + 0.15, (top + s.zE) / 2, 0x9f8aff);
    for (let k = 0; k < 3; k++) chevron(0, y0 + 0.1, rampZ - 20 + k * 6, 0x9fe8ff);
    cityBlocks(s, rng, 40, 110, 0);
    streetFurniture(s, rng, s.zS, pitZ, y0);
    streetFurniture(s, rng, pitEnd, rampZ, y0);
    const cars = [0xf04a5a, 0x4a96ff, 0xffc83c, 0xf0f0fa, 0x46d878];
    car(-(s.w / 2 - 4.5), y0, s.zS + 40, cars[Math.floor(rng() * cars.length)]);
    car(s.w / 2 - 4.5, y0, pitEnd + 24, cars[Math.floor(rng() * cars.length)]);
}
// The pit: the road falls away into a glowing purple abyss (falling in crashes you), with
// studded blocks floating over it that you jump across, climbing and then dropping back down
function buildPit(s, z0, z1, y0, rng) {
    const len = z1 - z0, zc = (z0 + z1) / 2, depth = 26;
    // Glowing floor far below, dark walls down the sides and the two road ends
    glow(EDGE * 2, 0.6, len, 0, y0 - depth, zc, 0x6a2aff);
    for (let k = 0; k < 40; k++) glow(0.5, 0.5, 0.5, (rng() * 2 - 1) * EDGE, y0 - depth + 0.6 + rng() * 3, z0 + rng() * len, 0xff7af0);
    for (const sx of [-1, 1]) deco(2, depth, len, sx * (EDGE + 1), y0 - depth / 2, zc, 0x2a1f5a);
    for (const ez of [z0, z1]) deco(EDGE * 2, depth - ROAD_BOTTOM, 1, 0, y0 - ROAD_BOTTOM - (depth - ROAD_BOTTOM) / 2, ez, 0x2a1f5a);
    const k = aabb(0, y0 - depth + 4, zc, EDGE * 2, 6, len); k.active = true; k.cause = 'pit'; kills.push(k);
    // Respawn at the pit edge after a fall, not back at the stage start
    s.checkpoints.push(z0 - 8);
    // Warning sign at the edge
    textPlane([{ t: '⚠ JUMP! (SPACE)', c: '#ffd028', s: '#16121f', px: 110 }], 18, 1024, new V3(0, y0 + 12, z0 - 2), new V3(0, y0 + 12, z0 - 20));
    FLOATERS.forEach(([dz, x, top, d], n) => {
        const w = 10, z = z0 + dz, color = FLOAT_COLORS[n % FLOAT_COLORS.length];
        slab(w, d, x, z, y0 + top, y0 + top - 2, studWallMaterial(color, w / 4, d / 4));
        glow(w - 1, 0.25, d - 1, x, y0 + top - 2.15, z, color);
        glow(w, 0.12, 0.3, x, y0 + top + 0.02, z - d / 2 + 0.2, 0xffffff);
        chevron(x, y0 + top + 0.05, z, 0xffffff);
        // Little sparkles drifting under each block
        const at = new V3(x, y0 + top - 2.5, z);
        let acc = Math.random();
        tickers.push((dt) => { acc += dt * 2; while (acc > 1) { acc -= 1; emitTread(at, 25, w * 0.8, d * 0.8); } });
    });
}

// ----- Stage 2: red brick ground with a dark raised causeway (stairs + cyan chevrons) -----
function buildBridge(i, s, rng) {
    const y = s.y0, CW = 22;
    const brick = brickMaterial(0xe0643c, EDGE / 3, s.len / 6);
    groundSection(s.zS, s.zE, y, brick);
    const dark = studWallMaterial(0x3a3a4c, CW / 4, 4);
    // Up the stairs, along the causeway, down again before the Wins pads
    let z = stairs(s.zS + 18, 5, 3.2, y, 1, CW, dark, s.theme.neon);
    const high = y + 5 * STEP_RISE, downZ = s.cE - 30;
    slab(CW, downZ - z, 0, (z + downZ) / 2, high, y - ROAD_BOTTOM, dark);
    for (const sx of [-1, 1]) glow(0.4, 0.3, downZ - z, sx * (CW / 2 - 0.2), high + 0.15, (z + downZ) / 2, s.theme.neon);
    for (let cz = z + 8; cz < downZ - 6; cz += 14) chevron(0, high + 0.06, cz, 0x7fe8ff);
    // Barriers to jump, on the causeway and across the brick on both sides (no way round)
    // Spike traps right where you land after each barrier and halfway to the next one, on the
    // causeway and the brick alike, each on its own timing
    const SW2 = EDGE - CW / 2, sideX = CW / 2 + SW2 / 2;
    for (let bz = z + 24, n = 0; bz < downZ - 16; bz += 36, n++) {
        barrier(s, 0, bz, high, CW);
        for (const sx of [-1, 1]) barrier(s, sx * sideX, bz, y, SW2);
        for (const [dz, ph] of [[7, 0], [19, 1.7]]) {
            if (bz + dz > downZ - 6) continue;
            const phase = ph + n * 0.9;
            spikeStrip(0, bz + dz, high, CW, phase);
            for (const sx of [-1, 1]) spikeStrip(sx * sideX, bz + dz, y, SW2, phase + 0.5);
        }
    }
    // Support pillars under the causeway
    for (let pz = z + 10; pz < downZ; pz += 24) for (const sx of [-1, 1]) deco(1.6, 5 * STEP_RISE, 1.6, sx * (CW / 2 - 1), y + 2, pz, 0x24242e);
    for (let k = 1; k <= 5; k++) {
        const top = high - STEP_RISE * k;
        slab(CW, 3.2, 0, downZ + (k - 0.5) * 3.2, top, y - ROAD_BOTTOM, dark);
    }
    cityBlocks(s, rng, 45, 120, 0);
    // Lamps along the brick edges
    for (let lz = s.zS + 20, n = 0; lz < s.zE - 20; lz += 36, n++) lamp((n % 2 ? 1 : -1) * (EDGE - 3), y, lz, n % 2 ? -1 : 1, s.theme.neon);
}

// ----- Stage 3: stone tunnel arches on both sides, STOP signs -----
const ARCH_GEO = new T.CylinderGeometry(1, 1, 1, 28);
function tunnelArch(sx, y, z, rng) {
    const stone = studWallMaterial(0x9a98aa, 4, 4), dark = mat(0x0c0c16);
    const x = sx * (EDGE + 1.5);
    // Stone block set into the building line, with a dark rounded opening facing the road
    texturedBox(5, 26, 30, x, y + 13, z, stone);
    const face = sx * (EDGE - 1.05);
    texturedBox(0.3, 10, 16, face, y + 5, z, dark);
    const top = new T.Mesh(ARCH_GEO, dark);
    top.scale.set(8, 0.3, 8); top.rotation.z = Math.PI / 2;
    top.position.set(face, y + 10, z); scene.add(top);
    // Keystones round the arch
    for (let k = 0; k <= 6; k++) {
        const a = Math.PI * k / 6;
        deco(0.6, 1.8, 1.8, sx * (EDGE - 1.3), y + 10 + Math.sin(a) * 9, z + Math.cos(a) * 9, 0x7a788a);
    }
    if (rng() < 0.5) glow(0.3, 0.8, 12, sx * (EDGE - 1.3), y + 21, z, 0xffa028);
}
function buildTunnels(i, s, rng) {
    const y = s.y0;
    roadSection(s, s.zS, s.zE, y, s.theme);
    dashes(s.zS, s.cE, y);
    cityBlocks(s, rng, 50, 120, 0);
    const colors = [0xf04a5a, 0x4a96ff, 0xffc83c, 0x46d878, 0xff8ad8];
    for (let tz = s.zS + 45, k = 0; tz < s.cE - 30; tz += 42, k++) {
        const sx = k % 2 ? 1 : -1;
        // A tunnel on each side: a big car bursts out of one, across the road and into the other.
        // The amber light over its exit flashes first.
        tunnelArch(1, y + 0.5, tz, rng);
        tunnelArch(-1, y + 0.5, tz, rng);
        crossing(sx, tz, y, TRAFFIC.crossPeriod + (k % 3) * 0.9, k * 1.7, () => buildCar(colors[k % colors.length]), 11, 5.4, 5, false, 2);
    }
    for (let sz = s.zS + 30, k = 0; sz < s.cE - 10; sz += 50, k++) stopSign((k % 2 ? 1 : -1) * (s.w / 2 + 3), y + 0.5, sz);
}

// ----- Stage 4: open highway in a purple haze, police cars coming at you -----
function buildHighway(i, s, rng) {
    const y = s.y0;
    roadSection(s, s.zS, s.zE, y, s.theme);
    dashes(s.zS, s.cE, y);
    for (const lx of [-11, 11]) for (let z = s.zS + 8; z < s.cE - 4; z += 16) deco(0.5, 0.06, 6, lx, y + 0.04, z, LC.line);
    cityBlocks(s, rng, 30, 70, 20);
    streetFurniture(s, rng, s.zS, s.zE, y);
}

// ----- Stage 5: the open police square. Chased in from the street, cut off from the exit -----
function buildChase(i, s, rng) {
    const y = s.y0, th = s.theme, A = s.arena, a0 = s.zS + A.from, a1 = s.zS + A.to, AX = A.half;
    // Street in, the open police square, street out to the Wins pads
    roadSection(s, s.zS, a0, y, th);
    roadSection(s, a1, s.zE, y, th);
    dashes(s.zS, a0, y);
    dashes(a1, s.cE, y);
    streetFurniture(s, rng, a1, s.zE, y);
    const len = a1 - a0, mid = (a0 + a1) / 2;
    slab(AX * 2, len, 0, mid, y, y - ROAD_BOTTOM, tileMaterial(0x9aa4e0, AX / 4, len / 4));
    // Painted markings: a big ring in the middle, lane stripes and arrows pointing at the exit
    for (let k = 0; k < 36; k++) {
        const ang = k / 36 * Math.PI * 2;
        glow(5.5, 0.06, 0.6, Math.cos(ang) * 40, y + 0.05, mid + Math.sin(ang) * 40, 0x3a7aff, -ang + Math.PI / 2);
    }
    for (let z = a0 + 20; z < a1 - 10; z += 40) for (const x of [-80, -40, 40, 80]) deco(0.6, 0.06, 18, x, y + 0.04, z, LC.line);
    for (let z = a0 + 30; z < a1 - 20; z += 30) chevron(0, y + 0.08, z, 0x7dff6b);
    // Low barriers scattered across the square (jump them; the police hop them too)
    for (let k = 0; k < 14; k++) {
        const bx = (rng() * 2 - 1) * (AX - 25), bz = a0 + 40 + rng() * (len - 80);
        if (Math.abs(bx) < 12 && Math.abs(bz - mid) < 50) continue;
        barrier(s, bx, bz, y, 12 + rng() * 14);
    }
    // Parked police cars and spotlight towers round the edge
    for (let k = 0; k < 10; k++) {
        const sx = k % 2 ? 1 : -1, pz = a0 + 25 + k * (len - 50) / 9;
        const car2 = buildPolice();
        car2.position.set(sx * (AX - 8), y + 0.2, pz); car2.rotation.y = sx * 0.6;
        wall(6, 5, 11, car2.position.x, y + 2.5, pz);
    }
    for (const [tx, tz] of [[-AX + 6, a0 + 6], [AX - 6, a0 + 6], [-AX + 6, a1 - 6], [AX - 6, a1 - 6]]) {
        deco(1.2, 26, 1.2, tx, y + 13, tz, LC.pole);
        glow(4, 2, 4, tx, y + 26, tz, 0xf4f8ff);
    }
    // The EXIT gate on the far side, glowing green
    for (const sx of [-1, 1]) glow(2, 26, 2, sx * (EDGE - 1), y + 13, a1, 0x46ec50);
    glow(EDGE * 2, 2, 2, 0, y + 26, a1, 0x46ec50);
    textPlane([{ t: 'EXIT ➜', c: '#7dff6b', s: '#16121f', px: 160 }], 26, 1024, new V3(0, y + 32, a1 - 1.2), new V3(0, y + 32, a1 - 20));
    textPlane([{ t: '🚨 POLICE SQUARE 🚨', c: '#ff5a6a', s: '#16121f', px: 120 }], 34, 1024, new V3(0, y + 30, a0 + 1.2), new V3(0, y + 30, a0 + 20));
    // Buildings: along the two streets, round the square, plus a hazy skyline and clouds
    const pal = th.palette, neon = th.neon;
    for (const sx of [-1, 1]) {
        buildingRow(rng, sx, sx * (EDGE + 1), s.zS, a0, y - 2, pal, neon, 45, 110);
        buildingRow(rng, sx, sx * (EDGE + 1), a1, s.zE, y - 2, pal, neon, 45, 110);
        buildingRow(rng, sx, sx * (AX + 1), a0 - 30, a1 + 30, y - 2, pal, neon, 50, 120);
        wall(2, 160, a0 - s.zS, sx * (EDGE + 1), y + 60, (s.zS + a0) / 2);
        wall(2, 160, s.zE - a1, sx * (EDGE + 1), y + 60, (a1 + s.zE) / 2);
        wall(2, 160, len, sx * (AX + 1), y + 60, mid);
        // Walls closing the square either side of the entrance and the exit
        wall(AX - EDGE, 160, 2, sx * (EDGE + (AX - EDGE) / 2), y + 60, a0);
        wall(AX - EDGE, 160, 2, sx * (EDGE + (AX - EDGE) / 2), y + 60, a1);
    }
    const lo = sxs => sxs > 0 ? [EDGE + 34, AX + 2] : [-AX - 2, -EDGE - 34];
    for (const sx of [-1, 1]) {
        const [x0, x1] = lo(sx);
        buildingRowX(rng, -1, a0 - 1, x0, x1, y - 2, pal, neon, 40, 90);
        buildingRowX(rng, 1, a1 + 1, x0, x1, y - 2, pal, neon, 40, 90);
    }
    for (let k = 0; k < 6; k++) cloud((rng() * 2 - 1) * 220, y + 110 + rng() * 50, s.zS + rng() * s.len, 1.2 + rng() * 1.6, rng);
}

// ----- Stage 6: the finale. Neon night street, barriers, trucks crossing, a faster chase -----
function buildFinal(i, s, rng) {
    const y = s.y0;
    roadSection(s, s.zS, s.zE, y, s.theme);
    dashes(s.zS, s.cE, y);
    cityBlocks(s, rng, 60, 140, 0);
    streetFurniture(s, rng, s.zS, s.zE, y);
    for (let bz = s.zS + 60; bz < s.cE - 20; bz += 62) barrierLine(s, bz, y + 0.5);
    // Two truck crossings from side streets, each with a warning light pole
    [[s.zS + 150, 1, 0], [s.zS + 340, -1, 2.3]].forEach(([tz, sx, ph]) => {
        tunnelArch(1, y + 0.5, tz, rng);
        tunnelArch(-1, y + 0.5, tz, rng);
        crossing(sx, tz, y, 5.5, ph, buildTruck, 16.5, 6.6, 9, true);
    });
}

const BUILDERS = { street: buildStreet, bridge: buildBridge, tunnels: buildTunnels, highway: buildHighway, chase: buildChase, final: buildFinal };
// Checkpoints (z) you respawn at after a crash: every stage start, plus a few mid-stage ones
// placed clear of the hazards
const MID_CHECKPOINTS = { tunnels: [276], final: [215] };
function buildStage(i, s) {
    const rng = rngFrom(100 + i * 17);
    s.checkpoints = [s.zS + 8].concat((MID_CHECKPOINTS[s.type] || []).map((d) => s.zS + d));
    BUILDERS[s.type](i, s, rng);
    if (s.arena) s.checkpoints.push(s.zS + s.arena.from + 15);
    s.checkpoints.sort((a, b) => a - b);
    stageSign(i, s);
    landing(i, s, i === STAGES.length - 1);
    const tr = aabb(0, s.y0 + 20, s.zS + 3, s.w, 60, 2);
    tr.enter = () => actions.enterStage(i);
    triggers.push(tr);
}

// "Stage N" in big white letters floating over the road, and from Stage 2 on a pink see-through
// wall across it (you ride straight through; the screen flashes pink inside it)
function stageSign(i, s) {
    const y = s.y0, z = s.zS;
    textPlane([{ t: s.name, c: '#ffffff', s: '#2a3aa8', px: 220 }], 30, 1024, new V3(0, y + 27, z - 0.5), new V3(0, y + 27, z - 20));
    if (i === 0) return;
    const pink = new T.MeshBasicMaterial({ color: 0xff3c8c, transparent: true, opacity: 0.42, depthWrite: false, side: T.DoubleSide });
    const w = new T.Mesh(UNIT, pink);
    w.scale.set(EDGE * 2, 20, 5); w.position.set(0, y + 10, z); scene.add(w);
    for (const dy of [0.2, 20]) glow(EDGE * 2, 0.4, 5.2, 0, y + dy, z, 0xff4ad8);
    textPlane([{ t: s.name, c: '#ffffff', s: '#a8106a', px: 120 }], 12, 512, new V3(0, y + 12, z - 2.7), new V3(0, y + 12, z - 20));
}

// End of a stage, as in the reference: an "X2 Win!" pad on the left (x2 Wins pass) and a
// "+N Wins / Return" pad on the right (both send you back to the lobby), chevrons on to the next
function landing(i, s, finish) {
    const y = s.y1, pz = s.cE + CFG.endZone / 2;
    const portal = (x, color, lines, enter) => {
        const m = new T.Mesh(UNIT, mat(color, { neon: true }));
        m.scale.set(12, 0.4, 8); m.position.set(x, y + 0.2, pz); scene.add(m);
        const rim = new T.Mesh(UNIT, mat(0x16121f)); rim.scale.set(12.8, 0.3, 8.8); rim.position.set(x, y + 0.1, pz); scene.add(rim);
        for (const sx of [-1, 1]) glow(1.2, 12, 1.2, x + sx * 6, y + 6, pz, color);
        glow(13.2, 1.2, 1.2, x, y + 12.4, pz, color);
        const cm = new T.MeshBasicMaterial({ map: forceFieldTexture(1, 1), color, transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false });
        const curtain = new T.Mesh(new T.PlaneGeometry(11, 11.6), cm);
        curtain.position.set(x, y + 6.2, pz); scene.add(curtain);
        billboard(lines, 9, 512, new V3(x, y + 16, pz));
        const tr = aabb(x, y + 2.5, pz, 12, 5, 9);
        tr.enter = enter;
        triggers.push(tr);
    };
    // Facing up the road, +x is on screen-left
    const x2 = () => (S.passes.DoubleWins ? actions.pad(i) : actions.buy('pass', 'DoubleWins'));
    portal(s.w / 2 - 8, 0xffc414, [{ t: 'X2 Win!', c: '#ffd028', s: '#16121f', px: 84 }, { t: '+' + fmt(s.wins * 2) + ' Wins · ' + buxText(PASSES.DoubleWins.price), c: '#ffffff', s: '#16121f', px: 40 }], x2);
    portal(-s.w / 2 + 8, 0xffd23c, [{ t: '+' + fmt(s.wins) + ' Wins', c: '#ffd028', s: '#16121f', px: 84 }, { t: finish ? 'FINISH!' : 'Return', c: '#ffffff', s: '#16121f', px: 50 }], () => actions.pad(i));
    if (!finish) for (let k = 0; k < 4; k++) chevron(0, y + 0.1, s.cE + 6 + k * 7, 0x9fe8ff);
    if (finish) {
        texturedBox(EDGE * 2 + 4, 90, 2, 0, y + 30, s.zE + 1, mat(0x1e1a3a));
        solids.push(aabb(0, y + 30, s.zE + 1, EDGE * 2 + 4, 90, 2));
        textPlane([{ t: 'NEXT UPDATE!', c: '#ffd028', s: '#16121f', px: 150 }, { t: 'More stages coming soon', c: '#ffffff', s: '#16121f', px: 70 }], 34, 1024, new V3(0, y + 24, s.zE - 0.2), new V3(0, y + 24, s.zE - 20));
    }
}

// =====================================================================================
// Traffic: a pink truck crossing the road past the Stage 4 wall, and police cars driving down
// the highway at you. Positions come from the server clock so everyone sees the same traffic;
// each vehicle has a kill box (getting hit crashes you).
// =====================================================================================
const traffic = [];
function vehicleBox(g, sx, sy, sz, cause) {
    const k = { min: new V3(), max: new V3(), active: true, half: new V3(sx / 2, sy / 2, sz / 2), g, cause: cause || 'car' };
    kills.push(k);
    return k;
}
function placeKill(k, x, y, z) {
    k.min.set(x - k.half.x, y, z - k.half.z);
    k.max.set(x + k.half.x, y + k.half.y * 2, z + k.half.z);
}
// Box truck facing +x: cab, pink cargo box, wheels, lights
function buildTruck() {
    const g = new T.Group(), part = (sx, sy, sz, x, y, z, m) => { const p = new T.Mesh(UNIT, m); p.scale.set(sx, sy, sz); p.position.set(x, y, z); p.castShadow = true; g.add(p); return p; };
    part(12, 8, 6.4, -2.5, 5.6, 0, paint(0xff7ab8, { metal: 0.1 }));
    part(5, 5.5, 6, 6.2, 4.2, 0, paint(0xf4f0ff, { metal: 0.2 }));
    part(0.2, 2.4, 5, 8.75, 5.4, 0, glass(0x9fd4ff, 0.7));
    part(16.5, 1, 6.2, 0, 1.6, 0, mat(0x2a2a34));
    for (const x of [-6, -3, 6]) for (const z of [-3.1, 3.1]) {
        const w = new T.Mesh(new T.CylinderGeometry(1.3, 1.3, 0.9, 16), mat(0x18181c));
        w.rotation.x = Math.PI / 2; w.position.set(x, 1.3, z); g.add(w);
    }
    part(0.2, 0.7, 1.2, 8.8, 2.6, 2.2, mat(0xfff2c8, { neon: true }));
    part(0.2, 0.7, 1.2, 8.8, 2.6, -2.2, mat(0xfff2c8, { neon: true }));
    scene.add(g);
    return g;
}
// Spike trap: a steel plate with a hazard border; on the server clock its spikes flash a red
// warning, shoot up (deadly while up) and sink back into the floor
const SPIKE_GEO = new T.ConeGeometry(0.42, 1, 6);
function spikeStrip(x, z, base, width, phase) {
    const depth = 3, cols = Math.max(2, Math.floor(width / 1.3)), rows = 2;
    deco(width, 0.08, depth, x, base + 0.04, z, 0x2a2a34);
    for (const dz of [-1, 1]) glow(width, 0.1, 0.25, x, base + 0.06, z + dz * (depth / 2 - 0.1), 0xffb51c);
    const warn = new T.Mesh(UNIT, mat(0xff2a3c, { neon: true }));
    warn.scale.set(width - 0.6, 0.1, depth - 0.7); warn.position.set(x, base + 0.08, z); warn.visible = false; scene.add(warn);
    const spikes = new T.InstancedMesh(SPIKE_GEO, chrome(0xd8dce8), cols * rows);
    const m4 = new T.Matrix4();
    for (let r = 0; r < rows; r++) for (let c2 = 0; c2 < cols; c2++) {
        m4.compose(new T.Vector3(x - width / 2 + (c2 + 0.5) * width / cols, 0.5, z + (r - 0.5) * 1.3), new T.Quaternion(), new T.Vector3(1, SPIKES.height, 1));
        spikes.setMatrixAt(r * cols + c2, m4);
    }
    spikes.castShadow = true;
    spikes.position.y = base - SPIKES.height - 0.2;
    scene.add(spikes);
    const k = { min: new V3(x - width / 2, base, z - depth / 2), max: new V3(x + width / 2, base + SPIKES.height * 0.8, z + depth / 2), active: false, cause: 'spikes' };
    kills.push(k);
    traffic.push({ update(t) {
        const c = (((t + phase) % SPIKES.period) + SPIKES.period) % SPIKES.period;
        let up;   // 0 = sunk, 1 = fully out
        if (c < SPIKES.warnAt) up = 0;
        else if (c < SPIKES.upAt) up = 0.12;                                            // tips peek out
        else if (c < SPIKES.upAt + 0.12) up = 0.12 + 0.88 * (c - SPIKES.upAt) / 0.12;     // shoot up
        else if (c < SPIKES.downAt) up = 1;
        else up = Math.max(0, 1 - (c - SPIKES.downAt) / 0.3);                             // sink
        warn.visible = c >= SPIKES.warnAt && c < SPIKES.upAt && Math.floor(c * 8) % 2 === 0;
        spikes.position.y = base - SPIKES.height - 0.2 + up * (SPIKES.height + 0.2);
        k.active = up > 0.5;
    } });
}
// Ordinary car facing -z
function buildCar(color) {
    const g = new T.Group(), part = (sx, sy, sz, x, y, z, m) => { const p = new T.Mesh(UNIT, m); p.scale.set(sx, sy, sz); p.position.set(x, y, z); p.castShadow = true; g.add(p); return p; };
    part(5.4, 2, 11, 0, 1.8, 0, paint(color, { metal: 0.3 }));
    part(4.8, 1.8, 6, 0, 3.6, 0.4, glass(0x9fd4ff, 0.8));
    part(4.9, 0.3, 5.8, 0, 4.6, 0.4, paint(color, { metal: 0.3 }));
    for (const x of [-2.6, 2.6]) for (const z of [-3.6, 3.6]) {
        const w = new T.Mesh(new T.CylinderGeometry(1, 1, 0.8, 16), mat(0x18181c));
        w.rotation.z = Math.PI / 2; w.position.set(x, 1, z); g.add(w);
    }
    part(4.2, 0.5, 0.2, 0, 2.2, -5.55, mat(0xfff2c8, { neon: true }));
    part(4.2, 0.45, 0.2, 0, 2.2, 5.55, mat(0xff2a3c, { neon: true }));
    scene.add(g);
    return g;
}
// A vehicle bursting out of a side street at z across the road, from side sx to the other side,
// once every `period` seconds of server time. An amber light over its exit flashes for
// TRAFFIC.crossWarn seconds before it comes. len / wid / h = its kill box (len along its travel).
// faceX: the model faces +x (truck) rather than -z (cars). scale: drawn this many times bigger.
// It drives from deep inside the tunnel on one side to deep inside the one opposite, so it is
// only ever seen coming out of one opening and going into the other.
function crossing(sx, z, y, period, phase, builder, len, wid, h, faceX, scale) {
    scale = scale || 1;
    len *= scale; wid *= scale; h *= scale;
    const v = builder(), k = vehicleBox(v, len, h, wid, faceX ? 'truck' : 'tunnel car');
    v.scale.setScalar(scale);
    k.half.set(len / 2, h / 2, wid / 2);
    const warn = new T.Mesh(UNIT, mat(0xffb51c, { neon: true }));
    warn.scale.set(0.7, 1.4, 7); warn.position.set(sx * (EDGE - 1.5), y + 23.5, z); scene.add(warn);
    const pole = new T.Mesh(UNIT, mat(LC.pole)); pole.scale.set(0.5, 23, 0.5); pole.position.set(sx * (EDGE - 1.5), y + 11.5, z + 9.5); scene.add(pole);
    const reach = EDGE + 6 + len / 2, cross = (reach * 2) / TRAFFIC.crossSpeed;
    v.rotation.y = faceX ? (sx > 0 ? Math.PI : 0) : sx * Math.PI / 2;
    traffic.push({ update(t) {
        const c = (((t + phase) % period) + period) % period;
        warn.visible = c < TRAFFIC.crossWarn && Math.floor(c * 6) % 2 === 0;
        const moving = c >= TRAFFIC.crossWarn && c < TRAFFIC.crossWarn + cross;
        v.visible = moving; k.active = moving;
        if (!moving) return;
        const x = sx * reach * (1 - 2 * (c - TRAFFIC.crossWarn) / cross);
        v.position.set(x, y + 0.2, z);
        placeKill(k, x, y, z);
    } });
}
// Police car facing -z, light bar flashing red / blue
export function buildPolice() {
    const g = new T.Group(), part = (sx, sy, sz, x, y, z, m) => { const p = new T.Mesh(UNIT, m); p.scale.set(sx, sy, sz); p.position.set(x, y, z); p.castShadow = true; g.add(p); return p; };
    part(5.4, 1.8, 11, 0, 1.7, 0, paint(0xf4f4fa, { metal: 0.2 }));
    part(5.45, 0.9, 5, 0, 1.5, 0, paint(0x14141c, { metal: 0.3 }));
    part(4.8, 1.8, 5.6, 0, 3.4, 0.4, glass(0x203048, 0.85));
    part(4.9, 0.3, 5.2, 0, 4.4, 0.4, paint(0xf4f4fa, { metal: 0.2 }));
    const red = part(1.6, 0.5, 0.9, -0.9, 4.8, 0.4, mat(0xff2030, { neon: true }));
    const blue = part(1.6, 0.5, 0.9, 0.9, 4.8, 0.4, mat(0x2050ff, { neon: true }));
    for (const x of [-2.6, 2.6]) for (const z of [-3.6, 3.6]) {
        const w = new T.Mesh(new T.CylinderGeometry(1, 1, 0.8, 16), mat(0x18181c));
        w.rotation.z = Math.PI / 2; w.position.set(x, 1, z); g.add(w);
    }
    part(4.2, 0.5, 0.2, 0, 2.1, -5.55, mat(0xfff2c8, { neon: true }));
    part(4.2, 0.45, 0.2, 0, 2.1, 5.55, mat(0xff2a3c, { neon: true }));
    g.userData.lights = [red, blue];
    scene.add(g);
    tickers.push((dt, t) => {
        const on = Math.floor(t * 4 + g.id) % 2 === 0;
        red.visible = on; blue.visible = !on;
    });
    return g;
}
function buildTraffic() {
    const s4 = STAGES.find((s) => s.type === 'highway');
    if (!s4) return;
    // The truck sweeps across the road just past the Stage 4 wall
    const truck = buildTruck(), tk = vehicleBox(truck, 16.5, 9, 6.6, 'truck');
    traffic.push({ update(t) {
        const ph = (t / TRAFFIC.truckPeriod) % 1;
        const dir = ph < 0.5 ? 1 : -1, k = ph < 0.5 ? ph * 2 : (ph - 0.5) * 2;
        const x = (k - 0.5) * 2 * (EDGE + 14) * dir;
        truck.position.set(x, s4.y0, s4.zS + 18);
        truck.rotation.y = dir > 0 ? 0 : Math.PI;
        placeKill(tk, x, s4.y0, s4.zS + 18);
        tk.half.set(8.25, 4.5, 3.3);
    } });
    // Police cars in three lanes, driving toward the lobby (-z) and looping
    const z0 = s4.zS + 32, z1 = s4.cE - 6, span = z1 - z0;
    [-12, 0, 12].forEach((lx, lane) => {
        const n = Math.max(1, Math.floor(span / (TRAFFIC.policeGap * 2)));
        for (let c = 0; c < n; c++) {
            const car = buildPolice(), k = vehicleBox(car, 5.4, 5, 11, 'traffic');
            const offset = (c / n) * span + lane * span / 5;
            traffic.push({ update(t) {
                const z = z1 - ((t * TRAFFIC.policeSpeed + offset) % span);
                car.position.set(lx, s4.y0 + 0.2, z);
                placeKill(k, lx, s4.y0, z);
            } });
        }
    });
}

// =====================================================================================
// Per-frame world state: traffic, and the haze takes on each stage's colour as you ride into it
// =====================================================================================
const hazeTarget = new T.Color(FOG);
export function updateWorld(dt, z) {
    const t = net.now() / 1000;
    for (const v of traffic) v.update(t);
    let idx = -1;
    for (let k = 0; k < STAGES.length; k++) if (z >= STAGES[k].zS - 20 && z < STAGES[k].zE) idx = k;
    hazeTarget.set(idx >= 0 ? STAGES[idx].theme.haze : FOG);
    scene.fog.color.lerp(hazeTarget, Math.min(1, dt * 1.5));
}
export function buildWorld() {
    buildLobby();
    STAGES.forEach((s, i) => buildStage(i, s));
    buildTraffic();
    flushDecor();
    refreshShop();
}
