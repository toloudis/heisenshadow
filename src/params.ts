const params = {
  mode: 0,
  speed: 5,
  dilation: 0.0,
  border: 0.08,
  clearInBetween: true,
  thickness: 0.03,
  thicknessVariation: 0.0,
  uniformity: 0.7,
  verticality: 1.0,
  angleVariation: 8.0,
  isDrawing: false,
  canvasAspect: 8.5 / 11,
  strokeType: 0,
  multiplicity: 3,
  linelength: 0.03,
  linelengthVariation: 0.0,
  clusters: {
    size: 1,
    spread: 0.04,
  },
  radialVoronoi: {
    center: { x: 0.0, y: 0.0 },
  },
};

function loadParamsFromObj(obj: any) {
  params.angleVariation = obj.angleVariation as number;
  params.clearInBetween = obj.clearInBetween as boolean;
  params.speed = obj.speed as number;
  params.thickness = obj.thickness as number;
  params.thicknessVariation = obj.thicknessVariation as number;
  params.uniformity = obj.uniformity as number;
  params.verticality = obj.verticality as number;
  params.angleVariation = obj.angleVariation as number;
  params.isDrawing = obj.isDrawing as boolean;
  params.canvasAspect = obj.canvasAspect as number;
  params.strokeType = obj.strokeType as number;
  params.multiplicity = obj.multiplicity as number;
  params.linelength = obj.linelength as number;
  params.linelengthVariation = obj.linelengthVariation as number;
  params.clusters.size = obj.clusters.size as number;
  params.clusters.spread = obj.clusters.spread as number;
  params.radialVoronoi.center.x = obj.radialVoronoi.center.x as number;
  params.radialVoronoi.center.y = obj.radialVoronoi.center.y as number;
}

export { params, loadParamsFromObj };
