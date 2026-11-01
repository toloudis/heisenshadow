import "./console.css";
import {
  type Accessor,
  bindNumber,
  bindPoint,
  bindProperty,
  type KeysOfType,
  localValue,
} from "./binding";
import { ButtonApi, type ButtonOptions } from "./button";
import { DialApi, type DialOptions } from "./dial";
import { Keyboard } from "./keyboard";
import { createLabel } from "./label";
import { SliderApi, type SliderOptions } from "./slider";
import {
  SliderWithButtonApi,
  type SliderWithButtonOptions,
} from "./sliderWithButton";
import { type Point, TrackpadApi, type TrackpadOptions } from "./trackpad";

type Control = { element: HTMLElement; refresh(): void; dispose(): void };

export type BoxOptions = {
  /** Draw a panel background behind the contents. */
  panel?: boolean;
  /** Fill the parent's leftover space along the parent's axis. */
  grow?: boolean;
};
export type GridOptions = BoxOptions & {
  /** Number of button columns. Default 2. */
  columns?: number;
};
export type StripOptions = BoxOptions & {
  /** Text at the top of the strip. */
  label?: string;
};

/**
 * A box of controls. Containers nest: the console is a row; rows and columns
 * arrange anything; a strip is a paneled column for one channel; a grid lays
 * buttons out in a fixed number of columns. Controls have fixed sizes (see
 * console.css), so they line up however they're arranged. See README.md.
 *
 * Like Tweakpane's addBinding, controls can be bound to a property of an
 * object: `addSlider(params, "speed", {...})` reads and writes `params.speed`.
 * Without a target the control keeps its own value; listen with `.on(...)`.
 */
export class ConsoleContainer {
  readonly element: HTMLElement;
  private readonly children: Control[] = [];

  protected constructor(
    element: HTMLElement,
    protected readonly keyboard: Keyboard,
  ) {
    this.element = element;
  }

  /** Add a slider, optionally bound to a numeric property of `target`. */
  addSlider(options?: SliderOptions): SliderApi;
  addSlider<T extends object>(
    target: T,
    key: KeysOfType<T, number>,
    options?: SliderOptions,
  ): SliderApi;
  addSlider(
    a?: object | SliderOptions,
    b?: string,
    c?: SliderOptions,
  ): SliderApi {
    let accessor: Accessor<number>;
    let options: SliderOptions;
    if (typeof b === "string") {
      accessor = bindNumber(a as object, b);
      options = c ?? {};
    } else {
      options = (a as SliderOptions | undefined) ?? {};
      accessor = localValue(options.value ?? options.min ?? 0);
    }
    return this.add(new SliderApi(accessor, this.keyboard, options));
  }

  /** Add a button, optionally bound to a boolean property of `target`. */
  addButton(options?: ButtonOptions): ButtonApi;
  addButton<T extends object>(
    target: T,
    key: KeysOfType<T, boolean>,
    options?: ButtonOptions,
  ): ButtonApi;
  addButton(
    a?: object | ButtonOptions,
    b?: string,
    c?: ButtonOptions,
  ): ButtonApi {
    if (typeof b === "string") {
      const accessor = bindProperty<boolean>(a as object, b);
      return this.add(new ButtonApi(accessor, this.keyboard, c));
    }
    return this.add(
      new ButtonApi(
        localValue(false),
        this.keyboard,
        a as ButtonOptions | undefined,
      ),
    );
  }

  /** Add a button-sized dial, optionally bound to a numeric property of `target`. */
  addDial(options?: DialOptions): DialApi;
  addDial<T extends object>(
    target: T,
    key: KeysOfType<T, number>,
    options?: DialOptions,
  ): DialApi;
  addDial(a?: object | DialOptions, b?: string, c?: DialOptions): DialApi {
    let accessor: Accessor<number>;
    let options: DialOptions;
    if (typeof b === "string") {
      accessor = bindNumber(a as object, b);
      options = c ?? {};
    } else {
      options = (a as DialOptions | undefined) ?? {};
      accessor = localValue(options.value ?? options.min ?? 0);
    }
    return this.add(new DialApi(accessor, this.keyboard, options));
  }

