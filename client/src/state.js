// Local mirror of this player's progress. The server owns the real values:
// public stats arrive through the room state, private ones in "profile" messages.
export const S = {
    speed: 0, wins: 0, level: 1, xp: 0, rebirths: 0, friends: 0,
    owned: { Dirt: true }, equipped: 'Dirt', auras: {}, aura: '', passes: {}, daily: null,
    boostUntil: 0, customSpeed: 0, claimedPack: false, firstPlay: Date.now(),
    freeClaimed: {}, joinedAt: Date.now(), name: '', chestAt: 0, freeBoost: false,
};

// Game actions that world objects (pads, bike pedestals, chests) trigger; filled in by main.js
export const actions = {};

export const net = {
    room: null,
    offset: 0,
    send(type, msg) { if (this.room) this.room.send(type, msg || {}); },
    // Server clock in ms, so race starts and timers line up for everyone
    now() { return Date.now() + this.offset; },
};
