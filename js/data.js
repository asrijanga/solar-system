// Planet data: physical facts, JPL Keplerian elements (J2000 epoch, valid 1800-2050),
// NASA texture credits, and "surprise" facts used by the info panel.
//
// Orbital elements are from JPL Solar System Dynamics, "Keplerian Elements for
// Approximate Positions of the Major Planets" (Standish), Table 1.
// Units: a [AU], e [-], i [deg], L [deg], longPeri [deg], longNode [deg];
// rates are per Julian century.

export const AU_KM = 149597870.7;
export const C_KM_S = 299792.458;
export const EARTH_RADIUS_KM = 6371.0;

export const SUN = {
  id: 'sun', name: 'Sun', type: 'star',
  radiusKm: 695700, massKg: 1.989e30, gravity: 274, rotationHours: 609.12, axialTilt: 7.25,
  tempK: 5772,
  description: 'A G-type main-sequence star holding 99.86% of the mass of the entire Solar System. Every second it fuses about 600 million tonnes of hydrogen into helium, converting 4 million tonnes of matter into pure light.',
  facts: [
    'Light leaving the surface of the Sun takes 8 min 20 s to reach Earth, but a photon born in the core needs roughly 100,000 years to random-walk its way out.',
    'You could fit 1.3 million Earths inside the Sun.',
    'The Sun is about 4.6 billion years old and roughly halfway through its life. In ~5 billion years it will swell into a red giant reaching past the orbit of Venus.',
    'The surface is 5,500 °C, but the corona above it is over 1,000,000 °C. Why the atmosphere is hotter than the surface is still an open research question.',
    'The Sun orbits the centre of the Milky Way at about 828,000 km/h, completing one galactic year every ~230 million years.'
  ],
  credit: { text: 'Surface: procedural shader. Live image: NASA/SDO, AIA 304 Å (updated every few minutes)', url: 'https://sdo.gsfc.nasa.gov/data/' },
  liveImage: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_0304.jpg'
};

