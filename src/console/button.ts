import type { Accessor } from "./binding";
import { Emitter } from "./emitter";
import { type Keyboard, keyLabel } from "./keyboard";
import { createLabel } from "./label";

export type ButtonOptions = {
  /** Text shown on the button. */
  label?: string;
  /**
   * Key that presses the button, e.g. `"z"`. A single letter or digit, or a
   * `KeyboardEvent.code` such as `"Space"`.
   */
  key?: string;
  /**
   * `"toggle"` (default): the value flips on each release, so the button stays
   * lit or unlit between clicks. `"continuous"`: the value is true while the
   * button is held and false once released.
   */
  mode?: ButtonMode;
};

export type ButtonMode = "toggle" | "continuous";

/** Events of {@link ButtonApi}. Handlers run synchronously. */
export type ButtonEvents = {
  /**
   * The on/off value changed; carries the new value. In `"toggle"` mode it
   * fires on release (before `release`); in `"continuous"` mode it fires
   * `true` on press (before `press`) and `false` on release (before
   * `release`). Also fires when `value` is set to a different value. Never
   * fires from `refresh()` or when the value is unchanged.
   */
  change: boolean;
  /**
   * The button went down, by its key or the pointer. If the key and the
   * pointer both hold it, this fires only for the first.
   */
  press: undefined;
  /**
   * The button came back up: the last key or pointer holding it let go, the
   * pointer was cancelled, or the window lost focus while the key was held.
   * Always follows a `press`.
   */
  release: undefined;
};
type PressSource = "key" | "pointer";

/**
 * A square button with an on/off value, shown lit when on. Created with
 * `container.addButton(...)`.
 */
export class ButtonApi {
  readonly element: HTMLButtonElement;

  private readonly mode: ButtonMode;
  private readonly emitter = new Emitter<ButtonEvents>();
  private readonly unbindKey: (() => void) | undefined;
  // The key and the pointer can both hold the button; it releases when the
  // last of them lets go.
  private readonly pressedBy = new Set<PressSource>();

  constructor(
    private readonly accessor: Accessor<boolean>,
    keyboard: Keyboard,
    options: ButtonOptions = {},
  ) {
    this.mode = options.mode ?? "toggle";

    this.element = document.createElement("button");
    this.element.className = "cc-button";
    this.element.type = "button";
    this.element.append(createLabel(options.label ?? "", "span"));
    if (options.key) {
      const hint = document.createElement("span");
      hint.className = "cc-key-hint";
      hint.textContent = keyLabel(options.key);
      this.element.append(hint);
    }

    this.element.addEventListener("pointerdown", (e) => {
      this.element.setPointerCapture(e.pointerId);
      this.press("pointer");
    });
    this.element.addEventListener("pointerup", () => this.release("pointer"));
    this.element.addEventListener("pointercancel", () =>
      this.release("pointer"),
    );

    this.unbindKey = options.key
      ? keyboard.bind(options.key, {
          down: () => this.press("key"),
          up: () => this.release("key"),
        })
      : undefined;

    this.render();
  }

  /** The on/off state (the bound boolean, if bound). Lit when true. */
  get value(): boolean {
    return this.accessor.get();
  }

  set value(v: boolean) {
    this.setValue(v);
  }

  /**
   * Listen for `"change"` (the new boolean), `"press"`, or `"release"`.
   * Returns an unsubscribe function.
   */
  on<K extends keyof ButtonEvents>(
    name: K,
    handler: (value: ButtonEvents[K]) => void,
  ): () => void {
    return this.emitter.on(name, handler);
  }

  refresh() {
    this.render();
  }

  dispose() {
    this.unbindKey?.();
    this.element.remove();
  }

  private press(source: PressSource) {
    const wasPressed = this.pressedBy.size > 0;
    this.pressedBy.add(source);
    if (wasPressed) return;
    if (this.mode === "continuous") this.setValue(true);
    this.render();
    this.emitter.emit("press", undefined);
  }

  private release(source: PressSource) {
    if (!this.pressedBy.delete(source) || this.pressedBy.size > 0) return;
    this.setValue(this.mode === "toggle" ? !this.value : false);
    this.render();
    this.emitter.emit("release", undefined);
  }

  private setValue(v: boolean) {
    if (v !== this.accessor.get()) {
      this.accessor.set(v);
      this.emitter.emit("change", v);
    }
    this.render();
  }

  private render() {
    this.element.classList.toggle("cc-pressed", this.pressedBy.size > 0);
    this.element.classList.toggle("cc-on", this.value);
  }
}
