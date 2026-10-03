export const MIN_MAP_HEIGHT = 180;
export const COLLAPSED_MAP_HEIGHT = 58;
const COLLAPSE_DRAG_MARGIN = 20;
const EXPAND_DRAG_MARGIN = 6;

/** Keep resize thresholds independent of the panel width and pointer capture target. */
export function resolveMapHeight(startHeight: number, delta: number, maximum: number) {
  const startedCollapsed = startHeight < MIN_MAP_HEIGHT;
  const requested = startedCollapsed
    ? MIN_MAP_HEIGHT + delta - EXPAND_DRAG_MARGIN
    : startHeight + delta;
  const collapsed = startedCollapsed
    ? delta <= EXPAND_DRAG_MARGIN
    : requested <= MIN_MAP_HEIGHT - COLLAPSE_DRAG_MARGIN;
  return {
    collapsed,
    height: collapsed
      ? COLLAPSED_MAP_HEIGHT
      : Math.min(Math.max(MIN_MAP_HEIGHT, maximum), Math.max(MIN_MAP_HEIGHT, requested)),
  };
}
