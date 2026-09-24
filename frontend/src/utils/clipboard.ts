import type { PlacedItem } from '../components/StageCanvas';
import type { CurveObject } from './bezierUtils';

export interface StageClipboardData {
  items: PlacedItem[];
  curves: CurveObject[];
  pasteCount: number;
}

let stageClipboard: StageClipboardData | null = null;

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

/**
 * 選択されたアイテムおよび曲線をクリップボード（メモリ内）にコピー
 */
export function copyStageObjects(items: PlacedItem[], curves: CurveObject[]): boolean {
  if (items.length === 0 && curves.length === 0) {
    return false;
  }
  // Deep clone to isolate from original state
  stageClipboard = {
    items: JSON.parse(JSON.stringify(items)),
    curves: JSON.parse(JSON.stringify(curves)),
    pasteCount: 1,
  };
  return true;
}

/**
 * クリップボードに貼り付け可能なオブジェクトが存在するか
 */
export function hasStageObjectsInClipboard(): boolean {
  return stageClipboard !== null && (stageClipboard.items.length > 0 || stageClipboard.curves.length > 0);
}

/**
 * クリップボードからオブジェクトを貼り付け（新規IDと座標オフセットを付与して複製）
 */
export function pasteStageObjects(): { newItems: PlacedItem[]; newCurves: CurveObject[] } | null {
  if (!stageClipboard || (stageClipboard.items.length === 0 && stageClipboard.curves.length === 0)) {
    return null;
  }

  const offset = 20 * stageClipboard.pasteCount;
  stageClipboard.pasteCount += 1;

  const newItems: PlacedItem[] = stageClipboard.items.map(item => ({
    ...JSON.parse(JSON.stringify(item)),
    id: generateId('item'),
    x: item.x + offset,
    y: item.y + offset,
  }));

  const newCurves: CurveObject[] = stageClipboard.curves.map(curve => {
    const cloned: CurveObject = JSON.parse(JSON.stringify(curve));
    return {
      ...cloned,
      id: generateId('curve'),
      x: cloned.x + offset,
      y: cloned.y + offset,
      items: cloned.items?.map(it => ({
        ...it,
        id: generateId('ci'),
      })),
    };
  });

  return { newItems, newCurves };
}

/**
 * 選択されたオブジェクトをその場で複製（Ctrl+D / 複製ボタン用）
 */
export function duplicateStageObjects(items: PlacedItem[], curves: CurveObject[], offset: number = 20): { newItems: PlacedItem[]; newCurves: CurveObject[] } {
  const newItems: PlacedItem[] = items.map(item => ({
    ...JSON.parse(JSON.stringify(item)),
    id: generateId('item'),
    x: item.x + offset,
    y: item.y + offset,
  }));

  const newCurves: CurveObject[] = curves.map(curve => {
    const cloned: CurveObject = JSON.parse(JSON.stringify(curve));
    return {
      ...cloned,
      id: generateId('curve'),
      x: cloned.x + offset,
      y: cloned.y + offset,
      items: cloned.items?.map(it => ({
        ...it,
        id: generateId('ci'),
      })),
    };
  });

  return { newItems, newCurves };
}
