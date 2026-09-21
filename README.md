# Solar System Sim — MVP Plan & Iteration Loop

*2026-09-20 — mirrored from the project's [Claude artifact](https://claude.ai/artifact/D6Gs7dXDfWt5PZJXHYmhHK). The world-by-world data status lives in [`docs/world-catalogue.md`](docs/world-catalogue.md).*

## Direction

**Show what we know. Show where we haven't looked yet.**

That is the thesis, and it decides the hard cases. When accuracy and beauty conflict, accuracy wins and the beauty comes from what is actually there. When a dataset runs out, the tool says so rather than inventing a continuation. When something is uncertain, the uncertainty is visible.

It also sets the standard for the whole project, which is not "is this impressive" but "does this teach something true." Those usually agree. Where they do not, the second one wins.

Three things follow directly.

### The hovering constraint is where knowledge ends

Not landing, only hovering close, is the right boundary and it is not an engineering compromise. Global coverage for most worlds tops out between 100 and 500 metres per pixel. Hovering a few kilometres up needs roughly 10 to 50. Landing would need centimetres, which exists almost nowhere.

So the constraint sits exactly where human knowledge sits. You are building to the edge of what has been measured, and stopping there is the honest thing to do as well as the cheap one.

### Vertical exaggeration has to be visible

Real planetary terrain is far flatter than people expect. Olympus Mons is roughly 22 km tall across 600 km of base, a slope of about four percent. Rendered truthfully at a distance it looks like a gentle bulge, and most people find that disappointing.

Every educational tool exaggerates vertically. This one exaggerates and says so on screen, with a factor adjustable down to 1x. That turns a necessary distortion into a lesson about how flat planets really are, which is more interesting than either the lie or the bare truth.

### Gaps are the most valuable content in the project

This is the part that makes the whole thing worth doing rather than redundant.

Coverage across the solar system is wildly uneven, and almost nothing communicates that. Pluto's encounter hemisphere was imaged at around 300 metres per pixel while the far side got 13 to 27 kilometres, a factor of forty across one world, with everything below about 38 degrees south unlit during the flyby. Venus has 75-metre radar imagery over topography 60 times coarser: detailed pictures of a surface whose shape we barely know. Some hemispheres of the Uranian moons have never been photographed by anything.

Showing that honestly, with the mission and year attached, teaches something no amount of invented terrain could. It also makes the tool a living document: every future mission fills in a region, and the difference between the old and new state is itself the story of exploration.

By contrast, the usual approach fills unmapped regions with plausible invented landscape. That is the one thing this project will not do.

### Working in the open

If the point is letting other people learn, then the learning should be visible while it happens rather than only at the end.

That means devlogs as you go, the data pipeline public, and notes on what each dataset turned out to actually be like once you opened it. Those notes are genuinely scarce: the practical experience of wrangling planetary data is scattered across papers and mailing lists, and writing it down plainly is a contribution independent of whether the renderer ever ships.

It also happens to be what sustains long solo projects. A small number of people following along is more durable fuel than a launch.

### What data actually exists

