/**
 * A setting a renderer exposes in its settings panel: a property of some
 * object (usually `params` or a part of it) that the app shows as a control
 * while the renderer is active. Plain data, so renderers don't depend on a UI
 * library; main.ts turns these into Tweakpane bindings.
 */
export type RendererSetting = {
  target: object;
  key: string;
  label?: string;
  /** Hover text explaining the setting. */
  tooltip?: string;
  /**
   * Numeric range and step. For `{x, y}` point values the range applies to
   * both axes. Console sliders and dials accept single numbers and throw for
   * anything else; bind points to a console trackpad instead.
   */
  min?: number;
  max?: number;
  step?: number;
  /** A fixed set of choices (label → value), shown as a dropdown in the pane. */
  options?: Record<string, number>;
};

/** Describe a setting, checking that `key` is a property of `target`. */
export function setting<T extends object>(
  target: T,
  key: keyof T & string,
  options: Omit<RendererSetting, "target" | "key"> = {},
): RendererSetting {
  return { target, key, ...options };
}

export interface Renderer {
  clear: (ctx: CanvasRenderingContext2D) => void;
  render: (ctx: CanvasRenderingContext2D, dt: number) => void;
  resize: (w: number, h: number) => void;
  pointerMove: (e: PointerEvent, relx: number, rely: number) => boolean;
  /** Settings specific to this renderer, shown in their own panel while it is active. */
  settings?: () => RendererSetting[];
}
