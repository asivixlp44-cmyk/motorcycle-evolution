import { T, texFrom } from './engine.js';

// Canvas-generated surface textures: cracked lava, water, bricks, studded walls, cracked stone,
// dotted sandstone and checkerboard.

// Tileable Voronoi lava: bright yellow cell centres, orange body, dark cracks
function lavaCanvas() {
    const N = 256, seeds = [];
    let s = 1337;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 22; i++) seeds.push([rnd() * N, rnd() * N]);
    const c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d');
    const img = x.createImageData(N, N), d = img.data;
    for (let py = 0; py < N; py++) {
        for (let px = 0; px < N; px++) {
            let f1 = 1e9, f2 = 1e9;
            for (const [sx, sy] of seeds) {
                for (let ox = -N; ox <= N; ox += N) for (let oy = -N; oy <= N; oy += N) {
                    const dx = px - sx - ox, dy = py - sy - oy;
                    const dd = dx * dx + dy * dy;
                    if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) f2 = dd;
                }
            }
            const edge = Math.sqrt(f2) - Math.sqrt(f1);   // distance to the crack
            const centre = Math.min(1, Math.sqrt(f1) / 34); // 0 at the cell centre
            const i = (py * N + px) * 4;
            if (edge < 2.2) { d[i] = 150; d[i + 1] = 38; d[i + 2] = 8; }
            else {
                const k = Math.min(1, (edge - 2.2) / 5);
                const hot = (1 - centre) * k;
                d[i] = 255;
                d[i + 1] = Math.round(120 + 110 * hot);
                d[i + 2] = Math.round(10 + 60 * hot * hot);
            }
            d[i + 3] = 255;
        }
    }
    x.putImageData(img, 0, 0);
    return c;
}

function brickCanvas() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#b9b3c9'; x.fillRect(0, 0, 128, 128);
    const rows = 8, h = 128 / rows, w = 32;
    let s = 7;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let r = 0; r < rows; r++) {
        const off = r % 2 ? w / 2 : 0;
        for (let b = -1; b < 128 / w + 1; b++) {
            const v = Math.round(225 + rnd() * 30);
            x.fillStyle = `rgb(${v},${v},${Math.min(255, v + 8)})`;
            x.fillRect(b * w + off + 1.5, r * h + 1.5, w - 3, h - 3);
            x.fillStyle = 'rgba(255,255,255,0.18)';
            x.fillRect(b * w + off + 1.5, r * h + 1.5, w - 3, 2);
        }
    }
    return c;
}

// Tileable cartoon water: cyan base with soft white caustic ridges (the stage lanes in the reference)
function waterCanvas() {
    const N = 256, seeds = [];
    let s = 4242;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 16; i++) seeds.push([rnd() * N, rnd() * N]);
    const c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d');
    const img = x.createImageData(N, N), d = img.data;
    for (let py = 0; py < N; py++) {
        for (let px = 0; px < N; px++) {
            let f1 = 1e9, f2 = 1e9;
            for (const [sx, sy] of seeds) {
                for (let ox = -N; ox <= N; ox += N) for (let oy = -N; oy <= N; oy += N) {
                    const dx = px - sx - ox, dy = py - sy - oy;
                    const dd = dx * dx + dy * dy;
                    if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) f2 = dd;
                }
            }
            const edge = Math.sqrt(f2) - Math.sqrt(f1);
            const i = (py * N + px) * 4;
            // Rounded cyan blobs separated by wide pale bands, like Roblox's water material
            const k = Math.min(1, Math.max(0, (edge - 5) / 7));
            const w = 1 - k * k * (3 - 2 * k);
            d[i] = Math.round(38 + 190 * w);
            d[i + 1] = Math.round(205 + 43 * w);
            d[i + 2] = Math.round(238 + 17 * w);
            d[i + 3] = 255;
        }
    }
    x.putImageData(img, 0, 0);
    return c;
}

