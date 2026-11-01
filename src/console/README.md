# console

A control panel of large, hardware-style controls (vertical and horizontal sliders and square buttons), designed to be played from the keyboard like a DJ console. You build it in code like a Tweakpane pane, and each control can be bound to a property of a parameter object.

Import everything from the folder's entry point, [index.ts](index.ts). The other modules are internal.

```ts
import { ControlConsole } from "./console";
```

## Quick start

```ts
const params = { speed: 5, density: 0.5 };

const panel = new ControlConsole({
  container: document.querySelector("#console-panel")!,
});

// A slider bound to params.speed, raised/lowered by holding Q/A, with a
// button under it (Z) that resets the speed when pressed.
panel
  .addSliderWithButton(params, "speed", {
    label: "speed",
    min: 0,
    max: 10,
    upKey: "q",
    downKey: "a",
    buttonLabel: "reset",
    buttonKey: "z",
    buttonMode: "continuous", // lit only while held
  })
  .on("press", () => {
    params.speed = 5;
    panel.refresh();
  });

// A gated slider: it can always be moved, but it only writes params.density
// while its button (B) is on.
panel.addSliderWithButton(params, "density", {
  label: "density",
  upKey: "t",
  downKey: "g",
  gated: true,
  buttonKey: "b",
});

// Four buttons in a 2×2 grid, without hotkeys.
const grid = panel.addGrid({ columns: 2 });
for (const label of ["A", "B", "C", "D"]) grid.addButton({ label });
```

## Concepts

### Binding

Every `add*` control method has two forms:

- **Bound:** `addSlider(target, key, options)` reads and writes `target[key]` directly, like Tweakpane's `addBinding`. TypeScript only accepts keys whose values have the right type: numbers for sliders, booleans for buttons.
- **Unbound:** `addSlider(options)`. The control keeps its own value. Read it with `.value`, or listen with `.on("change", …)`.

If the target changes somewhere else (for example after loading settings), call `refresh()` on the console, a container, or a single control so the controls show the new values.

### Hotkeys