Nearly everything is public domain and lives at NASA and USGS. The [Astropedia catalog](https://astrogeology.usgs.gov/search) is the main portal, with the Planetary Data System behind it. Figures below are global coverage; spot coverage is often far better.

| World | Best global topography | Best global imagery | The honest gap |
| --- | --- | --- | --- |
| Earth | Copernicus GLO-30, 30 m | Sentinel-2, sub-10 m | Ocean floor is mostly interpolated, not measured |
| Moon | [LOLA, 118 m](https://astrogeology.usgs.gov/search/details/Moon/LRO/LOLA/Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014/cub) | LRO WAC, 100 m | Permanently shadowed polar craters are unlit |
| Mars | [HRSC-MOLA blend, 200 m](https://astrogeology.usgs.gov/search/map/Mars/Topography/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp) | CTX, about 6 m | Best-mapped world after Earth and the Moon |
| Mercury | MESSENGER, about 665 m | [MDIS basemap, 166 m](https://astrogeology.usgs.gov/search/map/Mercury/Messenger/Global/Mercury_MESSENGER_MDIS_Basemap_LOI_Mosaic_Global_166m) | South polar region weaker than the north |
| Venus | [Magellan, 4,641 m](https://astrogeology.usgs.gov/search/map/venus_magellan_global_topography_4641m) | [Magellan SAR, 75 m](https://astrogeology.usgs.gov/search/map/venus_magellan_sar_fmap_left_look_global_mosaic_75m) | Radar, not optical; relief 60x coarser than imagery |
| Galilean moons | Sparse, local only | Galileo and Voyager, km-scale | Patchy 1980s and 1990s flyby coverage |
| Titan | Cassini RADAR, local patches | Obscured by haze | Surface visible only to radar and infrared |
| Enceladus | Cassini, encounter hemispheres | Cassini, good where covered | Coverage uneven by hemisphere |
| Pluto | Limited stereo, encounter side | [300 m near side, 13 to 27 km far side](https://arxiv.org/pdf/1510.07704) | Below about 38 degrees south was unlit |
| Uranus and Neptune moons | Essentially none | Voyager 2, 1986 and 1989 | Some hemispheres have never been imaged |
| Gas and ice giants | No surface exists | Cloud tops only | A different rendering problem entirely |

Two consequences worth planning around now.

The gas giants are not a later story in the same pipeline. They have no terrain, and rendering banded volumetric cloud tops shares almost no code with a displaced sphere. Treat them as a separate system, scheduled separately, and do not let the terrain work pretend it will eventually cover them.

The data volume is a project in its own right. Full-resolution Mars CTX is measured in terabytes. You will preprocess each source into your own tile pyramid, host it on object storage, and stream it to the browser. Budget real time for that pipeline, and prefer a host where egress is free, because egress is what makes this expensive rather than storage.

Every body worth rendering, sorted into four tiers by how much data exists, is catalogued in [World catalogue](docs/world-catalogue.md). Every row carries a status, so that file is the single answer to which worlds are supported. Tier 1 and Tier 2 together are twenty-five bodies and a realistic multi-year target.

## Vision and principles

When this is done, someone should come away feeling how large the solar system is, how detailed each world is, and curious enough to go read something. Detail and physics are the means. Those goals usually agree with accuracy, and where they do not, the Direction section decides: truth wins, and the feeling has to come from what is actually there.

### What "from the ground up" should mean

The Apple comparison is a good instinct and a dangerous one taken literally. Apple does not build everything. They run on an instruction set they licensed, a Unix kernel they inherited, a browser engine forked from KHTML, a compiler toolchain from LLVM, and chips fabricated by TSMC. What they actually do is pick a small number of layers to own completely and refuse to own the rest.

For a solo project over years, that discipline is the difference between shipping and not. Owning too much is the most common way ambitious solo projects die, and it usually feels like virtue while it is happening.

| Layer | Decision | Why |
| --- | --- | --- |
| Game engine | Adopt Bevy | Writing an engine is a different multi-year project wearing this one's clothes |
| Renderer core | Adopt wgpu via Bevy | Cross-platform GPU abstraction is solved and thankless |
| Ephemerides | Adopt SPICE kernels | JPL's measured data beats anything you would integrate yourself |
| Raster reprojection | Adopt GDAL | Decades of map-projection edge cases you do not want to rediscover |
| Tile format | Adopt an existing standard | Interop with the planetary data world is worth more than a bespoke format |
| Terrain LOD and streaming | Build | Nothing off-the-shelf fits Bevy plus browser; this is the technical core |
| Camera and scale handling | Build | How movement feels across fifteen orders of magnitude is the experience |
| Lighting and exposure | Build | Correct radiometry from Mercury to Neptune is unusual and is your differentiator |
| Per-world data pipeline | Build | Repeatable, scripted, and reused twenty times |
| Art direction and interface | Build | Nobody can give you this |

One detail matters for the browser target: `spicekit` is a pure-Rust reader for SPICE kernel formats with no CSpice linkage and no FFI. The C toolkit does not cross to wasm easily, so a pure-Rust reader is what makes accurate ephemerides possible in a browser at all.

### What "physics" means here

Worth scoping carefully, because the intuitive answer is wrong in a useful way.

**Optics and radiometry matter most.** Correct solar intensity falling off with distance, correct exposure, a physically-grounded terminator, accurate shadow geometry. This is what makes a render feel real rather than rendered, and it is where the years of study pay off most visibly.

**Geometry matters and is mostly adopted.** Positions, rotation, axial tilt, precession, libration, eclipse alignment. SPICE gives you all of it at professional accuracy.

**Dynamics matter least, which is counterintuitive.** For a science tool you do not simulate gravity, you replay measured reality. Any n-body integrator you write will be less accurate than the JPL ephemerides it is trying to reproduce. Simulated dynamics earn their place only as explicit educational toggles, where showing why something orbits is the point rather than where it is.

**Atmospheric radiative transfer is the one genuinely hard simulation** you will want, and only for Earth, Mars, Titan, and Venus.

### One world at a time

There is no continuous flight between worlds. You pick a world and arrive there. Each world is a self-contained scene, loaded on entry and discarded on exit.

This is a better trade than it first appears, because the two transitions are not equally valuable. Whole-planet down to a single crater is the one that produces the feeling. Crossing interplanetary space is mostly waiting, and rendered honestly it is empty in a way that reads as boring rather than vast. Cutting the second while keeping the first keeps almost all of the emotional payload for a fraction of the work.

What it costs is system-scale awe, which has to be carried somewhere else. Three places to put it:

- **The selector itself.** If choosing a world happens on an honest true-scale diagram, with distances and light-travel times shown, the selection screen teaches the thing the flight would have.
- **Comparison.** Ganymede beside our Moon at the same scale says more about the outer system than an hour of travel would.
- **Within a world.** Continuity from orbit down to hovering stays, and that is where scale actually lands. Olympus Mons only becomes real when the horizon curves away beneath you.

### What this buys technically

More than the earlier simplifications, and it is worth being explicit because it changes the risk profile of the whole project.

- **Floating origin becomes unnecessary again.** Each world is its own scene in its own local frame, with the planet's radius as the working unit. Fifteen orders of magnitude were only needed for the flight you just cut.
- **One world resident at a time.** Loading on entry and discarding on exit makes the browser memory ceiling far more tractable, since the budget covers one body rather than a solar system.
- **Loading becomes legitimate.** World selection is a natural place for a progress indicator, so you can stream what you need without pretending everything is seamless.
- **Worlds become independently shippable.** Each is a data manifest plus a scene, testable alone and releasable alone. That maps exactly onto one world per release.

The last point is the most valuable. It turns an open-ended detail project into a queue of finite, similar units of work, which is the shape a multi-year effort needs to stay finishable.

### A world is never alone

One world at a time does not mean one object in the scene. Standing at the Moon without Earth in the sky would be wrong in a way people feel immediately, and for the outer moons the neighbour is the whole point of being there.

Each world's scene therefore carries a list of context bodies: nearby significant objects rendered in the background at their real positions, sizes, and phases.

The good news is that this is cheap. A context body needs no terrain, no level of detail, and no streaming, because it is far away and subtends a fixed angle. One low-resolution textured sphere, positioned correctly and lit by the same sun, is the entire implementation. It costs almost nothing against the main world's budget.

Apparent sizes, computed from mean orbital distances and rounded, with our own Moon's half-degree as the yardstick:

| Standing at | Dominant neighbour | Apparent diameter | Versus our Moon |
| --- | --- | --- | --- |
| Phobos | Mars | about 40° | about 76x |
| Enceladus | Saturn | about 28° | about 53x |
| Io | Jupiter | about 19° | about 36x |
| Europa | Jupiter | about 12° | about 23x |
| Ganymede | Jupiter | about 7.5° | about 14x |
| Charon | Pluto | about 7° | about 13x |
| Titan | Saturn | about 5.5° | about 11x |
| The Moon | Earth | about 1.9° | about 3.7x |

Those numbers are the goosebumps. Jupiter from Io fills a fifth of the sky, and Mars from Phobos fills nearly half of it. No amount of terrain detail produces that reaction; correct geometry does it for free.

### What correctness gives you here

Positioning context bodies is exactly what SPICE is for, so the earlier decision to adopt it pays off a second time. Resolving where Earth sits as seen from a point above the Moon at a given epoch is a single query.

Three things fall out of doing it properly, and each is worth more than a paragraph of explanatory text:

- **Phases are complementary.** Light the context body with the same sun and Earth shows a phase opposite to the Moon's as seen from home. Full Moon means new Earth. Nobody expects this and everybody likes it.
- **Earth does not move in the lunar sky.** Tidal locking holds it near a fixed point, wobbling a few degrees with libration, never rising and never setting. From the far side it is simply never there. That is a whole lesson delivered by geometry alone.
- **Eclipses happen on their own.** A moon passing into its parent's shadow is dramatic, real, and requires no special code once positions and lighting are correct.

One rule keeps the body list from growing without limit: render a neighbour as a sphere when its apparent diameter is large enough to resolve, and leave everything smaller to the star catalogue as a bright point. Mars seen from Jupiter is a dot, and treating it as one is both cheaper and more truthful.

## The orbital view

A user-placed station in a configurable orbit, watched in third person, is the strongest single idea in this plan. It supplies the verb the project was missing. Everything else is looking; this is doing, and it is doing something that teaches the least intuitive subject in the whole domain.

It also fits the per-world architecture exactly. A station orbits one body, which is already the scope of a scene.

### This reverses the earlier advice on dynamics

The principles section says dynamics matter least, because measured ephemerides beat anything you would integrate. That is right for planets and wrong for this.

A station the user placed has no ephemeris. Nobody measured it. Its motion has to be simulated, and that makes this the one place where real orbital mechanics genuinely earns its keep rather than duplicating better data.

What that actually requires is less than it sounds:

- **Two-body Keplerian propagation** is enough for the viewing experience. Analytic, stable over arbitrary time, cheap, and exactly scrubbable forwards and backwards, which a numerical integrator is not.
- **Impulsive burns** rather than continuous thrust. Apply an instantaneous velocity change, recompute the orbital elements, carry on propagating. This is how real mission planning works and it avoids needing an integrator at all.
- **J2 oblateness** is the one perturbation worth adding later. It causes orbital planes to precess, which is why sun-synchronous orbits exist, and it is a genuinely beautiful thing to let someone discover.
- **Atmospheric drag** only matters for low orbits at Earth, Mars, Venus, and Titan, and only if you want decay to be visible.

Continuous-thrust integration is the thing to avoid. It costs numerical stability, breaks time scrubbing, and buys almost nothing a burn model does not already give you.

### Why the Apple TV shots work

Worth copying deliberately rather than by feel, because the ingredients are specific.

The station structure sits in frame the whole time. It is not decoration; it is the scale reference that makes the planet read as enormous. This is the same principle as putting a known object beside an unknown one, and it is why those shots feel vast where a bare planet does not.

The motion is slow and continuous, the terminator slides past rather than sitting still, and the night side carries its own detail. Cutting, fast motion, and interface chrome all destroy the effect.

So build a cinematic mode as a real mode: no interface, slow camera arm, long uninterrupted takes. It is close to free once the orbit propagates, and it is the thing people will leave running.

### Keep the first version to two controls

Six orbital elements is too many for anyone meeting orbits for the first time, and a six-slider panel will read as an engineering tool rather than an invitation.

Start with altitude and inclination. Two sliders produce every view worth seeing, from a low fast equatorial pass to a slow polar orbit crossing the terminator each time around. Eccentricity, argument of periapsis, and the rest can arrive with the thruster work, where changing them is the point.

The third-person camera needs one early decision: whether it holds steady relative to the station or relative to the planet below. The first reads as a spacecraft, the second as a flyover. Both are worth having, and they feel completely different.

### The design mini-game is a separate project

Building a station from parts is a construction game. That is a different genre with its own physics, its own interface problems, and its own years of work, and it is the part of this plan most likely to quietly consume everything else.

Schedule it the way the gas giants are scheduled: as its own project, started only once the orbital view is finished and people are actually using it. A single well-modelled station is enough for a long time.

### Sequencing by what you want to learn

The project is explicitly a vehicle for learning Rust, graphics, and physics. That makes "what do I want to understand next" a legitimate way to order the backlog, alongside product logic.

Use it deliberately rather than accidentally. A story pulled forward because it teaches you something is a good decision; a story pulled forward because it is more fun than the one you are avoiding is how the middle of a project rots.

## Scope

The MVP is the Moon as a real sphere, wrapped in real LRO imagery, lit by a real sun angle, that you can rotate and look at. No elevation yet, no other worlds, no solar system. Nobody sees it but you.

The Moon should be the first world, not Earth. Its data is uniform, global, and excellent, and it has no atmosphere, no ocean, no clouds, no weather, no vegetation, and no seasons. Earth needs four additional rendering systems before it looks right at all, and every one of them is a place to get stuck. The Moon looks correct the moment the texture loads, and everybody recognises it instantly.

Mars is the natural second world, since its data is nearly as good and its terrain is far more dramatic.

Worlds are reproduced, never invented. Where data does not exist, the tool shows that it does not exist rather than filling the gap with plausible-looking noise.

In scope for Release 1:

- A Bevy app running natively and in a browser tab
- A starfield backdrop
- The Moon as a sphere with a real LRO WAC mosaic, downsampled to fit the budget
- Correct sun direction producing a real terminator
- Drag to rotate, scroll to zoom, no closer than a distant orbital view

Not in Release 1:

- Elevation, displacement, or any terrain relief
- Level of detail, tile streaming, or hovering close
- Any other world
- Orbits, time controls, or the solar system
- Labels, UI, or educational text
- Public deployment

Nothing is published until you say so. The pipeline still deploys to a private link only you can open.

Release 1 deliberately ships a sphere with no relief. That sounds like a cop-out and is not. It proves the data path end to end, from a NASA archive to a pixel in a browser, which is the part of this project most likely to surprise you. Displacement is the next release and is comparatively easy once that path exists.

## Decisions to lock before code

These seven are expensive to reverse once there is a codebase. Everything else can be decided later by writing code and seeing what happens.

| Decision | Choice | Why it can't wait |
| --- | --- | --- |
| Render backend | WebGPU only, no WebGL2 fallback | WebGL2 has no compute shaders; supporting it means writing terrain generation twice |
| Coordinate system | Per-world local frame, planet radius as the unit | No flight between worlds means no floating origin; one scene at a time keeps precision local |
| Crate layout | Simulation, terrain, and atmosphere as Bevy-free crates | Bevy ships breaking releases every 3-4 months; isolation keeps migrations to a glue layer |
| Asset delivery | Your own tile pyramid on object storage, streamed | Source archives are terabytes; nothing usable can be bundled with the app |
| Data provenance | Source, mission, and resolution recorded per tile | An education tool has to cite itself, and SS-14 is impossible to retrofit without it |
| Memory budget | One world resident at a time, discarded on exit | Budgeting for a single body rather than a system is what keeps the browser ceiling reachable |
| Preprocessing | Scripted from the first world, never manual | You will run it for twenty worlds; manual steps make each one cost the same as the first |

Two of these deserve a note.

The WebGPU-only call costs you users on old browsers and buys you the entire compute-shader half of the project. Gate unsupported browsers with a clear upgrade message rather than a degraded experience.

The Bevy-free crate boundary is the one that pays off most over years. Under this direction it holds your world generation rather than orbital mechanics, which lets you iterate on generated worlds without launching the app.

Two rows read differently than you might expect. There is no floating origin, because one world at a time keeps precision local, and no quality-tier row, because tiers are a Release 3 concern that arrives with streaming rather than a decision to lock now.

## Release 1 backlog — a frame with a sun

Five stories. You are the only user of all five, which is exactly right for a first release and worth stating plainly rather than inventing a visitor who does not exist yet.

**Definition of done, applied to every story:** committed to git, still builds for both native and web, and you can see the result with your own eyes. Nothing is public.

IDs are renumbered here because the release was rescoped before any work started. From this point they freeze, and later changes get suffixes instead.

### SS-1 · A window opens

As the developer, I want a Bevy app that opens a window with a colour I chose, so that I know my toolchain works before anything else is at stake.

- [ ] `cargo run` opens a window
- [ ] Background is a solid non-default colour
- [ ] Closing the window exits cleanly

New to you here: installing Rust with rustup, `cargo new`, adding Bevy to `Cargo.toml`. The first compile takes several minutes and pulls in hundreds of crates. That is normal and only happens once.

Estimate: 2 to 5 hours, most of it installation and waiting.

### SS-2 · The same window in a browser

As the developer, I want that app running in a local browser tab, so that I have proven the wasm path before building anything on top of it.

- [ ] `wasm32-unknown-unknown` target installed
- [ ] App builds for wasm and serves locally
- [ ] Same colour renders in a browser tab
- [ ] Browser console shows no errors

New to you here: compile targets, `trunk serve` as the simplest dev server, and the idea that the browser is running a compiled binary rather than JavaScript. If this breaks, it breaks here while the app is one colour, which is the entire point of doing it now.

Estimate: 3 to 8 hours.

### SS-3 · A camera pointed at nothing

As the developer, I want a 3D camera in an empty scene, so that I have a place to put things and can tell the difference between 2D and 3D.

- [ ] A 3D camera exists at a known position looking at the origin
- [ ] A single test cube at the origin renders and is visibly three-dimensional
- [ ] Works identically native and in the browser

The cube is scaffolding and gets deleted in SS-5. Put it there anyway. Debugging an empty black screen with no reference object is miserable, and you cannot tell an empty scene from a broken camera.

New to you here: Bevy's ECS. Entities are ids, components are data attached to them, systems are functions that run over them. Slow down here. Everything later is built from this one idea.

Estimate: 4 to 10 hours, nearly all of it learning ECS.

### SS-4 · Stars behind everything

As the developer, I want a starfield background, so that the scene reads as space and a lit sphere has something to sit against.

- [ ] Stars visible in all directions
- [ ] Backdrop does not move or distort as the camera turns
- [ ] Star positions from a real catalogue, not random
- [ ] Background is true black, since space is

Use real star positions. The Yale Bright Star Catalogue is small, public domain, and covers everything visible to the naked eye. Real constellations cost no more than random dots and are the first moment the tool teaches something.

Estimate: 5 to 12 hours.

### SS-5 · The Moon, for real

As the developer, I want the Moon rendered as a sphere with real LRO imagery and a correct sun angle, so that the entire data path is proven from NASA archive to browser pixel.

- [ ] LRO WAC mosaic downloaded from the USGS archive and reprojected
- [ ] Downsampled to an equirectangular texture under 6 MB
- [ ] Mapped onto a sphere with correct orientation and no seam at the poles
- [ ] Directional light producing a visibly correct terminator
- [ ] Drag rotates, scroll zooms, within fixed limits
- [ ] Recognisable at a glance as the actual Moon, with the maria in the right places
- [ ] Processing steps written down as a repeatable script, not done by hand

That last criterion is the one that matters most and the one most likely to be skipped. You will repeat this process for every world in the solar system. If the first one is a sequence of manual steps in an image editor, the second one costs the same as the first. If it is a script, the twentieth is nearly free.

New to you here: the actual work is data wrangling rather than graphics. GDAL is the standard tool for reprojecting planetary rasters and will do most of it. Equirectangular projection distorts badly at the poles, which you will see immediately on a sphere.

Estimate: 12 to 25 hours, and most of it is not Rust. This is the largest story in the release by a wide margin, and that is the honest shape of this project.

When SS-5 passes, Release 1 is done. You will have a real Moon you can spin, built from real archive data by a script you can re-run. That is a genuinely strong foundation, and it is the moment you will know whether the data pipeline is going to be pleasant or awful.

## Estimates and cadence

Release 1 is about 41 hours of work, plausibly 26 to 60. At eight hours a week that is five weeks. SS-5 is worth two weeks on its own, so the one-week cadence holds for the first four stories and then bends once, deliberately.

*(the 13-story breakdown behind this estimate was worked out in the planning conversation attached to the source doc)*

These assume you are learning Rust as you go. More than half the hours in SS-1 to SS-3 are reading and confusion rather than typing. That ratio starts to flip around SS-4, once the language stops fighting you over every line.

### What the calendar looks like

| Hours a week | Release 1 ships in |
| --- | --- |
| 5, weeknights only | about 8 weeks |
| 8, weeknights plus a weekend morning | about 5 weeks |
| 15, a serious hobby | about 3 weeks |

Pick the row that matches the life you actually have, not the one you want. The plan survives a slow pace far better than it survives a pace you abandon.

### Use the week as a timebox, not an estimate

Fix the cadence at one week per story and let scope flex instead of time:

- If a story is done early, commit it and start the next one. Do not spend the remaining days polishing.
- If a week ends and it is not done, do not extend. Cut acceptance criteria until what remains is done, then put the rest in a new story.
- If you have cut twice and it is still not done, the story was too big. Split it and suffix the leftover as SS-3b.

Fixed time with flexible scope is what stops a one-month release becoming a one-year one. Fixed scope with flexible time is how most solo projects quietly die.

Two stories are likely to overrun. SS-3 is where Rust's ownership model stops being abstract and Bevy's ECS has to actually make sense to you. SS-5 is a data-wrangling problem in disguise, and reprojecting planetary rasters is fiddly work in tools you have not met yet. If either takes triple the estimate, that is normal and not a signal the plan is wrong.

## Later releases

Sketched, not specified. Write real acceptance criteria for a story only when it is next, because Release 1 will change what these should say.

| ID | Story | Release |
| --- | --- | --- |
| SS-6 | As the developer, I want the app on a private link only I can open, so that shipping is routine before anything is public | 2 |
| SS-7 | As a learner, I want the Moon to have real relief, so that craters and mountains read as three-dimensional | 2 |
| SS-8 | As a learner, I want a visible vertical exaggeration control, so that I understand how flat worlds really are | 2 |
| SS-9 | As a learner, I want to zoom in and have detail sharpen, so that I can study one crater closely | 3 |
| SS-10 | As a learner, I want to descend to a few kilometres and hover, so that I feel the scale of the terrain | 3 |
| SS-11 | As a learner, I want it to run smoothly on my own machine, so that I can actually use it — first public release | 3 |
| SS-12 | As a learner, I want to choose a world from a true-scale map showing real distances, so that I grasp the layout before I arrive | 4 |
| SS-13 | As a learner, I want Mars at the same fidelity as the Moon, so that I can compare two worlds | 4 |
| SS-14 | As a learner, I want named features labelled, so that I know what I am looking at | 4 |
| SS-15 | As a learner, I want to see where the data is poor and which mission produced it, so that I understand the limits of what we know | 5 |
| SS-16 | As a learner, I want worlds shown side by side at true relative size, so that I feel how they compare | 5 |
| SS-17 | As a learner, I want Mercury, so that a third rocky world is covered | 5 |
| SS-18 | As a learner, I want Venus as radar imagery over coarse relief, so that its strangeness is visible | 6 |
| SS-19 | As a learner, I want Earth with atmosphere, ocean, and clouds, so that home is included | 6 |
| SS-20 | As a learner, I want the major moons, so that the outer system is represented | 7 |
| SS-21 | As a learner, I want the gas giants as cloud tops, so that nothing is missing — a separate renderer | 8 |
| SS-22 | As a learner, I want to place a station at a chosen altitude and inclination and watch it orbit, so that I see a world the way astronauts do | 4 |
| SS-23 | As a learner, I want a cinematic mode with no interface and a slow camera, so that I can leave it running | 4 |
| SS-24 | As a learner, I want thrusters that change my orbit, so that I can feel how orbital mechanics actually behaves | 5 |
| SS-25 | As a player, I want to design my own station from parts, so that the thing in orbit is mine | Separate |

SS-9 and SS-10 are the architecturally heavy pair and the real technical risk of the project. Quadtree level of detail, tile streaming, eviction, and quality tiers all arrive together in Release 3. Everything before them is comparatively gentle, and everything after them is repetition of a solved pattern.

SS-12 is where world selection arrives, and it should land with the second world rather than before it. A selector with one entry is not a selector. Design it as the place that carries system-scale context, since nothing else in the experience will.

SS-15 deserves to be a headline feature rather than a footnote. A coverage overlay showing resolution per region with the mission and year behind it is the clearest differentiator this project has against everything already out there.

SS-21 shares only the camera with the rest. Schedule it as its own project rather than one more world in the queue.

From SS-13 onward each world is roughly the same shape of work: acquire, reproject, tile, verify, ship. The pipeline built for the Moon and proven on Mars is what makes the remaining worlds finite rather than endless.

SS-22 and SS-23 are the strongest candidates for pulling forward. They need a lit sphere and an orbit propagator, not terrain, so they would work on the plain Moon from Release 2. If motivation ever flags during the heavy Release 3 work, this is the pair to reach for, and doing so is a deliberate use of the learning-led sequencing principle rather than a detour.

## What you need to learn

Learn each concept just ahead of the story that needs it. A curriculum read front to back before writing code is a way of not starting, and most of this only makes sense once you have hit the problem it solves.

The depth column is the honest one. Not everything here needs deep understanding; some of it you adopt, trust, and move past. Knowing which is which is what keeps a multi-year project moving.

### Physics and astronomy

| Concept | Why this project needs it | First needed | Depth |
| --- | --- | --- | --- |
| Solar irradiance and inverse-square falloff | Sunlight at Neptune is about 1/900 of Earth's; getting this wrong makes every outer world look fake | SS-5 | Deep |
| Radiometric vs photometric units | Radiance, irradiance, luminance and lux are constantly confused, and the confusion shows up as unfixable lighting bugs | SS-5 | Deep |
| Exposure and tonemapping | A scene spanning sunlit rock to shadowed crater exceeds any display; how you compress that is an authored choice | SS-5 | Deep |
| Phase angle and albedo | Geometric vs Bond albedo, and why a full Moon looks flat rather than limb-darkened | SS-5 | Medium |
| Non-Lambertian surface scattering | Regolith exhibits an opposition surge that Lambertian shading cannot produce; Hapke or Oren-Nayar is what makes the Moon look right | SS-7 | Deep |
| Reference surfaces and vertical datums | Mars elevations are relative to an areoid, the Moon's to a mean radius; getting this wrong shifts everything | SS-7 | Deep |
| Planetocentric vs planetographic latitude | Two different definitions, both in common use, silently incompatible | SS-7 | Medium |
| Longitude conventions | East vs west positive differs by body and by era of dataset; the classic cause of mirrored maps | SS-7 | Shallow |
| Map projections and distortion | Equirectangular, polar stereographic, sinusoidal; each source arrives in one and needs another | SS-7 | Medium |
| Time systems | UTC, TAI, TT, TDB, ephemeris time, leap seconds, Julian dates; SPICE will force this on you | SS-12 | Medium |
| Reference frames | Inertial vs body-fixed, J2000 and ICRF, ecliptic vs equatorial | SS-12 | Medium |
| Rotation and orientation | Sidereal vs solar day, obliquity, precession, nutation, libration | SS-12 | Medium |
| Orbital elements | The six elements, and what each one does to the shape and orientation of an orbit | SS-22 | Deep |
| Kepler's equation | Mean to eccentric to true anomaly, solved by Newton iteration; the core of any propagator | SS-22 | Deep |
| Vis-viva and the two-body problem | Relates speed to position and orbit size; the sanity check for everything else | SS-22 | Deep |
| Eclipse and occultation geometry | Umbra and penumbra; a moon entering its parent's shadow | SS-22 | Medium |
| Impulsive delta-v | How prograde, retrograde, normal and radial burns each change specific elements | SS-24 | Deep |
| J2 oblateness perturbation | Causes nodal precession, which is why sun-synchronous orbits exist | SS-24 | Medium |
| Atmospheric drag | Orbital decay in low orbits at Earth, Mars, Venus and Titan | SS-24 | Shallow |
| Atmospheric scattering | Rayleigh and Mie, optical depth, transmittance, single vs multiple scattering | SS-19 | Deep |

The first four rows carry more weight than their position suggests. Radiometry and exposure are what separate a render that looks real from one that looks like a video game, and they arrive in Release 1. Study them properly before SS-5 rather than tuning numbers until something looks acceptable.

The non-Lambertian row is the single best detail-versus-everyone-else opportunity in the list. Almost no hobby renderer models regolith scattering, and the difference is immediately visible at full phase.

### Graphics, engine, and systems

| Concept | Why this project needs it | First needed | Depth |
| --- | --- | --- | --- |
| Rust ownership, borrowing, lifetimes | The wall every beginner hits; nothing proceeds until it clicks | SS-1 | Deep |
| Traits, generics, error handling | Idiomatic Rust structure; `Result` and `?` everywhere | SS-1 | Deep |
| Cargo workspaces and features | Bevy-free crates, conditional compilation for wasm | SS-2 | Medium |
| ECS: entities, components, systems | Bevy's whole model; the mental shift from object-oriented thinking | SS-3 | Deep |
| Schedules, ordering, change detection | Controlling when systems run and reacting only to what changed | SS-3 | Medium |
| Transform matrices and projection | View and projection matrices, homogeneous coordinates | SS-3 | Medium |
| Meshes, materials, texture sampling | Mipmapping and anisotropic filtering; visible immediately on a sphere | SS-5 | Medium |
| Sphere parameterisation | UV spheres seam and pinch at poles; cube-spheres distort differently | SS-5 | Medium |
| HDR pipeline and bloom | Rendering beyond display range, then compressing it | SS-5 | Medium |
| Physically based rendering | BRDF, energy conservation, and where PBR's assumptions break for regolith | SS-7 | Deep |
| Heightmap to geometry | Displacement, and computing correct normals from elevation data | SS-7 | Deep |
| Depth buffer precision | Reverse-Z or logarithmic depth; naive depth fails badly at planetary scale | SS-9 | Deep |
| Cube-sphere quadtree LOD | The core terrain structure; splitting and merging by screen-space error | SS-9 | Deep |
| Seam and crack prevention | Skirts or stitching between adjacent LOD levels | SS-9 | Deep |
| Geomorphing | Blending LOD transitions so detail does not visibly pop | SS-9 | Medium |
| Frustum and horizon culling | Never draw the half of the planet behind you | SS-9 | Medium |
| Async streaming without hitches | Loading and uploading tiles off the critical path | SS-9 | Deep |
| LRU eviction against a byte budget | The only memory control you get in a browser | SS-9 | Deep |
| Camera-relative rendering | f64 on the CPU, f32 on the GPU, origin near the camera | SS-10 | Deep |
| WGSL and compute shaders | Shader authoring, and GPU-side generation work | SS-10 | Deep |
| GPU memory and bind groups | Buffers, textures, formats, and what actually costs memory | SS-11 | Medium |
| Texture compression | BC, ASTC, and KTX2 with Basis transcoding per adapter | SS-11 | Medium |
| WebGPU limits and capability probing | Querying the adapter instead of sniffing user agents | SS-11 | Medium |
| Frame pacing and percentile timing | p95 and p99; means hide the stutter that people actually feel | SS-11 | Medium |
| GDAL and raster reprojection | Resampling choice matters: nearest for categorical, cubic for elevation | SS-5 | Deep |
| Tile pyramids and tiling schemes | WMTS and slippy-map conventions, and Cloud Optimized GeoTIFF | SS-9 | Medium |
| HTTP range requests and caching | Fetching part of a large file; cache headers and CDN behaviour | SS-9 | Medium |
| Browser storage and isolation | OPFS for tile caching, COOP and COEP for threads | SS-9 | Shallow |
| SPICE kernels | SPK, PCK, and text kernels; what each provides | SS-12 | Medium |

Rust concurrency deserves a note of its own. `Send`, `Sync`, `Arc`, channels, and async all arrive at SS-9 together, because that is where background tile work starts. That is a hard place to meet them for the first time, so it is worth reading ahead during Release 2 while the pressure is low.

The five Deep rows clustered at SS-9 are why Release 3 is the technical risk of this project. They interlock, they are hard to learn in isolation, and none of them can be half-done.

### Validating that any of it is right

An accuracy project needs external ground truth, because plausible and correct look identical on screen. Every one of these has an independent check available, and building the check is usually faster than debugging without it.

| Claim | How you prove it |
| --- | --- |
| Positions are correct | Query JPL Horizons for the same body and epoch, compare numerically, assert in CI |
| The map is not mirrored | Pick a known asymmetric feature and verify its longitude sign against published coordinates |
| Elevations are correct | Check known values: Olympus Mons height, Valles Marineris depth, specific crater rims |
| Terrain is correctly placed | Overlay named-feature coordinates from IAU nomenclature and see if they land on the right landforms |
| Lighting is correct | Reproduce a real spacecraft photograph: same body, same epoch, same viewing geometry, compare side by side |
| Scale is correct | Compute apparent angular diameters and check against published values |
| Orbits behave correctly | Assert conserved quantities, check that a circular orbit stays circular over many periods |
| Performance has not regressed | Fixed viewpoints, 300 frames, p95 frame time against a stored baseline |
| Visuals have not regressed | Perceptual image diff against stored captures, with tolerance for driver variation |

Reproducing a real photograph is the most valuable check in the list and the most satisfying. Apollo surface photography and LRO imagery both come with precise timestamps and geometry. When your render matches one of those, the radiometry, the ephemeris, the orientation, and the surface model are all simultaneously confirmed. When it does not match, the way it differs usually tells you which one is wrong.

### What this means for working with agents

What you can safely delegate is bounded by what you can verify, and not at all by what an agent can produce. That bound is the real reason the tables above are not optional.

The practical split:

- **Safe to delegate early.** Mechanical work with an obvious correct answer: reprojection scripts, tile pyramid generation, CI configuration, glue code, test harnesses, the screenshot capture tooling itself.
- **Delegate only once you understand it.** Anything where wrong output still looks reasonable: shading models, LOD error metrics, orbital propagation, coordinate conversions. An agent will produce confident, plausible, subtly incorrect code in every one of these, and subtle incorrectness is the failure mode this project cannot absorb.
- **Do not delegate at all.** The decisions: what a world should feel like, where exaggeration is honest, which detail earns its cost. Those are the project.

The sequencing that follows is worth stating plainly. Build the validation harness before you lean on agents heavily, not after. A check that runs in CI converts agent output from something you have to read carefully into something you can test, which is what makes the speed actually usable rather than a source of debt.

One caution specific to this domain. Planetary data conventions are exactly the kind of thing that is sparsely represented in training data and confidently guessed at: longitude sign, latitude definition, vertical datum, projection parameters. Check those against the dataset's own documentation every time, whoever wrote the code.

## Budgets and instrumentation

Pick the numbers now and treat them as requirements, not aspirations. A budget discovered at SS-11 is a rewrite; a budget enforced from SS-5 is a constraint you design within.

| Budget | Desktop tier | Mobile tier | Enforced by |
| --- | --- | --- | --- |
| Frame time (p95) | 16.7 ms | 33.3 ms | Dynamic render scale controller |
| Resident tile cache | 512 MB | 96 MB | Your own LRU accounting |
| Total wasm linear memory | 1.5 GB | 256 MB | Allocation tracking, logged on crossing |
| Wasm binary, compressed | 8 MB | 8 MB | CI gate on the release artifact |
| Time to first frame | 3 s | 5 s | Synthetic load test in CI |
| Time to interactive orbit view | 6 s | 10 s | Synthetic load test in CI |

The mobile numbers are deliberately harsh. iOS Safari tabs are killed by the system somewhere in the low hundreds of megabytes, and the failure is a silent white screen with no error you can catch. Budget well under the cliff rather than near it.

Instrument four things from SS-7 onward, because adding telemetry later means you have no baseline to compare against:

1. **Frame time histogram**, not a mean. The p95 and p99 are where stutter lives, and a mean of 12 ms can hide a 90 ms hitch every second.
2. **Allocation accounting** for the tile cache and GPU buffers, logged whenever a large allocation crosses a threshold. This is the only visibility you get into memory on the web.
3. **Tile pipeline counters**: requests in flight, cache hit rate, decode time, eviction rate. A bad hit rate looks exactly like a slow GPU from the outside.
4. **Tier transitions**: when the controller upgrades or downgrades, and what triggered it. Oscillation shows up here before users report it.

Expose all four in a debug overlay behind a URL parameter. You will spend more time in that overlay than in any profiler.

## Test and evaluation harness

Build the harness at SS-5, not at SS-11. Its real value is catching the slow visual drift that you stop noticing because you look at the thing every day.

**Unit tests on the Bevy-free crates.** Orbital positions checked against published ephemeris data at known dates. Energy drift over a simulated century for the integrator. Noise functions checked for determinism across platforms. These run in seconds and catch the errors that are hardest to see visually.

**Headless screenshot capture.** A CLI flag that boots the app, seeds the simulation to a fixed epoch and camera pose, renders a fixed frame, writes a PNG, and exits. Build a set of canonical viewpoints and never change them:

- Whole world from a distant orbital view, terminator centred
- Grazing sun angle across known relief, where shadows run longest
- A named crater from directly above at full detail
- Descent at 50 km altitude over terrain with recognisable features
- Hovering at minimum altitude, horizon visible and curving
- Night side with the sun fully occluded

**Visual regression in CI.** Compare each capture to a stored baseline with a perceptual difference metric and a tolerance threshold. GPU output is not bit-identical across drivers, so exact comparison will produce constant false positives. When a diff exceeds tolerance, fail the build and attach both images.

This is also the piece that makes remote work viable. A capture Claude Code can run and read turns "does this look right" into something checkable without you at the desk.

**Performance gates in CI.** Run each canonical viewpoint for 300 frames, record the p95 frame time, and fail if it regresses more than 10% against the baseline. Run on a consistent runner or the numbers are noise.

**Device matrix, tested manually each milestone.** Automation cannot catch iOS tab kills or thermal throttling. Keep the list short enough that you actually do it:

| Device | What it catches |
| --- | --- |
| Desktop Chrome, discrete GPU | Baseline, highest tier |
| Desktop Safari, Apple silicon | Metal backend differences, shader compilation |
| Desktop Firefox | Second wgpu implementation, validation differences |
| iPhone, current generation | Memory ceiling, tab kills, thermal throttle over 10 minutes |
| A five-year-old laptop with integrated graphics | The low tier actually being usable |

Run the phone test for at least ten minutes, not thirty seconds. Thermal throttling and slow memory growth are both invisible in a short session and both are what real users will hit.

## Iteration loop after launch

Run fixed-length slices with one theme each. A slice that ends without a deploy is a signal the slice was too big, not a reason to extend it.

```mermaid
flowchart LR
    A["Pick one theme"] --> B["Build behind<br/>a tier flag"]
    B --> C["Capture + gate<br/>in CI"]
    C --> D["Deploy"]
    D --> E["Measure against<br/>budgets"]
    E --> A
```

Candidate themes, roughly in the order they pay off:

1. **The next world in the catalogue.** From SS-13 onward this is the default slice, and it is the same shape of work every time: acquire, reproject, tile, verify, ship.
2. **Coverage honesty.** SS-15's overlay, then extending it as each new world exposes a different kind of gap.
3. **The orbital view.** SS-22 through SS-24, pulled forward whenever the terrain work gets heavy.
4. **Comparison.** SS-16, and later anything that puts two worlds beside each other at true relative scale.
5. **Guided tours.** Camera paths to specific features, which is what turns a tool into something a visitor understands in thirty seconds.
6. **Devlogs and pipeline notes.** Not a feature, but part of the output, and the slice most likely to get skipped if it is not scheduled.

Three rules that keep the loop honest.

**Every new feature ships with a tier assignment.** Decide at design time which tiers get it. A feature that only exists at the top tier is fine; a feature that silently blows the mobile budget is not.

**Add a canonical viewpoint with every feature.** Mars gets a Mars capture, the coverage overlay gets a gap capture. The baseline set grows with the project and keeps protecting what already worked.

**Re-run the full device matrix before each deploy, not each slice.** The matrix is the gate on shipping, and skipping it is how the iOS tier quietly breaks for two months.

For evaluation, resist judging by how it looks on your own machine. Your machine is the best case and you are the most habituated viewer. Real signals are the CI captures compared to baseline, the frame-time and memory numbers against the stated budgets, and people who have never seen it before. Watch someone use it for two minutes without instructions once a quarter. It tells you more than any metric.

## Risks and course changes

The technical risks are manageable and mostly known. The project risk is attrition, and it is the one worth designing against.

| Risk | Early warning sign | Response |
| --- | --- | --- |
| Bevy migrations eat your time | A release upgrade takes more than two days | Pin a version and skip releases; migrate on your schedule, not theirs |
| Mobile tier proves unviable | Tab kills persist below a 96 MB budget | Ship desktop-only with an honest message on phones; revisit later |
| Terrain streaming too slow | Cache hit rate below 70% during normal flight | Prefetch along the camera velocity vector before adding more tile detail |
| Scope creep into a game | Finding yourself designing mechanics | Return to the not-list in Scope; a game is a different project |
| Motivation decay | Weeks without a deploy | Ship something visible, however small; visible progress is the fuel |

Two things that genuinely would justify changing course.

If SS-9 and SS-10 do not work, stop and reconsider. Streamed quadtree terrain at planetary scale inside a browser is the load-bearing technical assumption of the whole design, and everything from SS-13 onward assumes it is solved. Releases 1 and 2 do not depend on it, which is exactly why reaching it early costs you so little.

If the wasm binary cannot be kept under roughly 8 MB compressed, the browser-first premise weakens considerably. A 30 MB download before anything appears defeats the ubiquity argument that motivated targeting the browser at all.

One thing that is not a reason to change course: the mobile tier being visually modest. It will be. A phone showing a clean orbital view with shallow terrain is a success, not a compromise, and holding it to desktop standards is the fastest way to waste months.

Finally, keep native builds in CI throughout even though they never ship. They cost almost nothing, they give you profilers and GPU captures the browser cannot, and they mean that if the web target ever becomes untenable, years of work are not hostage to one platform's decisions.

## Terrain shadows

Shadows shifting across mountains as the sun moves is the detail that makes relief read as real, and it is worth solving deliberately because the obvious approach does not work here.

**Shadow maps fail at planetary scale.** A single directional light covering a whole world gives you a handful of texels per kilometre. Cascades help near the camera and still leave you rendering depth from a light source across a body thousands of kilometres wide. The technique assumes a scene, not a planet.

**Horizon maps are the right answer.** For each terrain texel, precompute the elevation angle of the horizon in eight or sixteen compass directions. At runtime, interpolate between the two directions bracketing the sun and compare its elevation to that horizon angle. Below it, the texel is in shadow.

That approach fits this project unusually well:

- It is precomputed into the tile pyramid, so shadow quality costs data rather than frame time
- It scales to any body size, because it is per-texel and local
- It shifts correctly and continuously as the sun moves, which is exactly the effect you want
- The data is low-frequency and low-precision, so it compresses hard: two extra textures per tile, often less

Pair it with a precomputed sky-visibility term for ambient occlusion. That is what darkens crater floors and the insides of rilles, and without it shadowed regions look uniformly flat.

**The terminator is the payoff.** On an airless body at grazing sun angles, real relief throws shadows kilometres long. Lunar terminator photography is dramatic for exactly this reason, and it will be the most striking thing your renderer produces. Make sure the camera can get there easily.

One accurate detail worth keeping, because it is free and nobody expects it: the sun is not a point, so shadow edges have a penumbra whose softness depends on the sun's angular size from that world. From Mercury the sun is nearly three times as wide as we see it and shadow edges are noticeably soft. From Pluto it is close to a point and shadows are razor-sharp. Same code, different constant, and it quietly makes each world feel like a different place.

## Data volume and whether you need a server

The corpus is enormous and the client download is not, because nothing is ever bundled. Three numbers that are easy to conflate and worth keeping separate:

| Measure | Scale | Where it lives |
| --- | --- | --- |
| Total corpus, all worlds | Terabytes | Object storage, once |
| Transferred in a session | Tens of megabytes | Tiles fetched on demand |
| Resident in memory | A few hundred megabytes | The budget, enforced by eviction |
| Code bundle | Under 8 MB compressed | One wasm binary |

Streaming is what makes this work, and it was already the plan. A client never holds a world, only the tiles currently visible at the current level of detail. Adding twenty more worlds to the corpus does not change what any single visitor downloads.

### You do not need a server yet

This is the part worth correcting, because building one early would cost months and change the project's character.

Serving tiles needs no application server. They are immutable files fetched by HTTP with range requests, which is exactly what object storage plus a CDN does, at lower cost and with no operational burden. Cloudflare R2, S3 with CloudFront, or equivalent.

Generating tiles needs compute, but offline and in batches. You run the pipeline on your own machine or a rented box once per world and upload the output. That is a build step, not a service.

Static hosting carries the entire single-player roadmap, every world in the catalogue included. The first thing that genuinely requires a server is multiplayer.

### Capability splitting is about data, not code

The instinct to split by client capability is right, and it lands on the tile pyramid rather than the binary.

Serve different variants of the same tiles: resolution by quality tier, texture compression by what the adapter reports, tile depth by memory budget. All of that is selecting a different path on the same static host, and it needs no server logic.

Splitting the wasm binary is the thing to avoid. Dynamic linking in Rust and wasm is painful, and at under 8 MB compressed the binary is not the problem. Keep one binary and gate features at runtime from the capability probe.

## Multiplayer satellites, later

The good news first: the physics makes this unusually cheap. Because orbits propagate analytically, a satellite is its orbital elements plus an epoch, which is around a hundred bytes. Each client computes positions locally from that, so the server never streams positions. Thousands of satellites is kilobytes of state and no continuous traffic.

That is a far lighter multiplayer problem than most games have, and it is a direct dividend of choosing Keplerian propagation over numerical integration.

What it still costs is everything around the state:

- An authoritative server, with the propagator running server-side too so clients cannot invent impossible orbits
- Persistence, accounts, and identity
- Moderation, because anything users place and others see will eventually need it
- Uptime expectations and a running bill that never stops

That last group is the real change. Until then this is a tool that sits on static hosting and costs almost nothing to keep alive. After it, it is a service with users who expect it to be up, and walking that back is much harder than not starting it.

So it belongs exactly where you put it: after the single-player experience is finished and people are actually using it. Two things are worth doing early, though, because retrofitting either is unpleasant:

- Keep the propagator deterministic and free of any dependence on frame rate or wall-clock time, so the same elements and epoch produce identical positions everywhere
- Store satellites as elements and epoch from the very first local version, never as positions

Do those two and the single-player station work in SS-22 is already most of the way to being multiplayer-ready, whenever you decide that is worth the running cost.
