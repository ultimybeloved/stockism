// Catalog lookups keyed by something a client sent. A plain `map[key]` also
// finds what every object inherits, so a request naming "constructor" or
// "toString" got a truthy entry back: before 2026-10-28 that bought a pin slot
// and a "cosmetic" for $0 and joined a crew called "constructor". Use this for
// any map indexed by client input.
export const ownEntry = <T>(map: Readonly<Record<string, T>>, key: unknown): T | undefined =>
  typeof key === 'string' && Object.hasOwn(map, key) ? map[key] : undefined;
