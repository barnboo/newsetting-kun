import React, { useRef, useEffect, useLayoutEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { Stage, Layer, Image as KonvaImage, Transformer, Path, Circle, Ellipse, Line, Group, Text, Rect } from 'react-konva';
import useImage from 'use-image';
import { Ruler, X, Check, Copy, Trash2, ArrowLeft, ArrowRight } from 'lucide-react';
import type { ExtractedIcon } from '../App';
import type Konva from 'konva';
import { distributeAlongCurve, distributeItemsAlongCurve, getBezierPathData, type CurveObject, type CurveItem } from '../utils/bezierUtils';
import { TEMPLATE_SHAPES, getTemplateDataUrl, getPercussionDataUrl, getPercussionInfo, getSymbolDataUrl } from '../utils/templateShapes';
import { hasStageObjectsInClipboard } from '../utils/clipboard';
import type { ItemLabelModalTarget } from './PercussionLabelModal';

export interface PlacedItem {
  id: string;
  iconId: string;         // either an extractedIcon id or a template type e.g. 'tmpl_chorusChair'
  templateType?: string;  // template shape type e.g. 'chorusChair' if using template
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  width: number;
  height: number;
  percussionType?: string;
  showPercussionName?: boolean;
  labelOffsetX?: number;
  labelOffsetY?: number;
  labelRotation?: number;
  labelFontSize?: number;
  labelLetterSpacing?: number;
  isVerticalName?: boolean;
  pianoLidState?: string;
  color?: string;
  customIconStyle?: 'default' | 'xMark' | 'doubleCircle' | 'circlePi';
  chairType?: 'normal' | 'pianoChair' | 'pianoChairSvg' | 'pianoChairPi';
  symbolShape?: 'circle' | 'cross' | 'rect' | 'triangle';
  symbolFilled?: boolean;
  symbolText?: string;
  symbolFontSize?: number;
  isPinned?: boolean;
}

export interface SnapSettings {
  showGrid: boolean;
  gridSize: number;
  showCenterMarker: boolean;
  centerOffset: { x: number; y: number }; // Offset relative to background center
  snapToCenter: boolean;
  snapToGrid: boolean;
  snapAngle: boolean;
}

export interface StageCanvasRef {
  exportStageImage: (options?: { hideCurveLines?: boolean }) => string;
  getStageCenter: () => { x: number; y: number }; // Absolute origin (0, 0) at image center
  getEffectiveCenter: () => { x: number; y: number }; // Center marker position
  calculateSnapping: (x: number, y: number, isCtrl?: boolean, isShift?: boolean) => { x: number; y: number; snappedX: boolean; snappedY: boolean };
  setSnapGuides: (guideX: number | null, guideY: number | null) => void;
}

interface StageCanvasProps {
  backgroundUrl: string | null;
  extractedIcons: ExtractedIcon[];
  placedItems: PlacedItem[];
  curveObjects: CurveObject[];
  selectedId: string | null;
  selectedCurveId: string | null;
  selectedIds?: string[];
  selectedCurveIds?: string[];
  selectedCurveItemId?: string | null;
  onSelectCurveItem?: (curveId: string, itemId: string) => void;
  onMoveCurveItemOrder?: (curveId: string, itemId: string, direction: 'left' | 'right') => void;
  isCtrlPointSnapped?: boolean;
  isCurveMoving?: boolean;
  snapSettings?: SnapSettings;
  zoomMultiplier?: number;
  onZoomChange?: (multiplier: number) => void;
  onSelectItem: (id: string | null) => void;
  onSelectCurve: (id: string | null) => void;
  onSelectItems?: (ids: string[]) => void;
  onSelectCurves?: (ids: string[]) => void;
  onUpdateItem: (id: string, newAttrs: Partial<PlacedItem>) => void;
  onUpdateItems?: (updates: { id: string; attrs: Partial<PlacedItem> }[]) => void;
  onUpdateCurve: (id: string, newCurve: Partial<CurveObject>, skipHistory?: boolean) => void;
  onDragStartAction?: () => void;
  onDragEndAction?: () => void;
  onNudgeItems?: (updates: { id: string; attrs: Partial<PlacedItem> }[]) => void;
  onNudgeCurves?: (updates: { id: string; attrs: Partial<CurveObject> }[]) => void;
  onAddItem: (iconId: string, x: number, y: number) => void;
  onDeleteItem: (id: string) => void;
  onDeleteCurveItem?: (curveId: string, itemId: string) => void;
  onDeleteSelected?: () => void;
  onDuplicateItem: (id: string) => void;
  onDuplicateSelected?: () => void;
  onCopySelected?: () => void;
  onPaste?: () => void;
  onUpdateCenterOffset?: (offset: { x: number; y: number }) => void;
  isMovingCenter?: boolean;
  onExitMoveCenter?: () => void;
  onOpenContextMenu?: (info: {
    x: number;
    y: number;
    canvasX: number;
    canvasY: number;
    targetItemId?: string | null;
  }) => void;
  isMeasuringScale?: boolean;
  onMeasureComplete?: (dist: number) => void;
  onCancelMeasure?: () => void;
  onOpenPercussionLabelModal?: (target: ItemLabelModalTarget) => void;
  templateReplacements?: Record<string, string>;
}

// Helper function to calculate snapping for both items and curves
function calculateSnapping({
  x,
  y,
  snapSettings,
  effectiveCenter,
  bgCenter: _bgCenter,
  isCtrl,
  isShift,
}: {
  x: number;
  y: number;
  snapSettings?: SnapSettings;
  effectiveCenter: { x: number; y: number };
  bgCenter?: { x: number; y: number };
  isCtrl: boolean;
  isShift: boolean;
}): { x: number; y: number; snappedX: boolean; snappedY: boolean } {
  let newX = x;
  let newY = y;
  let snappedX = false;
  let snappedY = false;

  if (snapSettings) {
    const { snapToCenter, snapToGrid, gridSize } = snapSettings;
    const gridStep = gridSize > 0 ? gridSize : 50;
    const originX = effectiveCenter.x;
    const originY = effectiveCenter.y;

    // 1. Grid Snap: Activated by holding Ctrl / Command, or when snapToGrid checkbox is enabled (unless Shift is held)
    if ((isCtrl || snapToGrid) && !isShift) {
      const relX = newX - originX;
      const relY = newY - originY;
      const gridSnapX = originX + Math.round(relX / gridStep) * gridStep;
      const gridSnapY = originY + Math.round(relY / gridStep) * gridStep;

      if (isCtrl) {
        // Forced snap to grid lattice when holding Ctrl / Command
        newX = gridSnapX;
        newY = gridSnapY;
        if (Math.abs(newX - originX) < 1) snappedX = true;
        if (Math.abs(newY - originY) < 1) snappedY = true;
      } else {
        // Snap within threshold when snapToGrid is checked
        const threshold = 12;
        if (Math.abs(newX - gridSnapX) < threshold) {
          newX = gridSnapX;
          if (Math.abs(newX - originX) < 1) snappedX = true;
        }
        if (Math.abs(newY - gridSnapY) < threshold) {
          newY = gridSnapY;
          if (Math.abs(newY - originY) < 1) snappedY = true;
        }
      }
    }

    // 2. Snap to Center Marker / Effective Center (when not forced grid snap and not holding Shift)
    if (snapToCenter && !isCtrl && !isShift) {
      const threshold = 15;
      // Snap to Center Marker (effectiveCenter)
      if (!snappedX) {
        if (Math.abs(newX - originX) < threshold) {
          newX = originX;
          snappedX = true;
        }
      }

      if (!snappedY) {
        if (Math.abs(newY - originY) < threshold) {
          newY = originY;
          snappedY = true;
        }
      }
    }
  }

  return { x: newX, y: newY, snappedX, snappedY };
}

function renderSymbolShape(
  shape: 'circle' | 'cross' | 'rect' | 'triangle' = 'circle',
  filled: boolean = false,
  color: string = '#000000',
  width: number,
  height: number
) {
  const strokeColor = color;
  const fillColor = filled ? color : 'transparent';
  const strokeWidth = 2.5;

  const pad = 3;
  const w = Math.max(10, width - pad * 2);
  const h = Math.max(10, height - pad * 2);
  const cx = width / 2;
  const cy = height / 2;

  switch (shape) {
    case 'circle':
      return (
        <Ellipse
          x={cx}
          y={cy}
          radiusX={w / 2}
          radiusY={h / 2}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          listening={false}
        />
      );
    case 'rect':
      return (
        <Rect
          x={pad}
          y={pad}
          width={w}
          height={h}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          cornerRadius={2}
          listening={false}
        />
      );
    case 'triangle':
      return (
        <Line
          points={[cx, pad, width - pad, height - pad, pad, height - pad]}
          closed
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          lineJoin="round"
          listening={false}
        />
      );
    case 'cross': {
      if (!filled) {
        const spanX = (w / 2) * 0.85;
        const spanY = (h / 2) * 0.85;
        return (
          <Group listening={false}>
            <Line
              points={[cx - spanX, cy - spanY, cx + spanX, cy + spanY]}
              stroke={strokeColor}
              strokeWidth={strokeWidth + 0.8}
              lineCap="round"
              listening={false}
            />
            <Line
              points={[cx + spanX, cy - spanY, cx - spanX, cy + spanY]}
              stroke={strokeColor}
              strokeWidth={strokeWidth + 0.8}
              lineCap="round"
              listening={false}
            />
          </Group>
        );
      }
      const rx = w / 2;
      const ry = h / 2;
      const d = 0.35;
      const rawPoints = [
        -d, -1,
        d, -1,
        d, -d,
        1, -d,
        1, d,
        d, d,
        d, 1,
        -d, 1,
        -d, d,
        -1, d,
        -1, -d,
        -d, -d,
      ];
      const cos45 = Math.SQRT1_2;
      const sin45 = Math.SQRT1_2;
      const rotatedPoints: number[] = [];
      for (let i = 0; i < rawPoints.length; i += 2) {
        const px = rawPoints[i];
        const py = rawPoints[i + 1];
        const nx = px * cos45 - py * sin45;
        const ny = px * sin45 + py * cos45;
        rotatedPoints.push(cx + nx * rx, cy + ny * ry);
      }
      return (
        <Line
          points={rotatedPoints}
          closed
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          lineJoin="round"
          listening={false}
        />
      );
    }
    default:
      return null;
  }
}

function renderItemLabel(options: {
  text: string | undefined;
  width: number;
  height: number;
  color: string;
  offsetX?: number;
  offsetY?: number;
  rotation?: number;
  fontSize?: number;
  letterSpacing?: number;
  isVertical?: boolean;
  shape?: 'circle' | 'cross' | 'rect' | 'triangle';
  filled?: boolean;
  isSymbol?: boolean;
  parentScaleX?: number;
  parentScaleY?: number;
}) {
  const {
    text,
    width,
    height,
    color,
    offsetX = 0,
    offsetY = 0,
    rotation = 0,
    fontSize: customFontSize,
    letterSpacing = 0,
    isVertical = false,
    shape,
    filled = false,
    isSymbol = false,
    parentScaleX = 1,
    parentScaleY = 1,
  } = options;

  if (!text) return null;

  const textColor = isSymbol && filled ? '#ffffff' : color;
  const displayText = isVertical
    ? text.split('').map(c => (c === 'ー' || c === '―' ? '丨' : c)).join('\n')
    : text;

  let effectiveFontSize: number;
  if (customFontSize && customFontSize > 0) {
    effectiveFontSize = customFontSize;
  } else if (isSymbol) {
    // 縦横比が変更されても、短辺を基準にして図形内に美しく収まるフォントサイズを算出
    const minDim = Math.min(width, height);
    let factor = 0.72;
    if (shape === 'rect') factor = 0.85;
    if (shape === 'triangle') factor = 0.60;
    if (shape === 'cross') factor = 0.68;
    const availableDim = minDim * factor;
    effectiveFontSize = Math.max(8, Math.min(26, availableDim / Math.max(text.length * 0.65, 1)));
  } else {
    const maxFontByW = isVertical
      ? width * 0.42
      : (width * 0.95) / Math.max(text.length * 0.62, 1);
    const maxFontByH = isVertical
      ? (height * 0.95) / Math.max(text.length * 1.05, 1)
      : height * 0.42;
    effectiveFontSize = Math.max(8, Math.min(maxFontByW, maxFontByH, 20));
  }

  const cx = width / 2 + offsetX;
  const cy = (isSymbol && shape === 'triangle' && offsetY === 0)
    ? height * 0.58 + offsetY
    : height / 2 + offsetY;

  const lineCount = isVertical ? text.length : 1;
  const extraSpacingW = isVertical ? 0 : Math.max(0, (text.length - 1) * letterSpacing);
  const extraSpacingH = isVertical ? Math.max(0, (lineCount - 1) * letterSpacing) : 0;

  // 日本語全角文字（1.1em〜1.2em）や太字の幅、letterSpacingを十分にカバーし最後の文字が切れるのを防止
  const safeCharWidth = isVertical ? effectiveFontSize * 1.25 : effectiveFontSize * 1.35;
  const contentW = isVertical
    ? effectiveFontSize * 1.8
    : Math.max(width * 1.2, text.length * safeCharWidth + extraSpacingW + 24);
  const contentH = isVertical
    ? lineCount * effectiveFontSize * 1.35 + extraSpacingH + 16
    : Math.max(height * 1.2, effectiveFontSize * 1.6);

  const boxW = Math.max(16, contentW);
  const boxH = Math.max(16, contentH);

  const verticalLineHeight = isVertical
    ? (effectiveFontSize > 0 ? (effectiveFontSize * 1.15 + letterSpacing) / effectiveFontSize : 1.15)
    : 1;

  // 親グループのスケール歪みを打ち消す逆スケール（文字の縦横比1:1を完全に維持）
  const invScaleX = (parentScaleX && parentScaleX !== 0) ? (1 / parentScaleX) : 1;
  const invScaleY = (parentScaleY && parentScaleY !== 0) ? (1 / parentScaleY) : 1;

  return (
    <Group
      name="symbol-text-group"
      x={cx}
      y={cy}
      rotation={rotation}
      scaleX={invScaleX}
      scaleY={invScaleY}
      listening={false}
    >
      <Text
        text={displayText}
        x={-boxW / 2}
        y={-boxH / 2}
        width={boxW}
        height={boxH}
        fontSize={effectiveFontSize}
        fontFamily="'Helvetica Neue', Arial, 'Hiragino Kaku Gothic ProN', 'Hiragino Sans', Meiryo, sans-serif"
        fontStyle="bold"
        letterSpacing={isVertical ? 0 : letterSpacing}
        lineHeight={verticalLineHeight}
        align="center"
        verticalAlign="middle"
        wrap="none"
        ellipsis={false}
        fill={textColor}
        listening={false}
      />
    </Group>
  );
}

// A single placed icon item on canvas (either template SVG or extracted image)
const CanvasItem: React.FC<{
  item: PlacedItem;
  iconUrl: string;
  isSelected?: boolean;
  activeItemIds?: string[];
  activeCurveIds?: string[];
  snapSettings?: SnapSettings;
  templateReplacements?: Record<string, string>;
  bgCenter: { x: number; y: number };
  effectiveCenter: { x: number; y: number };
  onSelect: (e?: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onChange: (newAttrs: Partial<PlacedItem>) => void;
  onUpdateItems?: (updates: { id: string; attrs: Partial<PlacedItem> }[]) => void;
  onUpdateCurve?: (id: string, newCurve: Partial<CurveObject>, skipHistory?: boolean) => void;
  onDragStartAction?: () => void;
  onDragEndAction?: () => void;
  onSnapGuideChange?: (guideX: number | null, guideY: number | null) => void;
  onOpenPercussionLabelModal?: (target: ItemLabelModalTarget) => void;
}> = ({ item, iconUrl, isSelected, activeItemIds, activeCurveIds, snapSettings, templateReplacements, bgCenter, effectiveCenter, onSelect, onChange, onUpdateItems, onUpdateCurve, onDragStartAction, onDragEndAction, onSnapGuideChange, onOpenPercussionLabelModal }) => {
  const [image] = useImage(iconUrl, 'anonymous');
  const groupRef = useRef<Konva.Group>(null);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const multiDragStartRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const multiCurveDragStartRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const matchedTmplId = templateReplacements?.[item.iconId];
  const isSymbol = item.templateType === 'symbol' ||
                   matchedTmplId === 'tmpl_symbol' ||
                   (matchedTmplId?.replace(/^tmpl_/, '') === 'symbol');

  const isPerc = item.templateType === 'percussion' || Boolean(item.percussionType);
  const percInfo = isPerc ? getPercussionInfo(item.percussionType) : null;
  const showText = isPerc && item.showPercussionName !== false && Boolean(percInfo?.canvasName);

  // Auto-correct aspect ratio for percussion if existing item has square/distorted ratio
  const targetAspect = isPerc && percInfo ? (percInfo.defaultW || 1.34) / (percInfo.defaultH || 1.34) : 1;
  const currentAspect = item.width / item.height;
  const needsAspectCorrection = isPerc && percInfo && Math.abs(currentAspect - targetAspect) > 0.25;
  const effectiveWidth = needsAspectCorrection ? Math.round(item.height * targetAspect) : item.width;
  const effectiveHeight = item.height;

  useEffect(() => {
    if (needsAspectCorrection) {
      onChange({ width: effectiveWidth, height: effectiveHeight });
    }
  }, [needsAspectCorrection, effectiveWidth, effectiveHeight]);

  // Transformer の選択枠が文字ラベルや装飾に引っ張られて肥大化しないよう、本体サイズで境界を固定
  useLayoutEffect(() => {
    const node = groupRef.current;
    if (!node) return;
    node.getClientRect = (config?: { skipTransform?: boolean; relativeTo?: Konva.Node }) => {
      const skipTransform = config?.skipTransform;
      const relativeTo = config?.relativeTo;
      const w = effectiveWidth;
      const h = effectiveHeight;

      if (skipTransform) {
        return { x: 0, y: 0, width: w, height: h };
      }

      const transform = relativeTo
        ? node.getTransform().copy().multiply(relativeTo.getAbsoluteTransform().copy().invert())
        : node.getAbsoluteTransform();

      const points = [
        transform.point({ x: 0, y: 0 }),
        transform.point({ x: w, y: 0 }),
        transform.point({ x: w, y: h }),
        transform.point({ x: 0, y: h }),
      ];

      const xs = points.map(p => p.x);
      const ys = points.map(p => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      };
    };
  }, [effectiveWidth, effectiveHeight]);

  const handleOpenLabelModal = () => {
    if (isSymbol) {
      onOpenPercussionLabelModal?.({
        type: 'placedItem',
        itemId: item.id,
        targetType: 'symbol',
        canvasName: '記号テキスト',
        symbolShape: item.symbolShape || 'circle',
        symbolFilled: Boolean(item.symbolFilled),
        initialText: item.symbolText || '',
        width: effectiveWidth,
        height: effectiveHeight,
        color: item.color,
        currentOffsetX: item.labelOffsetX || 0,
        currentOffsetY: item.labelOffsetY || 0,
        currentRotation: item.labelRotation || 0,
        currentFontSize: item.labelFontSize || item.symbolFontSize,
        currentLetterSpacing: item.labelLetterSpacing || 0,
        isVertical: Boolean(item.isVerticalName),
      });
    } else if (isPerc) {
      onOpenPercussionLabelModal?.({
        type: 'placedItem',
        itemId: item.id,
        targetType: 'percussion',
        canvasName: percInfo?.canvasName || item.percussionType || '打楽器',
        percussionType: item.percussionType || 'ティンパニ',
        initialText: percInfo?.canvasName || '',
        width: effectiveWidth,
        height: effectiveHeight,
        color: item.color,
        currentOffsetX: item.labelOffsetX || 0,
        currentOffsetY: item.labelOffsetY || 0,
        currentRotation: item.labelRotation || 0,
        currentFontSize: item.labelFontSize,
        currentLetterSpacing: item.labelLetterSpacing || 0,
        isVertical: Boolean(item.isVerticalName),
      });
    }
  };

  return (
    <Group
      ref={groupRef}
      id={item.id}
      x={item.x}
      y={item.y}
      width={effectiveWidth}
      height={effectiveHeight}
      rotation={item.rotation}
      scaleX={item.scaleX}
      scaleY={item.scaleY}
      offsetX={effectiveWidth / 2}
      offsetY={effectiveHeight / 2}
      draggable={!item.isPinned}
      onClick={(e) => { e.cancelBubble = true; onSelect(e); }}
      onTap={(e) => { e.cancelBubble = true; onSelect(e); }}
      onDblClick={(e) => {
        if (isSymbol || isPerc) {
          e.cancelBubble = true;
          handleOpenLabelModal();
        }
      }}
      onDblTap={(e) => {
        if (isSymbol || isPerc) {
          e.cancelBubble = true;
          handleOpenLabelModal();
        }
      }}
      onDragStart={(e) => {
        onDragStartAction?.();
        dragStartPosRef.current = { x: e.target.x(), y: e.target.y() };
        const totalSelected = (activeItemIds?.length || 0) + (activeCurveIds?.length || 0);
        if (isSelected && totalSelected > 1) {
          multiDragStartRef.current.clear();
          multiCurveDragStartRef.current.clear();
          const stage = e.target.getStage();
          if (stage) {
            activeItemIds?.forEach(id => {
              const node = stage.findOne(`#${id}`);
              if (node && node.draggable()) {
                multiDragStartRef.current.set(id, { x: node.x(), y: node.y() });
              }
            });
            activeCurveIds?.forEach(id => {
              const node = stage.findOne(`#${id}`);
              if (node && node.draggable()) {
                multiCurveDragStartRef.current.set(id, { x: node.x(), y: node.y() });
              }
            });
          }
        }
      }}
      onDragMove={(e) => {
        const isCtrl = Boolean(e.evt && (e.evt.ctrlKey || e.evt.metaKey));
        const isShift = Boolean(e.evt && e.evt.shiftKey);

        const snap = calculateSnapping({
          x: e.target.x(),
          y: e.target.y(),
          snapSettings,
          effectiveCenter,
          bgCenter,
          isCtrl,
          isShift,
        });

        e.target.x(snap.x);
        e.target.y(snap.y);
        onSnapGuideChange?.(snap.snappedX ? snap.x : null, snap.snappedY ? snap.y : null);

        // If part of multi-selection, translate other selected items & curves
        const totalSelected = (activeItemIds?.length || 0) + (activeCurveIds?.length || 0);
        if (isSelected && totalSelected > 1 && dragStartPosRef.current) {
          const dx = snap.x - dragStartPosRef.current.x;
          const dy = snap.y - dragStartPosRef.current.y;
          const stage = e.target.getStage();
          if (stage) {
            multiDragStartRef.current.forEach((startPos, id) => {
              if (id !== item.id) {
                const node = stage.findOne(`#${id}`);
                if (node) {
                  node.x(startPos.x + dx);
                  node.y(startPos.y + dy);
                }
              }
            });
            multiCurveDragStartRef.current.forEach((startPos, id) => {
              const node = stage.findOne(`#${id}`);
              if (node) {
                node.x(startPos.x + dx);
                node.y(startPos.y + dy);
              }
            });
          }
        }
      }}
      onDragEnd={(e) => {
        onSnapGuideChange?.(null, null);
        const totalSelected = (activeItemIds?.length || 0) + (activeCurveIds?.length || 0);
        if (isSelected && totalSelected > 1 && dragStartPosRef.current) {
          const dx = e.target.x() - dragStartPosRef.current.x;
          const dy = e.target.y() - dragStartPosRef.current.y;
          if (onUpdateItems && multiDragStartRef.current.size > 0) {
            const updates: { id: string; attrs: Partial<PlacedItem> }[] = [];
            multiDragStartRef.current.forEach((startPos, id) => {
              updates.push({ id, attrs: { x: startPos.x + dx, y: startPos.y + dy } });
            });
            onUpdateItems(updates);
          }
          if (onUpdateCurve && multiCurveDragStartRef.current.size > 0) {
            multiCurveDragStartRef.current.forEach((startPos, id) => {
              onUpdateCurve(id, { x: startPos.x + dx, y: startPos.y + dy }, true);
            });
          }
          multiDragStartRef.current.clear();
          multiCurveDragStartRef.current.clear();
        } else {
          onChange({ x: e.target.x(), y: e.target.y() });
        }
        dragStartPosRef.current = null;
        onDragEndAction?.();
      }}
      onTransformStart={() => {
        onDragStartAction?.();
      }}
      onTransform={() => {
        const node = groupRef.current;
        if (!node) return;
        if (isSymbol) {
          const textGroup = node.findOne('.symbol-text-group');
          if (textGroup) {
            textGroup.scaleX(1 / (node.scaleX() || 1));
            textGroup.scaleY(1 / (node.scaleY() || 1));
          }
        }
      }}
      onTransformEnd={() => {
        const node = groupRef.current;
        if (!node) return;
        if (isSymbol) {
          const sx = node.scaleX();
          const sy = node.scaleY();
          const newWidth = Math.max(10, Math.round(item.width * sx));
          const newHeight = Math.max(10, Math.round(item.height * sy));
          node.scaleX(1);
          node.scaleY(1);
          const textGroup = node.findOne('.symbol-text-group');
          if (textGroup) {
            textGroup.scaleX(1);
            textGroup.scaleY(1);
          }
          onChange({
            x: node.x(),
            y: node.y(),
            rotation: node.rotation(),
            width: newWidth,
            height: newHeight,
            scaleX: 1,
            scaleY: 1,
          });
        } else {
          onChange({ x: node.x(), y: node.y(), rotation: node.rotation(), scaleX: node.scaleX(), scaleY: node.scaleY() });
        }
        onDragEndAction?.();
      }}
    >
      {/* Invisible hit area: ensures the Group is always detectable for drag/click
          even though KonvaImage has listening={false} */}
      <Rect
        width={effectiveWidth}
        height={effectiveHeight}
        fill="transparent"
      />

      {/* Visual selection highlight on multiple selected items (Transformer provides the bounding box, so no redundant outer stroke) */}
      {isSelected && activeItemIds && activeItemIds.length > 1 && (
        <Group name="canvas-item-selection-outline" listening={false}>
          <Rect
            x={0}
            y={0}
            width={effectiveWidth}
            height={effectiveHeight}
            fill="rgba(37, 99, 235, 0.12)"
            listening={false}
          />
          {/* Distinct Checkmark Badge on top-right */}
          <Group x={effectiveWidth + 2} y={-5} listening={false}>
            <Circle
              radius={7}
              fill="#2563eb"
              stroke="#ffffff"
              strokeWidth={1.5}
            />
            <Text
              text="✓"
              x={-5}
              y={-5}
              width={10}
              height={10}
              fontSize={8}
              fontFamily="sans-serif"
              fontStyle="bold"
              align="center"
              verticalAlign="middle"
              fill="#ffffff"
            />
          </Group>
        </Group>
      )}

      {isSymbol ? (
        <Group listening={false}>
          {renderSymbolShape(
            item.symbolShape,
            item.symbolFilled,
            item.color || '#000000',
            effectiveWidth,
            effectiveHeight
          )}
          {renderItemLabel({
            text: item.symbolText,
            width: effectiveWidth,
            height: effectiveHeight,
            color: item.color || '#000000',
            offsetX: item.labelOffsetX,
            offsetY: item.labelOffsetY,
            rotation: item.labelRotation,
            fontSize: item.labelFontSize || item.symbolFontSize,
            letterSpacing: item.labelLetterSpacing,
            isVertical: Boolean(item.isVerticalName),
            shape: item.symbolShape,
            filled: item.symbolFilled,
            isSymbol: true,
            parentScaleX: item.scaleX,
            parentScaleY: item.scaleY,
          })}
        </Group>
      ) : (
        <KonvaImage
          image={image}
          width={effectiveWidth}
          height={effectiveHeight}
          listening={false}
        />
      )}
      {showText && percInfo && renderItemLabel({
        text: percInfo.canvasName,
        width: effectiveWidth,
        height: effectiveHeight,
        color: item.color || '#000000',
        offsetX: item.labelOffsetX,
        offsetY: item.labelOffsetY,
        rotation: item.labelRotation,
        fontSize: item.labelFontSize,
        letterSpacing: item.labelLetterSpacing,
        isVertical: Boolean(item.isVerticalName),
      })}
    </Group>
  );
};

// Renderer for a single item along a bezier curve
const CurveItemRenderer: React.FC<{
  item: CurveItem;
  x: number;
  y: number;
  rotation: number;
  size: number;
  color?: string;
  isSelected?: boolean;
  extractedIcons?: ExtractedIcon[];
  templateReplacements?: Record<string, string>;
  curveChairType?: 'normal' | 'pianoChair' | 'pianoChairSvg' | 'pianoChairPi';
  curveCustomIconStyle?: 'default' | 'xMark' | 'doubleCircle' | 'circlePi';
  curvePercussionType?: string;
  curveId?: string;
  onSelect?: () => void;
  onOpenPercussionLabelModal?: (target: ItemLabelModalTarget) => void;
}> = ({ item, x, y, rotation, size, color, isSelected, extractedIcons, templateReplacements, curveChairType, curveCustomIconStyle, curvePercussionType, curveId, onSelect, onOpenPercussionLabelModal }) => {
  const matchedTmplId = item.iconId ? templateReplacements?.[item.iconId] : undefined;
  const tmpl = TEMPLATE_SHAPES.find(t =>
    t.type === item.type ||
    t.id === item.type ||
    t.id === `tmpl_${item.type}` ||
    (matchedTmplId && (t.id === matchedTmplId || t.type === matchedTmplId.replace(/^tmpl_/, '')))
  );
  const effectivePercType = item.percussionType || curvePercussionType || (tmpl?.type === 'percussion' ? 'ティンパニ' : undefined);
  const isPerc = item.type === 'percussion' || Boolean(item.percussionType) || Boolean(curvePercussionType) || (tmpl && tmpl.type === 'percussion');
  const percInfo = isPerc ? getPercussionInfo(effectivePercType) : null;

  const getUrl = () => {
    // 1. If custom extracted icon, first prefer data URL from extractedIcons
    if (item.isCustom && item.iconId && extractedIcons) {
      const iconDef = extractedIcons.find(ic => ic.id === item.iconId);
      if (iconDef?.url && iconDef.url.startsWith('data:')) {
        return iconDef.url;
      }
    }
    // 2. If item.url is a data URL, use it
    if (item.url && item.url.startsWith('data:')) {
      return item.url;
    }
    // 3. If extractedIcons has any URL, use it
    if (item.isCustom && item.iconId && extractedIcons) {
      const iconDef = extractedIcons.find(ic => ic.id === item.iconId);
      if (iconDef?.url) return iconDef.url;
    }
    if (item.url) return item.url;
    if (isPerc) {
      return getPercussionDataUrl(effectivePercType || 'ティンパニ', item.color || color);
    }
    const effectiveIconStyle = item.customIconStyle || curveCustomIconStyle;
    if (tmpl) return getTemplateDataUrl(tmpl, item.color || color, effectiveIconStyle, item.chairType || curveChairType);
    return '';
  };
  const [img] = useImage(getUrl(), 'anonymous');

  let aspect = 1;
  if (isPerc && percInfo) {
    aspect = (percInfo.defaultH || 1.34) / (percInfo.defaultW || 1.34);
  } else if (tmpl && tmpl.origH && tmpl.origW) {
    aspect = tmpl.origH / tmpl.origW;
  }
  const itemW = size;
  const itemH = size * aspect;
  const halfW = itemW / 2;
  const halfH = itemH / 2;
  const showText = isPerc && item.showPercussionName !== false && Boolean(percInfo?.canvasName);
  const isSymbol = tmpl?.type === 'symbol' || item.type === 'symbol' || matchedTmplId === 'tmpl_symbol' || matchedTmplId?.replace(/^tmpl_/, '') === 'symbol';

  const handleOpenLabelModal = () => {
    if (isSymbol) {
      onOpenPercussionLabelModal?.({
        type: 'curveItem',
        itemId: item.id,
        curveId,
        targetType: 'symbol',
        canvasName: '記号テキスト',
        symbolShape: item.symbolShape || 'circle',
        symbolFilled: Boolean(item.symbolFilled),
        initialText: item.symbolText || '',
        width: itemW,
        height: itemH,
        color: item.color || color,
        currentOffsetX: item.labelOffsetX || 0,
        currentOffsetY: item.labelOffsetY || 0,
        currentRotation: item.labelRotation || 0,
        currentFontSize: item.labelFontSize || item.symbolFontSize,
        currentLetterSpacing: item.labelLetterSpacing || 0,
        isVertical: Boolean(item.isVerticalName),
      });
    } else if (isPerc) {
      onOpenPercussionLabelModal?.({
        type: 'curveItem',
        itemId: item.id,
        curveId,
        targetType: 'percussion',
        canvasName: percInfo?.canvasName || effectivePercType || '打楽器',
        percussionType: effectivePercType || 'ティンパニ',
        initialText: percInfo?.canvasName || '',
        width: itemW,
        height: itemH,
        color: item.color || color,
        currentOffsetX: item.labelOffsetX || 0,
        currentOffsetY: item.labelOffsetY || 0,
        currentRotation: item.labelRotation || 0,
        currentFontSize: item.labelFontSize,
        currentLetterSpacing: item.labelLetterSpacing || 0,
        isVertical: Boolean(item.isVerticalName),
      });
    }
  };

  if (img || isSymbol) {
    return (
      <Group
        x={x}
        y={y}
        rotation={rotation}
        onClick={(e) => {
          if (onSelect) {
            e.cancelBubble = true;
            onSelect();
          }
        }}
        onTap={(e) => {
          if (onSelect) {
            e.cancelBubble = true;
            onSelect();
          }
        }}
        onDblClick={(e) => {
          if (isSymbol || isPerc) {
            e.cancelBubble = true;
            handleOpenLabelModal();
          }
        }}
        onDblTap={(e) => {
          if (isSymbol || isPerc) {
            e.cancelBubble = true;
            handleOpenLabelModal();
          }
        }}
        onMouseEnter={(e) => {
          const c = e.target.getStage()?.container();
          if (c) c.style.cursor = 'pointer';
        }}
        onMouseLeave={(e) => {
          const c = e.target.getStage()?.container();
          if (c) c.style.cursor = 'default';
        }}
      >
        {/* Transparent hit area */}
        <Rect
          x={-halfW}
          y={-halfH}
          width={itemW}
          height={itemH}
          fill="transparent"
        />

        {/* Selection indicator on the curve item */}
        {isSelected && (
          <Rect
            name="curve-item-selection-highlight"
            x={-halfW - 3}
            y={-halfH - 3}
            width={itemW + 6}
            height={itemH + 6}
            stroke="#2563eb"
            strokeWidth={2}
            fill="rgba(37, 99, 235, 0.2)"
            cornerRadius={4}
            dash={[4, 3]}
            listening={false}
          />
        )}

        {isSymbol ? (
          <Group x={-halfW} y={-halfH} listening={false}>
            {renderSymbolShape(
              item.symbolShape,
              item.symbolFilled,
              item.color || color || '#000000',
              itemW,
              itemH
            )}
            {renderItemLabel({
              text: item.symbolText,
              width: itemW,
              height: itemH,
              color: item.color || color || '#000000',
              offsetX: item.labelOffsetX,
              offsetY: item.labelOffsetY,
              rotation: item.labelRotation,
              fontSize: item.labelFontSize || item.symbolFontSize,
              letterSpacing: item.labelLetterSpacing,
              isVertical: Boolean(item.isVerticalName),
              shape: item.symbolShape,
              filled: item.symbolFilled,
              isSymbol: true,
            })}
          </Group>
        ) : (
          <KonvaImage
            image={img}
            x={-halfW}
            y={-halfH}
            width={itemW}
            height={itemH}
            listening={false}
          />
        )}
        {showText && percInfo && (
          <Group x={-halfW} y={-halfH} listening={false}>
            {renderItemLabel({
              text: percInfo.canvasName,
              width: itemW,
              height: itemH,
              color: item.color || color || '#000000',
              offsetX: item.labelOffsetX,
              offsetY: item.labelOffsetY,
              rotation: item.labelRotation,
              fontSize: item.labelFontSize,
              letterSpacing: item.labelLetterSpacing,
              isVertical: Boolean(item.isVerticalName),
            })}
          </Group>
        )}
      </Group>
    );
  }
  return (
    <Group
      x={x}
      y={y}
      onClick={(e) => {
        if (onSelect) {
          e.cancelBubble = true;
          onSelect();
        }
      }}
      onTap={(e) => {
        if (onSelect) {
          e.cancelBubble = true;
          onSelect();
        }
      }}
      onMouseEnter={(e) => {
        const c = e.target.getStage()?.container();
        if (c) c.style.cursor = 'pointer';
      }}
      onMouseLeave={(e) => {
        const c = e.target.getStage()?.container();
        if (c) c.style.cursor = 'default';
      }}
    >
      {isSelected && (
        <Circle
          name="curve-item-selection-highlight"
          radius={halfW + 4}
          stroke="#2563eb"
          strokeWidth={2}
          fill="rgba(37, 99, 235, 0.2)"
          dash={[4, 3]}
          listening={false}
        />
      )}
      <Circle
        radius={halfW}
        fill="#f8fafc"
        stroke="#475569"
        strokeWidth={1.5}
        listening={false}
      />
      <Text
        text={item.label || 'パーツ'}
        x={-halfW}
        y={-6}
        width={itemW}
        height={12}
        fontSize={Math.max(7, Math.min(10, halfW * 0.7))}
        fontFamily="sans-serif"
        fontStyle="bold"
        align="center"
        verticalAlign="middle"
        fill="#1e293b"
        listening={false}
      />
    </Group>
  );
};

// Calculate geometric bounding center of a quadratic bezier curve
function getBezierCenter(pts: [number, number, number, number, number, number]) {
  const [x0, y0, x1, y1, x2, y2] = pts;
  let minX = Math.min(x0, x2);
  let maxX = Math.max(x0, x2);
  let minY = Math.min(y0, y2);
  let maxY = Math.max(y0, y2);

  const denomX = x0 - 2 * x1 + x2;
  if (denomX !== 0) {
    const tx = (x0 - x1) / denomX;
    if (tx > 0 && tx < 1) {
      const qx = (1 - tx) * (1 - tx) * x0 + 2 * (1 - tx) * tx * x1 + tx * tx * x2;
      minX = Math.min(minX, qx);
      maxX = Math.max(maxX, qx);
    }
  }

  const denomY = y0 - 2 * y1 + y2;
  if (denomY !== 0) {
    const ty = (y0 - y1) / denomY;
    if (ty > 0 && ty < 1) {
      const qy = (1 - ty) * (1 - ty) * y0 + 2 * (1 - ty) * ty * y1 + ty * ty * y2;
      minY = Math.min(minY, qy);
      maxY = Math.max(maxY, qy);
    }
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    // 回転中心（ピボット）は回転ハンドルやカーブ凸の影響を除いた両端ベースラインの中央
    cx: (x0 + x2) / 2,
    cy: (y0 + y2) / 2,
  };
}

// A bezier curve with items placed along it
const CurveCanvas: React.FC<{
  curve: CurveObject;
  isSelected: boolean;
  activeItemIds?: string[];
  activeCurveIds?: string[];
  selectedCurveItemId?: string | null;
  onSelect: (e?: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onSelectCurveItem?: (curveId: string, itemId: string) => void;
  onUpdatePoints: (points: [number, number, number, number, number, number], isDragging?: boolean) => void;
  onUpdateCurvePos: (x: number, y: number) => void;
  onUpdateItems?: (updates: { id: string; attrs: Partial<PlacedItem> }[]) => void;
  onUpdateCurve?: (id: string, newCurve: Partial<CurveObject>, skipHistory?: boolean) => void;
  onDragStartAction?: () => void;
  onDragEndAction?: () => void;
  scale: number;
  snapSettings?: SnapSettings;
  templateReplacements?: Record<string, string>;
  bgCenter: { x: number; y: number };
  effectiveCenter: { x: number; y: number };
  onSnapGuideChange?: (guideX: number | null, guideY: number | null) => void;
  extractedIcons?: ExtractedIcon[];
  isCtrlPointSnapped?: boolean;
  isCurveMoving?: boolean;
  onOpenPercussionLabelModal?: (target: ItemLabelModalTarget) => void;
}> = ({
  curve,
  isSelected,
  isCtrlPointSnapped = false,
  isCurveMoving: _isCurveMoving = false,
  activeItemIds,
  activeCurveIds,
  selectedCurveItemId,
  onSelect,
  onSelectCurveItem,
  onUpdatePoints,
  onUpdateCurvePos,
  onUpdateItems,
  onUpdateCurve,
  onDragStartAction,
  onDragEndAction,
  scale,
  snapSettings,
  templateReplacements,
  bgCenter,
  effectiveCenter,
  onSnapGuideChange,
  extractedIcons,
  onOpenPercussionLabelModal,
}) => {
  const pts = curve.points;
  const pathData = getBezierPathData(pts);
  const handleRadius = 8 / scale;

  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const multiItemDragStartRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const multiCurveDragStartRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Determine items distribution
  const hasItemsArray = Array.isArray(curve.items);
  const curveItems = curve.items || [];
  const placedItems = hasItemsArray
    ? distributeItemsAlongCurve(pts, curveItems, curve.itemSize, curve.itemGap, curve.align)
    : null;
  const fallbackPositions = !hasItemsArray
    ? distributeAlongCurve(pts, curve.itemCount, curve.itemSize, curve.itemGap, curve.align)
    : null;

  // Pre-load fallback template image if needed
  const getFallbackUrl = () => {
    if (curve.itemType === 'percussion') {
      return getPercussionDataUrl(curve.percussionType || 'ティンパニ', curve.color);
    }
    if (curve.itemType === 'symbol') {
      return getSymbolDataUrl({ color: curve.color, shape: 'circle' });
    }
    const tmpl = TEMPLATE_SHAPES.find(t => t.type === curve.itemType);
    return tmpl ? getTemplateDataUrl(tmpl, curve.color, curve.customIconStyle, curve.chairType) : '';
  };
  const [fallbackImg] = useImage(getFallbackUrl(), 'anonymous');
  const [isSnappedToMid, setIsSnappedToMid] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [rotationAngle, setRotationAngle] = useState(curve.rotation || 0);
  const [isHoveredRotate, setIsHoveredRotate] = useState(false);
  const rotateCenterRef = useRef<{ x: number; y: number }>({ x: curve.x, y: curve.y });

  const isEmptyCurve = hasItemsArray ? curveItems.length === 0 : curve.itemCount === 0;

  return (
    <Group
      id={curve.id}
      x={curve.x}
      y={curve.y}
      rotation={curve.rotation || 0}
      draggable={!curve.isPinned}
      onClick={(e) => { e.cancelBubble = true; onSelect(e); }}
      onTap={(e) => { e.cancelBubble = true; onSelect(e); }}
      onDragStart={(e) => {
        onDragStartAction?.();
        dragStartPosRef.current = { x: e.target.x(), y: e.target.y() };
        const totalSelected = (activeItemIds?.length || 0) + (activeCurveIds?.length || 0);
        if (isSelected && totalSelected > 1) {
          multiItemDragStartRef.current.clear();
          multiCurveDragStartRef.current.clear();
          const stage = e.target.getStage();
          if (stage) {
            activeItemIds?.forEach(id => {
              const node = stage.findOne(`#${id}`);
              if (node && node.draggable()) {
                multiItemDragStartRef.current.set(id, { x: node.x(), y: node.y() });
              }
            });
            activeCurveIds?.forEach(id => {
              const node = stage.findOne(`#${id}`);
              if (node && node.draggable()) {
                multiCurveDragStartRef.current.set(id, { x: node.x(), y: node.y() });
              }
            });
          }
        }
      }}
      onDragMove={(e) => {
        if (e.target !== e.currentTarget) return;
        const isCtrl = Boolean(e.evt && (e.evt.ctrlKey || e.evt.metaKey));
        const isShift = Boolean(e.evt && e.evt.shiftKey);

        // ベジェ曲線の中心点（回転ハンドルや上部凸形状を除いた両端ベースラインの中央）
        const bounds = getBezierCenter(pts);
        const centerLocalX = bounds.cx;
        const centerLocalY = bounds.cy;

        const rotRad = ((curve.rotation || 0) * Math.PI) / 180;
        const cos = Math.cos(rotRad);
        const sin = Math.sin(rotRad);

        // グループ原点から曲線の真の中心点へのオフセット（回転考慮）
        const offsetX = centerLocalX * cos - centerLocalY * sin;
        const offsetY = centerLocalX * sin + centerLocalY * cos;

        // 現在の曲線の中心位置（キャンバス座標）でスナップを計算
        const currentCenterX = e.target.x() + offsetX;
        const currentCenterY = e.target.y() + offsetY;

        const snap = calculateSnapping({
          x: currentCenterX,
          y: currentCenterY,
          snapSettings,
          effectiveCenter,
          bgCenter,
          isCtrl,
          isShift,
        });

        // スナップ後の中心位置からグループ原点 (x, y) を逆算
        const finalGroupX = snap.x - offsetX;
        const finalGroupY = snap.y - offsetY;

        e.target.x(finalGroupX);
        e.target.y(finalGroupY);

        // スナップガイド線は曲線の中心位置に表示
        onSnapGuideChange?.(snap.snappedX ? snap.x : null, snap.snappedY ? snap.y : null);

        // If part of multi-selection, translate other selected items & curves
        const totalSelected = (activeItemIds?.length || 0) + (activeCurveIds?.length || 0);
        if (isSelected && totalSelected > 1 && dragStartPosRef.current) {
          const dx = finalGroupX - dragStartPosRef.current.x;
          const dy = finalGroupY - dragStartPosRef.current.y;
          const stage = e.target.getStage();
          if (stage) {
            multiItemDragStartRef.current.forEach((startPos, id) => {
              const node = stage.findOne(`#${id}`);
              if (node) {
                node.x(startPos.x + dx);
                node.y(startPos.y + dy);
              }
            });
            multiCurveDragStartRef.current.forEach((startPos, id) => {
              if (id !== curve.id) {
                const node = stage.findOne(`#${id}`);
                if (node) {
                  node.x(startPos.x + dx);
                  node.y(startPos.y + dy);
                }
              }
            });
          }
        }
      }}
      onDragEnd={(e) => {
        if (e.target !== e.currentTarget) return;
        onSnapGuideChange?.(null, null);
        const totalSelected = (activeItemIds?.length || 0) + (activeCurveIds?.length || 0);
        if (isSelected && totalSelected > 1 && dragStartPosRef.current) {
          const dx = e.target.x() - dragStartPosRef.current.x;
          const dy = e.target.y() - dragStartPosRef.current.y;
          if (onUpdateItems && multiItemDragStartRef.current.size > 0) {
            const updates: { id: string; attrs: Partial<PlacedItem> }[] = [];
            multiItemDragStartRef.current.forEach((startPos, id) => {
              updates.push({ id, attrs: { x: startPos.x + dx, y: startPos.y + dy } });
            });
            onUpdateItems(updates);
          }
          if (onUpdateCurve && multiCurveDragStartRef.current.size > 0) {
            multiCurveDragStartRef.current.forEach((startPos, id) => {
              onUpdateCurve(id, { x: startPos.x + dx, y: startPos.y + dy }, true);
            });
          } else {
            onUpdateCurvePos(e.target.x(), e.target.y());
          }
          multiItemDragStartRef.current.clear();
          multiCurveDragStartRef.current.clear();
        } else {
          onUpdateCurvePos(e.target.x(), e.target.y());
        }
        dragStartPosRef.current = null;
        onDragEndAction?.();
      }}
    >
      {/* Bezier guide line */}
      {(curve.showLine !== false || isEmptyCurve) && (
        <Path
          name="bezier-curve-path"
          data={pathData}
          stroke={isSelected ? '#6366f1' : (isEmptyCurve ? '#a855f7' : (curve.color || '#000000'))}
          strokeWidth={isSelected ? 2.5 / scale : (isEmptyCurve ? 2 / scale : 1.5 / scale)}
          dash={isSelected ? [6 / scale, 4 / scale] : (isEmptyCurve ? [4 / scale, 4 / scale] : undefined)}
          hitStrokeWidth={24 / scale}
          onClick={(e) => { e.cancelBubble = true; onSelect(e); }}
          onTap={(e) => { e.cancelBubble = true; onSelect(e); }}
        />
      )}

      {/* Items along curve (Array of items) */}
      {placedItems && placedItems.map((p) => (
        <CurveItemRenderer
          key={p.item.id || `item_${p.index}`}
          item={p.item}
          x={p.x}
          y={p.y}
          rotation={p.rotation}
          size={p.item.size || curve.itemSize}
          color={curve.color}
          isSelected={selectedCurveItemId === p.item.id}
          extractedIcons={extractedIcons}
          templateReplacements={templateReplacements}
          curveChairType={curve.chairType}
          curveCustomIconStyle={curve.customIconStyle}
          curvePercussionType={curve.percussionType}
          curveId={curve.id}
          onOpenPercussionLabelModal={onOpenPercussionLabelModal}
          onSelect={() => {
            onSelect();
            onSelectCurveItem?.(curve.id, p.item.id);
          }}
        />
      ))}

      {/* Fallback items along curve (Legacy single itemType) */}
      {fallbackPositions && fallbackPositions.map((pos) => {
        const half = curve.itemSize / 2;
        const isPercCurve = curve.itemType === 'percussion' || Boolean(curve.percussionType);
        const pInfo = isPercCurve ? getPercussionInfo(curve.percussionType) : null;
        const showPercName = isPercCurve && curve.showPercussionName !== false && Boolean(pInfo?.canvasName);

        if (fallbackImg) {
          return (
            <Group
              key={pos.index}
              x={pos.x}
              y={pos.y}
              rotation={pos.rotation}
              listening={false}
            >
              <KonvaImage
                image={fallbackImg}
                x={-half}
                y={-half}
                width={curve.itemSize}
                height={curve.itemSize}
                listening={false}
              />
              {showPercName && pInfo && (
                <Text
                  text={pInfo.canvasName}
                  x={-half}
                  y={-half}
                  width={curve.itemSize}
                  height={curve.itemSize}
                  fontSize={Math.max(9, Math.min(curve.itemSize * 0.42, 20))}
                  fontFamily="Arial, sans-serif"
                  fontStyle="bold"
                  align="center"
                  verticalAlign="middle"
                  fill={curve.color || '#000000'}
                  listening={false}
                />
              )}
            </Group>
          );
        }
        return (
          <Circle
            key={pos.index}
            x={pos.x}
            y={pos.y}
            radius={half}
            fill="#374151"
            listening={false}
          />
        );
      })}

      {/* Control handles (only when selected) */}
      {isSelected && (
        <Group name="curve-control-handle">
          {/* Start handle (left point) — dragging mirrors the right point */}
          <Circle
            key="curve-handle-start"
            x={pts[0]}
            y={pts[1]}
            radius={handleRadius}
            hitStrokeWidth={36 / scale}
            fill="#2563eb"
            stroke="#ffffff"
            strokeWidth={2 / scale}
            draggable={!curve.isPinned}
            onDragStart={(e) => {
              e.cancelBubble = true;
              onDragStartAction?.();
            }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              let nx = e.target.x();
              let ny = e.target.y();
              const isShift = Boolean(e.evt?.shiftKey);
              const snapThreshold = 12 / scale;

              // Ensure left handle stays on the left of center (x <= -10)
              if (nx > -10) nx = -10;

              if (!isShift) {
                // 水平スナップ（y=0 または反対側の端点の高さ）
                if (Math.abs(ny) < snapThreshold) {
                  ny = 0;
                }
              }

              e.target.position({ x: nx, y: ny });

              // Shiftキー押下時は左右対称をオフ（ドラッグしている端点のみ移動）
              const newPts: [number, number, number, number, number, number] = isShift
                ? [nx, ny, pts[2], pts[3], pts[4], pts[5]]
                : [nx, ny, pts[2], pts[3], -nx, ny];

              onUpdatePoints(newPts, true);
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              let nx = e.target.x();
              let ny = e.target.y();
              const isShift = Boolean(e.evt?.shiftKey);
              if (nx > -10) nx = -10;
              e.target.position({ x: nx, y: ny });

              const newPts: [number, number, number, number, number, number] = isShift
                ? [nx, ny, pts[2], pts[3], pts[4], pts[5]]
                : [nx, ny, pts[2], pts[3], -nx, ny];

              onUpdatePoints(newPts, false);
              onDragEndAction?.();
            }}
          />

          {/* End handle (right point) — dragging mirrors the left point unless Shift is held */}
          <Circle
            key="curve-handle-end"
            x={pts[4]}
            y={pts[5]}
            radius={handleRadius}
            hitStrokeWidth={36 / scale}
            fill="#2563eb"
            stroke="#ffffff"
            strokeWidth={2 / scale}
            draggable={!curve.isPinned}
            onDragStart={(e) => {
              e.cancelBubble = true;
              onDragStartAction?.();
            }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              let nx = e.target.x();
              let ny = e.target.y();
              const isShift = Boolean(e.evt?.shiftKey);
              const snapThreshold = 12 / scale;

              // Ensure right handle stays on the right of center (x >= 10)
              if (nx < 10) nx = 10;

              if (!isShift) {
                // 水平スナップ（y=0 または反対側の端点の高さ）
                if (Math.abs(ny) < snapThreshold) {
                  ny = 0;
                }
              }

              e.target.position({ x: nx, y: ny });

              // Shiftキー押下時は左右対称をオフ（ドラッグしている端点のみ移動）
              const newPts: [number, number, number, number, number, number] = isShift
                ? [pts[0], pts[1], pts[2], pts[3], nx, ny]
                : [-nx, ny, pts[2], pts[3], nx, ny];

              onUpdatePoints(newPts, true);
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              let nx = e.target.x();
              let ny = e.target.y();
              const isShift = Boolean(e.evt?.shiftKey);
              if (nx < 10) nx = 10;
              e.target.position({ x: nx, y: ny });

              const newPts: [number, number, number, number, number, number] = isShift
                ? [pts[0], pts[1], pts[2], pts[3], nx, ny]
                : [-nx, ny, pts[2], pts[3], nx, ny];

              onUpdatePoints(newPts, false);
              onDragEndAction?.();
            }}
          />

          {/* Guide lines */}
          <Line
            points={[pts[0], pts[1], pts[2], pts[3]]}
            stroke="#94a3b8"
            strokeWidth={1 / scale}
            dash={[4 / scale, 3 / scale]}
            listening={false}
          />
          <Line
            points={[pts[4], pts[5], pts[2], pts[3]]}
            stroke="#94a3b8"
            strokeWidth={1 / scale}
            dash={[4 / scale, 3 / scale]}
            listening={false}
          />

          {/* Control point handle (center red point with midpoint and line snap) */}
          <Circle
            key="curve-handle-ctrl"
            x={pts[2]}
            y={pts[3]}
            radius={handleRadius}
            hitStrokeWidth={36 / scale}
            fill={(isSnappedToMid || (isSelected && isCtrlPointSnapped)) ? '#10b981' : '#ef4444'}
            stroke="#ffffff"
            strokeWidth={2.5 / scale}
            shadowColor="#000000"
            shadowBlur={(isSnappedToMid || (isSelected && isCtrlPointSnapped)) ? 8 : 2}
            shadowOpacity={0.4}
            draggable={!curve.isPinned}
            onDragStart={(e) => {
              e.cancelBubble = true;
              onDragStartAction?.();
            }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              let mx = e.target.x();
              let my = e.target.y();
              const isShift = Boolean(e.evt?.shiftKey);
              let snapped = false;

              if (!isShift) {
                const x0 = pts[0], y0 = pts[1];
                const x2 = pts[4], y2 = pts[5];
                const snapThreshold = 15 / scale;
                let snappedToLine = false;

                // 1. 直線へのスナップ
                const L2 = (x2 - x0) ** 2 + (y2 - y0) ** 2;
                if (L2 > 0) {
                  const dot = (mx - x0) * (x2 - x0) + (my - y0) * (y2 - y0);
                  const t = dot / L2;
                  const px = x0 + t * (x2 - x0);
                  const py = y0 + t * (y2 - y0);
                  if (Math.hypot(mx - px, my - py) < snapThreshold) {
                    mx = px;
                    my = py;
                    snappedToLine = true;
                    snapped = true;
                  }
                }

                // 2. 中点へのスナップ（両端点の中点、および中心軸 X=0）
                const midX = (x0 + x2) / 2;
                const midY = (y0 + y2) / 2;

                if (Math.hypot(mx - midX, my - midY) < snapThreshold * 1.3) {
                  mx = midX;
                  my = midY;
                  snapped = true;
                } else if (Math.abs(mx - midX) < snapThreshold) {
                  mx = midX;
                  if (snappedToLine) my = midY;
                  snapped = true;
                } else if (Math.abs(mx) < snapThreshold) {
                  mx = 0;
                  snapped = true;
                }

                e.target.position({ x: mx, y: my });
              }

              setIsSnappedToMid(snapped);

              const newPts: [number, number, number, number, number, number] = [
                pts[0],
                pts[1],
                mx,
                my,
                pts[4],
                pts[5],
              ];
              onUpdatePoints(newPts, true);
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              setIsSnappedToMid(false);
              const newPts: [number, number, number, number, number, number] = [
                pts[0],
                pts[1],
                e.target.x(),
                e.target.y(),
                pts[4],
                pts[5],
              ];
              onUpdatePoints(newPts, false);
              onDragEndAction?.();
            }}
          />

          {/* Rotation Handle (only when curve is selected) */}
          {(() => {
            const bounds = getBezierCenter(pts);
            const { cx, cy, minY } = bounds;
            const rotateX = cx;
            const handleDist = 34 / scale;
            const rotateY = minY - handleDist;
            const handleRadius = (isHoveredRotate || isRotating ? 12 : 10.5) / scale;

            return (
              <Group key="curve-rotation-handle-group">
                {/* Anchor dot on top of the curve at geometric center X */}
                <Circle
                  x={rotateX}
                  y={minY}
                  radius={2.5 / scale}
                  fill="#2563eb"
                  stroke="#ffffff"
                  strokeWidth={1 / scale}
                  listening={false}
                />

                {/* Connecting dashed guide line */}
                <Line
                  points={[rotateX, minY, rotateX, rotateY + handleRadius]}
                  stroke="#2563eb"
                  strokeWidth={1.6 / scale}
                  dash={[3 / scale, 2 / scale]}
                  opacity={0.8}
                  listening={false}
                />

                {/* Real-time angle tooltip badge when rotating */}
                {isRotating && (
                  <Group x={rotateX} y={rotateY - 18 / scale} listening={false}>
                    <Rect
                      x={-24 / scale}
                      y={-9 / scale}
                      width={48 / scale}
                      height={18 / scale}
                      fill="rgba(15, 23, 42, 0.9)"
                      stroke="#38bdf8"
                      strokeWidth={1 / scale}
                      cornerRadius={9 / scale}
                      shadowColor="#000000"
                      shadowBlur={6}
                      shadowOpacity={0.35}
                    />
                    <Text
                      text={`${Math.round(rotationAngle)}°`}
                      x={-24 / scale}
                      y={-9 / scale}
                      width={48 / scale}
                      height={18 / scale}
                      fontSize={10 / scale}
                      fontFamily="system-ui, -apple-system, sans-serif"
                      fontStyle="bold"
                      align="center"
                      verticalAlign="middle"
                      fill="#ffffff"
                    />
                  </Group>
                )}

                {/* Draggable rotation handle circle */}
                <Group
                  x={rotateX}
                  y={rotateY}
                  draggable={!curve.isPinned}
                  onMouseEnter={(e) => {
                    const c = e.target.getStage()?.container();
                    if (c) c.style.cursor = 'grab';
                    setIsHoveredRotate(true);
                  }}
                  onMouseLeave={(e) => {
                    const c = e.target.getStage()?.container();
                    if (c) c.style.cursor = 'default';
                    setIsHoveredRotate(false);
                  }}
                  onDragStart={(e) => {
                    e.cancelBubble = true;
                    onDragStartAction?.();
                    setIsRotating(true);
                    setRotationAngle(curve.rotation || 0);
                    const c = e.target.getStage()?.container();
                    if (c) c.style.cursor = 'grabbing';

                    // ベジェの中心点 (cx, cy) のキャンバス絶対座標を固定ピボットとして保存
                    const rad0 = ((curve.rotation || 0) * Math.PI) / 180;
                    const centerCanvasX = curve.x + (cx * Math.cos(rad0) - cy * Math.sin(rad0));
                    const centerCanvasY = curve.y + (cx * Math.sin(rad0) + cy * Math.cos(rad0));
                    rotateCenterRef.current = { x: centerCanvasX, y: centerCanvasY };
                  }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const stage = e.target.getStage();
                    if (!stage) return;
                    const ptr = stage.getPointerPosition();
                    if (!ptr) return;

                    const transform = stage.getAbsoluteTransform().copy();
                    transform.invert();
                    const canvasPos = transform.point(ptr);

                    // ベジェ曲線の中心点 (rotateCenterRef) を原点とした角度計算
                    const dx = canvasPos.x - rotateCenterRef.current.x;
                    const dy = canvasPos.y - rotateCenterRef.current.y;
                    let angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
                    angle = Math.round(angle % 360);
                    if (angle < 0) angle += 360;

                    // 角度スナップ (Shiftキー非押下時、45度または15度単位にスナップ)
                    if (!e.evt?.shiftKey && snapSettings?.snapAngle !== false) {
                      const snapAngles = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 225, 240, 255, 270, 285, 300, 315, 330, 345, 360];
                      for (const sa of snapAngles) {
                        if (Math.abs(angle - sa) <= 5 || Math.abs(angle - (sa - 360)) <= 5) {
                          angle = sa % 360;
                          break;
                        }
                      }
                    }

                    setRotationAngle(angle);

                    // ベジェの中心位置を固定したまま回転させるための新しい (curve.x, curve.y)
                    const newRad = (angle * Math.PI) / 180;
                    const newCurveX = rotateCenterRef.current.x - (cx * Math.cos(newRad) - cy * Math.sin(newRad));
                    const newCurveY = rotateCenterRef.current.y - (cx * Math.sin(newRad) + cy * Math.cos(newRad));

                    // ハンドル自身の位置はローカル座標で固定
                    e.target.position({ x: rotateX, y: rotateY });
                    onUpdateCurve?.(curve.id, { x: newCurveX, y: newCurveY, rotation: angle }, true);
                  }}
                  onDragEnd={(e) => {
                    e.cancelBubble = true;
                    setIsRotating(false);
                    const c = e.target.getStage()?.container();
                    if (c) c.style.cursor = isHoveredRotate ? 'grab' : 'default';
                    e.target.position({ x: rotateX, y: rotateY });

                    const finalAngle = curve.rotation || 0;
                    const newRad = (finalAngle * Math.PI) / 180;
                    const finalX = rotateCenterRef.current.x - (cx * Math.cos(newRad) - cy * Math.sin(newRad));
                    const finalY = rotateCenterRef.current.y - (cx * Math.sin(newRad) + cy * Math.cos(newRad));

                    onUpdateCurve?.(curve.id, { x: finalX, y: finalY, rotation: finalAngle }, false);
                    onDragEndAction?.();
                  }}
                >
                  {/* Clean white badge with iOS-style blue ring & soft glow shadow */}
                  <Circle
                    radius={handleRadius}
                    hitStrokeWidth={40 / scale}
                    fill="#ffffff"
                    stroke="#2563eb"
                    strokeWidth={2 / scale}
                    shadowColor="rgba(37, 99, 235, 0.4)"
                    shadowBlur={isHoveredRotate || isRotating ? 8 : 4}
                    shadowOffsetY={1}
                  />
                  {/* Precise Lucide-style Rotate Arrow */}
                  <Group
                    offsetX={12}
                    offsetY={12}
                    scaleX={0.72 / scale}
                    scaleY={0.72 / scale}
                    listening={false}
                  >
                    <Path
                      data="M 21 12 a 9 9 0 1 1 -9 -9 c 2.52 0 4.93 1 6.74 2.74 L 21 8 M 21 3 v 5 h -5"
                      stroke="#2563eb"
                      strokeWidth={2.4}
                      strokeLineCap="round"
                      strokeLineJoin="round"
                      fill="transparent"
                      listening={false}
                    />
                  </Group>
                </Group>
              </Group>
            );
          })()}
        </Group>
      )}
    </Group>
  );
};


