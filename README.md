# Reef Tender

A programming game in the spirit of *The Farmer Was Replaced*. You don't tend the
reef — you write the program that does. Every unlock widens either the world or
**the language itself**: you buy your first `while` loop with kelp.

Written in a Python-like mini-language with a custom lexer, parser and
generator-based interpreter. The reef is a 3D sunset diorama in three.js: a
sandy island with the reef in a tide pool, a toy drone, palms and a dock. If
WebGL is unavailable it falls back to a flat 2D canvas view. Drag to orbit the
view and scroll or pinch to zoom.

**Play it:** https://hhemantpatel.github.io/reef-tender/ (no install, runs in the browser).

Progress saves in the browser automatically. The Lab tab can export the save to
a file, import one (checked before it is loaded), and reset. Every installed
upgrade has a "Load into editor" button for its example snippet.

Work on the game started in September 2026. It moved into this repository in
November 2026, so the earlier history here belongs to a different project.

## Commands

    npm test                # 51 tests: language + engine + save validation
    node test/balance.mjs   # throughput per tier + full playthrough timing
    npm run dev             # local dev server
    npm run build           # production build -> dist/

To play locally: `npm install && npm run dev`, then open the URL it prints.

## Layout

    src/lang/     lexer (indent-aware) -> parser (gates locked syntax) -> generator interpreter
    src/game/     world + growth + bleaching, the drone API, tech tree, session/save
    src/ui/       3D reef (reef3d.js), 2D fallback (render.js), code editor, DOM panels, app wiring
    src/docs/     the in-game Manual
    test/         node:test suites, reference solutions, balance harness

## Design notes worth keeping

- **The interpreter is generators all the way down.** Every statement yields
  before it runs; world actions yield again after. That one decision is what
  gives pause, step, speed control and the live line marker in the editor.
- **Locked syntax fails at parse time**, naming the unlock that grants it —
  never as a confusing runtime error.
- **`test/solutions.mjs` is load-bearing.** One reference solution per tier,
  written with only that tier's unlocks. It proves the mini-language can express
  each puzzle and is the yardstick `balance.mjs` measures.
- **Bleaching sickens a tile, it doesn't sterilise it.** Clearing the entity made
  the coral and shell puzzles unplayable the moment the Scrubber was unlocked.
- **Wild kelp stops once Seeding is bought**, or it fights whatever the player is
  trying to lay out at every later tier.
- **Run parks the drone at the origin.** Without it, a script that walks the grid
  by row index silently sorts an offset snake and can never finish.
- **Coral dieback is tuned so a tight sweep can just hold a full reef together.**
  Raise `CORAL_DIEBACK` and the bloom becomes unreachable; the balance harness
  is how you check.

## Balance

Full tech tree is reachable in ~104k ticks with the reference solutions.
Run `node test/balance.mjs` after touching any growth or payout constant.
