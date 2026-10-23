# Fighter

A Smash-style 2D fighting game that runs in a browser — so the same game works on
a laptop, an iPhone, and an Xbox without being rebuilt for each one.

## The fighter

**Rook Ashvane — "The Wandering Storm."** A drifter from the old highway towns,
born in a thunderstorm to a village swordsmith and a storm spirit. Straw hat, long
blade, short temper. Push him far enough and the blade's edge splits open to let
the storm out — which is why it only lights up when he attacks.

Both players are Rook; they're told apart by costume. P1 wears **Default**
(indigo / saffron / teal), P2 wears **Ember** (charcoal / red / gold). **Frost**
and **Moss** are defined in `src/rook.js` and can be swapped in by editing
`PLAYER_COSTUMES` in `src/characters.js`.

He's drawn in code rather than loaded as an image, so a costume is a three-colour
swap rather than a hue shift, and he stays sharp at any size on any screen. His
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
files directly. The only dependency is `vendor/phaser.min.js`, committed to the
repo so the game works offline.

| File                | Does                                                       |
| ------------------- | ---------------------------------------------------------- |
| `src/combat.js`     | Damage, knockback, hitstun, launch angle. Pure math.        |
| `src/characters.js` | Fighter stats and all 12 moves — tune the game here.        |
| `src/cpu.js`        | The CPU opponent.                                           |
| `src/rook.js`       | Rook's artwork, animation and the four costume palettes.   |
| `src/stage.js`      | Platform layout and blast zones.                            |
| `src/fighter.js`    | Movement, jumps, attacks, state machine.                    |
| `src/input.js`      | Keyboard and gamepad merged into one set of actions.        |
| `src/scenes/`       | Everything that draws to the screen.                        |
| `scripts/`          | Builds the double-clickable launcher apps.                  |

`combat.js`, `fighter.js` and `stage.js` have no Phaser dependency at all, which is
why a full match can be simulated in tests without a browser.

The combat math follows Super Smash Bros. Ultimate's publicly documented formulas
(SmashWiki, Kurogane Hammer) so the game feels mechanically right. Game mechanics
aren't copyrightable — but Nintendo's characters, art, music and names are, so
this uses original fighters only.

## Not built yet

- **Internet hosting.** It plays over your home wifi; it isn't on the web yet.
- **Grabs and throws**, a character select screen, more stages and fighters.
- Directional influence, stale moves, and rage — documented, deliberately left out.