A key can be a single letter or digit (`"q"`, `"7"`) or a [`KeyboardEvent.code`](https://developer.mozilla.org/docs/Web/API/KeyboardEvent/code) (`"ArrowUp"`, `"Space"`). Keys are matched by physical position, so Shift and Caps Lock make no difference.

- **Sliders** move smoothly for as long as the key is held, at `speed` (a fraction of the full range per second). A quick tap moves the slider by one `step`, or by 1/200 of the range if there is no step.
- **Buttons** react to the key the same way as to a mouse press: press on keydown, release on keyup.
- Hotkeys are ignored while the user is typing in a text field and while Ctrl, Alt or Meta is held, so normal shortcuts still work.
- If the window loses focus, every held key is released, so no slider keeps running.

The hint under each control shows its keys.

### Layout

The console is a row. Inside it you can nest containers:

| Method               | What it creates                                    |
| -------------------- | -------------------------------------------------- |
| `addRow(options)`    | Children laid out left to right.                   |
| `addColumn(options)` | Children laid out top to bottom.                   |
| `addStrip(options)`  | A column with a panel background, for one channel. |
| `addGrid(options)`   | A panel holding a grid of square buttons.          |

Each method returns a container with the same `add*` methods, so containers nest freely. Controls have fixed sizes, and nothing stretches unless asked to: sliders fill their length, and containers created with `grow: true` take the leftover space. For example, a toolbar above a row of channels, with a button grid to the right:

```ts
const left = panel.addColumn();
const toolbar = left.addRow({ panel: true });
const channels = left.addRow({ grow: true });
toolbar.addButton({ label: "rec" });
channels.addSliderWithButton({
  label: "S1",
  upKey: "q",
  downKey: "a",
  buttonKey: "z",
});
panel.addGrid({ columns: 2 }).addButton({ label: "G1" });
```

### Events

Controls report what happens through events. `control.on(name, handler)` subscribes and returns a function that unsubscribes:

```ts
const off = slider.on("change", (value) => console.log(value));
off(); // stop listening
```

These rules apply to every event:

- **Handlers run synchronously**, in the order they subscribed, inside the key, pointer or property-set call that caused them. By the time a `change` handler runs, the target has already been written.
- **Events report real changes only.** A `change` never fires when the new value equals the old one.
- **`refresh()` never fires events.** It only re-reads targets that something else changed.
- **Setting a value from code fires the same events as user input.** For example, `slider.value = 3` fires `change`. To update a control without triggering events, change the target object and call `refresh()`.
- **Containers have no events.** Only the controls listed below do.

Each control's events are defined in its API section below. The event maps are also exported as types (`SliderEvents`, `ButtonEvents`, `SliderWithButtonEvents`) and documented in the source, so editors show the definitions on hover.

## API reference

### `new ControlConsole({ container })`

Creates the console and appends it to `container`. The console also handles the keyboard for every control's hotkeys. Call `dispose()` to remove the console and its keyboard listeners.

### Container options

| Option    | Applies to | Description                                                                       |
| --------- | ---------- | --------------------------------------------------------------------------------- |
| `panel`   | all        | Draws a panel background behind the contents. On by default for strips and grids. |
| `grow`    | all        | Makes the container fill the leftover space along its parent's direction.         |
| `label`   | strip      | Text shown at the top of the strip.                                               |
| `columns` | grid       | Number of button columns. Default 2.                                              |

### `addSlider([target, key,] options)` → `SliderApi`

| Option        | Default      | Description                                                                                                   |
| ------------- | ------------ | ------------------------------------------------------------------------------------------------------------- |
| `label`       | none         | Text shown above the track (vertical) or to its left (horizontal).                                            |
| `min`, `max`  | 0, 1         | The value range.                                                                                              |
| `step`        | none         | Snaps the value to multiples of `step`, counted from `min`.                                                   |
| `upKey`       | none         | Key that raises the value while held.                                                                         |
| `downKey`     | none         | Key that lowers the value while held.                                                                         |
| `speed`       | 0.5          | Fraction of the full range traveled per second while a key is held.                                           |
| `format`      | auto         | `(value) => string` for the readout. By default it shows as many decimals as `step` has, or 2 without a step. |
| `value`       | `min`        | Starting value. Only used when the slider is unbound.                                                         |
| `orientation` | `"vertical"` | `"vertical"` increases upward; `"horizontal"` increases to the right.                                         |

**`SliderApi` members**

- `value`: the current value. Setting it clamps and snaps the value, writes the target, and fires `change`.
- `on(event, handler)`: subscribes to an event and returns an unsubscribe function.
- `refresh()`: re-reads the target. `dispose()`: removes the slider and its key bindings. `element`: the slider's DOM element.

**`SliderApi` events**

| Event    | Payload                 | Fires when                                                                                                                                                                                           | Does not fire                                                                                                                |
| -------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `change` | `number`, the new value | The value changes: while dragging, while a key is held (at most once per animation frame), on each key tap, or when `value` is set. The value is already clamped, snapped and written to the target. | From `refresh()`; when the value doesn't change, such as when a key is held at `min`/`max` or a move is smaller than `step`. |

### `addButton([target, key,] options)` → `ButtonApi`

Every button has an on/off value and is lit while it is on.

| Option  | Default    | Description                                                                                                                                                                                |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `label` | none       | Text shown on the button.                                                                                                                                                                  |
| `key`   | none       | Key that presses the button.                                                                                                                                                               |
| `mode`  | `"toggle"` | `"toggle"`: the value flips each time the button is released, so it stays lit or unlit between clicks. `"continuous"`: the value is true while the button is held and false when released. |

**`ButtonApi` members**

- `value`: the on/off state (the bound boolean, if the button is bound). Setting it writes the target and fires `change`.
- `on(event, handler)`: subscribes to an event and returns an unsubscribe function.
- `refresh()`: re-reads the target. `dispose()`: removes the button and its key binding. `element`: the button's DOM element.

**`ButtonApi` events**

| Event     | Payload                  | Fires when                                                                                                                                                                          | Does not fire                                                                                   |
| --------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `press`   | none                     | The button goes down, by its key or the pointer.                                                                                                                                    | For a second press while the button is already down, such as clicking it while its key is held. |
| `release` | none                     | The button comes back up: the last key or pointer holding it lets go, the pointer is cancelled, or the window loses focus while the key is held. Always follows a `press`.          | While another key or pointer is still holding the button.                                       |
| `change`  | `boolean`, the new value | The on/off value changes. In `"toggle"` mode this happens on release; in `"continuous"` mode it happens on press (`true`) and on release (`false`). Also fires when `value` is set. | From `refresh()`; when the value doesn't change.                                                |

The order of events for one click:

| Mode           | Pressing          | Releasing           |
| -------------- | ----------------- | ------------------- |
| `"toggle"`     | `press`           | `change`, `release` |
| `"continuous"` | `change`, `press` | `change`, `release` |

`change` always comes first, so by the time a `press` or `release` handler runs, `value` already holds the new state.

### `addSliderWithButton([target, key,] options)` → `SliderWithButtonApi`

A slider and a button combined into one channel. In vertical orientation the slider sits above the button; in horizontal orientation the button sits to its left. It takes every slider option above, plus:

| Option        | Default                            | Description                                                                                                                                                                              |
| ------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gated`       | `false`                            | When true, the button acts as an on/off gate for the slider's binding (see below). When false, the button works on its own; listen for its `press` / `release` events, or use `.button`. |
| `buttonLabel` | `"on"` if gated, otherwise empty   | Text shown on the button.                                                                                                                                                                |
| `buttonKey`   | none                               | Key that presses the button.                                                                                                                                                             |
| `buttonMode`  | `"toggle"`                         | The button's `mode` when not gated. A gate always toggles.                                                                                                                               |
| `buttonValue` | `true` if gated, otherwise `false` | The button's starting state.                                                                                                                                                             |

**How gating works.** The slider can always be moved, but it only writes to its target while the button is on. While the button is off, the slider is dimmed and the target keeps its last value. When you turn the button back on, the target immediately jumps to the slider's current position. This lets you set up a new value without affecting anything, then switch it in.

**`SliderWithButtonApi` members**

- `value`: the target's value. While gated off, this can differ from the slider's position.
- `enabled`: whether the slider is currently writing to the target. Setting it switches the gate and fires `enable`. When not gated, it is always true and setting it does nothing.
- `on(event, handler)`: subscribes to an event and returns an unsubscribe function.
- `slider` and `button`: the underlying `SliderApi` and `ButtonApi`. Their own events still fire. Note that `slider`'s `change` reports the slider's position, even while gated off.
- `refresh()`: re-reads the target, unless gated off. `dispose()`: removes the channel and its key bindings. `element`: the channel's DOM element.

**`SliderWithButtonApi` events**

| Event     | Payload                         | Fires when                                                                                                                                                                      | Does not fire                                                     |
| --------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `change`  | `number`, the value written     | The target is written. This happens while the slider moves (unless gated off), and once when a gate turns on and the target catches up to a slider that moved while it was off. | While gated off; from `refresh()`; when the value doesn't change. |
| `enable`  | `boolean`, the gate's new state | The gate turns on (`true`) or off (`false`), by its key, the pointer, or setting `enabled`.                                                                                     | When `gated` is false.                                            |
| `press`   | none                            | The button goes down. Fires whether or not the channel is gated. Use it for one-shot actions such as a reset.                                                                   | As for `ButtonApi`.                                               |
| `release` | none                            | The button comes back up. Fires whether or not the channel is gated.                                                                                                            | As for `ButtonApi`.                                               |

Turning a gate on is a single toggle click, so it fires `press` when pressed, then `enable(true)`, `change(value)`, `release` when released. `change` fires only if the slider moved while the gate was off. Turning a gate off fires `press`, then `enable(false)`, `release`.

When not gated, the button's state is reached through `button.value` and `button.on("change", …)`.

## Styling

[console.css](console.css) is imported by the module itself. Sizes are CSS variables on `.cc-console`. Override them there, or on any container to resize only that part:

| Variable             | Default | Controls                                   |
| -------------------- | ------- | ------------------------------------------ |
| `--cc-button-size`   | 48px    | Width and height of every button.          |
| `--cc-slider-width`  | 52px    | Width of vertical sliders.                 |
| `--cc-slider-height` | 36px    | Height of horizontal sliders.              |
| `--cc-gap`           | 6px     | Space between controls inside a container. |

The colors (`--cc-bg`, `--cc-panel`, `--cc-fg`, `--cc-dim`, `--cc-accent`, `--cc-control`, `--cc-control-hover`) are defined in the same place. All class names start with `cc-`.

## Source layout

| File                                                                                       | Contents                                                  |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| [index.ts](index.ts)                                                                       | The public exports.                                       |
| [controlConsole.ts](controlConsole.ts)                                                     | `ControlConsole` and the containers (`ConsoleContainer`). |
| [slider.ts](slider.ts), [button.ts](button.ts), [sliderWithButton.ts](sliderWithButton.ts) | The controls.                                             |
| [keyboard.ts](keyboard.ts)                                                                 | Hotkey handling (internal).                               |
| [binding.ts](binding.ts), [emitter.ts](emitter.ts)                                         | Value binding and events (internal).                      |
| [console.css](console.css)                                                                 | Styles and size variables.                                |

The module has no runtime dependencies. It imports its own CSS, so it currently relies on a bundler that handles CSS imports, such as Vite. If it becomes a package, its own `package.json` and a TypeDoc build that reads the TSDoc comments in the source would be a natural fit.