  /**
   * Add a slider paired with a button, optionally bound to a numeric property
   * of `target`. With `gated: true` the button switches the binding on and off.
   */
  addSliderWithButton(options?: SliderWithButtonOptions): SliderWithButtonApi;
  addSliderWithButton<T extends object>(
    target: T,
    key: KeysOfType<T, number>,
    options?: SliderWithButtonOptions,
  ): SliderWithButtonApi;
  addSliderWithButton(
    a?: object | SliderWithButtonOptions,
    b?: string,
    c?: SliderWithButtonOptions,
  ): SliderWithButtonApi {
    let accessor: Accessor<number>;
    let options: SliderWithButtonOptions;
    if (typeof b === "string") {
      accessor = bindNumber(a as object, b);
      options = c ?? {};
    } else {
      options = (a as SliderWithButtonOptions | undefined) ?? {};
      accessor = localValue(options.value ?? options.min ?? 0);
    }
    return this.add(new SliderWithButtonApi(accessor, this.keyboard, options));
  }

  /**
   * Add a square trackpad (as big as a 2×2 button grid) that sets a 2D point,
   * optionally bound to an `{x, y}` property of `target`.
   */
  addTrackpad(options?: TrackpadOptions): TrackpadApi;
  addTrackpad<T extends object>(
    target: T,
    key: KeysOfType<T, Point>,
    options?: TrackpadOptions,
  ): TrackpadApi;
  addTrackpad(
    a?: object | TrackpadOptions,
    b?: string,
    c?: TrackpadOptions,
  ): TrackpadApi {
    let accessor: Accessor<Point>;
    let options: TrackpadOptions;
    if (typeof b === "string") {
      accessor = bindPoint(a as object, b);
      options = c ?? {};
    } else {
      options = (a as TrackpadOptions | undefined) ?? {};
      accessor = localValue(
        options.value ?? {
          x: ((options.x?.min ?? -1) + (options.x?.max ?? 1)) / 2,
          y: ((options.y?.min ?? -1) + (options.y?.max ?? 1)) / 2,
        },
      );
    }
    return this.add(new TrackpadApi(accessor, options));
  }

  /** Add a container that lays out its children left to right. */
  addRow(options: BoxOptions = {}): ConsoleContainer {
    return this.addContainer("cc-row", options);
  }

  /** Add a container that lays out its children top to bottom. */
  addColumn(options: BoxOptions = {}): ConsoleContainer {
    return this.addContainer("cc-column", options);
  }

  /** Add a paneled column for one channel, e.g. a slider over its button. */
  addStrip(options: StripOptions = {}): ConsoleContainer {
    const container = this.addContainer("cc-strip cc-column", {
      panel: true,
      ...options,
    });
    if (options.label) {
      container.element.append(createLabel(options.label));
    }
    return container;
  }

  /** Add a paneled grid of square buttons. */
  addGrid(options: GridOptions = {}): ConsoleContainer {
    const container = this.addContainer("cc-grid", { panel: true, ...options });
    container.element.style.gridTemplateColumns = `repeat(${options.columns ?? 2}, var(--cc-button-size))`;
    return container;
  }

  /** Re-read every bound value, e.g. after loading settings. */
  refresh() {
    for (const c of this.children) c.refresh();
  }

  dispose() {
    for (const c of this.children) c.dispose();
    this.children.length = 0;
    this.element.remove();
  }

  private addContainer(
    className: string,
    options: BoxOptions,
  ): ConsoleContainer {
    const element = document.createElement("div");
    element.className = className;
    if (options.panel) element.classList.add("cc-panel");
    if (options.grow) element.classList.add("cc-grow");
    return this.add(new ConsoleContainer(element, this.keyboard));
  }

  private add<C extends Control>(control: C): C {
    this.children.push(control);
    this.element.append(control.element);
    return control;
  }
}

/**
 * The root of a console: a row appended to `container`. It owns the keyboard
 * listener for every control's hotkeys; `dispose()` removes it.
 */
export class ControlConsole extends ConsoleContainer {
  constructor(options: { container: HTMLElement }) {
    const element = document.createElement("div");
    element.className = "cc-console";
    options.container.append(element);
    super(element, new Keyboard());
  }

  override dispose() {
    super.dispose();
    this.keyboard.dispose();
  }
}