const lavaImg = lavaCanvas();
const brickImg = brickCanvas();
const waterImg = waterCanvas();
const waterAnimated = [];
const animated = [];
const cache = new Map();

function repeated(img, key, rx, ry) {
    rx = Math.max(1, Math.round(rx)); ry = Math.max(1, Math.round(ry));
    const id = key + rx + 'x' + ry;
    if (cache.has(id)) return cache.get(id);
    const t = texFrom(img);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(rx, ry);
    cache.set(id, t);
    return t;
}

// Unlit so it reads as glowing, but kept below the bloom threshold
export function lavaMaterial(rx, ry) {
    const id = 'lavaMat' + Math.round(rx) + 'x' + Math.round(ry);
    if (cache.has(id)) return cache.get(id);
    const m = new T.MeshBasicMaterial({ map: repeated(lavaImg, 'lava', rx, ry) });
    animated.push(m.map);
    cache.set(id, m);
    return m;
}
export function brickMaterial(color, rx, ry) {
    const id = 'brickMat' + color + Math.round(rx) + 'x' + Math.round(ry);
    if (cache.has(id)) return cache.get(id);
    const m = new T.MeshLambertMaterial({ color, map: repeated(brickImg, 'brick', rx, ry) });
    cache.set(id, m);
    return m;
}

// Walkable water lane; the caustics drift slowly (updateMaterials)
export function waterMaterial(rx, ry) {
    const id = 'waterMat' + Math.round(rx) + 'x' + Math.round(ry);
    if (cache.has(id)) return cache.get(id);
    const m = new T.MeshLambertMaterial({ map: repeated(waterImg, 'water', rx, ry) });
    waterAnimated.push(m.map);
    cache.set(id, m);
    return m;
}

// Roblox-style wall studs: a small raised square per 2x2 studs, lit from the top-left.
// Drawn white so the material colour tints it.
function studCanvas(cracks) {
    const N = 64, c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, N, N);
    if (cracks) {
        // Pale branching cracks for the Stage 2 stone
        x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 1.6;
        let s = 99;
        const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
        for (let i = 0; i < 5; i++) {
            let px = rnd() * N, py = rnd() * N;
            x.beginPath(); x.moveTo(px, py);
            for (let k = 0; k < 4; k++) { px += (rnd() - 0.5) * 30; py += (rnd() - 0.5) * 30; x.lineTo(px, py); }
            x.stroke();
        }
    }
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        const ox = 8 + i * 32, oy = 8 + j * 32, s = 14;
        x.fillStyle = 'rgba(0,0,0,0.28)'; x.fillRect(ox + 2, oy + 2, s, s);
        x.fillStyle = '#d6d6d6'; x.fillRect(ox, oy, s, s);
        x.fillStyle = '#ffffff'; x.fillRect(ox, oy, s - 3, 2.5); x.fillRect(ox, oy, 2.5, s - 3);
    }
    return c;
}
const studImg = studCanvas(false);
const crackImg = studCanvas(true);

// Studded wall surface (1 texture tile = 4 studs), tinted by colour
export function studWallMaterial(color, rx, ry) {
    const id = 'studMat' + color + Math.round(rx) + 'x' + Math.round(ry);
    if (cache.has(id)) return cache.get(id);
    const m = new T.MeshLambertMaterial({ color, map: repeated(studImg, 'stud', rx, ry) });
    cache.set(id, m);
    return m;
}
// Grey studded stone with pale cracks (Stage 2's falling walls); a fresh material so each can flash
export function crackedStoneMaterial(rx, ry) {
    return new T.MeshLambertMaterial({ color: 0x8e8ca4, map: repeated(crackImg, 'crack', rx, ry) });
}

