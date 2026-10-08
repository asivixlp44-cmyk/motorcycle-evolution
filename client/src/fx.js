import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { T, V3, $, renderer, scene, camera, sun } from './engine.js';

// ----- quality presets -----
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
export const QUALITIES = {
    low: { label: 'Low', ratio: 0.85, shadows: false, bloom: false },
    medium: { label: 'Medium', ratio: 1, shadows: true, bloom: true },
    high: { label: 'High', ratio: 1.5, shadows: true, bloom: true },
};
let quality = isTouch ? 'medium' : 'high';
try { quality = localStorage.getItem('pme_quality') || quality; } catch (e) { /* default */ }
if (!QUALITIES[quality]) quality = 'high';

// Neon materials are HDR (brighter than 1) so only they cross the bloom threshold;
// neutral tone mapping keeps every other colour close to its authored sRGB value.
renderer.toneMapping = T.NeutralToneMapping;
renderer.toneMappingExposure = 1.2;

let composer = null, bloomPass = null;
function buildComposer() {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new T.Vector2(innerWidth / 2, innerHeight / 2), 0.3, 0.3, 1.2);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
}
function applyQuality() {
    const q = QUALITIES[quality];
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, q.ratio));
    renderer.shadowMap.enabled = q.shadows;
    sun.castShadow = q.shadows;
    scene.traverse((o) => { if (o.material) { const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach((x) => { x.needsUpdate = true; }); } });
    if (q.bloom && !composer) buildComposer();
    resizeFx();
}
export function getQuality() { return quality; }
export function setQuality(q) {
    if (!QUALITIES[q]) return;
    quality = q;
    try { localStorage.setItem('pme_quality', q); } catch (e) { /* ignore */ }
    applyQuality();
}
function resizeFx() {
    if (composer) {
        composer.setPixelRatio(renderer.getPixelRatio());
        composer.setSize(innerWidth, innerHeight);
        bloomPass.resolution.set(innerWidth / 2, innerHeight / 2);
    }
    lines.width = Math.round(innerWidth * Math.min(devicePixelRatio || 1, 1.5));
    lines.height = Math.round(innerHeight * Math.min(devicePixelRatio || 1, 1.5));
}
addEventListener('resize', resizeFx);

export function render() {
    if (QUALITIES[quality].bloom && composer) composer.render();
    else renderer.render(scene, camera);
}

// ----- speed lines (2D overlay) -----
const lines = $('#speedLines');
const lctx = lines.getContext('2d');
const streaks = Array.from({ length: 70 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random(), l: 0.1 + Math.random() * 0.25, w: 1 + Math.random() * 2.5 }));
let lineAmt = 0;
export function setSpeedLines(target, dt) {
    lineAmt += (target - lineAmt) * Math.min(1, dt * 6);
    const w = lines.width, h = lines.height;
    lctx.clearRect(0, 0, w, h);
    if (lineAmt < 0.02) return;
    const cx = w / 2, cy = h * 0.46, R = Math.hypot(w, h) / 2;
    lctx.lineCap = 'round';
    for (const s of streaks) {
        s.r += dt * (1.6 + s.l * 4);
        if (s.r > 1) { s.r = 0.35 + Math.random() * 0.2; s.a = Math.random() * Math.PI * 2; }
        const r0 = R * s.r, r1 = R * Math.min(1.1, s.r + s.l);
        lctx.strokeStyle = `rgba(255,255,255,${(0.7 * lineAmt * s.r).toFixed(3)})`;
        lctx.lineWidth = s.w;
        lctx.beginPath();
        lctx.moveTo(cx + Math.cos(s.a) * r0, cy + Math.sin(s.a) * r0);
        lctx.lineTo(cx + Math.cos(s.a) * r1, cy + Math.sin(s.a) * r1);
        lctx.stroke();
    }
}

// ----- soft sprite particles (dust, sparkles, fireworks) -----
const softTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    return t;
})();
const sprites = [];
function spawn(pos, vel, color, size, life, opts) {
    opts = opts || {};
    const m = new T.SpriteMaterial({ map: opts.map || softTex, color, transparent: true, depthWrite: false, blending: opts.add ? T.AdditiveBlending : T.NormalBlending, opacity: opts.opacity || 1 });
    if (opts.hdr) m.color.multiplyScalar(opts.hdr);
    const s = new T.Sprite(m);
    s.position.copy(pos); s.scale.setScalar(size);
    scene.add(s);
    sprites.push({ s, v: vel, life, max: life, grow: opts.grow || 0, grav: opts.grav || 0, drag: opts.drag || 0, size, fade0: opts.opacity || 1 });
}
export function dust(pos, n, strength) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = (2 + Math.random() * 4) * strength;
        spawn(new V3(pos.x + Math.cos(a) * 0.6, pos.y + 0.3, pos.z + Math.sin(a) * 0.6), new V3(Math.cos(a) * sp, 1.5 + Math.random() * 2, Math.sin(a) * sp),
            0xd8d0e8, 0.55 + Math.random() * 0.4, 0.35 + Math.random() * 0.2, { grow: 1.6, drag: 3.5, opacity: 0.35 });
    }
}
export function sparkleColumn(pos, color) {
    for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2, r = 1.8 + Math.random() * 1.2;
        spawn(new V3(pos.x + Math.cos(a) * r, pos.y + Math.random() * 2, pos.z + Math.sin(a) * r), new V3(0, 7 + Math.random() * 8, 0),
            color, 0.3 + Math.random() * 0.3, 0.7 + Math.random() * 0.4, { add: true, hdr: 1.6, drag: 0.6 });
    }
}

