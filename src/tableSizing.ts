export interface TableSizingInput {
  readonly logicalWidths: ReadonlyArray<number>;
  readonly viewportWidth: number;
  readonly fontScale: number;
  readonly tableScale: number;
  readonly autoFit: boolean;
  readonly frozenLanes?: ReadonlyArray<boolean>;
}

export interface TableSizingResult {
  readonly effectiveScale: number;
  readonly readableMinWidth: number;
  readonly widths: ReadonlyArray<number>;
  readonly totalWidth: number;
}

const MIN_AUTO_SCALE = 0.68;
const MAX_AUTO_SCALE = 0.85;
const FROZEN_LOGICAL_WIDTH = 110;
const FROZEN_MIN_WIDTH = 76;

export function computeTableSizing(input: TableSizingInput): TableSizingResult {
  const logicalWidths = input.logicalWidths.map((value) =>
    Number.isFinite(value) ? Math.max(1, value) : 210,
  );
  const fontScale = finiteOr(input.fontScale, 1);
  const requestedScale = clamp(finiteOr(input.tableScale, 0.85), 0.65, 1.35);
  const available = Math.max(1, finiteOr(input.viewportWidth, 1) - 2);
  const frozenLanes = logicalWidths.map((_, index) => input.frozenLanes?.[index] === true);
  const effectiveLogicalWidths = logicalWidths.map((width, index) =>
    frozenLanes[index] ? Math.min(width, FROZEN_LOGICAL_WIDTH) : width,
  );
  const logicalTotal = effectiveLogicalWidths.reduce((sum, width) => sum + width, 0);
  const fitScale = logicalTotal > 0 ? available / logicalTotal : requestedScale;
  const effectiveScale = input.autoFit
    ? Math.min(requestedScale, MAX_AUTO_SCALE, Math.max(MIN_AUTO_SCALE, fitScale))
    : requestedScale;
  const readableMinWidth = clamp(Math.round(132 * fontScale), 132, 210);
  const widths = effectiveLogicalWidths.map((width, index) =>
    Math.max(
      frozenLanes[index] ? FROZEN_MIN_WIDTH : readableMinWidth,
      Math.round(width * effectiveScale),
    ),
  );
  return {
    effectiveScale,
    readableMinWidth,
    widths,
    totalWidth: widths.reduce((sum, width) => sum + width, 0),
  };
}

export function scaledRowHeight(logicalHeight: number, scale: number): number {
  return Math.max(54, Math.round(finiteOr(logicalHeight, 88) * finiteOr(scale, 0.85)));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
