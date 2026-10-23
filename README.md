# Fighter

A Smash-style 2D fighting game that runs in a browser — so the same game works on
a laptop, an iPhone, and an Xbox without being rebuilt for each one.

**Play it online:** https://firex2200.github.io/fighter/ — on an iPhone, open it in
Safari, tap Share → **Add to Home Screen**, and it installs like an app.

## The fighter

**Rook Ashvane — "The Wandering Storm."** A drifter from the old highway towns,
born in a thunderstorm to a village swordsmith and a storm spirit. Straw hat, long
blade, short temper. Push him far enough and the blade's edge splits open to let
the storm out — which is why it only lights up when he attacks.

Both players are Rook, told apart by costume: **Default** (indigo / saffron /
teal), **Ember** (charcoal / red / gold), **Frost** (white / blue / ice) or
**Moss** (green / lime / mint), picked on the costume-select screen before each
fight.

He's built in 3D from code rather than loaded from model files, so a costume is
an exact three-colour swap rather than a hue shift. His
stats come straight off the concept sheet (Weight 5, Ground 8, Air 7, Power 7,
Range 8, Recovery 6) — the mapping to game values is documented at the top of
`src/characters.js`.

## Play it

Double-click **Fighter** in `~/Desktop/Games`. It starts the game and opens your
browser. Double-click **Stop Fighter** in the same folder when you're done.

That's it — no Terminal needed.

<details>
<summary>Starting it manually instead</summary>

```bash
cd ~/fighter
python3 -m http.server 8010
```

Then open <http://localhost:8010>. Press `Ctrl+C` in Terminal to stop.
</details>

### Why the project lives at `~/fighter` and not in `ai-work`

macOS blocks double-clickable apps from reading files under `~/Desktop`,
`~/Documents` and `~/Downloads`, so the launcher could not start the server from
there. Sideline sits outside those folders for the same reason.

**The game uses port 8010. Sideline uses 8000.** Keep it that way — a second
service on Sideline's port makes its launcher open the wrong thing.

### Rebuilding the launcher apps

Only needed if you move or rename the project folder:

```bash
bash ~/fighter/scripts/make_launcher.sh
```

## Controls

|            | Move       | Jump | Attack | Strong | Special | Shield |
| ---------- | ---------- | ---- | ------ | ------ | ------- | ------ |
| Player 1   | `W A S D`  | `W`  | `J`    | `K`    | `L`     | `I`    |
| Player 2   | arrows     | `↑`  | `,`    | `.`    | `/`     | Right Shift |
| Controller | stick/dpad | `A`  | `X`    | `Y`    | `B`     | any bumper or trigger |

Plug in or pair any Xbox controller and it works — player 1 takes the first pad,
player 2 the second. Keyboard always keeps working alongside.

**On a phone:** with the game running, scan the QR code in the corner of the
laptop screen with your iPhone camera (same wifi). Hold the phone sideways.
Left thumb anywhere on the left half is a joystick; the right side has Jump,
Atk, Strong, Spec and Shield. Pair a controller and the buttons disappear.

**Playing alone:** player 2 is the CPU. The moment anyone presses a player-2
key or picks up a second controller, they take over for the rest of that match.

**Tapping jump gives a short hop; holding it gives a full hop.** That distinction
is the core of the movement game.

Press `H` during a match to see hitboxes (red) and hurtboxes (blue).

### Rook's moves

Hold a direction while pressing a button, like Smash.

| | On the ground | In the air |
|---|---|---|
| **Attack** | jab · up = anti-air swat · down = low sweep | nair spin · forward · back (strongest) · up · down = meteor spike |
| **Strong** | forward smash, his main kill move | same as Attack |
| **Special** | **Storm Draw** — lit-blade dash forward | same; once per jump |
| **Up + Special** | **Rising Storm** — his recovery, climbs high, then helpless until he lands or grabs the ledge | same |
| **Down + Special** | **Thunder Guard** — catch an attack and strike back harder | same |