// Light trail streaming behind the rider, like the reference's white-blue speed trail:
// a vertical ribbon through the last few positions, tapering and fading toward the tail
export function makeTrail(color) {
    const N = 26, pts = [];
    const pos = new Float32Array(N * 2 * 3), col = new Float32Array(N * 2 * 3);
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    const idx = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    const mesh = new T.Mesh(geo, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false }));
    mesh.frustumCulled = false;
    scene.add(mesh);
    const c = new T.Color(color);
    let acc = 0;
    return {
        color,
        setColor(hex) { this.color = hex; c.set(hex); },
        update(at, on, dt) {
            acc += dt;
            if (acc >= 0.03) {
                acc = 0;
                if (on) pts.unshift(at.clone()); else pts.pop();
                if (pts.length > N) pts.length = N;
            }
            if (pts.length) pts[0].copy(on ? at : pts[0]);
            for (let i = 0; i < N; i++) {
                const p = pts[Math.min(i, pts.length - 1)];
                const k = pts.length > 1 ? 1 - i / (pts.length - 1) : 0;
                const h = i < pts.length ? 1.1 * k : 0;
                for (let s = 0; s < 2; s++) {
                    const o = (i * 2 + s) * 3;
                    if (p) { pos[o] = p.x; pos[o + 1] = p.y + (s ? h : -h); pos[o + 2] = p.z; }
                    col[o] = c.r * k * 0.9; col[o + 1] = c.g * k * 0.9; col[o + 2] = c.b * k * 0.9;
                }
            }
            geo.attributes.position.needsUpdate = true;
            geo.attributes.color.needsUpdate = true;
            mesh.visible = pts.length > 1;
        },
    };
}

// Fire puff (exhaust flames on the top bikes): rises, shrinks and fades
export function flame(at, spread, size, vel) {
    const p = new V3(at.x + (Math.random() - 0.5) * spread, at.y + (Math.random() - 0.5) * spread * 0.5, at.z + (Math.random() - 0.5) * spread);
    const v = vel ? vel.clone().multiplyScalar(0.7 + Math.random() * 0.6) : new V3(0, 0, 0);
    v.x += (Math.random() - 0.5) * 3; v.y += 3 + Math.random() * 5; v.z += (Math.random() - 0.5) * 3;
    spawn(p, v, Math.random() < 0.45 ? 0xff5a14 : Math.random() < 0.6 ? 0xffb51c : 0xfff0a0,
        (size || 1.4) * (0.7 + Math.random() * 0.6), 0.45 + Math.random() * 0.35, { add: true, hdr: 1.3, grow: -0.5, drag: 1.5, opacity: 0.95 });
}
// Exhaust smoke puffing out of a pipe (back = unit vector pointing out of the tail)
export function exhaust(at, back, n) {
    for (let i = 0; i < n; i++) {
        const v = new V3(back.x * (3 + Math.random() * 3) + (Math.random() - 0.5) * 1.5, 1 + Math.random() * 1.5, back.z * (3 + Math.random() * 3) + (Math.random() - 0.5) * 1.5);
        spawn(at.clone(), v, Math.random() < 0.5 ? 0xd8d4ec : 0xb8b4d0, 0.4 + Math.random() * 0.3, 0.5 + Math.random() * 0.3, { grow: 2.2, drag: 2.2, opacity: 0.32 });
    }
}
// Bright sparks scraping off the road at speed
export function sparks(at, color, n) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        spawn(new V3(at.x, at.y + 0.2, at.z), new V3(Math.cos(a) * 6, 3 + Math.random() * 5, Math.sin(a) * 6), color || 0xffd028,
            0.18 + Math.random() * 0.15, 0.25 + Math.random() * 0.2, { add: true, hdr: 2, grav: 30, drag: 1 });
    }
}

