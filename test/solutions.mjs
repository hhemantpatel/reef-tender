// Reference solutions, one per tier. These are what a competent player would
// write with exactly the unlocks they have at that point -- so they double as
// proof the mini-language can express each puzzle, and as the balance yardstick.

export const TIER0 = Array.from({ length: 24 }, () => 'harvest()\nmove(EAST)').join('\n');

export const LOOPS = `while True:
    harvest()
    move(EAST)`;

export const SEEDING = `while True:
    harvest()
    plant(KELP)
    move(EAST)`;

export const BRANCHING = `while True:
    if can_harvest():
        harvest()
    plant(KELP)
    move(EAST)`;

export const COUNTING = `while True:
    for i in range(4):
        for j in range(4):
            if can_harvest():
                harvest()
            plant(KELP)
            move(EAST)
        move(NORTH)`;

// Anemones stall if they touch, so they go on one colour of the checkerboard
// and kelp fills the other.
export const ANEMONES = `while True:
    for y in range(get_world_size()):
        for x in range(get_world_size()):
            if can_harvest():
                harvest()
            if (get_pos_x() + get_pos_y()) % 2 == 0:
                plant(ANEMONE)
            else:
                plant(KELP)
            move(EAST)
        move(NORTH)`;

// With Sensors the reef can be read: kelp likes silt, anemones tolerate rock.
export const SENSORS = `while True:
    for y in range(get_world_size()):
        for x in range(get_world_size()):
            if can_harvest():
                harvest()
            if sense() == EMPTY:
                if (get_pos_x() + get_pos_y()) % 2 == 0:
                    plant(ANEMONE)
                elif get_ground() == ROCK:
                    plant(ANEMONE)
                else:
                    plant(KELP)
            move(EAST)
        move(NORTH)`;

export const FUNCTIONS = `def tend():
    if can_harvest():
        harvest()
    if sense() == EMPTY:
        if (get_pos_x() + get_pos_y()) % 2 == 0:
            plant(ANEMONE)
        else:
            plant(KELP)

def sweep():
    n = get_world_size()
    for y in range(n):
        for x in range(n):
            tend()
            move(EAST)
        move(NORTH)

while True:
    sweep()`;

// Scrubber adds the one branch that keeps the reef alive - and pays for itself.
export const SCRUBBER = `def tend():
    if is_bleached():
        scrub()
        return None
    if can_harvest():
        harvest()
    if sense() == EMPTY:
        if (get_pos_x() + get_pos_y()) % 2 == 0:
            plant(ANEMONE)
        else:
            plant(KELP)

def sweep():
    n = get_world_size()
    for y in range(n):
        for x in range(n):
            tend()
            move(EAST)
        move(NORTH)

while True:
    sweep()`;

// Coral only pays properly when every tile is mature at once, so the sweep
// counts what it sees and only harvests on a full house.
// Coral only pays properly when every tile is mature at once. The sweep has to
// clear whatever is left over from earlier tiers, replant what died back, and
// only harvest on a full house -- harvesting early takes one polyp and undoes it.
export const CORAL = `def sweep_and_count():
    n = get_world_size()
    ready = 0
    for y in range(n):
        for x in range(n):
            if is_bleached():
                scrub()
            if sense() == EMPTY:
                plant(CORAL)
            elif sense() != CORAL:
                harvest()
            elif measure() >= 1:
                ready = ready + 1
            move(EAST)
        move(NORTH)
    return ready

while True:
    n = get_world_size()
    if sweep_and_count() == n * n:
        harvest()`;

// Bubble sort along the snake path. Every pair adjacent in snake order is also
// physically adjacent, so one swap() does the exchange. Passes repeat until one
// of them changes nothing, which is how the program knows the reef is sorted.
export const SHELLS = `def fill():
    n = get_world_size()
    covered = 0
    for y in range(n):
        for x in range(n):
            if is_bleached():
                scrub()
            if sense() == EMPTY:
                plant(SHELL)
            elif sense() != SHELL:
                harvest()
            if sense() == SHELL:
                covered = covered + 1
            move(EAST)
        move(NORTH)
    return covered

def bubble_row(n, fwd, back):
    swaps = 0
    for i in range(n - 1):
        here = measure()
        move(fwd)
        if is_bleached():
            scrub()
        if here > measure():
            swap(back)
            swaps = swaps + 1
    return swaps

def step_up():
    here = measure()
    move(NORTH)
    if here > measure():
        swap(SOUTH)
        return 1
    return 0

def one_pass():
    n = get_world_size()
    swaps = 0
    for y in range(n):
        if y % 2 == 0:
            swaps = swaps + bubble_row(n, EAST, WEST)
        else:
            swaps = swaps + bubble_row(n, WEST, EAST)
        if y < n - 1:
            swaps = swaps + step_up()
    move(NORTH)
    while get_pos_x() != 0:
        move(WEST)
    return swaps

while True:
    n = get_world_size()
    if fill() == n * n:
        swaps = 1
        while swaps > 0:
            swaps = one_pass()
        harvest()`;

export const DRONES = `def tend():
    if is_bleached():
        scrub()
        return None
    if can_harvest():
        harvest()
    if sense() == EMPTY:
        if (get_pos_x() + get_pos_y()) % 2 == 0:
            plant(ANEMONE)
        else:
            plant(KELP)

def southern():
    while True:
        n = get_world_size()
        for x in range(n):
            tend()
            move(EAST)
        move(NORTH)

spawn_drone(southern)
while True:
    n = get_world_size()
    for x in range(n):
        tend()
        move(EAST)
    move(NORTH)`;
