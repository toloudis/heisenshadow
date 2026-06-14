import { params } from "./params";

const SAMPLE_SIZE = 192;

let loadedUrl = "";
let loadingUrl = "";
let sampleW = 0;
let sampleH = 0;
let sampleData: Uint8ClampedArray | null = null;

function resetMap() {
  sampleData = null;
  sampleW = 0;
  sampleH = 0;
}

function beginLoad(url: string) {
  if (!url || url === loadingUrl || url === loadedUrl) {
    return;
  }

  loadingUrl = url;
  resetMap();

  const img = new Image();
  img.crossOrigin = "anonymous";

  img.onload = () => {
    if (loadingUrl !== url) return;

    const sw = SAMPLE_SIZE;
    const sh = SAMPLE_SIZE;
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      loadingUrl = "";
      return;
    }

    ctx.drawImage(img, 0, 0, sw, sh);
    const imgData = ctx.getImageData(0, 0, sw, sh);

    sampleW = sw;
    sampleH = sh;
    sampleData = imgData.data;
    loadedUrl = url;
    loadingUrl = "";
  };

  img.onerror = () => {
    if (loadingUrl === url) {
      loadingUrl = "";
    }
    if (loadedUrl === url) {
      loadedUrl = "";
    }
    resetMap();
  };

  img.src = url;
}

export function getImageThicknessMultiplier(x01: number, y01: number): number {
  const url = (params.imageThicknessUrl || "").trim();
  if (!url) {
    return 1;
  }

  if (url !== loadedUrl && url !== loadingUrl) {
    beginLoad(url);
  }

  if (!sampleData || sampleW <= 0 || sampleH <= 0) {
    return 1;
  }

  const x = Math.max(0, Math.min(1, x01));
  const y = Math.max(0, Math.min(1, y01));
  const ix = Math.min(sampleW - 1, Math.floor(x * (sampleW - 1)));
  const iy = Math.min(sampleH - 1, Math.floor(y * (sampleH - 1)));
  const idx = (iy * sampleW + ix) * 4;

  const r = sampleData[idx] / 255;
  const g = sampleData[idx + 1] / 255;
  const b = sampleData[idx + 2] / 255;

  // HSV value is max(rgb). Lower value should produce thicker strokes.
  const value = Math.max(r, g, b);
  const inv = 1 - value;

  // Maps bright->0.5x and dark->1.5x thickness.
  return 0.5 + inv;
}
