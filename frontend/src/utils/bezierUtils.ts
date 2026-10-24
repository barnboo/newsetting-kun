/**
 * Bezier Curve Mathematics & Item Distribution Engine
 * Evaluates quadratic bezier curves and spaces items along the arc with tangential rotation.
 */

export interface Point {
  x: number;
  y: number;
}

export interface CurvePlacedPoint {
  index: number;
  x: number;
  y: number;
  rotation: number; // in degrees
}

export interface CurveItem {
  id: string;
  type: string; // 'chorusChair', 'ensembleStand', or extracted icon id 'icon_...'
  label?: string;
  size?: number; // size in canvas pixels
  gap?: number;
  color?: string;
  percussionType?: string;
  showPercussionName?: boolean;
  labelOffsetX?: number;
  labelOffsetY?: number;
  labelRotation?: number;
  labelFontSize?: number;
  labelLetterSpacing?: number;
  isVerticalName?: boolean;
  pianoLidState?: string;
  customIconStyle?: 'default' | 'xMark' | 'doubleCircle' | 'circlePi';
  chairType?: 'normal' | 'pianoChair' | 'pianoChairSvg' | 'pianoChairPi';
  symbolShape?: 'circle' | 'cross' | 'rect' | 'triangle';
  symbolFilled?: boolean;
  symbolText?: string;
  symbolFontSize?: number;
  // If custom extracted icon
  isCustom?: boolean;
  iconId?: string;
  url?: string;
}

export interface CurvePlacedItem {
  item: CurveItem;
  index: number;
  x: number;
  y: number;
  rotation: number;
}

export interface CurveObject {
  id: string;
  x: number;
  y: number;
  points: [number, number, number, number, number, number]; // [x0, y0, cx, cy, x1, y1] relative to (x, y)
  items?: CurveItem[]; // Individual items placed along the curve
  itemType?: string; // template shape type fallback
  itemCount: number;
  itemGap: number;
  itemSize: number;
  align: 'center' | 'left' | 'right';
  color?: string;
  showLine?: boolean;
  percussionType?: string;
  showPercussionName?: boolean;
  labelLetterSpacing?: number;
  customIconStyle?: 'default' | 'xMark' | 'doubleCircle' | 'circlePi';
  chairType?: 'normal' | 'pianoChair' | 'pianoChairSvg' | 'pianoChairPi';
  rotation?: number; // in degrees
  isPinned?: boolean;
}

/**
 * Generate SVG Path string for Quadratic Bezier
 */
export function getBezierPathData(points: [number, number, number, number, number, number]): string {
  return `M ${points[0]} ${points[1]} Q ${points[2]} ${points[3]} ${points[4]} ${points[5]}`;
}

/**
 * Sample a quadratic bezier curve at N discrete steps
 */
export function sampleBezier(
  points: [number, number, number, number, number, number],
  steps = 200
): { pts: Point[]; totalLength: number; lengths: number[] } {
  const [x0, y0, cx, cy, x1, y1] = points;
  const pts: Point[] = [];
  const lengths: number[] = [0];
  let totalLength = 0;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const invT = 1 - t;
    const x = invT * invT * x0 + 2 * invT * t * cx + t * t * x1;
    const y = invT * invT * y0 + 2 * invT * t * cy + t * t * y1;
    pts.push({ x, y });

    if (i > 0) {
      const segDist = Math.hypot(x - pts[i - 1].x, y - pts[i - 1].y);
      totalLength += segDist;
      lengths.push(totalLength);
    }
  }

  return { pts, totalLength, lengths };
}

/**
 * Calculate positions and rotation angles for N items along the curve
 */
