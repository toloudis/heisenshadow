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

export function localValue<V>(initial: V): Accessor<V> {
  let value = initial;
  return {
    get: () => value,
    set: (v) => {
      value = v;
    },
  };
}
