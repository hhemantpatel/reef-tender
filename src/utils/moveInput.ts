/**
 * Virtual-joystick input. Mutated on every touchmove and read inside the render
 * loop, so it lives outside React state to avoid re-rendering the whole app.
 */
export const moveInput = { x: 0, z: 0 };