export function distributeAlongCurve(
  points: [number, number, number, number, number, number],
  count: number,
  itemSize: number,
  gap = 10,
  align: 'center' | 'left' | 'right' = 'center'
): CurvePlacedPoint[] {
  if (count <= 0) return [];

  const { pts, totalLength } = sampleBezier(points, 200);
  if (totalLength === 0) return [];

  // Total width needed along curve for all items and gaps
  const totalItemsWidth = count * itemSize;
  const totalGapsWidth = Math.max(0, count - 1) * gap;
  const neededLength = totalItemsWidth + totalGapsWidth;

  let startDist = 0;
  if (align === 'center') {
    startDist = (totalLength - neededLength) / 2;
  } else if (align === 'right') {
    startDist = totalLength - neededLength;
  }

  const results: CurvePlacedPoint[] = [];
  const ptCount = pts.length - 1;

  for (let idx = 0; idx < count; idx++) {
    const centerDist = startDist + idx * (itemSize + gap) + itemSize / 2;
    const clampedDist = Math.max(0, Math.min(totalLength, centerDist));

    // Find sample index corresponding to distance
    let targetIdx = 0;
    let accum = 0;
    for (let i = 1; i <= ptCount; i++) {
      const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (accum + seg >= clampedDist) {
        targetIdx = i;
        break;
      }
      accum += seg;
    }

    const p = pts[targetIdx] || pts[ptCount];

    // Compute tangential rotation angle
    const i1 = Math.max(0, targetIdx - 1);
    const i2 = Math.min(ptCount, targetIdx + 1);
    let angle = 0;
    if (i1 !== i2) {
      const p1 = pts[i1];
      const p2 = pts[i2];
      angle = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
    }

    // Align items tangentially along curve (matching prototype orientation)
    const adjustedAngle = angle;

    results.push({
      index: idx,
      x: p.x,
      y: p.y,
      rotation: adjustedAngle,
    });
  }

  return results;
}

/**
 * Distribute an arbitrary list of CurveItem objects along the curve
 */
export function distributeItemsAlongCurve(
  points: [number, number, number, number, number, number],
  items: CurveItem[],
  defaultSize = 32,
  defaultGap = 10,
  align: 'center' | 'left' | 'right' = 'center'
): CurvePlacedItem[] {
  if (!items || items.length === 0) return [];

  const { pts, totalLength } = sampleBezier(points, 200);
  if (totalLength === 0) return [];

  let totalItemWidth = 0;
  for (const it of items) {
    totalItemWidth += (it.size || defaultSize);
  }
  // 末尾アイテム（右端のオブジェクト）の右側の間隔（余白）
  const lastItem = items[items.length - 1];
  const endGap = (lastItem && lastItem.gap !== undefined) ? lastItem.gap : 0;

  const totalGapWidth = items.reduce(
    (acc, it, i) => i < items.length - 1 ? acc + (it.gap !== undefined ? it.gap : defaultGap) : acc,
    0
  );
  const totalNeededLen = totalItemWidth + totalGapWidth + endGap;

  let startDist = 0;
  if (align === 'center') {
    startDist = (totalLength - totalNeededLen) / 2;
  } else if (align === 'right') {
    startDist = totalLength - totalNeededLen;
  }

  let curDist = startDist;
  const results: CurvePlacedItem[] = [];
  const ptCount = pts.length - 1;

  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const size = it.size || defaultSize;
    const gap = it.gap !== undefined ? it.gap : defaultGap;
    const centerDist = Math.max(0, Math.min(totalLength, curDist + size / 2));

    let targetIdx = 0;
    let accum = 0;
    for (let i = 1; i <= ptCount; i++) {
      const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (accum + seg >= centerDist) {
        targetIdx = i;
        break;
      }
      accum += seg;
    }

    const p = pts[targetIdx] || pts[ptCount];
    const i1 = Math.max(0, targetIdx - 1);
    const i2 = Math.min(ptCount, targetIdx + 1);
    let angle = 0;
    if (i1 !== i2) {
      const p1 = pts[i1];
      const p2 = pts[i2];
      angle = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
    }

    // Align items tangentially along curve (matching prototype orientation)
    const adjustedAngle = angle;

    results.push({
      item: it,
      index: idx,
      x: p.x,
      y: p.y,
      rotation: adjustedAngle,
    });

    curDist += size + gap;
  }

  return results;
}

/**
 * Generate a default curve in the center of the viewport
 * By default creates an empty curve (items: []) without any items placed yet
 */
export function createDefaultCurveObject(
  cx: number,
  cy: number,
  itemType?: string,
  itemCount = 0
): CurveObject {
  const span = 280;
  const archDepth = 80;

  return {
    id: `curve_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    x: cx,
    y: cy - archDepth / 2,
    // [Start X, Start Y, Control X, Control Y, End X, End Y]
    points: [-span / 2, archDepth / 2, 0, -archDepth, span / 2, archDepth / 2],
    items: [],
    itemType: itemType || 'chorusChair',
    itemCount,
    itemGap: 10,
    itemSize: 32,
    align: 'center',
    color: '#000000',
    rotation: 0,
    showLine: true,
  };
}
