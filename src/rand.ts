// Seedable PRNG (mulberry32), so a frame can be drawn again with the same
// random choices, e.g. at a higher resolution for export.
let state = newRandomSeed();

export function newRandomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

export function setRandomSeed(seed: number) {
  state = seed >>> 0;
}

/** The generator's current state; pass it to setRandomSeed to resume from here. */
export function getRandomSeed(): number {
  return state;
}

function next(): number {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
}

export function rand(min: number, max: number) {
  return next() * (max - min) + min;
}
