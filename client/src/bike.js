import { T, UNIT, mat, paint, chrome, glass } from './engine.js';

// Procedural motorcycles built from boxes, tubes and tori, facing +Z with the wheels on y = 0.
// Styles: dirt, street, sport, hyper, chopper, scooter. Bodies use clear-coated paint and real
// chrome (they reflect the scene environment); tier extras add neon rims, an underglow and
// exhaust fire. userData: seat / seatZ (where the rider sits), wheels (spun by animateBike),
// exhaust (tip for flames), inner (leans into turns and shakes with the engine).

const TIRE = 0x18181c, DARK = 0x24242c, SEAT = 0x141418, LIGHT = 0xfff4d8, TAIL = 0xff2a3c;
const TORUS = new T.TorusGeometry(1, 0.36, 12, 32);
const DISC = new T.CylinderGeometry(1, 1, 1, 28);
const TUBE = new T.CylinderGeometry(0.5, 0.5, 1, 10);
const MOUNT_SCALE = 1;

function maker(root) {
    return (sx, sy, sz, x, y, z, m, parent) => {
        const mesh = new T.Mesh(UNIT, m);
        mesh.scale.set(sx, sy, sz); mesh.position.set(x, y, z);
        mesh.castShadow = !m.isMeshBasicMaterial;
        (parent || root).add(mesh);
        return mesh;
    };
}
// A round tube from a to b ([x, y, z] arrays)
function tube(parent, a, b, r, m) {
    const va = new T.Vector3(...a), vb = new T.Vector3(...b);
    const mesh = new T.Mesh(TUBE, m);
    mesh.position.copy(va).add(vb).multiplyScalar(0.5);
    mesh.scale.set(r * 2, va.distanceTo(vb), r * 2);
    mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
}
// Disc with its axis along x (wheel faces, hubs, lamps)
function disc(parent, r, w, x, y, z, m) {
    const mesh = new T.Mesh(DISC, m);
    mesh.scale.set(r, w, r); mesh.rotation.z = Math.PI / 2; mesh.position.set(x, y, z);
    mesh.castShadow = !m.isMeshBasicMaterial;
    parent.add(mesh);
    return mesh;
}

// Wheel: fat torus tyre, painted rim, chrome hub, five spokes. Spins around x.
function wheel(parent, r, z, d, neonRim) {
    const g = new T.Group(); g.position.set(0, r, z); parent.add(g);
    const tyre = new T.Mesh(TORUS, mat(TIRE));
    tyre.scale.set(r * 0.735, r * 0.735, 1.1); tyre.rotation.y = Math.PI / 2; tyre.castShadow = true; g.add(tyre);
    disc(g, r * 0.52, 0.34, 0, 0, 0, neonRim ? mat(d.accent, { neon: true }) : chrome(d.accent));
    disc(g, r * 0.4, 0.4, 0, 0, 0, mat(DARK));
    disc(g, r * 0.18, 0.62, 0, 0, 0, chrome());
    for (let i = 0; i < 5; i++) {
        const s = new T.Mesh(UNIT, chrome(d.accent));
        s.scale.set(0.44, r * 0.86, 0.12); s.rotation.x = i / 5 * Math.PI; g.add(s);
    }
    return { g, r };
}

const STYLE = {
    // Wheel radii, wheelbase, seat height and a few shape switches per style
    dirt: { rf: 1.2, rr: 1.15, zf: 2.55, zr: -2.25, seatY: 2.55, tankY: 2.7, bars: 3.35 },
    street: { rf: 1.15, rr: 1.15, zf: 2.45, zr: -2.25, seatY: 2.45, tankY: 2.65, bars: 3.2 },
    sport: { rf: 1.15, rr: 1.2, zf: 2.5, zr: -2.25, seatY: 2.5, tankY: 2.7, bars: 2.85, fairing: true },
    hyper: { rf: 1.15, rr: 1.25, zf: 2.6, zr: -2.3, seatY: 2.45, tankY: 2.65, bars: 2.8, fairing: true, fins: true },
    chopper: { rf: 1.05, rr: 1.3, zf: 3.3, zr: -2.35, seatY: 2.2, tankY: 2.55, bars: 3.9, long: true },
    scooter: { rf: 0.85, rr: 0.85, zf: 2.1, zr: -1.9, seatY: 2.45, tankY: 2.2, bars: 3.3, scooter: true },
};

