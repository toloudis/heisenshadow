const params = {
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
  },
};

function loadParamsFromObj(obj: any) {
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
}

export { params, loadParamsFromObj };