const StageCanvas = forwardRef<StageCanvasRef, StageCanvasProps>((
  {
    backgroundUrl,
    extractedIcons,
    placedItems,
    curveObjects,
    selectedId,
    selectedCurveId,
    selectedIds,
    selectedCurveIds,
    selectedCurveItemId,
    onSelectCurveItem,
    onMoveCurveItemOrder,
    isCtrlPointSnapped = false,
    isCurveMoving = false,
    snapSettings,
    zoomMultiplier = 1.0,
    onZoomChange,
    onSelectItem,
    onSelectCurve,
    onSelectItems,
    onSelectCurves,
    onUpdateItem,
    onUpdateItems,
    onUpdateCurve,
    onDragStartAction,
    onDragEndAction,
    onNudgeItems,
    onNudgeCurves,
    onAddItem,
    onDeleteItem,
    onDeleteCurveItem,
    onDeleteSelected,
    onDuplicateItem,
    onDuplicateSelected,
    onCopySelected,
    onPaste,
    onUpdateCenterOffset,
    isMovingCenter = false,
    onExitMoveCenter,
    onOpenContextMenu,
    isMeasuringScale = false,
    onMeasureComplete,
    onCancelMeasure,
    onOpenPercussionLabelModal,
    templateReplacements,
  }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const bgLayerRef = useRef<Konva.Layer>(null);
  const gridLayerRef = useRef<Konva.Layer>(null);
  const centerMarkerLayerRef = useRef<Konva.Layer>(null);
  const guideLayerRef = useRef<Konva.Layer>(null);

  // Measuring Scale State (ported from prototype measureMode)
  const [measureStartPos, setMeasureStartPos] = useState<{ x: number; y: number } | null>(null);
  const [measureCurPos, setMeasureCurPos] = useState<{ x: number; y: number } | null>(null);

  // Esc key cancels measure mode
  useEffect(() => {
    if (!isMeasuringScale) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMeasureStartPos(null);
        setMeasureCurPos(null);
        onCancelMeasure?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMeasuringScale, onCancelMeasure]);

  const activeItemIds = selectedIds ?? (selectedId ? [selectedId] : []);
  const activeCurveIds = selectedCurveIds ?? (selectedCurveId ? [selectedCurveId] : []);

  const [activeGuideX, setActiveGuideX] = useState<number | null>(null);
  const [activeGuideY, setActiveGuideY] = useState<number | null>(null);

  const [selectionBox, setSelectionBox] = useState<{
    startX: number;
    startY: number;
    curX: number;
    curY: number;
  } | null>(null);

  const [bgImage] = useImage(backgroundUrl || '', 'anonymous');
  const [stageDimensions, setStageDimensions] = useState({ width: 900, height: 600, scale: 1 });

  // Refs for smooth zoom without jumps
  const stageWrapperRef = useRef<HTMLDivElement>(null);
  const prevDimensionsRef = useRef(stageDimensions);
  const zoomAnchorRef = useRef<{
    rx: number;
    ry: number;
    clientX: number;
    clientY: number;
  } | null>(null);

  // Compute stage size to fit container synchronously
  useLayoutEffect(() => {
    if (!containerRef.current) return;

    const updateSize = () => {
      if (!containerRef.current) return;
      const containerWidth = containerRef.current.clientWidth;
      const containerHeight = containerRef.current.clientHeight;
      if (!containerWidth || !containerHeight) return;

      const bgW = bgImage?.naturalWidth || 1200;
      const bgH = bgImage?.naturalHeight || 800;
      const scaleX = containerWidth / bgW;
      const scaleY = containerHeight / bgH;
      const baseScale = Math.min(scaleX, scaleY) * 0.98;
      const finalScale = baseScale * zoomMultiplier;

      setStageDimensions({ width: bgW * finalScale, height: bgH * finalScale, scale: finalScale });
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [bgImage, zoomMultiplier]);

  // Keep zoom anchor perfectly stable so zoomed position stays under finger/cursor
  useLayoutEffect(() => {
    const prev = prevDimensionsRef.current;
    prevDimensionsRef.current = stageDimensions;

    if (!containerRef.current || !stageWrapperRef.current) return;

    const container = containerRef.current;
    const stageWrapper = stageWrapperRef.current;

    // Canvas の新サイズが DOM に反映されたこの瞬間に CSS Transform を確実にリセット
    // これにより、拡大中と確定後の表示が 1 フレームのチラつき・巨大化もなくシームレスに引き継がれる
    stageWrapper.style.transform = '';
    stageWrapper.style.transformOrigin = '';
    stageWrapper.style.willChange = '';

    if (prev.scale === stageDimensions.scale || prev.scale === 0) return;

    const anchor = zoomAnchorRef.current;

    if (anchor) {
      // 指/カーソルが触れているステージ上の比率点（rx, ry）を画面上の現在位置（clientX, clientY）に完全一致させる
      const targetContentX = stageWrapper.offsetLeft + anchor.rx * stageDimensions.width;
      const targetContentY = stageWrapper.offsetTop + anchor.ry * stageDimensions.height;

      container.scrollLeft = targetContentX - anchor.clientX;
      container.scrollTop = targetContentY - anchor.clientY;

      zoomAnchorRef.current = null;
    } else {
      // ツールバーの ＋ / − ボタンなどの場合、コンテナ中央をアンカーにして拡大縮小
      const box = container.getBoundingClientRect();
      const centerX = box.width / 2;
      const centerY = box.height / 2;

      const prevContentX = container.scrollLeft + centerX;
      const prevContentY = container.scrollTop + centerY;
      const rx = (prevContentX - stageWrapper.offsetLeft) / prev.width;
      const ry = (prevContentY - stageWrapper.offsetTop) / prev.height;

      const targetContentX = stageWrapper.offsetLeft + rx * stageDimensions.width;
      const targetContentY = stageWrapper.offsetTop + ry * stageDimensions.height;

      container.scrollLeft = targetContentX - centerX;
      container.scrollTop = targetContentY - centerY;
    }
  }, [stageDimensions]);

  // Container wheel zoom (Ctrl/Cmd + Wheel)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();

        if (!stageWrapperRef.current) return;
        const box = container.getBoundingClientRect();
        const stageRect = stageWrapperRef.current.getBoundingClientRect();

        const rx = (e.clientX - stageRect.left) / stageRect.width;
        const ry = (e.clientY - stageRect.top) / stageRect.height;

        zoomAnchorRef.current = {
          rx,
          ry,
          clientX: e.clientX - box.left,
          clientY: e.clientY - box.top,
        };

        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        const next = Math.min(Math.max(Number((zoomMultiplier + delta).toFixed(2)), 0.5), 2.5);
        if (next !== zoomMultiplier) {
          onZoomChange?.(next);
        }
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [zoomMultiplier, onZoomChange]);

  // Middle mouse (wheel click) or Space+Drag pan
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let isPanning = false;
    let startX = 0;
    let startY = 0;
    let startScrollLeft = 0;
    let startScrollTop = 0;
    let isSpaceDown = false;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        if (!isSpaceDown) {
          isSpaceDown = true;
          if (!isPanning) {
            container.style.cursor = 'grab';
          }
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpaceDown = false;
        if (!isPanning) {
          container.style.cursor = '';
        }
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 1 || (e.button === 0 && isSpaceDown)) {
        isPanning = true;
        startX = e.clientX;
        startY = e.clientY;
        startScrollLeft = container.scrollLeft;
        startScrollTop = container.scrollTop;
        container.style.cursor = 'grabbing';
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isPanning) return;
      e.preventDefault();
      e.stopPropagation();
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      container.scrollLeft = startScrollLeft - dx;
      container.scrollTop = startScrollTop - dy;
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (isPanning) {
        isPanning = false;
        container.style.cursor = isSpaceDown ? 'grab' : '';
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleAuxClick = (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    container.addEventListener('mousedown', handleMouseDown, { capture: true });
    window.addEventListener('mousemove', handleMouseMove, { capture: true });
    window.addEventListener('mouseup', handleMouseUp, { capture: true });
    container.addEventListener('auxclick', handleAuxClick);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      container.removeEventListener('mousedown', handleMouseDown, { capture: true });
      window.removeEventListener('mousemove', handleMouseMove, { capture: true });
      window.removeEventListener('mouseup', handleMouseUp, { capture: true });
      container.removeEventListener('auxclick', handleAuxClick);
    };
  }, []);

  // High-performance Gesture-driven Pinch-to-zoom & 2-finger Pan via GPU CSS Transform
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let isPinching = false;
    let startDist = 0;
    let initialZoom = zoomMultiplier || 1.0;
    let startMidX = 0;
    let startMidY = 0;
    let currentMidX = 0;
    let currentMidY = 0;
    let currentScale = 1.0;
    let currentDx = 0;
    let currentDy = 0;
    let rx = 0.5;
    let ry = 0.5;

    // Prevent Safari default full-page pinch zoom
    const preventGestures = (e: Event) => {
      e.preventDefault();
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        setSelectionBox(null);
        isPinching = true;

        const stageWrapper = stageWrapperRef.current;
        if (!stageWrapper) return;

        const t1 = e.touches[0];
        const t2 = e.touches[1];
        startDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        initialZoom = zoomMultiplier || 1.0;
        startMidX = (t1.clientX + t2.clientX) / 2;
        startMidY = (t1.clientY + t2.clientY) / 2;
        currentMidX = startMidX;
        currentMidY = startMidY;
        currentScale = 1.0;
        currentDx = 0;
        currentDy = 0;

        const stageRect = stageWrapper.getBoundingClientRect();
        // 指のステージ内での正確な相対原点 (px & 比率)
        const originX = startMidX - stageRect.left;
        const originY = startMidY - stageRect.top;
        rx = stageRect.width > 0 ? originX / stageRect.width : 0.5;
        ry = stageRect.height > 0 ? originY / stageRect.height : 0.5;

        stageWrapper.style.transformOrigin = `${originX}px ${originY}px`;
        stageWrapper.style.willChange = 'transform';
        stageWrapper.style.transition = 'none';

        e.preventDefault();
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2 && isPinching) {
        setSelectionBox(null);

        const stageWrapper = stageWrapperRef.current;
        if (!stageWrapper) return;

        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const curDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        currentMidX = (t1.clientX + t2.clientX) / 2;
        currentMidY = (t1.clientY + t2.clientY) / 2;

        const rawScale = startDist > 10 ? curDist / startDist : 1.0;
        const minScale = 0.5 / (initialZoom || 1);
        const maxScale = 2.5 / (initialZoom || 1);
        currentScale = Math.min(maxScale, Math.max(minScale, rawScale));
        currentDx = currentMidX - startMidX;
        currentDy = currentMidY - startMidY;

        // GPU コンポジタによる直接レンダリング (React再レンダリング0回・遅延0ms・完全滑らか)
        stageWrapper.style.transform = `translate3d(${currentDx}px, ${currentDy}px, 0) scale(${currentScale})`;

        e.preventDefault();
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2 && isPinching) {
        isPinching = false;

        const stageWrapper = stageWrapperRef.current;
        if (!stageWrapper) return;

        // 最終ズーム倍率を確定
        const finalZoom = Math.min(2.5, Math.max(0.5, Number((initialZoom * currentScale).toFixed(2))));

        // ズーム比率がほぼ変わらずパンのみ（指の移動）だった場合
        if (Math.abs(finalZoom - initialZoom) < 0.02) {
          stageWrapper.style.transform = '';
          stageWrapper.style.transformOrigin = '';
          stageWrapper.style.willChange = '';
          container.scrollLeft -= currentDx;
          container.scrollTop -= currentDy;
        } else if (onZoomChange) {
          // 指の現在位置を中心にして React state を 1回だけ更新
          // ※ transform は即時解除せず、useLayoutEffect で新解像度 Canvas がマウントされた瞬間に同期解除する
          const box = container.getBoundingClientRect();
          zoomAnchorRef.current = {
            rx,
            ry,
            clientX: currentMidX - box.left,
            clientY: currentMidY - box.top,
          };
          onZoomChange(finalZoom);
        } else {
          stageWrapper.style.transform = '';
          stageWrapper.style.transformOrigin = '';
          stageWrapper.style.willChange = '';
        }
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchEnd);
    container.addEventListener('gesturestart', preventGestures);
    container.addEventListener('gesturechange', preventGestures);
    container.addEventListener('gestureend', preventGestures);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      container.removeEventListener('gesturestart', preventGestures);
      container.removeEventListener('gesturechange', preventGestures);
      container.removeEventListener('gestureend', preventGestures);
    };
  }, [zoomMultiplier, onZoomChange]);

  // Attach Transformer to selected placed items (excluding pinned items)
  useEffect(() => {
    let animId: number;
    const updateTransformer = () => {
      if (!trRef.current || !stageRef.current) return;
      if (activeItemIds.length > 0 && activeCurveIds.length === 0) {
        const nodes: Konva.Node[] = [];
        activeItemIds.forEach(id => {
          const itemObj = placedItems.find(it => it.id === id);
          if (itemObj?.isPinned) return;
          const node = stageRef.current?.findOne(`#${id}`);
          if (node) nodes.push(node);
        });
        trRef.current.nodes(nodes);
        trRef.current.getLayer()?.batchDraw();
        return;
      }
      trRef.current.nodes([]);
      trRef.current.getLayer()?.batchDraw();
    };

    updateTransformer();
    // Re-verify on next animation frame in case newly added Konva nodes mounted asynchronously
    animId = requestAnimationFrame(updateTransformer);
    return () => cancelAnimationFrame(animId);
  }, [activeItemIds, activeCurveIds, placedItems]);

  // Keyboard shortcuts (Copy, Paste, Duplicate, Delete, Arrow nudging)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) {
        return;
      }

      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      const hasItemSelection = activeItemIds.length > 0;
      const hasCurveSelection = activeCurveIds.length > 0;
      const hasSelection = hasItemSelection || hasCurveSelection;

      // Copy: Ctrl+C / Cmd+C
      if (isCmdOrCtrl && (e.key === 'c' || e.key === 'C')) {
        if (hasSelection) {
          e.preventDefault();
          onCopySelected?.();
        }
        return;
      }

      // Paste: Ctrl+V / Cmd+V
      if (isCmdOrCtrl && (e.key === 'v' || e.key === 'V')) {
        if (hasStageObjectsInClipboard()) {
          e.preventDefault();
          onPaste?.();
        }
        return;
      }

      // Reorder Curve Item: '[' or Alt+ArrowLeft for left, ']' or Alt+ArrowRight for right
      if (selectedCurveId && selectedCurveItemId && onMoveCurveItemOrder) {
        if (e.key === '[' || (e.altKey && e.key === 'ArrowLeft')) {
          e.preventDefault();
          onMoveCurveItemOrder(selectedCurveId, selectedCurveItemId, 'left');
          return;
        }
        if (e.key === ']' || (e.altKey && e.key === 'ArrowRight')) {
          e.preventDefault();
          onMoveCurveItemOrder(selectedCurveId, selectedCurveItemId, 'right');
          return;
        }
      }

      // Duplicate: Ctrl+D / Cmd+D
      if (isCmdOrCtrl && (e.key === 'd' || e.key === 'D')) {
        if (hasSelection) {
          e.preventDefault();
          if (onDuplicateSelected) {
            onDuplicateSelected();
          } else if (activeItemIds.length === 1) {
            onDuplicateItem(activeItemIds[0]);
          }
        }
        return;
      }

      // Delete: Delete / Backspace
      if ((hasSelection || (selectedCurveId && selectedCurveItemId)) && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        if (selectedCurveId && selectedCurveItemId && onDeleteCurveItem) {
          onDeleteCurveItem(selectedCurveId, selectedCurveItemId);
          return;
        }
        if (onDeleteSelected) {
          onDeleteSelected();
        } else if (activeItemIds.length > 0) {
          onDeleteItem(activeItemIds[0]);
        }
        return;
      }

      // Arrow keys nudging
      if (hasSelection && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 2;
        if (hasItemSelection) {
          const updates: { id: string; attrs: Partial<PlacedItem> }[] = [];
          activeItemIds.forEach(id => {
            const cur = placedItems.find(it => it.id === id);
            if (!cur || cur.isPinned) return;
            let { x, y } = cur;
            if (e.key === 'ArrowUp') y -= step;
            if (e.key === 'ArrowDown') y += step;
            if (e.key === 'ArrowLeft') x -= step;
            if (e.key === 'ArrowRight') x += step;
            updates.push({ id, attrs: { x, y } });
          });
          if (onNudgeItems && updates.length > 0) {
            onNudgeItems(updates);
          } else if (onUpdateItems && updates.length > 0) {
            onUpdateItems(updates);
          } else if (updates[0]) {
            onUpdateItem(updates[0].id, updates[0].attrs);
          }
        }
        if (hasCurveSelection) {
          const curveUpdates: { id: string; attrs: Partial<CurveObject> }[] = [];
          activeCurveIds.forEach(id => {
            const cur = curveObjects.find(c => c.id === id);
            if (!cur || cur.isPinned) return;
            let { x, y } = cur;
            if (e.key === 'ArrowUp') y -= step;
            if (e.key === 'ArrowDown') y += step;
            if (e.key === 'ArrowLeft') x -= step;
            if (e.key === 'ArrowRight') x += step;
            curveUpdates.push({ id, attrs: { x, y } });
          });
          if (onNudgeCurves && curveUpdates.length > 0) {
            onNudgeCurves(curveUpdates);
          } else {
            curveUpdates.forEach(u => onUpdateCurve(u.id, u.attrs));
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeItemIds,
    activeCurveIds,
    placedItems,
    curveObjects,
    onDeleteSelected,
    onDeleteItem,
    onDuplicateItem,
    onDuplicateSelected,
    onCopySelected,
    onPaste,
    onUpdateItem,
    onUpdateItems,
    onUpdateCurve,
  ]);

  // HTML5 drag & drop from palette
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const iconId = e.dataTransfer.getData('iconId');
    if (!iconId || !stageRef.current) return;
    const stage = stageRef.current;
    const stageBox = stage.container().getBoundingClientRect();
    const dropX = (e.clientX - stageBox.left) / stageDimensions.scale;
    const dropY = (e.clientY - stageBox.top) / stageDimensions.scale;
    onAddItem(iconId, dropX, dropY);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  // Register contextmenu via native DOM event & long-press on touch devices
  // (not via React synthetic events, to avoid interfering with Konva's click handling)
  useEffect(() => {
    if (!stageRef.current) return;
    const stageContainer = stageRef.current.container();

    const triggerContextMenu = (clientX: number, clientY: number) => {
      if (!onOpenContextMenu) return;
      const stageBox = stageContainer.getBoundingClientRect();
      const relX = clientX - stageBox.left;
      const relY = clientY - stageBox.top;
      if (relX < 0 || relY < 0 || relX > stageBox.width || relY > stageBox.height) return;

      const canvasX = relX / stageDimensions.scale;
      const canvasY = relY / stageDimensions.scale;
      const targetItemId = activeItemIds.length === 1 ? activeItemIds[0] : null;

      onOpenContextMenu({
        x: clientX,
        y: clientY,
        canvasX,
        canvasY,
        targetItemId,
      });
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      triggerContextMenu(e.clientX, e.clientY);
    };

    // Long press for touch devices (smartphones, tablets, iPads)
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let touchStartX = 0;
    let touchStartY = 0;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        if (longPressTimer) clearTimeout(longPressTimer);
        longPressTimer = setTimeout(() => {
          try {
            if ('vibrate' in navigator) navigator.vibrate(35);
          } catch (_) {}
          triggerContextMenu(touchStartX, touchStartY);
        }, 500);
      } else {
        if (longPressTimer) clearTimeout(longPressTimer);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (longPressTimer && e.touches.length === 1) {
        const touch = e.touches[0];
        if (Math.hypot(touch.clientX - touchStartX, touch.clientY - touchStartY) > 12) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      }
    };

    const handleTouchEnd = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    stageContainer.addEventListener('contextmenu', handleContextMenu);
    stageContainer.addEventListener('touchstart', handleTouchStart, { passive: true });
    stageContainer.addEventListener('touchmove', handleTouchMove, { passive: true });
    stageContainer.addEventListener('touchend', handleTouchEnd);
    stageContainer.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      if (longPressTimer) clearTimeout(longPressTimer);
      stageContainer.removeEventListener('contextmenu', handleContextMenu);
      stageContainer.removeEventListener('touchstart', handleTouchStart);
      stageContainer.removeEventListener('touchmove', handleTouchMove);
      stageContainer.removeEventListener('touchend', handleTouchEnd);
      stageContainer.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [onOpenContextMenu, stageDimensions.scale, activeItemIds]);

  const baseWidth = bgImage?.naturalWidth || 1200;
  const baseHeight = bgImage?.naturalHeight || 800;

  useImperativeHandle(ref, () => ({
    exportStageImage: (options?: { hideCurveLines?: boolean }) => {
      if (!stageRef.current) return '';
      const bg = bgLayerRef.current;
      const tr = trRef.current;
      const grid = gridLayerRef.current;
      const marker = centerMarkerLayerRef.current;
      const guide = guideLayerRef.current;

      const prevBgVisible = bg?.visible();
      const prevGridVisible = grid?.visible();
      const prevMarkerVisible = marker?.visible();
      const prevGuideVisible = guide?.visible();
      const prevNodes = tr?.nodes();

      if (bg) bg.visible(false);
      if (grid) grid.visible(false);
      if (marker) marker.visible(false);
      if (guide) guide.visible(false);
      if (tr) tr.nodes([]);

      // Temporarily hide all selection indicators & control handles from export
      const selectionOutlines = stageRef.current.find('.canvas-item-selection-outline');
      const prevOutlinesVisible = selectionOutlines.map(o => o.visible());
      selectionOutlines.forEach(o => o.visible(false));

      const curveHandles = stageRef.current.find('.curve-control-handle');
      const prevHandlesVisible = curveHandles.map(h => h.visible());
      curveHandles.forEach(h => h.visible(false));

      const curveHighlights = stageRef.current.find('.curve-item-selection-highlight');
      const prevHighlightsVisible = curveHighlights.map(h => h.visible());
      curveHighlights.forEach(h => h.visible(false));

      // Hide bezier curve guide lines if requested
      const bezierPaths = stageRef.current.find('.bezier-curve-path');
      const prevBezierVisibles = bezierPaths.map(p => p.visible());
      if (options?.hideCurveLines) {
        bezierPaths.forEach(p => p.visible(false));
      }

      const pixelRatio = (baseWidth / stageDimensions.width) * 2.0;
      const dataUrl = stageRef.current.toDataURL({ pixelRatio, mimeType: 'image/png' });

      if (bg && prevBgVisible !== undefined) bg.visible(prevBgVisible);
      if (grid && prevGridVisible !== undefined) grid.visible(prevGridVisible);
      if (marker && prevMarkerVisible !== undefined) marker.visible(prevMarkerVisible);
      if (guide && prevGuideVisible !== undefined) guide.visible(prevGuideVisible);
      if (tr && prevNodes) tr.nodes(prevNodes);

      selectionOutlines.forEach((o, idx) => o.visible(prevOutlinesVisible[idx] ?? true));
      curveHandles.forEach((h, idx) => h.visible(prevHandlesVisible[idx] ?? true));
      curveHighlights.forEach((h, idx) => h.visible(prevHighlightsVisible[idx] ?? true));

      if (options?.hideCurveLines) {
        bezierPaths.forEach((p, idx) => p.visible(prevBezierVisibles[idx] ?? true));
      }

      return dataUrl;
    },
    getStageCenter: () => ({
      x: Math.round(baseWidth / 2),
      y: Math.round(baseHeight / 2),
    }),
    getEffectiveCenter: () => ({
      x: Math.round(baseWidth / 2) + (snapSettings?.centerOffset?.x || 0),
      y: Math.round(baseHeight / 2) + (snapSettings?.centerOffset?.y || 0),
    }),
    calculateSnapping: (x: number, y: number, isCtrl = false, isShift = false) => {
      const bgCenter = {
        x: Math.round(baseWidth / 2),
        y: Math.round(baseHeight / 2),
      };
      const effCenter = {
        x: bgCenter.x + (snapSettings?.centerOffset?.x || 0),
        y: bgCenter.y + (snapSettings?.centerOffset?.y || 0),
      };
      return calculateSnapping({
        x,
        y,
        snapSettings,
        effectiveCenter: effCenter,
        bgCenter,
        isCtrl,
        isShift,
      });
    },
    setSnapGuides: (guideX: number | null, guideY: number | null) => {
      setActiveGuideX(guideX);
      setActiveGuideY(guideY);
    },
  }));

  const getItemUrl = (item: PlacedItem): string => {
    // 1. Explicit templateType on item
    if (item.templateType) {
      if (item.templateType === 'symbol') {
        return getSymbolDataUrl({
          shape: item.symbolShape || 'circle',
          filled: Boolean(item.symbolFilled),
          text: item.symbolText,
          fontSize: item.labelFontSize || item.symbolFontSize,
          color: item.color,
          width: item.width,
          height: item.height,
        });
      }
      if (item.templateType === 'percussion') {
        const pType = item.percussionType || 'ティンパニ';
        return getPercussionDataUrl(pType, item.color);
      }
      const tmpl = TEMPLATE_SHAPES.find(t => t.type === item.templateType);
      if (tmpl) return getTemplateDataUrl(tmpl, item.color, item.customIconStyle, item.chairType);
    }
    // 2. Replaced template for extracted icon
    const tmplId = templateReplacements?.[item.iconId];
    if (tmplId) {
      const tmpl = TEMPLATE_SHAPES.find(t => t.id === tmplId || t.type === tmplId.replace(/^tmpl_/, ''));
      if (tmpl) {
        if (tmpl.type === 'symbol') {
          return getSymbolDataUrl({
            shape: item.symbolShape || 'circle',
            filled: Boolean(item.symbolFilled),
            text: item.symbolText,
            fontSize: item.labelFontSize || item.symbolFontSize,
            color: item.color,
            width: item.width,
            height: item.height,
          });
        }
        if (tmpl.type === 'percussion') {
          return getPercussionDataUrl(tmpl.percussionType || 'ティンパニ', item.color);
        }
        return getTemplateDataUrl(tmpl, item.color, item.customIconStyle, item.chairType);
      }
    }
    // 3. Extracted PDF icon
    const iconDef = extractedIcons.find(ic => ic.id === item.iconId);
    return iconDef?.url || '';
  };

  const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    // 2本指以上のタッチ操作中はピンチズーム/パンを優先し選択ボックスや計測をスキップ
    if ('touches' in e.evt && e.evt.touches.length > 1) {
      setSelectionBox(null);
      return;
    }
    if ('button' in e.evt && e.evt.button === 1) return;
    if (isMovingCenter) return;

    if (isMeasuringScale) {
      const stage = stageRef.current;
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;
      const sx = pos.x / stageDimensions.scale;
      const sy = pos.y / stageDimensions.scale;

      if (!measureStartPos) {
        setMeasureStartPos({ x: sx, y: sy });
        setMeasureCurPos({ x: sx, y: sy });
      } else {
        const dist = Math.hypot(sx - measureStartPos.x, sy - measureStartPos.y);
        if (dist > 2) {
          setMeasureStartPos(null);
          setMeasureCurPos(null);
          onMeasureComplete?.(dist);
        }
      }
      return;
    }

    const isBg = e.target === e.target.getStage() || e.target.name() === 'bgImage';
    if (isBg) {
      const stage = stageRef.current;
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;
      const sx = pos.x / stageDimensions.scale;
      const sy = pos.y / stageDimensions.scale;

      const isShift = 'shiftKey' in e.evt && Boolean(e.evt.shiftKey);
      if (!isShift) {
        if (onSelectItems) onSelectItems([]);
        if (onSelectCurves) onSelectCurves([]);
        onSelectItem(null);
        onSelectCurve(null);
      }

      setSelectionBox({
        startX: sx,
        startY: sy,
        curX: sx,
        curY: sy,
      });
    }
  };

  const handleStageMouseMove = (e?: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    // 2本指以上のタッチ操作中は選択ボックスを破棄
    if (e?.evt && 'touches' in e.evt && e.evt.touches.length > 1) {
      setSelectionBox(null);
      return;
    }

    if (isMeasuringScale) {
      if (measureStartPos) {
        const stage = stageRef.current;
        if (!stage) return;
        const pos = stage.getPointerPosition();
        if (!pos) return;
        const cx = pos.x / stageDimensions.scale;
        const cy = pos.y / stageDimensions.scale;
        setMeasureCurPos({ x: cx, y: cy });
      }
      return;
    }

    if (!selectionBox) return;
    const stage = stageRef.current;
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const cx = pos.x / stageDimensions.scale;
    const cy = pos.y / stageDimensions.scale;

    setSelectionBox(prev => prev ? { ...prev, curX: cx, curY: cy } : null);
  };

  const handleStageMouseUp = (e?: Konva.KonvaEventObject<MouseEvent | TouchEvent> | MouseEvent | TouchEvent) => {
    const rawEvt = e && 'evt' in e ? e.evt : e;
    if (rawEvt && 'touches' in rawEvt && rawEvt.touches.length > 1) {
      setSelectionBox(null);
      return;
    }

    if (!selectionBox) return;

    const x1 = Math.min(selectionBox.startX, selectionBox.curX);
    const x2 = Math.max(selectionBox.startX, selectionBox.curX);
    const y1 = Math.min(selectionBox.startY, selectionBox.curY);
    const y2 = Math.max(selectionBox.startY, selectionBox.curY);
    const w = x2 - x1;
    const h = y2 - y1;

    setSelectionBox(null);

    // If box is tiny (just a click), selection has already been cleared
    if (w < 6 && h < 6) return;

    const isShift = e && 'shiftKey' in e && Boolean(e.shiftKey);
    const matchedItemIds: string[] = isShift ? [...activeItemIds] : [];
    const matchedCurveIds: string[] = isShift ? [...activeCurveIds] : [];

    // Check placed items intersecting with selection rectangle
    placedItems.forEach(item => {
      const halfW = (item.width * (item.scaleX || 1)) / 2;
      const halfH = (item.height * (item.scaleY || 1)) / 2;
      const left = item.x - halfW;
      const right = item.x + halfW;
      const top = item.y - halfH;
      const bottom = item.y + halfH;

      const intersects = !(right < x1 || left > x2 || bottom < y1 || top > y2);
      if (intersects && !matchedItemIds.includes(item.id)) {
        matchedItemIds.push(item.id);
      }
    });

    // Check curves intersecting with selection rectangle
    curveObjects.forEach(curve => {
      const pts = curve.points;
      const rot = ((curve.rotation || 0) * Math.PI) / 180;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const rotatedPts = [
        { x: pts[0] * cos - pts[1] * sin, y: pts[0] * sin + pts[1] * cos },
        { x: pts[2] * cos - pts[3] * sin, y: pts[2] * sin + pts[3] * cos },
        { x: pts[4] * cos - pts[5] * sin, y: pts[4] * sin + pts[5] * cos },
      ];
      const xs = rotatedPts.map(p => curve.x + p.x);
      const ys = rotatedPts.map(p => curve.y + p.y);
      const left = Math.min(...xs) - 20;
      const right = Math.max(...xs) + 20;
      const top = Math.min(...ys) - 20;
      const bottom = Math.max(...ys) + 20;

      const intersects = !(right < x1 || left > x2 || bottom < y1 || top > y2);
      if (intersects && !matchedCurveIds.includes(curve.id)) {
        matchedCurveIds.push(curve.id);
      }
    });

    if (onSelectItems) {
      onSelectItems(matchedItemIds);
    } else if (matchedItemIds.length > 0) {
      onSelectItem(matchedItemIds[0]);
    }

    if (onSelectCurves) {
      onSelectCurves(matchedCurveIds);
    } else if (matchedCurveIds.length > 0) {
      onSelectCurve(matchedCurveIds[0]);
    }
  };

  useEffect(() => {
    const handleWindowMouseUp = (e: MouseEvent | TouchEvent) => {
      if (selectionBox) {
        handleStageMouseUp(e);
      }
    };
    window.addEventListener('mouseup', handleWindowMouseUp);
    window.addEventListener('touchend', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleWindowMouseUp);
      window.removeEventListener('touchend', handleWindowMouseUp);
    };
  }, [selectionBox, activeItemIds, activeCurveIds, placedItems, curveObjects]);

  return (
    <div className="flex-1 w-full h-full relative overflow-hidden flex">
      {/* ── Fixed Overlays: キャンバスのスクロール/パンに流されず画面上部・下部に常に固定表示 ── */}
      {isMeasuringScale && (
        <div key="measuring-banner" className="absolute top-4 left-1/2 -translate-x-1/2 z-40 liquid-glass-heavy text-slate-900 dark:text-white text-xs font-bold px-5 py-2.5 rounded-full flex items-center gap-2.5 animate-in fade-in slide-in-from-top-2 duration-150 pointer-events-auto shadow-lg">
          <Ruler className="w-4 h-4 text-[#007AFF]" />
          <span className="text-[#007AFF] dark:text-sky-400">
            {measureStartPos
              ? '「2点目」をクリックして距離を確定してください（Escでキャンセル）'
              : 'キャンバス上で基準となる長さの「1点目」をクリックしてください'}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMeasureStartPos(null);
              setMeasureCurPos(null);
              onCancelMeasure?.();
            }}
            className="ml-2 liquid-btn text-slate-700 dark:text-slate-200 px-2.5 py-0.5 rounded-full text-[10px] font-bold transition-colors flex items-center gap-1 cursor-pointer"
          >
            <X className="w-3 h-3" />
            <span>キャンセル</span>
          </button>
        </div>
      )}
      {isMovingCenter && !isMeasuringScale && (
        <div key="moving-center-banner" className="absolute top-4 left-1/2 -translate-x-1/2 z-30 liquid-glass-heavy text-slate-800 dark:text-white text-xs font-semibold px-4 py-2 rounded-full flex items-center gap-3 shadow-lg select-none pointer-events-auto">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff00ff] animate-pulse shrink-0 shadow-[0_0_8px_#ff00ff]" />
          <span>基準点移動モード：ピンクのマーカーをドラッグして位置を移動できます</span>
          <button
            type="button"
            onClick={() => onExitMoveCenter?.()}
            className="liquid-btn-primary text-white text-[11px] font-bold px-3 py-1 rounded-full flex items-center gap-1 cursor-pointer transition-all hover:scale-105 active:scale-95"
            title="基準点の移動モードを終了します"
          >
            <Check className="w-3.5 h-3.5" />
            <span>移動を終了</span>
          </button>
        </div>
      )}

      {/* Curve Item Reorder Quick Control Bar */}
      {selectedCurveId && selectedCurveItemId && !isMovingCenter && !isMeasuringScale && (() => {
        const curve = curveObjects.find(c => c.id === selectedCurveId);
        const items = curve?.items || [];
        const idx = items.findIndex(it => it.id === selectedCurveItemId);
        if (idx === -1) return null;
        const currentItem = items[idx];
        return (
          <div
            key="curve-item-reorder-banner"
            className="absolute top-4 left-1/2 -translate-x-1/2 z-30 liquid-glass-heavy text-slate-800 dark:text-white text-xs font-semibold px-4 py-2 rounded-full flex items-center gap-3 shadow-lg select-none pointer-events-auto animate-in fade-in slide-in-from-top-2 duration-150"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-[#007AFF] shrink-0" />
            <span className="truncate max-w-[140px] sm:max-w-none">
              {idx + 1}. {currentItem.label || currentItem.type || 'アイテム'}
            </span>
            <div className="flex items-center gap-1.5 border-l border-slate-300 dark:border-slate-600 pl-2">
              <button
                type="button"
                disabled={idx <= 0}
                onClick={() => onMoveCurveItemOrder?.(selectedCurveId, selectedCurveItemId, 'left')}
                className="liquid-btn text-slate-700 dark:text-slate-200 text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer transition-all hover:scale-105 active:scale-95"
                title="左隣へ移動 ([ または Alt+←])"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>左隣へ</span>
              </button>
              <button
                type="button"
                disabled={idx >= items.length - 1}
                onClick={() => onMoveCurveItemOrder?.(selectedCurveId, selectedCurveItemId, 'right')}
                className="liquid-btn text-slate-700 dark:text-slate-200 text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer transition-all hover:scale-105 active:scale-95"
                title="右隣へ移動 (] または Alt+→)"
              >
                <span>右隣へ</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onDeleteCurveItem?.(selectedCurveId, selectedCurveItemId)}
                className="liquid-btn text-red-600 dark:text-red-400 hover:bg-red-500/15 text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 cursor-pointer transition-all hover:scale-105 active:scale-95"
                title="このオブジェクトを曲線から削除 (Deleteキー)"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>削除</span>
              </button>
              <button
                type="button"
                onClick={() => onSelectCurveItem?.(selectedCurveId, '')}
                className="ml-1 p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                title="選択を解除"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      })()}

      {/* Floating Multi-Selection Action Pill (Liquid Glass) */}
      {(activeItemIds.length + activeCurveIds.length) > 1 && (
        <div key="multi-select-action-pill" className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 liquid-glass-heavy text-slate-800 dark:text-white px-4 py-2 rounded-full flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-150 pointer-events-auto shadow-lg">
          <div className="flex items-center gap-1.5 text-xs font-bold text-[#007AFF] dark:text-sky-400">
            <span className="w-2 h-2 rounded-full bg-[#007AFF] animate-pulse" />
            <span>{activeItemIds.length + activeCurveIds.length} 個選択中</span>
          </div>
          <div className="h-3.5 w-px bg-slate-300/70 dark:bg-slate-600/70" />
          {onDuplicateSelected && (
            <button
              type="button"
              onClick={onDuplicateSelected}
              className="text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-[#007AFF] flex items-center gap-1 liquid-btn px-2.5 py-1 rounded-full transition-colors cursor-pointer"
              title="選択したアイテムを複製 (Ctrl+D)"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>複製</span>
            </button>
          )}
          {onDeleteSelected && (
            <button
              type="button"
              onClick={onDeleteSelected}
              className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:text-rose-700 flex items-center gap-1 liquid-btn hover:!bg-rose-50 dark:hover:!bg-rose-950/60 px-2.5 py-1 rounded-full transition-colors cursor-pointer"
              title="選択したアイテムを一括削除 (Delete)"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>削除</span>
            </button>
          )}
          <div className="h-3.5 w-px bg-slate-300/70 dark:bg-slate-600/70" />
          <button
            type="button"
            onClick={() => {
              if (onSelectItems) onSelectItems([]);
              else onSelectItem(null);
              if (onSelectCurves) onSelectCurves([]);
              else onSelectCurve(null);
            }}
            className="text-xs text-slate-400 hover:text-slate-700 dark:hover:white p-1 rounded-full transition-colors cursor-pointer flex items-center justify-center"
            title="選択を解除"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Scrollable Workspace Container ── */}
      <div
        ref={containerRef}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        style={{ touchAction: 'pan-x pan-y' }}
        className={`flex-1 w-full h-full flex bg-transparent overflow-auto relative select-none p-5 transition-colors ${
          isMeasuringScale ? 'cursor-crosshair' : ''
        }`}
      >
      {/* Scrollable centering canvas wrapper */}
      <div className="min-w-full min-h-full w-max h-max flex items-center justify-center p-6 shrink-0 m-auto">
        <div
          ref={stageWrapperRef}
          key="stage-konva-wrapper"
          className="bg-white dark:bg-slate-900 shadow-[0_16px_48px_-8px_rgba(15,23,42,0.16)] ring-1 ring-white/80 dark:ring-white/15 rounded-xl overflow-hidden relative shrink-0 transition-colors"
          style={{ width: stageDimensions.width, height: stageDimensions.height }}
        >
          <Stage
          ref={stageRef}
          width={stageDimensions.width}
          height={stageDimensions.height}
          scaleX={stageDimensions.scale}
          scaleY={stageDimensions.scale}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
          onTouchStart={handleStageMouseDown}
          onTouchMove={handleStageMouseMove}
          onTouchEnd={handleStageMouseUp}
        >
          {/* Background Layer */}
          <Layer ref={bgLayerRef}>
            {bgImage && (
              <KonvaImage
                name="bgImage"
                image={bgImage}
                x={0} y={0}
                width={baseWidth}
                height={baseHeight}
                listening={true}
              />
            )}
          </Layer>

          {/* Grid Layer */}
          {snapSettings?.showGrid && (
            <Layer ref={gridLayerRef} listening={false}>
              {(() => {
                const step = snapSettings.gridSize || 50;
                const limit = 4000;
                const bgCenterX = Math.round(baseWidth / 2);
                const bgCenterY = Math.round(baseHeight / 2);
                const cx = bgCenterX + (snapSettings?.centerOffset?.x || 0);
                const cy = bgCenterY + (snapSettings?.centerOffset?.y || 0);
                const lines: React.ReactNode[] = [];

                for (let y = 0; y <= limit; y += step) {
                  const isMajor = Math.round(y) % (step * 5) === 0;
                  const strokeWidth = (isMajor ? 1.5 : 0.75) / stageDimensions.scale;
                  const opacity = isMajor ? 0.35 : 0.15;
                  lines.push(
                    <Line
                      key={`gh+${y}`}
                      points={[cx - limit, cy + y, cx + limit, cy + y]}
                      stroke="#475569"
                      strokeWidth={strokeWidth}
                      opacity={opacity}
                    />
                  );
                  if (y > 0) {
                    lines.push(
                      <Line
                        key={`gh-${y}`}
                        points={[cx - limit, cy - y, cx + limit, cy - y]}
                        stroke="#475569"
                        strokeWidth={strokeWidth}
                        opacity={opacity}
                      />
                    );
                  }
                }

                for (let x = 0; x <= limit; x += step) {
                  const isMajor = Math.round(x) % (step * 5) === 0;
                  const strokeWidth = (isMajor ? 1.5 : 0.75) / stageDimensions.scale;
                  const opacity = isMajor ? 0.35 : 0.15;
                  lines.push(
                    <Line
                      key={`gv+${x}`}
                      points={[cx + x, cy - limit, cx + x, cy + limit]}
                      stroke="#475569"
                      strokeWidth={strokeWidth}
                      opacity={opacity}
                    />
                  );
                  if (x > 0) {
                    lines.push(
                      <Line
                        key={`gv-${x}`}
                        points={[cx - x, cy - limit, cx - x, cy + limit]}
                        stroke="#475569"
                        strokeWidth={strokeWidth}
                        opacity={opacity}
                      />
                    );
                  }
                }

                return lines;
              })()}
            </Layer>
          )}

          {/* Center Marker Layer (Hidden by default; shown only if enabled in settings or in move mode) */}
          {(snapSettings?.showCenterMarker || isMovingCenter) && (
            <Layer ref={centerMarkerLayerRef}>
              {(() => {
                const bgCenterX = Math.round(baseWidth / 2);
                const bgCenterY = Math.round(baseHeight / 2);
                const effX = bgCenterX + (snapSettings?.centerOffset?.x || 0);
                const effY = bgCenterY + (snapSettings?.centerOffset?.y || 0);
                return (
                  <Group
                    x={effX}
                    y={effY}
                    draggable={isMovingCenter}
                    listening={isMovingCenter}
                    onMouseEnter={(e) => {
                      if (isMovingCenter) {
                        const container = e.target.getStage()?.container();
                        if (container) container.style.cursor = 'move';
                      }
                    }}
                    onMouseLeave={(e) => {
                      const container = e.target.getStage()?.container();
                      if (container) container.style.cursor = 'default';
                    }}
                    onDragEnd={(e) => {
                      onUpdateCenterOffset?.({
                        x: Math.round(e.target.x() - bgCenterX),
                        y: Math.round(e.target.y() - bgCenterY),
                      });
                    }}
                  >
                    {/* Touch & Click enlarged hit area for dragging center marker */}
                    {isMovingCenter && (
                      <Circle
                        radius={32 / stageDimensions.scale}
                        fill="transparent"
                        listening={true}
                      />
                    )}
                    {/* Center Point Marker Dot */}
                    <Circle
                      radius={5 / stageDimensions.scale}
                      fill="#ff00ff"
                      stroke="#ffffff"
                      strokeWidth={1.5 / stageDimensions.scale}
                      shadowColor="#ff00ff"
                      shadowBlur={4 / stageDimensions.scale}
                      shadowOpacity={0.7}
                      listening={false}
                    />
                    {/* Target Ring Marker */}
                    <Circle
                      radius={16 / stageDimensions.scale}
                      stroke="#ff00ff"
                      strokeWidth={2 / stageDimensions.scale}
                      dash={[4 / stageDimensions.scale, 4 / stageDimensions.scale]}
                      fill="rgba(255, 0, 255, 0.15)"
                      listening={false}
                    />
                    {/* Horizontal Center Axis (screen-wide) */}
                    <Line
                      points={[-5000, 0, 5000, 0]}
                      stroke="#ff00ff"
                      strokeWidth={1.5 / stageDimensions.scale}
                      dash={[6 / stageDimensions.scale, 6 / stageDimensions.scale]}
                      opacity={0.75}
                      listening={false}
                    />
                    {/* Vertical Center Axis (screen-wide) */}
                    <Line
                      points={[0, -5000, 0, 5000]}
                      stroke="#ff00ff"
                      strokeWidth={1.5 / stageDimensions.scale}
                      dash={[6 / stageDimensions.scale, 6 / stageDimensions.scale]}
                      opacity={0.75}
                      listening={false}
                    />
                    {/* Hit target for dragging when in moving mode */}
                    {isMovingCenter && (
                      <Circle
                        radius={20 / stageDimensions.scale}
                        fill="transparent"
                        hitStrokeWidth={40 / stageDimensions.scale}
                      />
                    )}
                  </Group>
                );
              })()}
            </Layer>
          )}

          {/* Snap Guide Layer */}
          <Layer ref={guideLayerRef} listening={false}>
            {activeGuideX !== null && (
              <Line
                points={[activeGuideX, -5000, activeGuideX, 5000]}
                stroke="#ff00ff"
                strokeWidth={1.5 / stageDimensions.scale}
                dash={[6 / stageDimensions.scale, 4 / stageDimensions.scale]}
                opacity={0.85}
              />
            )}
            {activeGuideY !== null && (
              <Line
                points={[-5000, activeGuideY, 5000, activeGuideY]}
                stroke="#ff00ff"
                strokeWidth={1.5 / stageDimensions.scale}
                dash={[6 / stageDimensions.scale, 4 / stageDimensions.scale]}
                opacity={0.85}
              />
            )}
          </Layer>

          {/* Bezier Curve Objects Layer */}
          <Layer>
            {curveObjects.map(curve => {
              const bgCenterX = Math.round(baseWidth / 2);
              const bgCenterY = Math.round(baseHeight / 2);
              const effCenter = {
                x: bgCenterX + (snapSettings?.centerOffset?.x || 0),
                y: bgCenterY + (snapSettings?.centerOffset?.y || 0),
              };
              return (
                <CurveCanvas
                  key={curve.id}
                  curve={curve}
                  isSelected={activeCurveIds.includes(curve.id)}
                  isCtrlPointSnapped={isCtrlPointSnapped}
                  isCurveMoving={isCurveMoving}
                  activeItemIds={activeItemIds}
                  activeCurveIds={activeCurveIds}
                  selectedCurveItemId={selectedCurveItemId}
                  onSelectCurveItem={onSelectCurveItem}
                  onSelect={(e) => {
                    if (e?.evt?.shiftKey) {
                      if (activeCurveIds.includes(curve.id)) {
                        const next = activeCurveIds.filter(id => id !== curve.id);
                        if (onSelectCurves) onSelectCurves(next);
                        else onSelectCurve(next[0] || null);
                      } else {
                        const next = [...activeCurveIds, curve.id];
                        if (onSelectCurves) onSelectCurves(next);
                        else onSelectCurve(curve.id);
                      }
                    } else {
                      if (onSelectCurves) onSelectCurves([curve.id]);
                      else onSelectCurve(curve.id);
                      if (onSelectItems) onSelectItems([]);
                      else onSelectItem(null);
                    }
                  }}
                  onUpdatePoints={(points, isDragging) => onUpdateCurve(curve.id, { points }, isDragging)}
                  onUpdateCurvePos={(x, y) => onUpdateCurve(curve.id, { x, y })}
                  onUpdateItems={onUpdateItems}
                  onUpdateCurve={onUpdateCurve}
                  onDragStartAction={onDragStartAction}
                  onDragEndAction={onDragEndAction}
                  scale={stageDimensions.scale}
                  snapSettings={snapSettings}
                  bgCenter={{ x: bgCenterX, y: bgCenterY }}
                  effectiveCenter={effCenter}
                  onSnapGuideChange={(gx, gy) => {
                    setActiveGuideX(gx);
                    setActiveGuideY(gy);
                  }}
                  extractedIcons={extractedIcons}
                  templateReplacements={templateReplacements}
                  onOpenPercussionLabelModal={onOpenPercussionLabelModal}
                />
              );
            })}
          </Layer>

          {/* Placed Items Layer */}
          <Layer>
            {placedItems.map(item => {
              const url = getItemUrl(item);
              if (!url) return null;
              const bgCenterX = Math.round(baseWidth / 2);
              const bgCenterY = Math.round(baseHeight / 2);
              const effCenter = {
                x: bgCenterX + (snapSettings?.centerOffset?.x || 0),
                y: bgCenterY + (snapSettings?.centerOffset?.y || 0),
              };
              return (
                <CanvasItem
                  key={item.id}
                  item={item}
                  iconUrl={url}
                  isSelected={activeItemIds.includes(item.id)}
                  activeItemIds={activeItemIds}
                  activeCurveIds={activeCurveIds}
                  snapSettings={snapSettings}
                  templateReplacements={templateReplacements}
                  bgCenter={{ x: bgCenterX, y: bgCenterY }}
                  effectiveCenter={effCenter}
                  onSelect={(e) => {
                    if (e?.evt?.shiftKey) {
                      if (activeItemIds.includes(item.id)) {
                        const next = activeItemIds.filter(id => id !== item.id);
                        if (onSelectItems) onSelectItems(next);
                        else onSelectItem(next[0] || null);
                      } else {
                        const next = [...activeItemIds, item.id];
                        if (onSelectItems) onSelectItems(next);
                        else onSelectItem(item.id);
                      }
                    } else {
                      if (onSelectItems) onSelectItems([item.id]);
                      else onSelectItem(item.id);
                      if (onSelectCurves) onSelectCurves([]);
                      else onSelectCurve(null);
                    }
                  }}
                  onChange={(attrs) => onUpdateItem(item.id, attrs)}
                  onUpdateItems={onUpdateItems}
                  onUpdateCurve={onUpdateCurve}
                  onDragStartAction={onDragStartAction}
                  onDragEndAction={onDragEndAction}
                  onSnapGuideChange={(gx, gy) => {
                    setActiveGuideX(gx);
                    setActiveGuideY(gy);
                  }}
                  onOpenPercussionLabelModal={onOpenPercussionLabelModal}
                />
              );
            })}
          </Layer>

          {/* Transformer & Selection Rectangle Layer */}
          {(() => {
            const selectedSingleItem = activeItemIds.length === 1 ? placedItems.find(it => it.id === activeItemIds[0]) : null;
            const singleItemTmplId = selectedSingleItem ? templateReplacements?.[selectedSingleItem.iconId] : undefined;
            const isSelectedSymbol = selectedSingleItem?.templateType === 'symbol' ||
                                     singleItemTmplId === 'tmpl_symbol' ||
                                     singleItemTmplId?.replace(/^tmpl_/, '') === 'symbol';

            return (
              <Layer>
                <Transformer
                  ref={trRef}
                  boundBoxFunc={(oldBox, newBox) => {
                    if (Math.abs(newBox.width) < 10 || Math.abs(newBox.height) < 10) return oldBox;
                    return newBox;
                  }}
                  rotateEnabled={true}
                  rotationSnaps={snapSettings?.snapAngle !== false ? [0, 45, 90, 135, 180, 225, 270, 315] : []}
                  rotationSnapTolerance={15}
                  keepRatio={!isSelectedSymbol}
                  enabledAnchors={
                    isSelectedSymbol
                      ? ['top-left', 'top-center', 'top-right', 'middle-right', 'bottom-right', 'bottom-center', 'bottom-left', 'middle-left']
                      : ['top-left', 'top-right', 'bottom-left', 'bottom-right']
                  }
                  borderStroke="#2563eb"
                  borderStrokeWidth={typeof window !== 'undefined' && ('ontouchstart' in window || window.innerWidth < 1024) ? 2 : 1.5}
                  anchorStroke="#2563eb"
                  anchorFill="#ffffff"
                  anchorSize={typeof window !== 'undefined' && ('ontouchstart' in window || window.innerWidth < 1024) ? 16 : 8}
                  anchorCornerRadius={typeof window !== 'undefined' && ('ontouchstart' in window || window.innerWidth < 1024) ? 5 : 2}
                  onTransformStart={() => {
                    onDragStartAction?.();
                  }}
                  onTransform={() => {
                    if (!stageRef.current) return;
                    activeItemIds.forEach(id => {
                      const node = stageRef.current?.findOne(`#${id}`);
                      if (node) {
                        const textGroup = (node as Konva.Container).findOne?.('.symbol-text-group');
                        if (textGroup) {
                          textGroup.scaleX(1 / (node.scaleX() || 1));
                          textGroup.scaleY(1 / (node.scaleY() || 1));
                        }
                      }
                    });
                  }}
                  onTransformEnd={() => {
                    if (!stageRef.current) return;
                    if (activeItemIds.length > 1 && onUpdateItems) {
                      const updates: { id: string; attrs: Partial<PlacedItem> }[] = [];
                      activeItemIds.forEach(id => {
                        const node = stageRef.current?.findOne(`#${id}`);
                        if (node) {
                          updates.push({
                            id,
                            attrs: {
                              x: node.x(),
                              y: node.y(),
                              rotation: node.rotation(),
                              scaleX: node.scaleX(),
                              scaleY: node.scaleY(),
                            }
                          });
                        }
                      });
                      onUpdateItems(updates);
                    } else if (activeItemIds.length === 1) {
                      const node = stageRef.current?.findOne(`#${activeItemIds[0]}`);
                      if (node) {
                        const targetItem = placedItems.find(it => it.id === activeItemIds[0]);
                        const targetTmplId = targetItem ? templateReplacements?.[targetItem.iconId] : undefined;
                        const isTargetSymbol = targetItem?.templateType === 'symbol' ||
                                               targetTmplId === 'tmpl_symbol' ||
                                               targetTmplId?.replace(/^tmpl_/, '') === 'symbol';
                        if (targetItem && isTargetSymbol) {
                          const sx = node.scaleX();
                          const sy = node.scaleY();
                          const newWidth = Math.max(10, Math.round(targetItem.width * sx));
                          const newHeight = Math.max(10, Math.round(targetItem.height * sy));
                          node.scaleX(1);
                          node.scaleY(1);
                          onUpdateItem(activeItemIds[0], {
                            x: node.x(),
                            y: node.y(),
                            rotation: node.rotation(),
                            width: newWidth,
                            height: newHeight,
                            scaleX: 1,
                            scaleY: 1,
                          });
                        } else {
                          onUpdateItem(activeItemIds[0], {
                            x: node.x(),
                            y: node.y(),
                            rotation: node.rotation(),
                            scaleX: node.scaleX(),
                            scaleY: node.scaleY(),
                          });
                        }
                      }
                    }
                    onDragEndAction?.();
                  }}
                />

                {/* Selection Rectangle (Rubberband Box) */}
                {selectionBox && (
                  <Rect
                    x={Math.min(selectionBox.startX, selectionBox.curX)}
                    y={Math.min(selectionBox.startY, selectionBox.curY)}
                    width={Math.abs(selectionBox.curX - selectionBox.startX)}
                    height={Math.abs(selectionBox.curY - selectionBox.startY)}
                    fill="rgba(59, 130, 246, 0.15)"
                    stroke="#3b82f6"
                    strokeWidth={1.5 / stageDimensions.scale}
                    dash={[6 / stageDimensions.scale, 3 / stageDimensions.scale]}
                    listening={false}
                  />
                )}
              </Layer>
            );
          })()}

          {/* Measure Scale Preview Layer */}
          {isMeasuringScale && (
            <Layer listening={false}>
              {measureStartPos && measureCurPos && (
                <>
                  <Line
                    points={[measureStartPos.x, measureStartPos.y, measureCurPos.x, measureCurPos.y]}
                    stroke="#ef4444"
                    strokeWidth={2.5 / stageDimensions.scale}
                    dash={[6 / stageDimensions.scale, 4 / stageDimensions.scale]}
                  />
                  <Circle
                    x={measureStartPos.x}
                    y={measureStartPos.y}
                    radius={6 / stageDimensions.scale}
                    fill="#ef4444"
                    stroke="#ffffff"
                    strokeWidth={2 / stageDimensions.scale}
                  />
                  <Circle
                    x={measureCurPos.x}
                    y={measureCurPos.y}
                    radius={6 / stageDimensions.scale}
                    fill="#ef4444"
                    stroke="#ffffff"
                    strokeWidth={2 / stageDimensions.scale}
                  />
                  {/* Distance badge */}
                  {(() => {
                    const dist = Math.hypot(measureCurPos.x - measureStartPos.x, measureCurPos.y - measureStartPos.y);
                    const midX = (measureStartPos.x + measureCurPos.x) / 2;
                    const midY = (measureStartPos.y + measureCurPos.y) / 2 - 16 / stageDimensions.scale;
                    return (
                      <Group x={midX} y={midY}>
                        <Rect
                          x={-40 / stageDimensions.scale}
                          y={-10 / stageDimensions.scale}
                          width={80 / stageDimensions.scale}
                          height={20 / stageDimensions.scale}
                          fill="rgba(15, 23, 42, 0.85)"
                          cornerRadius={4 / stageDimensions.scale}
                        />
                        <Text
                          text={`${dist.toFixed(1)} px`}
                          x={-40 / stageDimensions.scale}
                          y={-5 / stageDimensions.scale}
                          width={80 / stageDimensions.scale}
                          align="center"
                          fontSize={11 / stageDimensions.scale}
                          fontFamily="sans-serif"
                          fontStyle="bold"
                          fill="#ffffff"
                        />
                      </Group>
                    );
                  })()}
                </>
              )}
            </Layer>
          )}
        </Stage>
        </div>
      </div>
      </div>
    </div>
  );
});

StageCanvas.displayName = 'StageCanvas';
export default StageCanvas;
