import { describe, expect, it } from "vitest";
import {
  clientPanToGraphDelta,
  graphZoom,
  panGraphCamera,
  zoomGraphCamera,
  type GraphViewBox,
} from "../src/lib/dependency-camera";

const base: GraphViewBox = { x: 0, y: -100, width: 1000, height: 600 };

describe("dependency graph camera", () => {
  it("uses the fitted graph as 1x and clamps zoom to 1–4x", () => {
    expect(zoomGraphCamera(base, base, 0.5)).toEqual(base);
    const maximum = zoomGraphCamera(base, base, 10);
    expect(graphZoom(base, maximum)).toBe(4);
    expect(maximum).toMatchObject({ width: 250, height: 150 });
  });

  it("keeps the requested graph point anchored while zooming", () => {
    const camera = zoomGraphCamera(base, base, 2, { x: 250, y: 50 });
    expect(camera).toEqual({ x: 125, y: -25, width: 500, height: 300 });
    expect((250 - camera.x) / camera.width).toBeCloseTo(0.25);
    expect((50 - camera.y) / camera.height).toBeCloseTo(0.25);
  });

  it("clamps panning so the graph cannot be lost off-screen", () => {
    const camera = zoomGraphCamera(base, base, 2);
    expect(panGraphCamera(base, camera, -10_000, -10_000)).toMatchObject({ x: 0, y: -100 });
    expect(panGraphCamera(base, camera, 10_000, 10_000)).toMatchObject({ x: 500, y: 200 });
  });

  it("converts pointer movement using the fitted SVG scale", () => {
    const camera = { x: 0, y: 0, width: 500, height: 300 };
    expect(clientPanToGraphDelta(camera, { width: 1000, height: 500 }, 20, -10)).toEqual({
      x: 12,
      y: -6,
    });
  });
});