On keyboard, `W` is both up and jump. Press `W` and an attack key together and
you get the up-move rather than a jump — Smash lets you cancel a jump's first
3 frames into an up-move, and so does this.

### Defense

- **Shield** — hold it. Blocks everything but wears down, and shrinks as it
  does. Let it run out and it breaks: you're stunned and wide open.
- **Spot dodge** — shield + down. **Roll** — shield + left/right.
- **Air dodge** — shield in the air. One per jump. Hold a direction to dash, but
  that leaves you helpless until you land.
- **Ledge** — falling past the stage edge grabs it automatically. Then press
  toward the stage to climb up, jump to leap up, or down to let go. Hang too long
  and you'll drop.

## How a match works

You don't have a health bar. Every hit raises your **damage percent**, and the
higher that number goes the further the next hit launches you. You lose a stock by
being knocked past the edge of the screen. Three stocks each, last one standing wins.

## Running the tests

```bash
cd ~/fighter
node --test test/*.test.js
```

95 tests, no installation needed, all run headlessly without a browser:
`combat` (the Ultimate formulas), `sim` (movement and physics), `moves` (every
attack connects once and launches the right way), `defense` (shield, dodges,
ledge) and `cpu` (the AI recovers, blocks, and can finish a whole match).

## How it's built

No build step, no `node_modules`, no installation. The browser loads the source
files directly. The one dependency is **Three.js** (3D graphics, MIT license) in
`vendor/three/`, committed to the repo so the game works offline.

| File                | Does                                                        |
| ------------------- | ----------------------------------------------------------- |
| `src/combat.js`     | Damage, knockback, hitstun, launch angle. Pure math.         |
| `src/characters.js` | Fighter stats and all 12 moves — tune the game here.         |
| `src/fighter.js`    | Movement, jumps, attacks, shield, ledge: the state machine.  |
| `src/match.js`      | One match: CPU, hitlag, stats, events for effects and sound. |
| `src/cpu.js`        | The CPU opponent.                                            |
| `src/camera.js`     | How the camera frames the fight.                             |
| `src/stage.js`      | Platform layout and blast zones.                             |
| `src/rook.js`       | Rook's costumes, and where every body part goes per pose.    |
| `src/render/`       | The 3D world: Rook, stage, sky, effects, lighting, glow.     |
| `src/ui/`           | Title, costume select, damage cards, GAME!, results.         |
| `src/app.js`        | The game loop and moving between screens.                    |
| `src/sound.js`      | Sound effects, generated in code.                            |
| `src/input.js`, `src/touch.js` | Keyboard, controller and touch, merged.           |
| `scripts/`          | Builds the double-clickable launcher apps.                   |

Gameplay (`combat`, `fighter`, `match`, `cpu`, `camera`, `stage`) never touches
the 3D code, which is why whole matches run in the tests without a browser, and
why the drawing could be swapped from 2D to 3D without changing how it plays.

**Graphics quality** picks itself: high on a laptop or Xbox, medium on a phone,
and it steps down automatically if frames run slow. Add `?quality=low` to the
address to force the lightest setting.

**Rook's 3D model** is built from shapes in code (`src/render/rook3d.js`). A
sculpted model, e.g. generated from the concept turnaround, can replace it later:
it only has to follow the same pose data from `rigPose()` in `src/rook.js`.

### The 2D version

The previous 2D version is saved as `v1-2d` in the project history. To go back
to it, ask Claude to "restore the 2D version", or run
`git checkout v1-2d -- .` in the project folder and publish.

The combat math follows Super Smash Bros. Ultimate's publicly documented formulas
(SmashWiki, Kurogane Hammer) so the game feels mechanically right. Game mechanics
aren't copyrightable — but Nintendo's characters, art, music and names are, so
this uses original fighters only.

## Not built yet

- **Grabs and throws**, a character select screen, more stages and fighters.
- Directional influence, stale moves, and rage — documented, deliberately left out.
