type Params = {
  mode: number;
  speed: number;
  dilation: number;
  border: number;
  clearInBetween: boolean;
  thickness: number;
  thicknessVariation: number;
  imageThicknessEnabled: boolean;
  imageThicknessUrl: string;
  uniformity: number;
  verticality: number;
  angleVariation: number;
  isDrawing: boolean;
  canvasAspect: number;
  strokeType: number;
  multiplicity: number;
  linelength: number;
  linelengthVariation: number;
  radialVoronoi: {
    center: { x: number; y: number };
  };
  grid: {
    cellPx: number;
    verticalThickness: number;
    orientationVariationProbability: number;
    patternVariation: number;
  };
};

const params: Params = {
  mode: 0,
  speed: 5,
  dilation: 0.0,
  border: 0.04,
  clearInBetween: true,
  thickness: 0.048,
  thicknessVariation: 0.0,
  imageThicknessEnabled: false,
  imageThicknessUrl:
    "https://upload.wikimedia.org/wikipedia/commons/6/6a/Mona_Lisa.jpg",
  uniformity: 0.7,
  verticality: 1.0,
  angleVariation: 8.0,
  isDrawing: false,
  canvasAspect: 8.5 / 11,
  strokeType: 0,
  multiplicity: 3,
  linelength: 0.03,
  linelengthVariation: 0.0,
  radialVoronoi: {
    center: { x: 0.0, y: 0.0 },
  },
  grid: {
    cellPx: 20,
    verticalThickness: 0.0,
    orientationVariationProbability: 1 / 25,
    patternVariation: 0.0,
  },
};

function loadParamsFromObj(obj: Params) {
  params.angleVariation = obj.angleVariation as number;
  params.clearInBetween = obj.clearInBetween as boolean;
  params.speed = obj.speed as number;
  params.thickness = obj.thickness as number;
  params.thicknessVariation = obj.thicknessVariation as number;
  if (typeof obj.imageThicknessEnabled === "boolean") {
    params.imageThicknessEnabled = obj.imageThicknessEnabled as boolean;
  }
  if (typeof obj.imageThicknessUrl === "string") {
    params.imageThicknessUrl = obj.imageThicknessUrl as string;
  }
  params.uniformity = obj.uniformity as number;
  params.verticality = obj.verticality as number;
  params.angleVariation = obj.angleVariation as number;
  params.isDrawing = obj.isDrawing as boolean;
  params.canvasAspect = obj.canvasAspect as number;
  params.strokeType = obj.strokeType as number;
  params.multiplicity = obj.multiplicity as number;
  params.linelength = obj.linelength as number;
  params.linelengthVariation = obj.linelengthVariation as number;
  params.radialVoronoi.center.x = obj.radialVoronoi.center.x as number;
  params.radialVoronoi.center.y = obj.radialVoronoi.center.y as number;
  if (obj.grid && typeof obj.grid.cellPx === "number") {
    params.grid.cellPx = obj.grid.cellPx as number;
  }
  if (obj.grid && typeof obj.grid.verticalThickness === "number") {
    params.grid.verticalThickness = obj.grid.verticalThickness as number;
  }
  if (
    obj.grid &&
    typeof obj.grid.orientationVariationProbability === "number"
  ) {
    params.grid.orientationVariationProbability = obj.grid
      .orientationVariationProbability as number;
  }
  if (obj.grid && typeof obj.grid.patternVariation === "number") {
    params.grid.patternVariation = obj.grid.patternVariation as number;
  }
}

// ---- URL query string (de)serialization ------------------------------------
// Every leaf of `params` maps to a flat query key using dotted paths, e.g.
// `thickness=0.048&grid.cellPx=20`. The current value's type in `params`
// decides how the string from the URL is parsed.
type ParamLeaf = number | boolean | string;
type ParamTree = { [key: string]: ParamLeaf | ParamTree };

// Runtime state rather than part of the view. The active mode is stored in the
// URL by its mode id instead (see main.ts), since `mode` alone is ambiguous.
const URL_EXCLUDED_KEYS = new Set(["mode", "isDrawing"]);

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

function writeParamsToSearchParams(search: URLSearchParams) {
  forEachLeaf(params as unknown as ParamTree, (path, holder, key) => {
    if (URL_EXCLUDED_KEYS.has(path)) return;
    search.set(path, String(holder[key]));
  });
}

function loadParamsFromSearchParams(search: URLSearchParams) {
  forEachLeaf(params as unknown as ParamTree, (path, holder, key) => {
    if (URL_EXCLUDED_KEYS.has(path)) return;
    const raw = search.get(path);
    if (raw === null) return;
    const current = holder[key];
    if (typeof current === "number") {
      const n = Number(raw);
      if (raw.trim() !== "" && Number.isFinite(n)) holder[key] = n;
    } else if (typeof current === "boolean") {
      if (raw === "true" || raw === "false") holder[key] = raw === "true";
    } else {
      holder[key] = raw;
    }
  });
}

export {
  loadParamsFromObj,
  loadParamsFromSearchParams,
  params,
  writeParamsToSearchParams,
};
