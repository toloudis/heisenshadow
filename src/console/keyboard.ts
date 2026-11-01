export type KeyHandlers = {
  down?: () => void;
  up?: () => void;
};

// Keys are given as a single character ("q", "7") or as a KeyboardEvent.code
// ("ArrowUp", "Space"). Matching on physical key codes keeps a held key working
// when Shift or Caps Lock changes the character it produces.
export function keyToCode(key: string): string {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return key;
}

export function keyLabel(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key;
}

// Don't steal keystrokes meant for text fields (e.g. Tweakpane's text inputs).
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

// Dispatches key press and release to bound handlers. Auto-repeat keydowns are
// swallowed, so `down` fires once per press and `up` once per release; controls
// that act continuously while held run their own animation loop in between.
export class Keyboard {
  private bindings = new Map<string, KeyHandlers[]>();
  private held = new Set<string>();

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.releaseAll);
  }

  bind(key: string, handlers: KeyHandlers): () => void {
    const code = keyToCode(key);
    const list = this.bindings.get(code) ?? [];
    list.push(handlers);
    this.bindings.set(code, list);
    return () => {
      const i = list.indexOf(handlers);
      if (i >= 0) list.splice(i, 1);
    };
  }

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.releaseAll);
    this.bindings.clear();
    this.held.clear();
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const list = this.bindings.get(e.code);
    if (!list?.length) return;
    if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
    e.preventDefault();
    if (e.repeat || this.held.has(e.code)) return;
    this.held.add(e.code);
    for (const h of list) h.down?.();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (!this.held.delete(e.code)) return;
    e.preventDefault();
    for (const h of this.bindings.get(e.code) ?? []) h.up?.();
  };

  // The window misses keyups while it is unfocused, so release everything on
  // blur rather than leave a slider running.
  private releaseAll = () => {
    for (const code of this.held) {
      for (const h of this.bindings.get(code) ?? []) h.up?.();
    }
    this.held.clear();
  };
}