export const PLANETS = [
  {
    id: 'mercury', name: 'Mercury', type: 'terrestrial', color: 0x9c9a94,
    radiusKm: 2439.7, massKg: 3.3011e23, gravity: 3.7, rotationHours: 1407.6, axialTilt: 0.034,
    dayLengthHours: 4222.6, tempK: 440, moons: 0,
    elements: { a: 0.38709927, e: 0.20563593, i: 7.00497902, L: 252.25032350, longPeri: 77.45779628, longNode: 48.33076593,
                da: 0.00000037, de: 0.00001906, di: -0.00594749, dL: 149472.67411175, dPeri: 0.16047689, dNode: -0.12534081 },
    texture: 'mercury.jpg',
    description: 'The smallest planet and the closest to the Sun. Mercury has almost no atmosphere, so its surface swings from 430 °C in sunlight to −180 °C at night, the most extreme temperature range of any planet.',
    facts: [
      'A single day on Mercury (sunrise to sunrise) lasts 176 Earth days, which is twice as long as its year of 88 days.',
      'From some places on Mercury the Sun appears to rise, stop, move backwards, and set again before rising once more.',
      'Despite being closest to the Sun, Mercury has water ice in permanently shadowed craters at its poles, confirmed by NASA\'s MESSENGER spacecraft.',
      'Mercury is shrinking. As its iron core cools, the whole planet has contracted by up to 14 km in radius, wrinkling the crust into giant cliffs called lobate scarps.'
    ],
    credit: { text: 'NASA / Johns Hopkins APL / Carnegie Institution — MESSENGER MDIS global enhanced-colour mosaic', url: 'https://messenger.jhuapl.edu/Explore/Images.html' }
  },
  {
    id: 'venus', name: 'Venus', type: 'terrestrial', color: 0xe6c88a,
    radiusKm: 6051.8, massKg: 4.8675e24, gravity: 8.87, rotationHours: -5832.5, axialTilt: 177.36,
    dayLengthHours: 2802, tempK: 737, moons: 0,
    elements: { a: 0.72333566, e: 0.00677672, i: 3.39467605, L: 181.97909950, longPeri: 131.60246718, longNode: 76.67984255,
                da: 0.00000390, de: -0.00004107, di: -0.00078890, dL: 58517.81538729, dPeri: 0.00268329, dNode: -0.27769418 },
    texture: 'venus.jpg', atmosphere: { color: 0xf2d49b, intensity: 0.9 },
    description: 'Earth\'s "twin" in size, but wrapped in a crushing carbon-dioxide atmosphere 90 times denser than ours, with clouds of sulphuric acid. The runaway greenhouse effect makes it the hottest planet, hotter even than Mercury.',
    facts: [
      'Venus rotates backwards, and so slowly that its day (243 Earth days) is longer than its year (225 Earth days).',
      'The surface pressure is 92 bar, the same as being 900 m under the ocean. Soviet Venera landers survived only ~2 hours before being crushed and cooked.',
      'Venus is the brightest natural object in the night sky after the Moon, and can cast faint shadows on Earth.',
      'The clouds whip around the planet every 4 days at 360 km/h, sixty times faster than the surface below rotates.'
    ],
    credit: { text: 'NASA 3D Resources — Magellan radar mosaic (NASA/JPL)', url: 'https://github.com/nasa/NASA-3D-Resources' }
  },
  {
    id: 'earth', name: 'Earth', type: 'terrestrial', color: 0x4f7fc6,
    radiusKm: 6371.0, massKg: 5.97237e24, gravity: 9.807, rotationHours: 23.9345, axialTilt: 23.44,
    dayLengthHours: 24, tempK: 288, moons: 1,
    elements: { a: 1.00000261, e: 0.01671123, i: -0.00001531, L: 100.46457166, longPeri: 102.93768193, longNode: 0.0,
                da: 0.00000562, de: -0.00004392, di: -0.01294668, dL: 35999.37244981, dPeri: 0.32327364, dNode: 0.0 },
    texture: 'earth_day.jpg', nightTexture: 'earth_night.jpg', cloudsTexture: 'earth_clouds.jpg',
    atmosphere: { color: 0x6fb2ff, intensity: 1.0 },
    description: 'The only world known to harbour life. 71% of the surface is liquid water, and the atmosphere is 21% oxygen, kept there by living things. Watch the night side: the city lights you see are real, from NASA\'s Earth at Night data.',
    facts: [
      'You are moving at about 107,000 km/h around the Sun right now, and the whole Solar System is moving at 828,000 km/h around the galaxy.',
      'Earth is not a perfect sphere: it bulges 21 km at the equator because of its spin. Mount Chimborazo in Ecuador, not Everest, is the point farthest from Earth\'s centre.',
      'The Moon is drifting away from us at 3.8 cm per year, and Earth\'s day is getting longer by about 2 milliseconds per century.',
      'If the history of Earth were compressed into 24 hours, humans would appear in the last 4 seconds before midnight.'
    ],
    credit: { text: 'NASA Visible Earth — Blue Marble Next Generation (day), Earth at Night (city lights), cloud composite', url: 'https://visibleearth.nasa.gov/collection/1484/blue-marble' },
    satellites: [
      { id: 'moon', name: 'Moon', radiusKm: 1737.4, gravity: 1.62, distanceKm: 384400, periodDays: 27.3217, inclination: 5.145, texture: 'moon.jpg', tidallyLocked: true,
        description: 'Earth\'s only natural satellite, formed ~4.5 billion years ago when a Mars-sized body collided with the young Earth. Twelve humans have walked here.',
        facts: [ 'The Moon always shows us the same face because it rotates exactly once per orbit.', 'Apollo astronauts\' footprints will survive for millions of years: there is no wind or water to erase them.', 'The Moon is slowly moving away from Earth at 3.8 cm/year, about the rate your fingernails grow.' ],
        credit: { text: 'NASA 3D Resources — Lunar Reconnaissance Orbiter (LRO) colour map', url: 'https://github.com/nasa/NASA-3D-Resources' } }
    ]
  },
  {
    id: 'mars', name: 'Mars', type: 'terrestrial', color: 0xc1663f,
    radiusKm: 3389.5, massKg: 6.4171e23, gravity: 3.721, rotationHours: 24.6229, axialTilt: 25.19,
    dayLengthHours: 24.66, tempK: 210, moons: 2,
    elements: { a: 1.52371034, e: 0.09339410, i: 1.84969142, L: -4.55343205, longPeri: -23.94362959, longNode: 49.55953891,
                da: 0.00001847, de: 0.00007882, di: -0.00813131, dL: 19140.30268499, dPeri: 0.44441088, dNode: -0.29257343 },
    texture: 'mars.jpg', atmosphere: { color: 0xe0956a, intensity: 0.35 },
    description: 'The Red Planet, rust-coloured from iron oxide dust. Home to the tallest volcano in the Solar System (Olympus Mons, 22 km high) and a canyon (Valles Marineris) that would stretch across the entire United States.',
    facts: [
      'A day on Mars is 24 h 37 min, so close to ours that rover teams at NASA JPL live on "Mars time", shifting their schedule by 40 minutes each day.',
      'Mars once had rivers, lakes and possibly an ocean. Curiosity and Perseverance have found ancient lake beds and organic molecules.',
      'Sunsets on Mars are blue. Fine dust scatters red light away, leaving a blue glow around the setting Sun.',
      'The two tiny moons, Phobos and Deimos, may be captured asteroids. Phobos is spiralling inward and will break up into a ring in ~50 million years.'
    ],
    credit: { text: 'NASA 3D Resources — Viking Orbiter colour mosaic (NASA/JPL/USGS)', url: 'https://github.com/nasa/NASA-3D-Resources' },
    satellites: [
      { id: 'phobos', name: 'Phobos', radiusKm: 11.1, gravity: 0.0057, distanceKm: 9376, periodDays: 0.3189, inclination: 1.08, color: 0x8a7f74,
        description: 'The larger and inner of Mars\'s two moons. It orbits so fast that it rises in the west and sets in the east, twice every Martian day.', facts: [], credit: { text: 'Procedural (no NASA global map used)', url: '' } },
      { id: 'deimos', name: 'Deimos', radiusKm: 6.2, gravity: 0.003, distanceKm: 23463, periodDays: 1.263, inclination: 1.79, color: 0x9a9088,
        description: 'The outer Martian moon, only 12 km across.', facts: [], credit: { text: 'Procedural (no NASA global map used)', url: '' } }
    ]
  },
  {
    id: 'jupiter', name: 'Jupiter', type: 'gas giant', color: 0xd3b18c,
    radiusKm: 69911, massKg: 1.8982e27, gravity: 24.79, rotationHours: 9.925, axialTilt: 3.13,
    dayLengthHours: 9.93, tempK: 165, moons: 95,
    elements: { a: 5.20288700, e: 0.04838624, i: 1.30439695, L: 34.39644051, longPeri: 14.72847983, longNode: 100.47390909,
                da: -0.00011607, de: -0.00013253, di: -0.00183714, dL: 3034.74612775, dPeri: 0.21252668, dNode: 0.20469106 },
    texture: 'jupiter.jpg', oblateness: 0.06487,
    description: 'The king of the planets, with more than twice the mass of all the other planets combined. Its Great Red Spot is a storm larger than Earth that has raged for at least 190 years.',
    facts: [
      'Jupiter has the shortest day of any planet, spinning once every 9 h 55 min. That spin flattens it visibly at the poles, an effect reproduced in this model.',
      'The map you are looking at was assembled by NASA\'s Cassini spacecraft during its December 2000 flyby on the way to Saturn.',
      'Jupiter\'s magnetic field is 20,000 times stronger than Earth\'s. Its radiation belts would deliver a lethal dose to an unshielded astronaut in minutes.',
      'Jupiter is not a "failed star", it would need to be about 80 times more massive to ignite fusion. But it does radiate more heat than it receives from the Sun.'
    ],
    credit: { text: 'NASA/JPL/Space Science Institute — Cassini cylindrical map (PIA07782)', url: 'https://photojournal.jpl.nasa.gov/catalog/PIA07782' },
    satellites: [
      { id: 'io', name: 'Io', radiusKm: 1821.6, gravity: 1.796, distanceKm: 421700, periodDays: 1.769, inclination: 0.05, texture: 'io.jpg',
        description: 'The most volcanically active world in the Solar System, with hundreds of volcanoes, some erupting plumes 400 km high.', facts: ['Io\'s volcanism is powered by tidal squeezing from Jupiter: its surface flexes by up to 100 m every orbit.'], credit: { text: 'NASA 3D Resources — Galileo/Voyager mosaic', url: 'https://github.com/nasa/NASA-3D-Resources' } },
      { id: 'europa', name: 'Europa', radiusKm: 1560.8, gravity: 1.315, distanceKm: 671034, periodDays: 3.551, inclination: 0.47, texture: 'europa.jpg',
        description: 'An ice-covered moon hiding a global ocean with twice as much water as all of Earth\'s oceans combined. NASA\'s Europa Clipper is on its way to study it.', facts: ['Europa\'s ocean is a leading candidate for extraterrestrial life in our Solar System.'], credit: { text: 'NASA 3D Resources — Galileo mosaic', url: 'https://github.com/nasa/NASA-3D-Resources' } },
      { id: 'ganymede', name: 'Ganymede', radiusKm: 2634.1, gravity: 1.428, distanceKm: 1070412, periodDays: 7.155, inclination: 0.2, texture: 'ganymede.jpg',
        description: 'The largest moon in the Solar System, bigger than the planet Mercury, and the only moon with its own magnetic field.', facts: [], credit: { text: 'NASA 3D Resources — Galileo/Voyager mosaic', url: 'https://github.com/nasa/NASA-3D-Resources' } },
      { id: 'callisto', name: 'Callisto', radiusKm: 2410.3, gravity: 1.235, distanceKm: 1882709, periodDays: 16.69, inclination: 0.19, texture: 'callisto.jpg',
        description: 'The most heavily cratered object in the Solar System; its surface is ~4 billion years old.', facts: [], credit: { text: 'NASA 3D Resources — Galileo/Voyager mosaic', url: 'https://github.com/nasa/NASA-3D-Resources' } }
    ]
  },
  {
    id: 'saturn', name: 'Saturn', type: 'gas giant', color: 0xe3d3a5,
    radiusKm: 58232, massKg: 5.6834e26, gravity: 10.44, rotationHours: 10.656, axialTilt: 26.73,
    dayLengthHours: 10.66, tempK: 134, moons: 146,
    elements: { a: 9.53667594, e: 0.05386179, i: 2.48599187, L: 49.95424423, longPeri: 92.59887831, longNode: 113.66242448,
                da: -0.00125060, de: -0.00050991, di: 0.00193609, dL: 1222.49362201, dPeri: -0.41897216, dNode: -0.28867794 },
    texture: 'saturn.jpg', oblateness: 0.09796,
    rings: { innerKm: 74500, outerKm: 140220 },
    description: 'The jewel of the Solar System. Its rings span 280,000 km yet are mostly less than 10 m thick, made of billions of chunks of nearly pure water ice. The ring gaps in this model are at their real radii.',
    facts: [
      'Saturn is the least dense planet: at 0.687 g/cm³ it would float in a bathtub, if you could find one big enough.',
      'The rings are young, perhaps only 100 million years old, and are raining down onto the planet. They may vanish within 300 million years.',
      'A hexagonal jet stream, each side wider than Earth, sits at Saturn\'s north pole.',
      'Every 15 years the rings turn edge-on to Earth and seem to disappear. Galileo, seeing this in 1612, wrote "has Saturn swallowed his children?"'
    ],
    credit: { text: 'NASA 3D Resources — Cassini/Voyager map. Rings: procedural, built from real ring radii (C, B, Cassini Division, A, Encke Gap, F)', url: 'https://github.com/nasa/NASA-3D-Resources' },
    satellites: [
      { id: 'titan', name: 'Titan', radiusKm: 2574.7, gravity: 1.352, distanceKm: 1221870, periodDays: 15.945, inclination: 0.35, texture: 'titan.jpg', atmosphere: { color: 0xe8a94a, intensity: 0.8 },
        description: 'The only moon with a thick atmosphere, and the only other world with rivers, lakes and seas on its surface, filled with liquid methane. NASA\'s Dragonfly rotorcraft will land here in the 2030s.', facts: ['Titan\'s air is so thick and its gravity so low that a human could fly by flapping strap-on wings.'], credit: { text: 'NASA 3D Resources — Cassini map', url: 'https://github.com/nasa/NASA-3D-Resources' } },
      { id: 'enceladus', name: 'Enceladus', radiusKm: 252.1, gravity: 0.113, distanceKm: 237948, periodDays: 1.370, inclination: 0.02, texture: 'enceladus.jpg',
        description: 'A tiny ice moon that shoots geysers of water 500 km into space from a subsurface ocean. Cassini flew through the plumes and tasted salt and organic molecules.', facts: [], credit: { text: 'NASA 3D Resources — Cassini mosaic', url: 'https://github.com/nasa/NASA-3D-Resources' } }
    ]
  },
  {
    id: 'uranus', name: 'Uranus', type: 'ice giant', color: 0xa6d8e0,
    radiusKm: 25362, massKg: 8.6810e25, gravity: 8.69, rotationHours: -17.24, axialTilt: 97.77,
    dayLengthHours: 17.24, tempK: 76, moons: 28,
    elements: { a: 19.18916464, e: 0.04725744, i: 0.77263783, L: 313.23810451, longPeri: 170.95427630, longNode: 74.01692503,
                da: -0.00196176, de: -0.00004397, di: -0.00242939, dL: 428.48202785, dPeri: 0.40805281, dNode: 0.04240589 },
    procedural: 'uranus', oblateness: 0.0229,
    rings: { innerKm: 41837, outerKm: 51149, faint: true },
    description: 'An ice giant tipped on its side: its axis is tilted 98°, so it rolls around the Sun like a barrel. Each pole gets 42 years of continuous sunlight followed by 42 years of darkness.',
    facts: [
      'Uranus is the coldest planet, dipping to −224 °C, colder than Neptune despite being closer to the Sun.',
      'It was the first planet discovered with a telescope, by William Herschel in 1781. He wanted to name it "George\'s Star" after King George III.',
      'Uranus has 13 faint, dark rings, tilted with the planet, shown here at their real radii.',
      'Only one spacecraft has ever visited: Voyager 2, for just six hours in January 1986. This model uses a procedural surface because no NASA global map exists.'
    ],
    credit: { text: 'Procedural surface matched to Voyager 2 / Hubble colour (no NASA global map exists)', url: 'https://science.nasa.gov/uranus/' }
  },
  {
    id: 'neptune', name: 'Neptune', type: 'ice giant', color: 0x4b70dd,
    radiusKm: 24622, massKg: 1.02413e26, gravity: 11.15, rotationHours: 16.11, axialTilt: 28.32,
    dayLengthHours: 16.11, tempK: 72, moons: 16,
    elements: { a: 30.06992276, e: 0.00859048, i: 1.77004347, L: -55.12002969, longPeri: 44.96476227, longNode: 131.78422574,
                da: 0.00026291, de: 0.00005105, di: 0.00035372, dL: 218.45945325, dPeri: -0.32241464, dNode: -0.02185083 },
    texture: 'neptune.jpg', oblateness: 0.0171, atmosphere: { color: 0x6b8cff, intensity: 0.5 },
    description: 'The windiest world in the Solar System, with supersonic gusts of 2,100 km/h. Neptune was the first planet found by mathematics: its position was predicted from wobbles in the orbit of Uranus before anyone saw it.',
    facts: [
      'Neptune has completed only one orbit since its discovery in 1846. Its second "birthday" arrived in 2011.',
      'It rains diamonds inside Neptune and Uranus: extreme pressure squeezes methane carbon into diamond crystals that sink toward the core.',
      'Its largest moon, Triton, orbits backwards and is probably a captured Kuiper Belt object. It is slowly spiralling in and will be torn into rings.',
      'Voyager 2\'s 1989 flyby is still the only visit. It found the "Great Dark Spot", a storm the size of Earth that vanished a few years later.'
    ],
    credit: { text: 'NASA 3D Resources — Voyager 2 map (NASA/JPL)', url: 'https://github.com/nasa/NASA-3D-Resources' },
    satellites: [
      { id: 'triton', name: 'Triton', radiusKm: 1353.4, gravity: 0.779, distanceKm: 354759, periodDays: -5.877, inclination: 156.9, texture: 'triton.jpg',
        description: 'Neptune\'s largest moon orbits backwards, has nitrogen geysers, and a surface of frozen nitrogen at −235 °C.', facts: [], credit: { text: 'NASA 3D Resources — Voyager 2 mosaic', url: 'https://github.com/nasa/NASA-3D-Resources' } }
    ]
  },
  {
    id: 'pluto', name: 'Pluto', type: 'dwarf planet', color: 0xc9b39a,
    radiusKm: 1188.3, massKg: 1.303e22, gravity: 0.62, rotationHours: -153.29, axialTilt: 122.53,
    dayLengthHours: 153.3, tempK: 44, moons: 5,
    elements: { a: 39.48211675, e: 0.24882730, i: 17.14001206, L: 238.92903833, longPeri: 224.06891629, longNode: 110.30393684,
                da: -0.00031596, de: 0.00005170, di: 0.00004818, dL: 145.20780515, dPeri: -0.04062942, dNode: -0.01183482 },
    texture: 'pluto.jpg',
    description: 'A dwarf planet in the Kuiper Belt with a heart-shaped nitrogen glacier (Sputnik Planitia), mountains of water ice, and a thin blue atmosphere. New Horizons flew past in 2015 after a 9.5-year journey.',
    facts: [
      'Pluto\'s orbit is so eccentric that from 1979 to 1999 it was closer to the Sun than Neptune.',
      'Pluto and its moon Charon orbit a point in space between them, so they are sometimes called a double dwarf planet. They are tidally locked to each other, forever showing the same faces.',
      'A year on Pluto lasts 248 Earth years. No one born when it was discovered (1930) will live to see it complete one orbit.',
      'Some of the ashes of Clyde Tombaugh, who discovered Pluto, are aboard New Horizons, making him the first human to leave the Solar System.'
    ],
    credit: { text: 'NASA 3D Resources — New Horizons map (NASA/JHUAPL/SwRI)', url: 'https://github.com/nasa/NASA-3D-Resources' },
    satellites: [
      { id: 'charon', name: 'Charon', radiusKm: 606, gravity: 0.288, distanceKm: 19591, periodDays: 6.387, inclination: 0.08, texture: 'charon.jpg',
        description: 'Half the size of Pluto, with a dark red polar cap made of organic molecules that drifted over from Pluto\'s atmosphere.', facts: [], credit: { text: 'NASA 3D Resources — New Horizons map', url: 'https://github.com/nasa/NASA-3D-Resources' } }
    ]
  }
];

// Halley's Comet: JPL small-body elements (epoch 1994-02-17), perihelion 1986-02-09.
export const COMETS = [
  { id: 'halley', name: "Halley's Comet", color: 0xcfe8ff, radiusKm: 5.5,
    a: 17.834, e: 0.96714, i: 162.26, longNode: 58.42, argPeri: 111.33, periodYears: 75.32, perihelionJD: 2446470.95,
    description: 'The most famous comet, visible from Earth every 75-76 years. Its nucleus is a 15 km peanut of ice and dust darker than coal. Last seen in 1986, it returns in 2061.',
    facts: [ 'Halley orbits backwards (retrograde) relative to the planets, tilted 162° to the ecliptic.', 'Mark Twain was born as Halley appeared in 1835 and died the day after it returned in 1910, exactly as he predicted.', 'The Orionid and Eta Aquariid meteor showers are Earth passing through the dust Halley leaves behind.' ],
    credit: { text: 'Orbit: JPL Small-Body Database', url: 'https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=1P' } }
];

export const KEYBOARD_ORDER = ['sun','mercury','venus','earth','mars','jupiter','saturn','uranus','neptune','pluto'];