// Builds a new bike group for a catalogue entry (bikeById[...])
export function buildBike(d) {
    const g = new T.Group();
    const inner = new T.Group(); g.add(inner);
    const part = maker(inner);
    const st = STYLE[d.style] || STYLE.street;
    const body = paint(d.body, { metal: d.body === 0xffffff ? 0.1 : 0.35 });
    const accent = mat(d.accent, { neon: true });
    const metal = chrome(), dark = mat(DARK);
    const tier = d.bonus;
    const neonRims = tier >= 100 || !!d.pass;

    // Wheels
    const wheels = [wheel(inner, st.rf, st.zf, d, neonRims), wheel(inner, st.rr, st.zr, d, neonRims)];

    // Engine block with chrome cooling fins, frame tubes, swingarm and front fork
    if (!st.scooter) {
        part(1.1, 1.0, 1.45, 0, 1.45, 0.1, mat(0x3a3c46));
        for (let i = 0; i < 3; i++) part(1.26, 0.09, 1.3, 0, 1.75 - i * 0.22, 0.1, metal);
        tube(inner, [0, st.tankY + 0.05, st.zf - 1.25], [0, st.seatY - 0.15, -1.6], 0.17, body);
        tube(inner, [0, st.tankY - 0.2, st.zf - 1.3], [0, 0.95, 0.65], 0.15, dark);
    }
    for (const x of [-0.38, 0.38]) {
        tube(inner, [x, 1.25, -0.4], [x, st.rr, st.zr], 0.11, dark);
        tube(inner, [x, st.bars - 0.25, st.zf - (st.long ? 1.7 : 1.05)], [x, st.rf, st.zf], 0.1, metal);
    }

    // Tank (with a glowing accent stripe), seat, tail and tail light
    if (st.scooter) {
        // Step-through scooter: floorboard, leg shield and a tall seat box
        part(1.2, 0.3, 2.4, 0, 1.0, 0.1, body);
        part(1.3, 2.0, 0.3, 0, 2.0, 1.35, body).rotation.x = -0.25;
        part(1.25, 1.1, 1.8, 0, 1.65, -1.05, body);
        part(1.27, 0.12, 1.6, 0, 1.75, -1.05, accent);
    } else {
        part(1.3, 0.8, 1.7, 0, st.tankY, 0.55, body);
        part(1.0, 0.3, 1.35, 0, st.tankY + 0.5, 0.5, body);
        part(1.34, 0.13, 1.5, 0, st.tankY + 0.05, 0.55, accent);
    }
    part(1.15, 0.3, 1.8, 0, st.seatY, -0.7, mat(SEAT));
    part(1.0, 0.45, 1.25, 0, st.seatY + 0.02, -1.85, body).rotation.x = 0.12;
    part(0.8, 0.22, 0.1, 0, st.seatY + 0.05, -2.48, mat(TAIL, { neon: true }));

    // Fenders
    if (d.style === 'dirt') {
        part(0.75, 0.1, 2.1, 0, st.rf * 2 + 0.55, st.zf + 0.1, body).rotation.x = -0.1;
        part(0.75, 0.1, 2.2, 0, st.seatY + 0.2, st.zr - 0.3, body).rotation.x = 0.22;
        part(0.95, 0.85, 0.08, 0, st.bars - 0.45, st.zf - 0.75, mat(0xf4f4f4)).rotation.x = 0.25;
    } else {
        part(0.85, 0.12, 1.4, 0, st.rf * 2 + 0.12, st.zf, body);
        part(0.9, 0.12, 1.3, 0, st.rr * 2 + 0.1, st.zr - 0.2, body).rotation.x = 0.15;
    }

    // Headlight: housing + glowing lens
    const lampY = st.fairing ? 2.2 : st.bars - 0.6, lampZ = st.zf - (st.long ? 1.4 : 0.55);
    part(0.95, 0.8, 0.45, 0, lampY, lampZ, body);
    part(0.7, 0.5, 0.1, 0, lampY, lampZ + 0.26, mat(LIGHT, { neon: true }));

    // Handlebars, grips and mirrors
    const barZ = st.long ? st.zf - 1.75 : st.zf - 1.2;
    tube(inner, [-1.25, st.bars, barZ], [1.25, st.bars, barZ], 0.09, dark);
    for (const x of [-1.15, 1.15]) {
        tube(inner, [x - 0.2, st.bars, barZ], [x + 0.2, st.bars, barZ], 0.14, mat(0x101012));
        tube(inner, [x * 0.65, st.bars, barZ], [x * 0.85, st.bars + 0.6, barZ - 0.05], 0.04, dark);
        part(0.42, 0.26, 0.08, x * 0.85, st.bars + 0.66, barZ - 0.05, metal);
    }

    // Exhaust pipe(s) with a dark tip (flames come out of the tip on fire bikes)
    const pipes = st.long ? [-1, 1] : [1];
    const exhaust = new T.Object3D();
    for (const s of pipes) {
        tube(inner, [s * 0.62, 0.95, 0.3], [s * 0.7, st.long ? 1.15 : 1.55, -2.45], 0.17, metal);
        disc(inner, 0.2, 0.22, s * 0.7, st.long ? 1.15 : 1.55, -2.5, dark).rotation.set(Math.PI / 2, 0, 0);
    }
    exhaust.position.set(0.7, st.long ? 1.15 : 1.55, -2.6); inner.add(exhaust);

    // Style extras
    if (st.fairing) {
        part(1.5, 1.15, 1.3, 0, 2.15, st.zf - 0.75, body);
        part(1.5, 0.75, 2.2, 0, 1.6, 0.0, body);
        part(1.53, 0.1, 2.0, 0, 1.85, 0.0, accent);
        const screen = part(1.1, 0.75, 0.06, 0, 2.95, st.zf - 0.85, glass(d.accent, 0.45));
        screen.rotation.x = -0.65; screen.castShadow = false;
    }
    if (st.fins) for (const x of [-0.55, 0.55]) part(0.08, 0.8, 1.0, x, st.seatY + 0.5, -2.0, accent).rotation.x = -0.4;
    if (st.long) {
        // Chopper: sissy bar backrest
        tube(inner, [0, st.seatY, -1.5], [0, st.seatY + 1.4, -1.9], 0.07, metal);
        part(0.9, 0.7, 0.14, 0, st.seatY + 1.2, -1.85, mat(SEAT)).rotation.x = 0.2;
    }
    if (d.glow) {
        // Neon underglow strip and a soft glowing disc on the ground under OP bikes
        part(0.9, 0.08, 3.6, 0, 0.75, 0, mat(d.glow, { neon: true }));
        const r = new T.Mesh(new T.RingGeometry(1.8, 2.6, 40), mat(d.glow, { neon: true, opacity: 0.55 }));
        r.rotation.x = -Math.PI / 2; r.position.y = 0.06; inner.add(r);
    }

    const size = (d.size || 1) * MOUNT_SCALE;
    inner.scale.setScalar(size);
    Object.assign(g.userData, {
        inner, wheels, exhaust, seat: (st.seatY + 0.15) * size, seatZ: -0.7 * size,
        spin: 0, phase: Math.random() * 6, size, fire: !!d.fire, glowColor: d.glow || d.accent,
    });
    return g;
}

// Wheels roll with the ground speed, the bike leans into turns and the engine shakes it a little
export function animateBike(g, dt, moving, speed, lean) {
    const u = g.userData;
    u.phase += dt;
    const v = moving ? speed || 16 : 0;
    u.spin += (v * dt) / (u.size * 1.15);
    for (const w of u.wheels) w.g.rotation.x = u.spin * (1.15 / w.r);
    const rumble = moving ? Math.sin(u.phase * 70) * 0.025 : Math.sin(u.phase * 38) * 0.012;
    u.inner.position.y = rumble;
    u.inner.rotation.z += ((lean || 0) - u.inner.rotation.z) * Math.min(1, dt * 8);
}
