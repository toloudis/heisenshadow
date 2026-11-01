type Handler<V> = (value: V) => void;

// Minimal typed event emitter. `on` returns a function that unsubscribes.
export class Emitter<Events extends Record<string, unknown>> {
  private handlers: { [K in keyof Events]?: Set<Handler<Events[K]>> } = {};

  on<K extends keyof Events>(name: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers[name];
    if (!set) {
      set = new Set();
      this.handlers[name] = set;
    }
    set.add(handler);
    return () => set.delete(handler);
  }

  emit<K extends keyof Events>(name: K, value: Events[K]) {
    for (const handler of this.handlers[name] ?? []) {
      handler(value);
    }
  }
}
