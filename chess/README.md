# Obsidian & Aurora — 3D Chess

A chess board on a sunlit marble terrace. Two armies — jet-black **Obsidian**
and ivory-and-gold **Aurora** — face off on a polished stone board, viewed
from a steep bird's-eye angle that keeps the game readable while staying
unmistakably three-dimensional. The opponent is a real search-based chess
engine running entirely in your browser (a Web Worker, no server involved),
and every capture on the board plays its own short scene: the attacking
piece's approach and the captured piece's demise are both keyed to *what*
they are, so a pawn taking a rook looks and feels different from the same
pawn taking a bishop.

**Play it:** https://asrijanga.github.io/solar-system/chess/

**Live-tested at:** desktop, iPhone-sized and small-phone viewports, both
portrait and landscape, both starting colors, and every attacker × captured
piece-type combination.

## Stack

Everything is static — there is no backend and nothing to host beyond the
built files. TypeScript, [Three.js](https://threejs.org),
[Vite](https://vitejs.dev), [chess.js](https://github.com/jhlywa/chess.js)
for rules/legality, and a hand-written **negamax + alpha-beta engine with
iterative deepening** for the opponent (not a scripted or random mover — it
actually searches the position tree, with MVV-LVA move ordering and
piece-square tables), running off the main thread in a Web Worker so the
scene never stutters while it thinks. No UI framework: the HUD, side-select
screen and modals are plain DOM, styled to match the 3D scene.

```
chess/frontend/src/
  engine/     chess.js + the search engine, and the Web Worker that runs it
  game/       game state, FEN parsing, input handling
  three/      scene, board, piece geometry, capture-animation system
  ui/         side-select, HUD, promotion/game-over modals
```

## Running it locally

```bash
cd chess/frontend
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run build     # writes frontend/dist — a fully static site
npm run preview   # serve that build locally
```

## Deployment

This game is deployed as part of the repository's GitHub Pages site: the
top-level `.github/workflows/deploy-pages.yml` builds `chess/frontend` and
publishes it under `/chess/` alongside the solar-system app at the repo
root, on every push to `main`. `vite.config.ts` sets `base: './'` so the
same build works unmodified whether it ends up at a site root or nested in
a subpath. To deploy the chess app on its own elsewhere, just run
`npm run build` and serve `frontend/dist` — no environment variables, no
API to point at.

## The engine

`engine/search.ts` runs iterative-deepening negamax with alpha-beta pruning
directly against a `chess.js` position, ordering moves by MVV-LVA (captures
first, biggest prize / cheapest attacker first) so pruning is effective even
at shallow depth. `engine/evaluate.ts` scores a position by material plus
classic piece-square tables. `engine/worker.ts` runs all of this on a
background thread; `engine/workerClient.ts` is the main-thread promise
wrapper the game talks to. Each of the three difficulties is a search-depth
/ time budget, not a different algorithm:

| Difficulty | Max depth | Time budget |
| --- | --- | --- |
| Squire | 2 ply | 450 ms |
| Knight | 3 ply | 1.1 s |
| Warlord | 4 ply | 2.4 s |

`engine/store.ts` + `engine/localApi.ts` hold the game session and drive the
turn sequence (validate the player's move, ask the worker for the engine's
reply, apply it) — this is the same shape a small REST API would have
(`createGame` / `submitMove` / `resignGame`), just called as local async
functions instead of `fetch`, so the rest of the app doesn't know or care
that there's no server behind it.

## The art direction

**Obsidian & Aurora**: low-poly, gem-faceted pieces (a 10-sided lathe revolve
with flat shading, so every face catches light distinctly instead of
smoothing into a blob) in two palettes — jet obsidian with a violet inner
glow, ivory aurora with a gold one — standing on a warm marble board with a
gilt frame, in daylight: a pale sky gradient, drifting clouds, soft dust
motes, and a sunlit stone floor beneath the board. Every piece type has its
own silhouette (`frontend/src/three/pieces/profiles.ts` and `factory.ts`):
rooks get a ring of crenellations, bishops a mitre slit and finial, knights
an actual extruded horse-head profile, queens a crown of spikes, kings a
cross.

The camera is a `PerspectiveCamera` locked to a steep, mostly-overhead
viewing direction (`frontend/src/three/fitView.ts` binary-searches the
minimum distance, along that fixed direction, that keeps the whole board on
screen for the current aspect ratio — recomputed on every resize/orientation
change) with `OrbitControls` clamped to a bird's-eye range: you can tilt and
spin the board, but never far enough to lose the top-down read or see under
it.

## The capture animation system

This is the part built specifically to satisfy "every capture should look
different." It's a small combinatorial system rather than 36 bespoke
animations:

- `three/animation/attackerMotion.ts` gives each of the 6 piece types its own
  **approach motion** — a pawn's stiff short lunge, a knight's spinning
  arc-leap, a bishop's leaning diagonal glide, a rook's rumbling straight
  charge, a queen's curved sweep, a king's hesitant single step.
- `three/animation/defenderDeath.ts` gives each of the 6 piece types its own
  **death sequence** — a pawn sinks and dissolves, a knight rears up and
  topples, a bishop shatters into radiating shards, a rook crumbles into
  rubble and sinks, a queen bursts into a particle explosion, a king falls in
  slow motion with a flash of light.
- `three/animation/moveAnimator.ts` composes the two: the attacker's motion
  and the defender's death play concurrently, timed so the "impact" (a
  per-attacker-type fraction of its motion) is what triggers the death, not
  the start of the move. A pawn capturing a rook and a pawn capturing a
  bishop therefore always look different (different death), and a pawn
  capturing a rook looks different from a queen capturing a rook (different
  approach) — every one of the 36 attacker × captured combinations is
  visually distinct.

Quiet (non-capturing) moves reuse the same attacker-motion functions with no
death sequence. Castling animates the king and rook simultaneously; en
passant resolves the captured square correctly (it isn't the destination
square); promotion plays a small scale-in flourish once the piece transforms.

## Controls

- **Tap/click** a piece, then a highlighted square, to move.
- **Drag** to orbit the board (within the bird's-eye range); **pinch/scroll**
  to zoom.
- Side-select screen chooses your army and the engine's difficulty; a
  "Let the battle begin" banner plays before the first move.

## Mobile

Pointer Events unify mouse and touch input for board taps. `touch-action`
is tuned per element (`none` on the canvas so a drag always orbits the
camera instead of scrolling the page; `manipulation` on buttons for snappy
taps). Layout uses `env(safe-area-inset-*)` for notches, shadows and
device-pixel-ratio cap back off on small screens
(`frontend/src/config.ts#IS_SMALL_SCREEN`), and the camera fit described
above means the whole board is always visible without scrolling, from a
small phone in portrait to a wide desktop monitor.
