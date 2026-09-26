# World catalogue

Every body in the solar system that has been imaged well enough to render as a place, sorted by how much data exists rather than by size or distance. The tier is the build queue.

Status is a dropdown on every row. Change it in place as worlds ship, and this tab stays the single answer to what is supported. Each world is built by one round of `docs/world-recipe.md`.

Radii are approximate mean values for scale only. Do not hardcode them: authoritative body constants live in SPICE PCK kernels, and reading them from there keeps the catalogue honest and removes a whole class of typo.

| Tier | Meaning | Renderable as |
| --- | --- | --- |
| 1 | Global topography and global imagery | Full terrain with relief |
| 2 | Global imagery, little or no global topography | Textured sphere, relief where local data exists |
| 3 | Partial or low-resolution imagery | Sphere with visible coverage gaps |
| 4 | Unresolved, no surface detail | Point of light, or a disc with inferred colour |

## Tier 1 — global topography and imagery

Five bodies. Everything the terrain pipeline was designed for, and the entire early roadmap.

| Body | Status | Type | Radius (km) | Data from |
| --- | --- | --- | --- | --- |
| Earth | Not started | Planet | 6,371 | Copernicus, Sentinel, GEBCO |
| Moon | Live: website and local mode | Moon of Earth | 1,737 | LRO, LOLA, Clementine, Kaguya |
| Mars | Not started | Planet | 3,390 | MOLA, HRSC, CTX, HiRISE |
| Mercury | Not started | Planet | 2,440 | MESSENGER |
| Venus | Not started | Planet | 6,052 | Magellan radar |

Venus is Tier 1 only by courtesy. Its imagery is excellent and its topography is 60 times coarser, so it needs a rendering approach of its own rather than the standard pipeline.

## Tier 2 — global imagery, limited topography

Twenty bodies with enough coverage to read as real places. These are where the project spends its middle years, and each is roughly the same shape of work once the pipeline exists.

| Body | Status | Type | Radius (km) | Data from | Notable |
| --- | --- | --- | --- | --- | --- |
| Ganymede | Not started | Moon of Jupiter | 2,634 | Voyager, Galileo, Juno | Largest moon in the solar system |
| Titan | Not started | Moon of Saturn | 2,575 | Cassini RADAR, Huygens | Thick haze; surface only via radar |
| Callisto | Not started | Moon of Jupiter | 2,410 | Voyager, Galileo | Most heavily cratered surface known |
| Io | Not started | Moon of Jupiter | 1,822 | Voyager, Galileo, Juno | Active volcanism, surface changes |
| Europa | Not started | Moon of Jupiter | 1,561 | Voyager, Galileo | Ice shell, chaos terrain |
| Triton | Not started | Moon of Neptune | 1,353 | Voyager 2 | Retrograde orbit, nitrogen geysers |
| Pluto | Not started | Dwarf planet | 1,188 | New Horizons | Coverage drops 40x on the far side |
| Titania | Not started | Moon of Uranus | 789 | Voyager 2 | Largest Uranian moon |
| Rhea | Not started | Moon of Saturn | 764 | Cassini |  |
| Oberon | Not started | Moon of Uranus | 761 | Voyager 2 |  |
| Iapetus | Not started | Moon of Saturn | 735 | Cassini | Two-tone surface, equatorial ridge |
| Charon | Not started | Moon of Pluto | 606 | New Horizons | Pluto fills 7° of its sky |
| Umbriel | Not started | Moon of Uranus | 585 | Voyager 2 |  |
| Ariel | Not started | Moon of Uranus | 579 | Voyager 2 |  |
| Dione | Not started | Moon of Saturn | 561 | Cassini |  |
| Tethys | Not started | Moon of Saturn | 531 | Cassini | Odysseus crater spans a third of it |
| Ceres | Not started | Dwarf planet | 470 | Dawn | Nearest dwarf planet |
| Enceladus | Not started | Moon of Saturn | 252 | Cassini | Active plumes from the south pole |
| Miranda | Not started | Moon of Uranus | 236 | Voyager 2 | Cliffs up to 20 km high |
| Mimas | Not started | Moon of Saturn | 198 | Cassini | Herschel crater dominates one face |

Io, Enceladus, and Triton are the three worth prioritising within this tier. All three are geologically active, all three photograph dramatically, and all three carry a story that makes the data worth looking at.

## Tier 3 — partial or low-resolution imagery

Imaged, but not well. Renderable with visible gaps, which under this project's principles is a feature rather than a reason to skip them.

