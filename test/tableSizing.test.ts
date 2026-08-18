import { describe, expect, it } from "vitest";
import { computeTableSizing, scaledRowHeight } from "../src/tableSizing.js";

describe("compact table sizing", () => {
  it("fits a small lane table into the viewport with the compact default", () => {
    const result = computeTableSizing({
      logicalWidths: [210, 210, 210, 210],
      viewportWidth: 900,
      fontScale: 1,
      tableScale: 0.85,
      autoFit: true,
    });
    expect(result.effectiveScale).toBe(0.85);
    expect(result.widths).toEqual([179, 179, 179, 179]);
    expect(result.totalWidth).toBeLessThan(900);
  });

  it("preserves a readable minimum and scrolls a very wide tree", () => {
    const result = computeTableSizing({
      logicalWidths: Array.from({ length: 20 }, () => 210),
      viewportWidth: 620,
      fontScale: 1.6,
      tableScale: 0.85,
      autoFit: true,
    });
    expect(result.effectiveScale).toBe(0.68);
    expect(new Set(result.widths)).toEqual(new Set([210]));
    expect(result.totalWidth).toBeGreaterThan(620);
  });

  it("honors manual scaling and handles non-finite inputs", () => {
    const result = computeTableSizing({
      logicalWidths: [Number.NaN, 300],
      viewportWidth: Number.NaN,
      fontScale: Number.POSITIVE_INFINITY,
      tableScale: 1.2,
      autoFit: false,
    });
    expect(result.effectiveScale).toBe(1.2);
    expect(result.widths).toEqual([252, 360]);
    expect(scaledRowHeight(100, 0.8)).toBe(80);
  });

  it("shrinks frozen lanes while keeping active lanes readable", () => {
    const result = computeTableSizing({
      logicalWidths: [210, 210, 210],
      viewportWidth: 800,
      fontScale: 1,
      tableScale: 0.85,
      autoFit: true,
      frozenLanes: [false, true, false],
    });
    expect(result.widths).toEqual([179, 94, 179]);
    expect(result.totalWidth).toBe(452);
  });
});