// Sandstone wall from the reference: tan with rows of small dark dimples
function dottedCanvas() {
    const N = 64, c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, N, N);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const ox = 8 + i * 16 + (j % 2 ? 8 : 0), oy = 8 + j * 16;
        x.fillStyle = 'rgba(70,40,20,0.55)'; x.beginPath(); x.arc(ox % N, oy, 2.6, 0, Math.PI * 2); x.fill();
        x.fillStyle = 'rgba(255,255,255,0.5)'; x.beginPath(); x.arc((ox % N) - 0.8, oy - 1, 1, 0, Math.PI * 2); x.fill();
    }
    x.strokeStyle = 'rgba(0,0,0,0.08)'; x.lineWidth = 2; x.strokeRect(0, 0, N, N);
    return c;
}
// Soft lavender checkerboard (the "sky" panels inside the stage gates and the Stage 2 walls)
function checkerCanvas() {
    const N = 64, c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, N, N);
    x.fillStyle = '#d4d0ec'; x.fillRect(0, 0, 32, 32); x.fillRect(32, 32, 32, 32);
    x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillRect(2, 2, 28, 3); x.fillRect(34, 34, 28, 3);
    return c;
}
const dottedImg = dottedCanvas();
const checkerImg = checkerCanvas();
export function dottedWallMaterial(color, rx, ry) {
    const id = 'dotMat' + color + Math.round(rx) + 'x' + Math.round(ry);
    if (cache.has(id)) return cache.get(id);
    const m = new T.MeshLambertMaterial({ color, map: repeated(dottedImg, 'dot', rx, ry) });
    cache.set(id, m);
    return m;
}
export function checkerMaterial(color, rx, ry) {
    const id = 'chkMat' + color + Math.round(rx) + 'x' + Math.round(ry);
    if (cache.has(id)) return cache.get(id);
    const m = new T.MeshLambertMaterial({ color, map: repeated(checkerImg, 'chk', rx, ry) });
    cache.set(id, m);
    return m;
}

