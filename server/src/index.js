import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config, { listen } from '@colyseus/tools';
import { defineRoom } from 'colyseus';
import express from 'express';
import { SpeedRoom, grantPurchase } from './SpeedRoom.js';
import { WEBHOOK_SECRET, WEBHOOK_KEY_SHA256, BUX_MODE, installStatReporter } from './bloxity.js';
import { saveProfiles, firstDelivery } from './profiles.js';
import { skuLookup } from '../../shared/config.js';
import { statsSummary } from './stats.js';

// Serves the built client (client/dist) and the game room on the same port,
// so one Node host is enough to run the whole game.
const CLIENT_DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();
const sameHash = (s, hex) => crypto.timingSafeEqual(sha256(s), Buffer.from(hex, 'hex'));
// A webhook is genuine when it carries the URL key (?key=...) or the header matching
// LEGION_WEBHOOK_SECRET. In Bux mode nothing else is accepted; in local demo mode anything is.
function webhookAllowed(req) {
    const key = req.query && typeof req.query.key === 'string' ? req.query.key : '';
    if (key && sameHash(key, WEBHOOK_KEY_SHA256)) return true;
    const header = req.get('x-legion-webhook-secret') || '';
    if (header && WEBHOOK_SECRET && sameHash(header, sha256(WEBHOOK_SECRET).toString('hex'))) return true;
    if (header && sameHash(header, WEBHOOK_KEY_SHA256)) return true;
    return !BUX_MODE && !WEBHOOK_SECRET;
}

// Bloxity calls this after deducting Bux; answer 2xx within 10 s or the Bux are refunded
async function buxWebhook(req, res) {
    if (!webhookAllowed(req)) {
        console.warn('[Bux] rejected a webhook without a valid key');
        return res.status(401).json({ error: 'bad secret' });
    }
    const b = req.body || {};
    const item = skuLookup(b.sku);
    if (!b.transactionId || !b.userId || !item) return res.status(400).json({ error: 'unknown purchase' });
    const tx = String(b.transactionId);
    try {
        if (!(await firstDelivery(tx))) return res.json({ ok: true, duplicate: true });
    } catch (e) {
        // Database down: a non-2xx makes Bloxity refund instead of charging for nothing
        console.warn('[Bux]', tx, e.message);
        return res.status(503).json({ error: 'storage unavailable' });
    }
    const ok = await grantPurchase('legion_' + b.userId, String(b.username || '').slice(0, 20), item.kind, item.key, tx).catch(() => false);
    saveProfiles();
    console.log('[Bux]', b.transactionId, b.username, b.sku, ok ? 'granted' : 'rejected');
    return ok ? res.json({ ok: true }) : res.status(400).json({ error: 'grant failed' });
}

const app = config({
    rooms: {
        speed: defineRoom(SpeedRoom),
    },
    initializeExpress: (expressApp) => {
        expressApp.get('/health', (req, res) => res.json({ ok: true }));
        expressApp.post('/api/legion-webhook', express.json({ limit: '32kb' }), buxWebhook);
        // Play stats (aggregate, no names): /api/stats?key=<webhook key>&days=7
        expressApp.get('/api/stats', async (req, res) => {
            const key = typeof req.query.key === 'string' ? req.query.key : '';
            if (BUX_MODE && !(key && sameHash(key, WEBHOOK_KEY_SHA256))) return res.status(401).json({ error: 'bad key' });
            const days = Math.min(60, Math.max(1, Number(req.query.days) || 7));
            try { res.json(await statsSummary(days)); } catch (e) { res.status(503).json({ error: e.message }); }
        });
        if (fs.existsSync(CLIENT_DIST)) expressApp.use(express.static(CLIENT_DIST));
    },
});

const reporter = installStatReporter();
process.once('beforeExit', () => { reporter.flush(); });

// 2593 locally so this game can run beside the other Legion games (they use 2567 / 2580); Legion sets PORT
listen(app, Number(process.env.PORT) || 2593);