| Body | Status | Type | Radius (km) | Data from | The gap |
| --- | --- | --- | --- | --- | --- |
| Proteus | Not started | Moon of Neptune | 210 | Voyager 2 | Single 1989 flyby, one hemisphere |
| Nereid | Not started | Moon of Neptune | 170 | Voyager 2 | Barely resolved |
| Hyperion | Not started | Moon of Saturn | 135 | Cassini | Chaotic rotation, sponge-like surface |
| Phoebe | Not started | Moon of Saturn | 107 | Cassini | One close flyby, captured object |
| Janus | Not started | Moon of Saturn | 90 | Cassini | Swaps orbits with Epimetheus |
| Amalthea | Not started | Moon of Jupiter | 83 | Galileo | Irregular, reddest object in the system |
| Puck | Not started | Moon of Uranus | 81 | Voyager 2 | Low resolution only |
| Phobos | Not started | Moon of Mars | 11 | Mars Express, MRO | Well imaged; irregular shape |
| Deimos | Not started | Moon of Mars | 6 | MRO | Smaller, less covered |

The Uranian and Neptunian moons share one fact worth surfacing in the interface: everything we know about them came from two flybys in 1986 and 1989, and some hemispheres have never been photographed. That is the clearest possible illustration of how partial our picture of the outer system still is.

## Tier 4 — unresolved

Known to exist, measured for size and colour, never seen as a surface. Renderable only as a point or an inferred disc, and honest to present that way.

| Body | Status | Type | Radius (km) | What we know |
| --- | --- | --- | --- | --- |
| Eris | Not started | Dwarf planet | 1,163 | Mass and size from occultations; more massive than Pluto |
| Haumea | Not started | Dwarf planet | \~816 long axis | Extremely elongated, rotates in under 4 hours, has rings |
| Makemake | Not started | Dwarf planet | 715 | Methane surface inferred from spectra |
| Gonggong | Not started | Dwarf planet candidate | 615 | Red, likely water ice |
| Quaoar | Not started | Dwarf planet candidate | 545 | Has a ring outside the expected limit |
| Sedna | Not started | Dwarf planet candidate | \~500 | Extreme orbit reaching beyond 900 AU |
| Orcus | Not started | Dwarf planet candidate | 458 | Pluto-like orbit, has a large moon |

These are the most interesting entries in the catalogue precisely because there is nothing to render. A tool that shows Eris as an honest point of light, beside a note that no spacecraft has ever visited it, teaches something that a beautifully invented surface would actively undermine.

They are also the strongest argument for the retroactive-update principle. Every one of these is a placeholder waiting for a mission, and the tool should be built so that filling one in later is a data change rather than a code change.

## Small bodies

Asteroids and comets visited closely enough to have real shape models. They are listed apart because they break the central assumption of the terrain pipeline.

| Body | Status | Type | Size | Mission |
| --- | --- | --- | --- | --- |
| Vesta | Not started | Asteroid | 525 km across | Dawn |
| Pallas | Not started | Asteroid | 512 km across | Hubble only |
| Hygiea | Not started | Asteroid | 434 km across | Ground-based |
| Lutetia | Not started | Asteroid | 100 km across | Rosetta flyby |
| Ida and Dactyl | Not started | Asteroid and its moon | 56 km, 1.4 km | Galileo |
| Arrokoth | Not started | Kuiper belt object | 36 km long | New Horizons |
| Eros | Not started | Near-Earth asteroid | 34 km long | NEAR Shoemaker |
| 67P/Churyumov-Gerasimenko | Not started | Comet | 4 km across | Rosetta and Philae |
| Ryugu | Not started | Near-Earth asteroid | 900 m across | Hayabusa2 |
| Bennu | Not started | Near-Earth asteroid | 490 m across | OSIRIS-REx |
| Itokawa | Not started | Near-Earth asteroid | 330 m long | Hayabusa |
| Dimorphos | Not started | Moonlet of Didymos | 170 m across | DART |

## What this catalogue implies

Four things follow from the shape of the list rather than from any individual row.

**Irregular bodies need a second renderer.** A cube-sphere quadtree assumes a roughly spherical body. Eros, Arrokoth, 67P, Phobos, and Hyperion are nothing of the sort, and they need arbitrary shape models with a different level-of-detail approach. Treat them as a separate track, like the gas giants, rather than a later item in the same queue.

**Twenty-five bodies carry the project.** Tier 1 and Tier 2 together are the realistic multi-year target. At one world per release, that is the roadmap, and finishing it would be a genuine achievement rather than a starting point.

**Tier 4 must be designed in from the start.** Retroactive updating only works if a world is a data manifest the renderer consumes, not a hand-built scene. Build Eris as a real entry with almost no data rather than leaving it out, and a future mission becomes a file drop.

**Coverage itself is the story.** Laid out this way, the catalogue shows that we have global topography for five bodies out of everything in the solar system, and nothing at all for objects larger than Pluto. That single observation is more educational than any individual world, and it belongs in the interface rather than only in this document.