// ----- City surfaces -----
function seeded(seed) { let v = seed; return () => { v = (v * 16807) % 2147483647; return v / 2147483647; }; }
// Asphalt: dark blue-grey with fine speckles and soft patches
function asphaltCanvas() {
    const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d'), rnd = seeded(31);
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, N, N);
    for (let i = 0; i < 26; i++) {
        x.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.05})`;
        x.beginPath(); x.arc(rnd() * N, rnd() * N, 6 + rnd() * 18, 0, Math.PI * 2); x.fill();
    }
    for (let i = 0; i < 900; i++) {
        const v = rnd();
        x.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.35)';
        x.fillRect(rnd() * N, rnd() * N, 1 + rnd(), 1 + rnd());
    }
    return c;
}
// Building facade: one window bay per tile. Painted in the wall colour so windows keep their own
// colours: warm lit windows, blue glass, a ledge and a light frame.
const facadeCache = new Map();
function facadeCanvas(wall, style) {
    const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d');
    const col = new T.Color(wall);
    x.fillStyle = '#' + col.getHexString(); x.fillRect(0, 0, N, N);
    // Faint brick courses
    x.fillStyle = 'rgba(0,0,0,0.06)';
    for (let y = 8; y < N; y += 12) x.fillRect(0, y, N, 2);
    if (style === 1) {
        // Modern: a band of tinted glass across the whole bay
        const g = x.createLinearGradient(0, 30, 0, 98);
        g.addColorStop(0, '#bfe6ff'); g.addColorStop(0.5, '#5a9ce8'); g.addColorStop(1, '#3a6ac8');
        x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, 26, N, 76);
        x.fillStyle = g; x.fillRect(0, 30, N, 68);
        x.fillStyle = 'rgba(255,255,255,0.55)'; x.fillRect(0, 34, N, 4);
        x.fillStyle = 'rgba(255,255,255,0.18)';
        for (let i = 0; i < 4; i++) x.fillRect(i * 32 + 2, 30, 3, 68);
    } else {
        // Classic: a big square window with a frame, lit warm yellow (the reference look)
        x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(28, 22, 76, 84);
        x.fillStyle = '#fff2c0'; x.fillRect(24, 18, 76, 84);
        const g = x.createLinearGradient(0, 24, 0, 98);
        g.addColorStop(0, '#ffe58a'); g.addColorStop(1, '#ffc21c');
        x.fillStyle = g; x.fillRect(30, 24, 64, 72);
        x.fillStyle = 'rgba(255,255,255,0.5)'; x.fillRect(34, 28, 22, 6);
        x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(20, 102, 84, 6);
    }
    return c;
}
export function facadeMaterial(wall, style, rx, ry) {
    rx = Math.max(1, Math.round(rx)); ry = Math.max(1, Math.round(ry));
    const id = 'fac' + wall + '|' + style + '|' + rx + 'x' + ry;
    if (cache.has(id)) return cache.get(id);
    const ck = wall + '|' + style;
    if (!facadeCache.has(ck)) facadeCache.set(ck, facadeCanvas(wall, style));
    const m = new T.MeshLambertMaterial({ map: repeated(facadeCache.get(ck), 'fac' + ck, rx, ry) });
    cache.set(id, m);
    return m;
}
const asphaltImg = asphaltCanvas();
export function asphaltMaterial(color, rx, ry) {
    const id = 'asph' + color + Math.round(rx) + 'x' + Math.round(ry);
    if (cache.has(id)) return cache.get(id);
    const m = new T.MeshLambertMaterial({ color, map: repeated(asphaltImg, 'asph', rx, ry) });
    cache.set(id, m);
    return m;
}
// Hexagon force field for the stage barriers (additive, scrolls slowly)
function hexCanvas() {
    // Flat-top hexes: two columns per tile across (3r), two rows down (4h), so it tiles cleanly
    const r = 40, h = r * Math.sqrt(3) / 2, c = document.createElement('canvas');
    c.width = 3 * r; c.height = Math.round(4 * h);
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(0, 0, c.width, c.height);
    x.strokeStyle = 'rgba(255,255,255,0.95)'; x.lineWidth = 3;
    const hex = (cx, cy) => {
        x.beginPath();
        for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
        x.closePath(); x.stroke();
    };
    for (let col = -1; col <= 2; col++) for (let row = -1; row <= 2; row++) hex(col * r * 1.5, row * h * 2 + (Math.abs(col) % 2 ? h : 0));
    return c;
}
const hexImg = hexCanvas();
export function forceFieldTexture(rx, ry) {
    const t = texFrom(hexImg);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(Math.max(1, Math.round(rx)), Math.max(1, Math.round(ry)));
    animated.push(t);
    return t;
}
// Polished plaza tiles with thin bright seams
function tileCanvas() {
    const N = 64, c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, N, N);
    x.fillStyle = 'rgba(0,0,0,0.07)'; x.fillRect(0, 0, 32, 32); x.fillRect(32, 32, 32, 32);
    x.fillStyle = 'rgba(255,255,255,0.9)'; x.fillRect(0, 0, N, 1.5); x.fillRect(0, 0, 1.5, N);
    return c;
}
const tileImg = tileCanvas();
export function tileMaterial(color, rx, ry) {
    const id = 'tile' + color + Math.round(rx) + 'x' + Math.round(ry);
    if (cache.has(id)) return cache.get(id);
    const m = new T.MeshLambertMaterial({ color, map: repeated(tileImg, 'tile', rx, ry) });
    cache.set(id, m);
    return m;
}

export function updateMaterials(dt) {
    for (const t of animated) { t.offset.y = (t.offset.y + dt * 0.035) % 1; t.offset.x = (t.offset.x + dt * 0.01) % 1; }
    for (const t of waterAnimated) { t.offset.y = (t.offset.y + dt * 0.02) % 1; t.offset.x = (t.offset.x + dt * 0.012) % 1; }
}
