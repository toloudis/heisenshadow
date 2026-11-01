// Controls read and write their value through an Accessor, so the same control
// works whether it is bound to a property of some object (like a Tweakpane
// binding) or just holds its own value.
export type Accessor<V> = {
  get(): V;
  set(value: V): void;
};

// Keys of T whose values are assignable to V, e.g. the number fields of params.
export type KeysOfType<T, V> = {
  [K in keyof T]: T[K] extends V ? K : never;
}[keyof T] &
  string;

export function bindProperty<V>(target: object, key: string): Accessor<V> {
  const obj = target as Record<string, V>;
  return {
    get: () => obj[key],
    set: (value) => {
      obj[key] = value;
    },
  };
}

/**
 * Bind to a property that must hold a single number. Sliders and dials only
 * work with plain numbers, so anything else (a point, a string, a missing
 * key) is an error rather than a control that silently misbehaves.
 */
export function bindNumber(target: object, key: string): Accessor<number> {
  const value = (target as Record<string, unknown>)[key];
  if (typeof value !== "number") {
    const found =
      value !== null && typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
    throw new TypeError(
      `Console sliders and dials bind a single number, but "${key}" is ${found}. (Use a trackpad for {x, y} points.)`,
    );
  }
  return bindProperty<number>(target, key);
}

/**
 * Bind to a property that must hold an `{x, y}` point of numbers, as
 * trackpads need. Writes update the existing point object in place, so
 * anything else holding a reference to it sees the new values.
 */
export function bindPoint(
  target: object,
  key: string,
): Accessor<{ x: number; y: number }> {
  const value = (target as Record<string, unknown>)[key];
  const p = value as { x?: unknown; y?: unknown } | null;
  if (
    p === null ||
    typeof p !== "object" ||
    typeof p.x !== "number" ||
    typeof p.y !== "number"
  ) {
    throw new TypeError(
      `Console trackpads bind an {x, y} point, but "${key}" is ${JSON.stringify(value) ?? String(value)}.`,
    );
  }
  const obj = target as Record<string, { x: number; y: number }>;
  return {
    get: () => obj[key],
    set: (v) => {
      obj[key].x = v.x;
      obj[key].y = v.y;
    },
  };
}

export function localValue<V>(initial: V): Accessor<V> {
  let value = initial;
  return {
    get: () => value,
    set: (v) => {
      value = v;
    },
  };
}
