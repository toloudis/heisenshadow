// App-wide params: the paper, playback, export, and the thickness image.
//
// Each renderer keeps its own params (including its own marks: thickness,
// dilation, ...) in renderers/<name>/settings.ts and registers them here with
// registerParams, so they're saved, loaded and put in the URL alongside these.
type Params = {
  speed: number;
  border: number;
  clearInBetween: boolean;
  imageThicknessEnabled: boolean;
  imageThicknessUrl: string;
  isDrawing: boolean;
  canvasAspect: number;
  export: {
    format: string; // "png" | "jpeg"
    longEdge: number; // pixels along the longer side of the exported image
    jpegQuality: number;
  };
};

const params: Params = {
  speed: 5,
  border: 0.04,
  clearInBetween: true,
  imageThicknessEnabled: false,
  imageThicknessUrl:
    "https://upload.wikimedia.org/wikipedia/commons/6/6a/Mona_Lisa.jpg",
  isDrawing: false,
  canvasAspect: 8.5 / 11,
  export: {
    format: "png",
    longEdge: 4096,
    jpegQuality: 0.92,
  },
};

// ---- Registered renderer params ---------------------------------------------
type ParamLeaf = number | boolean | string;
type ParamTree = { [key: string]: ParamLeaf | ParamTree };

const sections = new Map<string, ParamTree>();

/**
 * Register a renderer's params under `name`, so they're saved, loaded and
 * kept in the URL (as `name.key`, e.g. `grid.thickness`). Returns `values`.
 */
function registerParams<T extends object>(name: string, values: T): T {
  sections.set(name, values as unknown as ParamTree);
  return values;
}

/** Every param, app-wide and registered, as one plain tree (e.g. for Save Settings). */
function allParams(): ParamTree {
  snapNearZeroParams();
  return {
    ...(params as unknown as ParamTree),
    ...Object.fromEntries(sections),
  };
}

// ---- Saving and loading -----------------------------------------------------
// Every leaf maps to a dotted path, e.g. `border`, `export.format`,
// `grid.cellsAcross`. Loading only accepts a value of the same type as the
// current one.

// Runtime state rather than part of the view. (The active renderer mode isn't
// a param; main.ts stores it in the URL by its mode id.)
const EXCLUDED_KEYS = new Set(["isDrawing"]);

function forEachLeaf(
  obj: ParamTree,
  fn: (path: string, holder: ParamTree, key: string) => void,
  prefix = "",
) {
  for (const key of Object.keys(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (typeof value === "object") {
      forEachLeaf(value, fn, path);
    } else {
      fn(path, obj, key);
    }
  }
}

/**
 * Visit every param leaf. For registered params, `legacyPath` is the path
 * the setting had when all renderers shared one set of params (`thickness`
 * for `grid.thickness`), so older links and files still apply.
 */
function forEachParam(
  fn: (
    path: string,
    holder: ParamTree,
    key: string,
    legacyPath?: string,
  ) => void,
) {
  forEachLeaf(params as unknown as ParamTree, (path, holder, key) => {
    if (!EXCLUDED_KEYS.has(path)) fn(path, holder, key);
  });
  for (const [name, tree] of sections) {
    forEachLeaf(tree, (path, holder, key) =>
      fn(`${name}.${path}`, holder, key, path),
    );
  }
}

// Floating point leftovers (e.g. a slider dragged to 0 landing on 5e-17) are
// zero for every param, and would otherwise end up in links and settings.
const NEAR_ZERO = 1e-9;
function snapNearZero(n: number): number {
  return Math.abs(n) < NEAR_ZERO ? 0 : n;
}

/** Set numeric params within NEAR_ZERO of 0 to exactly 0. */
function snapNearZeroParams() {
  forEachParam((_path, holder, key) => {
    const value = holder[key];
    if (typeof value === "number") holder[key] = snapNearZero(value);
  });
}

/**
 * Set each param from `lookup(path)`, falling back to its legacy path, when
 * the found value has (or for strings from the URL, parses to) the param's
 * type. Missing or mismatched values leave the param as it is.
 */
function loadParams(lookup: (path: string) => unknown) {
  forEachParam((path, holder, key, legacyPath) => {
    let found = lookup(path);
    if (found === undefined && legacyPath) found = lookup(legacyPath);
    if (found === undefined) return;
    const current = holder[key];
    if (typeof current === "number") {
      const n = typeof found === "string" ? Number(found) : found;
      const blank = typeof found === "string" && found.trim() === "";
      if (typeof n === "number" && Number.isFinite(n) && !blank) {
        holder[key] = snapNearZero(n);
      }
    } else if (typeof current === "boolean") {
      if (typeof found === "boolean") holder[key] = found;
      else if (found === "true" || found === "false") {
        holder[key] = found === "true";
      }
    } else if (typeof found === "string") {
      holder[key] = found;
    }
  });
}

/** Load params from a parsed settings file (as written by Save Settings). */
function loadParamsFromObj(obj: unknown) {
  loadParams((path) => {
    let value: unknown = obj;
    for (const part of path.split(".")) {
      if (value === null || typeof value !== "object") return undefined;
      value = (value as Record<string, unknown>)[part];
    }
    return value;
  });
}

function loadParamsFromSearchParams(search: URLSearchParams) {
  loadParams((path) => search.get(path) ?? undefined);
}

function writeParamsToSearchParams(search: URLSearchParams) {
  snapNearZeroParams();
  forEachParam((path, holder, key) => {
    const value = holder[key];
    // Local-file urls (from the file picker) only work in this page session,
    // so they aren't shareable.
    if (typeof value === "string" && /^(blob|data):/i.test(value)) {
      search.delete(path);
      return;
    }
    search.set(path, String(value));
  });
}

export {
  allParams,
  loadParamsFromObj,
  loadParamsFromSearchParams,
  params,
  registerParams,
  writeParamsToSearchParams,
};