// Treadmill effects: 3x flames, 9x electric sparks, 25x white/purple twinkles, 100x rainbow plasma
export function emitTread(at, mult, len, width) {
    const p = new V3(at.x + (Math.random() - 0.5) * len * 0.8, at.y, at.z + (Math.random() - 0.5) * width * 0.9);
    if (mult === 3) {
        spawn(p, new V3((Math.random() - 0.5) * 1.5, 5 + Math.random() * 4, (Math.random() - 0.5) * 1.5), Math.random() < 0.5 ? 0xff7a1a : 0xffc414,
            0.9 + Math.random() * 0.7, 0.45 + Math.random() * 0.3, { add: true, hdr: 1.3, grow: -0.6, opacity: 0.9 });
    } else if (mult === 9) {
        spawn(p.setY(at.y + Math.random() * 2.5), new V3((Math.random() - 0.5) * 8, (Math.random() - 0.3) * 6, (Math.random() - 0.5) * 8), 0x7fe8ff,
            0.35 + Math.random() * 0.3, 0.18 + Math.random() * 0.15, { add: true, hdr: 1.6 });
    } else if (mult === 25) {
        spawn(p.setY(at.y + Math.random() * 4), new V3(0, 1 + Math.random() * 2, 0), Math.random() < 0.6 ? 0xffffff : 0xc28cff,
            0.3 + Math.random() * 0.35, 0.6 + Math.random() * 0.5, { add: true, hdr: 1.5 });
    } else {
        const c = new T.Color().setHSL(Math.random(), 1, 0.6).getHex();
        spawn(p, new V3((Math.random() - 0.5) * 3, 6 + Math.random() * 6, (Math.random() - 0.5) * 3), c,
            0.5 + Math.random() * 0.5, 0.5 + Math.random() * 0.4, { add: true, hdr: 1.8, grow: -0.4 });
    }
}

// Expanding neon ring on the ground (level up, landing big falls)
const rings = [];
export function ring(pos, color, maxR, life) {
    const m = new T.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: T.DoubleSide });
    m.color.multiplyScalar(2.2);
    const mesh = new T.Mesh(new T.RingGeometry(0.8, 1, 48), m);
    mesh.rotation.x = -Math.PI / 2; mesh.position.copy(pos).setY(pos.y + 0.2);
    scene.add(mesh);
    rings.push({ mesh, t: 0, life: life || 0.7, maxR: maxR || 9 });
}

// Fireworks: a glowing rocket that bursts into coloured sparks
const rockets = [];
const FW_COLORS = [0xffd028, 0x46ec50, 0x28c8ff, 0xff3fa0, 0xc428ff, 0xff6e14];
export function fireworks(center, count, onBurst) {
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 10;
        rockets.push({
            p: new V3(center.x + Math.cos(a) * r, center.y + 1, center.z + Math.sin(a) * r),
            v: new V3((Math.random() * 2 - 1) * 3, 34 + Math.random() * 10, (Math.random() * 2 - 1) * 3),
            t: 0.7 + Math.random() * 0.3 + i * 0.18, trail: 0, color: FW_COLORS[(Math.random() * FW_COLORS.length) | 0], onBurst,
        });
    }
}
function burstFw(p, color) {
    for (let i = 0; i < 46; i++) {
        const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        const sp = 16 + Math.random() * 8;
        spawn(p.clone(), new V3(s * Math.cos(th) * sp, u * sp, s * Math.sin(th) * sp), i % 5 ? color : 0xffffff, 0.9 + Math.random() * 0.5, 1.1 + Math.random() * 0.5, { add: true, hdr: 2.5, grav: 14, drag: 1.4 });
    }
}

export function updateFx(dt) {
    for (let i = sprites.length - 1; i >= 0; i--) {
        const p = sprites[i];
        p.life -= dt;
        if (p.life <= 0) { scene.remove(p.s); p.s.material.dispose(); sprites.splice(i, 1); continue; }
        p.v.y -= p.grav * dt;
        if (p.drag) p.v.multiplyScalar(Math.exp(-p.drag * dt));
        p.s.position.addScaledVector(p.v, dt);
        const k = p.life / p.max;
        p.s.material.opacity = p.fade0 * Math.min(1, k * 2);
        if (p.grow) p.s.scale.setScalar(Math.max(0.05, p.size * (1 + p.grow * (1 - k))));
    }
    for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.t += dt;
        const k = r.t / r.life;
        if (k >= 1) { scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); rings.splice(i, 1); continue; }
        const e = 1 - Math.pow(1 - k, 3);
        r.mesh.scale.setScalar(1 + e * r.maxR);
        r.mesh.material.opacity = 1 - k;
    }
    for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.v.y -= 20 * dt;
        r.p.addScaledVector(r.v, dt);
        r.trail -= dt;
        if (r.trail <= 0) { r.trail = 0.03; spawn(r.p.clone(), new V3(0, -2, 0), 0xffe7a8, 0.7, 0.35, { add: true, hdr: 2 }); }
        r.t -= dt;
        if (r.t <= 0) { burstFw(r.p, r.color); if (r.onBurst) r.onBurst(); rockets.splice(i, 1); }
    }
}

applyQuality();
