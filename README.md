# +1 Motorcycle Evolution

A multiplayer "+1 Speed" motorcycle game for the browser, built with **Three.js** and **Colyseus** for Bloxity. You ride a motorcycle through a neon city, every step gives +Speed, Speed fills your Level (each level = a faster bike), and you break through stage gates to collect Wins and unlock better motorcycles. It clones the Roblox game *+1 Motorcycle Evolution* (see `Reference/Gameplay.mp4`) with premium graphics.

It shares its engine with Speed Dino Escape, Speed Football Scape and Speed Fish Escape: the same server, Bloxity integration and effects, with a city theme, procedural motorcycles and the reference's HUD.

## Project layout

| Folder | What it is |
|---|---|
| `client/` | Vite + Three.js game client (`src/main.js`, `world.js`, `bike.js`, `engine.js`, `ui.js`, `audio.js`) |
| `server/` | Colyseus 0.18 server: the `speed` room, player profiles, leaderboards, Bux webhook |
| `shared/` | Game data and formulas used by both sides (`config.js`) |

## Run it locally

Needs Node 20 or newer.

```sh
npm install          # installs client and server too
npm run build        # builds the client into client/dist
npm start            # server + game on http://localhost:2593
```

Or double-click `start-local.bat`. For development, run `npm run dev:server` and `npm run dev:client` in two terminals, then open the Vite URL (http://localhost:5173).

## Gameplay (from the reference video)

- **Ride to gain Speed.** Every step gives your motorcycle's `+N/Speed` (the starter Dirt Rider is +1). Speed is also XP: Level 1 needs 57.5, then 66.1 / 76 / 87.5 ... (x1.15 per level, as in the reference). Each level adds +2 riding speed: "Level Up! (1 -> 2) / New Speed: 14 -> 16". Custom Speed lets you ride slower than your MAX.
- **HUD** (from the reference): Wins with the trophy, Shop / Rebirth / AURAS / FREE on the left, Custom Speed with MAX and the rainbow **x2 Speed** pass on the right, `2,527 Speed  x1(Rebirth)` over the Level bar, and **+100K / +1M / +10M SPEED** buttons at the bottom.
- **Lobby**: a lavender city plaza with a road running north to the STAGE 1 gate and a giant glowing "+1" floating above it.
  - Left: the **MOTORCYCLES** showroom. Ride onto a pad to equip a bike (or "Not Enough Wins!"). Front row: Dirt Rider (+1), Street Runner (+2, 3 Wins), Crimson Fang (+5, 15), Blue Comet (+25, 100), Shadow Chopper (+50, 500), Pocket Rocket (Bux) and the OP Nitro Dragon (Bux). Raised back row: Neon Viper (+100, 2.5K), Golden Thunder (+250, 15K), Cyber Blade (+500, 50K), Inferno (+1K, 250K), Frost Phantom (+2K, 500K), Galaxy Hyper (+5K, 1M), Void Reaper (+10K, 2M) and Celestial God (+25K, 5M).
  - Right: the **TREADMILLS** ("Increase your speed automatically!"): 3x Steps, 9x (25 Wins), 25x (250 Wins) and 100x (pass). They keep earning while you're offline (a quarter rate, up to 8 hours).
  - Also: TOP WINS / TOP SPEED boards, +SPEED / +WINS pads, the LIKE REWARD chest (free Speed and Wins once a day), the Mystery Crate (a free Turbo Scooter after 20 minutes), the "Keep playing" garage (free x2 Speed Boost after 15 minutes).
- **Race road**: six stages, each harder than the last. Every stage starts at a floating "Stage N" title (with a hint) and a pink see-through wall (a checkpoint you ride through), and ends with an **"X2 Win!" pad** (x2 Wins pass) and a **"+N Wins / Return" pad** that sends you back to the lobby. Getting hit by a vehicle crashes you: Revive (Bux) or back to the lobby.
  1. **Stage 1, city street**: the road breaks off into a glowing pit; **jump across 9 floating blocks** that climb up and drop back down (falling in crashes you), then stairs up a purple deck. Every hop works at the starter speed (14). **+1 Win**.
  2. **Stage 2, brick bridge**: a raised causeway and concrete barriers across the whole road that you have to **jump** (2.4 studs, higher than you can ride over), and **spike traps** right where you land and halfway to the next barrier: a red light flashes, then steel spikes shoot up for about a second (touch them and you crash). Each trap has its own timing (`SPIKES` in `shared/config.js`). **+3 Wins**.
  3. **Stage 3, tunnels**: big cars (twice normal size) burst out of a stone tunnel, cross the road and disappear into the tunnel opposite. An amber light over the tunnel flashes first: **stop, let it pass, then go**. **+8 Wins**.
  4. **Stage 4, highway**: a truck sweeps across the road past the Stage 4 wall and police cars drive at you down the lanes. **+20 Wins**.
  5. **Stage 5, police square**: a short street opens into a huge open square (240 x 350 studs) with scattered barriers and parked police cars. A police car chases you in at **28** and, once you are in the square, a second one comes at you from the exit side. Police cars home in on you but turn at a limited rate: out-ride them (level up your MAX Speed, or sprint) or swerve hard so they overshoot, then escape through the green **EXIT** gate. **+50 Wins**.
  6. **Stage 6, finale**: barriers every 60 studs, trucks crossing from side streets and a police chase at **40**. **+125 Wins**, then the NEXT UPDATE wall.
  Traffic runs on the server clock, so everyone sees the same vehicles; the chasing police car is your own. Each rebirth adds +1x to the Wins from the pads. Tune it all in `STAGES` / `TRAFFIC` in `shared/config.js`.
- **Rebirth** at Level 25: back to Level 1, +50% to all Speed earned and +10 riding speed per rebirth.
- **Race event** every 5 minutes, Daily Reward, FREE playtime rewards, Auras, Friend Boost, Store, Friends, Avatar and Auto Train work as in the other games.

## Crashes and checkpoints

A crash never sends you back to the lobby. After 3 s you respawn at the last checkpoint: the start of each stage, the edge of the Stage 1 pit, the middle of Stages 3 and 6 and the entrance of the Stage 5 police square. **Revive** (Bux) puts you back right where you crashed. Too slow for the police? A hint says to level up or train.

## Play stats

Every finished session is recorded (no names or ids): length, furthest stage, Wins pads cleared, crashes per stage and their cause (pit, spikes, tunnel car, traffic, truck, police, fall), treadmill time, purchases and rebirths. In MongoDB on Legion (`sessions`), in `server/data/sessions.jsonl` locally.

`GET /api/stats?key=<webhook key>&days=7` sums them up: session length (mean, median, buckets) for new and returning players, the share of players that reach and clear each stage, crashes per stage, the causes, how many left in the lobby or while crashed, treadmill share and purchases.

## Graphics

- Procedural motorcycles (`client/src/bike.js`) in six styles (dirt, street, sport, hyper, chopper, scooter) with clear-coated paint and chrome that reflect an environment map, spinning wheels, leaning into turns, neon rims and underglow on the top tiers, exhaust smoke, and fire from the pipes on the fire bikes.
- Neon city: textured building facades with lit windows and glass bands, glowing curbs and street lamps, a hazy sky that takes on each stage's colour, bloom, light trails in the bike's colour, speed lines, sparks in hard leans and a speed-based field of view.
- Soundtrack: an original, code-generated 118 BPM synthwave track plus a motorcycle engine whose pitch follows your speed. No audio files.

## Controls

| Action | Keyboard / mouse | Controller |
|---|---|---|
| Ride | WASD / arrows | Left stick |
| Camera | Drag, wheel to zoom | Right stick, D-pad up/down to zoom |
| Jump | Space | A |
| Boost | Hold Shift | Hold RT, LT or L3 |
| Interact | E | X |

Phones get an on-screen joystick with JUMP and SPRINT buttons.

## How multiplayer works

- Everyone joins one shared `speed` room (up to 24 players), which covers the lobby and all six stages.
- **Client-side:** movement and physics, including traffic hits. Other players are drawn with interpolation, riding their own bikes.
- **Server-side:** everything that changes progress: Speed from riding (treadmills, bike bonus, multipliers), pickups, Wins pads (one claim per run; re-armed in the lobby), bike unlocks, auras, rebirths, rewards and purchases.
- Progress is saved per browser (a random id in localStorage) or per Bloxity account. On Legion it lives in MongoDB (`MONGODB_URI`); locally in `server/data/profiles.json`. Each browser also keeps a signed backup (`server/src/saves.js`, key `SAVE_SECRET`).

## Bloxity

- `GAME_SLUG` in `client/src/bloxity.js` defaults to `motorcycle-evolution`; it must match the slug of the game in bloxity.io Manage Games.
- Every price is in **Bux**. Store items map to SKUs (`SKUS` in `shared/config.js`); create them in the game's IAP catalog: `speed_100k`, `speed_1m`, `speed_10m`, `starter_pack`, `revive`, `speed_boost`, `wins_500`, `wins_5k`, `pass_double_speed`, `pass_double_wins`, `pass_treadmill_100x`, `pass_cheap_bike`, `pass_op_bike`, `pass_rainbow_aura`. Without a catalog the game runs in demo mode, where purchases are free.
- Legion has no custom env vars. On Legion (it injects `BLOXITY_GAME_ID`) the server runs in **Bux mode**: purchases only come from the Bloxity webhook `POST /api/legion-webhook?key=<webhook key>`. The key itself is never in the repo, only its SHA-256 (`WEBHOOK_KEY_SHA256` in `server/src/bloxity.js`); a webhook without the right key gets 401. To change the key, generate a new one, put its SHA-256 there, redeploy and update the webhook URL on bloxity.io. Progress backups are signed with Legion's `JWT_SECRET`.

## Deploy (Bloxity hosting)

Every push to `main` (prod) or `dev` runs `.github/workflows/deploy.yml`: it builds the server image (`ghcr.io/asivixlp44-cmyk/motorcycle-evolution-server`), tells Legion to roll it out, and uploads the client.

Play at https://motorcycle-evolution.play.bloxity.io (prod) or https://motorcycle-evolution.dev.play.bloxity.io (dev).

One-time setup:

- Create the app `motorcycle-evolution` on hosting.bloxity.io (Legion has no create-on-deploy).
- Create the game in bloxity.io Manage Games with the slug `motorcycle-evolution`, plus the SKUs above.
- Repo secret: `LEGION_DEPLOY_TOKEN` (from hosting.bloxity.io).
