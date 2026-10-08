import { schema, t } from '@colyseus/schema';

// Public, synced to every client. Private progress (passes, owned bikes,
// boosts...) is sent only to its owner with the "profile" message.
export const PlayerState = schema({
    name: t.string().default(''),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    ry: t.angle(),
    anim: t.uint8().default(0), // 0 idle, 1 run, 2 air, 3 dead
    speed: t.number().default(0),
    wins: t.number().default(0),
    level: t.uint8().default(1),
    xp: t.number().default(0),
    rebirths: t.uint16().default(0),
    equipped: t.string().default(''),
    aura: t.string().default(''),
    friends: t.uint8().default(0), // Friend Boost: Bloxity friends in this server
    kit: t.uint8().default(0),
    skin: t.uint8().default(0),
    av: t.string().default(''), // packed Bloxity avatar (equipped ids + proportions)
}, 'PlayerState');

export const GameState = schema({
    players: t.map(PlayerState),
}, 'GameState');
