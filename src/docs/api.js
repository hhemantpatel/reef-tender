// The Manual. Sections appear as their unlock is bought, so the reference grows
// with the player instead of drowning them on the first screen.

export const MANUAL = [
  {
    id: null,
    title: 'How the reef works',
    lede: 'The drone runs your script from the top, one statement at a time. Anything that touches the reef costs a tick; thinking is free. Growth happens per tick, so your real score is what you harvest per tick, not per line.',
    entries: [
      { sig: 'The grid wraps', text: 'Walk off the east edge and you arrive at the west one. A loop that moves in one direction forever will sweep the whole reef.' },
      { sig: 'North increases y', text: '<code>get_pos_y()</code> counts up as you go north, and <code>get_pos_x()</code> counts up as you go east. The origin is the bottom-left tile.' },
      { sig: 'Run parks the drone', text: 'Pressing Run restarts your script and returns the drone to the origin, so a run always begins from the same place.' },
      { sig: 'The reef keeps growing', text: 'Stopping your script does not freeze the reef. What you planted carries on maturing between runs.' },
    ],
  },
  {
    id: null,
    title: 'Always available',
    entries: [
      { sig: 'move(direction)', cost: 'tick', text: 'Move one tile: <code>NORTH</code>, <code>EAST</code>, <code>SOUTH</code> or <code>WEST</code>.' },
      { sig: 'harvest()', cost: 'tick', text: 'Take whatever is ready on this tile. Returns <code>True</code> if something came up. Harvesting an unripe tile just wastes the tick.' },
      { sig: 'wait()', cost: 'tick', text: 'Do nothing for one tick. Useful when something needs time to grow.' },
      { sig: 'print(value)', text: 'Write to the console below the editor. Your best debugging tool - it costs nothing.' },
      { sig: '# comment', text: 'Everything after a <code>#</code> on a line is ignored.' },
    ],
  },
  {
    id: 'loops',
    title: 'Loops',
    entries: [
      { sig: 'while condition:', text: 'Repeat the indented block for as long as the condition holds. <code>while True:</code> runs until you press Stop.' },
      { sig: 'break', text: 'Leave the loop immediately.' },
      { sig: 'continue', text: 'Skip the rest of this pass and start the next one.' },
    ],
  },
  {
    id: 'seeding',
    title: 'Seeding',
    lede: 'Once you can plant, wild kelp stops drifting in on its own. The reef is yours to lay out.',
    entries: [
      { sig: 'plant(KELP)', cost: 'tick', text: 'Plant on the current tile. Returns <code>False</code> if the tile is occupied, bleached, or bare rock.' },
      { sig: 'can_harvest()', text: 'Is there something ripe here right now?' },
    ],
  },
  {
    id: 'branching',
    title: 'Branching',
    entries: [
      { sig: 'if / elif / else:', text: 'Run a block only when a condition holds.' },
      { sig: '== != &lt; &lt;= &gt; &gt;=', text: 'Compare two values.' },
      { sig: 'and / or / not', text: 'Combine conditions. <code>and</code> and <code>or</code> stop early once the answer is settled.' },
    ],
  },
  {
    id: 'counting',
    title: 'Counting',
    entries: [
      { sig: 'name = value', text: 'Remember a value. Names set inside a function are local to it.' },
      { sig: 'for name in range(n):', text: 'Repeat exactly n times, counting from 0. <code>range(a, b)</code> and <code>range(a, b, step)</code> also work.' },
      { sig: '+ - * / // %', text: '<code>//</code> divides and rounds down; <code>%</code> is the remainder. Both are how you turn a position into a pattern.' },
    ],
  },
  {
    id: 'anemones',
    title: 'Anemones',
    lede: 'Two anemones side by side sting each other and both stop growing. They have to go down with gaps - a checkerboard is the usual answer.',
    entries: [
      { sig: 'plant(ANEMONE)', cost: 'tick', text: 'Slower to mature than kelp, and worth more.' },
      { sig: 'get_pos_x() / get_pos_y()', text: 'Where the drone is. <code>(get_pos_x() + get_pos_y()) % 2</code> tells you which colour of the checkerboard you are standing on.' },
      { sig: 'get_world_size()', text: 'The width of the reef. Use it instead of a hard-coded number and your script survives every expansion.' },
    ],
  },
  {
    id: 'sensors',
    title: 'Sensors',
    lede: 'Read the tile under the drone. None of these cost a tick.',
    entries: [
      { sig: 'sense()', text: 'What is on this tile: <code>EMPTY</code>, <code>KELP</code>, <code>ANEMONE</code>, <code>CORAL</code> or <code>SHELL</code>.' },
      { sig: 'measure()', text: 'How far along the occupant is, from 0 to 1. For a shell it returns the shell size instead.' },
      { sig: 'get_ground()', text: '<code>SAND</code>, <code>SILT</code> or <code>ROCK</code>. Kelp races on silt and refuses rock outright; coral prefers rock.' },
      { sig: 'is_bleached()', text: 'Is this tile bleached?' },
    ],
  },
  {
    id: 'functions',
    title: 'Functions',
    entries: [
      { sig: 'def name(a, b):', text: 'Name a block so you can call it from anywhere, including above where it is written.' },
      { sig: 'return value', text: 'Hand a value back to whoever called the function and stop it there.' },
    ],
  },
  {
    id: 'scrubber',
    title: 'Scrubber',
    lede: 'Bleaching now appears on the reef and creeps to neighbouring tiles. A bleached tile stops growing and cannot be harvested or planted, and reef health scales the growth rate of everything - so ignoring it strangles your income. Clearing it is where pearls come from.',
    entries: [
      { sig: 'scrub()', cost: 'tick', text: 'Clear the bleaching on this tile and collect pearls. On a clean tile it just costs a tick.' },
      { sig: 'Scrub and plant together', text: 'A tile is clean the instant you scrub it, so you can scrub and plant on the same visit. Using <code>elif</code> there costs you a whole sweep.' },
    ],
  },
  {
    id: 'lists',
    title: 'Lists',
    entries: [
      { sig: '[a, b, c]', text: 'Hold several values in order.' },
      { sig: 'xs[i] and xs[i] = v', text: 'Read and replace by position, counting from 0. Negative numbers count back from the end.' },
      { sig: 'xs.append(v) / xs.pop()', text: 'Add to the end, or take the last one off.' },
      { sig: 'len(xs)', text: 'How many items there are.' },
      { sig: 'for v in xs:', text: 'Walk through a list item by item.' },
    ],
  },
  {
    id: 'coral',
    title: 'Coral Bloom',
    lede: 'Harvesting one mature coral pays a single unit and clears the tile. But if every tile on the reef holds mature, unbleached coral at the same moment, a single harvest() blooms the whole reef and pays size x size x 4. Mature coral dies back at random, so it is a race between your sweep and the die-off.',
    entries: [
      { sig: 'plant(CORAL)', cost: 'tick', text: 'Slow to mature. Thrives on rock, struggles on silt.' },
      { sig: 'Do not harvest early', text: 'A stray harvest() takes one polyp and clears that tile, undoing the bloom. Count what is mature first, and only harvest on a full house. The Bloom readout under the reef tracks this for you.' },
    ],
  },
  {
    id: 'shells',
    title: 'Shell Sort',
    lede: 'Fill every tile with a shell, then arrange them in ascending size along a snake path: the bottom row left to right, the next row right to left, and so on. Harvest a sorted reef and it pays size x size x 20.',
    entries: [
      { sig: 'plant(SHELL)', cost: 'tick', text: 'Places a shell of a size you do not get to choose. Every size on the reef is different.' },
      { sig: 'swap(direction)', cost: 'tick', text: 'Exchange the contents of this tile with its neighbour.' },
      { sig: 'measure()', text: 'On a shell tile this gives the shell size, which is what you sort by.' },
      { sig: 'Every snake neighbour is a real neighbour', text: 'Two tiles adjacent in snake order are always physically adjacent, so a single swap() exchanges them. That is what makes a bubble sort possible.' },
    ],
  },
  {
    id: 'drones',
    title: 'Second Drone',
    lede: 'Two drones, one reef, one set of global variables. They take turns, one action each.',
    entries: [
      { sig: 'spawn_drone(fn)', text: 'Start a second drone running the function you name - written without parentheses. It takes no arguments.' },
      { sig: 'num_drones()', text: 'How many drones are running.' },
      { sig: 'They share everything', text: 'Both drones read and write the same globals and the same reef. Splitting the reef between them is the easy half; not tripping over each other is the rest.' },
    ],
  },
];
