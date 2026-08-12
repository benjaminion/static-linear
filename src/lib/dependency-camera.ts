export interface GraphViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export const MIN_GRAPH_ZOOM = 1;
export const MAX_GRAPH_ZOOM = 4;

export function graphZoom(base: GraphViewBox, camera: GraphViewBox): number {
  return base.width / camera.width;
}

export function zoomGraphCamera(
  base: GraphViewBox,
  camera: GraphViewBox,
  requestedZoom: number,
  anchor = { x: camera.x + camera.width / 2, y: camera.y + camera.height / 2 },
): GraphViewBox {
  const zoom = Math.min(MAX_GRAPH_ZOOM, Math.max(MIN_GRAPH_ZOOM, requestedZoom));
  const width = base.width / zoom;
  const height = base.height / zoom;
  const anchorX = camera.width ? (anchor.x - camera.x) / camera.width : 0.5;
  const anchorY = camera.height ? (anchor.y - camera.y) / camera.height : 0.5;
  return clampGraphCamera(base, {
    x: anchor.x - anchorX * width,
    y: anchor.y - anchorY * height,
    width,
    height,
  });
}

export function panGraphCamera(
  base: GraphViewBox,
  camera: GraphViewBox,
  deltaX: number,
  deltaY: number,
): GraphViewBox {
  return clampGraphCamera(base, {
    ...camera,
    x: camera.x + deltaX,
    y: camera.y + deltaY,
  });
}

export function clientPanToGraphDelta(
  camera: GraphViewBox,
  viewport: ViewportSize,
  clientDeltaX: number,
  clientDeltaY: number,
): { x: number; y: number } {
  const scale = Math.max(
    camera.width / Math.max(1, viewport.width),
    camera.height / Math.max(1, viewport.height),
  );
  return { x: clientDeltaX * scale, y: clientDeltaY * scale };
}

export function clampGraphCamera(base: GraphViewBox, camera: GraphViewBox): GraphViewBox {
  const width = Math.min(base.width, Math.max(base.width / MAX_GRAPH_ZOOM, camera.width));
  const height = Math.min(base.height, Math.max(base.height / MAX_GRAPH_ZOOM, camera.height));
  return {
    x: clamp(camera.x, base.x, base.x + base.width - width),
    y: clamp(camera.y, base.y, base.y + base.height - height),
    width,
    height,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
