// The spine of the game. Each entry either widens the world or widens the
// language, and the resource it costs is the one the previous tier produces.

export const RESOURCES = [
  { id: 'kelp', name: 'Kelp', color: 'var(--kelp)' },
  { id: 'anemone', name: 'Anemone', color: 'var(--anemone)' },
  { id: 'pearl', name: 'Pearl', color: 'var(--pearl)' },
  { id: 'coral', name: 'Coral', color: 'var(--coral)' },
  { id: 'nacre', name: 'Nacre', color: 'var(--nacre)' },
];

export const TECH_TREE = [
  {
    id: 'loops',
    name: 'Loops',
    cost: { kelp: 10 },
    grants: ['while', 'True / False', 'break', 'continue'],
    blurb: 'Repeat a block until you say stop. Your script stops being a list of moves and starts being a program.',
    example: 'while True:\n    harvest()\n    move(NORTH)',
  },
  {
    id: 'seeding',
    name: 'Seeding',
    cost: { kelp: 40 },
    grants: ['plant(KELP)', 'can_harvest()', 'KELP'],
    blurb: 'Stop waiting for kelp to drift in. Plant it yourself and the reef starts paying on your schedule.',
    example: 'while True:\n    harvest()\n    plant(KELP)\n    move(EAST)',
  },
  {
    id: 'branching',
    name: 'Branching',
    cost: { kelp: 120 },
    grants: ['if / elif / else', '== != < <= > >=', 'and / or / not'],
    blurb: 'Ask the reef a question before you act. No more harvesting bare sand.',
    example: 'while True:\n    if can_harvest():\n        harvest()\n    move(EAST)',
  },
  {
    id: 'reef1',
    name: 'Expand Reef I',
    cost: { kelp: 300 },
    grants: ['Reef grows to 6 x 6'],
    blurb: 'More seabed. Twice the tiles to tend, twice the yield if your code can keep up.',
    effect: { resize: 6 },
  },
  {
    id: 'counting',
    name: 'Counting',
    cost: { kelp: 700 },
    grants: ['variables', 'for x in range(n)', '+ - * / // %'],
    blurb: 'Remember things between lines and repeat a fixed number of times. This is where sweeps get short.',
    example: 'for i in range(4):\n    harvest()\n    plant(KELP)\n    move(EAST)',
  },
  {
    id: 'anemones',
    name: 'Anemones',
    cost: { kelp: 1600 },
    grants: ['plant(ANEMONE)', 'get_pos_x()', 'get_pos_y()', 'get_world_size()'],
    blurb: 'Anemones sting each other. Two side by side and both stop growing - so they have to go down in a checkerboard.',
    example: 'if (get_pos_x() + get_pos_y()) % 2 == 0:\n    plant(ANEMONE)',
  },
  {
    id: 'sensors',
    name: 'Sensors',
    cost: { kelp: 1200, anemone: 250 },
    grants: ['sense()', 'measure()', 'get_ground()', 'is_bleached()'],
    blurb: 'Read the tile under you: what is growing, how far along it is, and what it is growing on.',
    example: 'if get_ground() == SILT:\n    plant(KELP)',
  },
  {
    id: 'functions',
    name: 'Functions',
    cost: { kelp: 2500, anemone: 600 },
    grants: ['def', 'parameters', 'return'],
    blurb: 'Name a piece of your program and reuse it. The first unlock that makes your script shorter instead of longer.',
    example: 'def sweep_row(n):\n    for i in range(n):\n        harvest()\n        move(EAST)',
  },
  {
    id: 'scrubber',
    name: 'Scrubber',
    cost: { anemone: 1500 },
    grants: ['scrub()', 'Bleaching begins', 'Pearls'],
    blurb: 'Bleaching starts spreading across the reef. It kills growth wherever it lands - but scrubbing it off is where pearls come from.',
    example: 'if is_bleached():\n    scrub()',
  },
  {
    id: 'lists',
    name: 'Lists',
    cost: { pearl: 900 },
    grants: ['[ ]', 'indexing', 'len()', '.append()', 'for x in list'],
    blurb: 'Hold many values at once. Now you can remember the whole reef, not just the tile under you.',
    example: 'seen = []\nseen.append(measure())\nprint(len(seen))',
  },
  {
    id: 'reef2',
    name: 'Expand Reef II',
    cost: { pearl: 1800 },
    grants: ['Reef grows to 8 x 8'],
    blurb: 'Sixty-four tiles. A naive sweep will not keep up any more.',
    effect: { resize: 8 },
  },
  {
    id: 'coral',
    name: 'Coral Bloom',
    cost: { pearl: 3000 },
    grants: ['plant(CORAL)', 'CORAL'],
    blurb: 'Coral pays a pittance one polyp at a time. But get every tile mature at once and the whole reef blooms. Tiles die back while you work.',
    example: 'if sense() == EMPTY:\n    plant(CORAL)',
  },
  {
    id: 'shells',
    name: 'Shell Sort',
    cost: { coral: 2200 },
    grants: ['plant(SHELL)', 'swap(dir)', 'SHELL'],
    blurb: 'Fill the reef with shells, then sort them by size along a snake path. Yes, you have to write the sorting algorithm.',
    example: 'here = measure()\nmove(EAST)\nif here > measure():\n    swap(WEST)',
  },
  {
    id: 'reef3',
    name: 'Expand Reef III',
    cost: { coral: 4000 },
    grants: ['Reef grows to 10 x 10'],
    blurb: 'A hundred tiles. At this size only good code produces anything at all.',
    effect: { resize: 10 },
  },
  {
    id: 'drones',
    name: 'Second Drone',
    cost: { nacre: 3000 },
    grants: ['spawn_drone(fn)', 'num_drones()'],
    blurb: 'Run a second drone on its own function, sharing one reef. Twice the hands, and every race condition you write yourself.',
    example: 'def tender():\n    while True:\n        harvest()\n        move(EAST)\nspawn_drone(tender)',
  },
];

export const TECH_BY_ID = new Map(TECH_TREE.map((t) => [t.id, t]));

/** Builtins the parser should reject early, mapped to the unlock that grants them. */
export const GAME_LOCKED_NAMES = new Map([
  ['plant', 'seeding'], ['can_harvest', 'seeding'], ['KELP', 'seeding'],
  ['ANEMONE', 'anemones'], ['get_pos_x', 'anemones'], ['get_pos_y', 'anemones'],
  ['get_world_size', 'anemones'],
  ['sense', 'sensors'], ['measure', 'sensors'], ['get_ground', 'sensors'],
  ['is_bleached', 'sensors'], ['EMPTY', 'sensors'],
  ['SAND', 'sensors'], ['SILT', 'sensors'], ['ROCK', 'sensors'],
  ['scrub', 'scrubber'],
  ['CORAL', 'coral'],
  ['SHELL', 'shells'], ['swap', 'shells'],
  ['spawn_drone', 'drones'], ['num_drones', 'drones'],
]);
