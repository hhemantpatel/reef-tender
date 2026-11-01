import init, { PhysicsEngine } from './pkg/game_engine_wasm.js';
import wasmUrl from './pkg/game_engine_wasm_bg.wasm?url';

let engineInstance: PhysicsEngine | null = null;
let wasmMemory: WebAssembly.Memory | null = null;
let initPromise: Promise<PhysicsEngine> | null = null;

export async function getPhysicsEngine(): Promise<PhysicsEngine> {
  if (engineInstance) return engineInstance;

  if (!initPromise) {
    initPromise = (async () => {
      wasmMemory = (await init(wasmUrl)).memory;
      engineInstance = new PhysicsEngine();
      return engineInstance;
    })();
  }

  return initPromise;
}

/**
 * Zero-copy Float32Array view of the engine's particle buffer in wasm memory.
 * Valid only until the next engine call that may grow memory; re-create it every frame
 * (cheap: no copy) rather than caching it.
 */
export function getParticleView(engine: PhysicsEngine): Float32Array | null {
  if (!wasmMemory) return null;
  return new Float32Array(wasmMemory.buffer, engine.get_particles_ptr(), engine.get_particles_len());
}
