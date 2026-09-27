import React, { useRef, useEffect, useLayoutEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { Stage, Layer, Image as KonvaImage, Transformer, Path, Circle, Line, Group, Text, Rect } from 'react-konva';
import useImage from 'use-image';
import type { ExtractedIcon } from '../App';
import type Konva from 'konva';
import { distributeAlongCurve, distributeItemsAlongCurve, getBezierPathData, type CurveObject, type CurveItem } from '../utils/bezierUtils';
import { TEMPLATE_SHAPES, getTemplateDataUrl, getPercussionDataUrl, getPercussionInfo } from '../utils/templateShapes';
import { hasStageObjectsInClipboard } from '../utils/clipboard';

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
  pianoLidState?: string;
  color?: string;
  customIconStyle?: 'default' | 'xMark' | 'doubleCircle';
  chairType?: 'normal' | 'pianoChair' | 'pianoChairSvg';
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
  snapSettings?: SnapSettings;
  zoomMultiplier?: number;
  onZoomChange?: (multiplier: number) => void;
  onSelectItem: (id: string | null) => void;
  onSelectCurve: (id: string | null) => void;
  onSelectItems?: (ids: string[]) => void;
  onSelectCurves?: (ids: string[]) => void;
  onUpdateItem: (id: string, newAttrs: Partial<PlacedItem>) => void;
  onUpdateItems?: (updates: { id: string; attrs: Partial<PlacedItem> }[]) => void;
  onUpdateCurve: (id: string, newCurve: Partial<CurveObject>) => void;
  onAddItem: (iconId: string, x: number, y: number) => void;
  onDeleteItem: (id: string) => void;
  onDeleteSelected?: () => void;
  onDuplicateItem: (id: string) => void;
  onDuplicateSelected?: () => void;
  onCopySelected?: () => void;
  onPaste?: () => void;
  onUpdateCenterOffset?: (offset: { x: number; y: number }) => void;
  isMovingCenter?: boolean;
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
}

// Helper function to calculate snapping for both items and curves
function calculateSnapping({
  x,
  y,
  snapSettings,
  effectiveCenter,
  bgCenter,
  isCtrl,
  isShift,
}: {
  x: number;
  y: number;
  snapSettings?: SnapSettings;
  effectiveCenter: { x: number; y: number };
  bgCenter: { x: number; y: number };
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

    // 2. Snap to Center Marker / Image Center (when not forced grid snap and not holding Shift)
    if (snapToCenter && !isCtrl && !isShift) {
      const threshold = 15;
      // Snap to Center Marker
      if (!snappedX) {
        if (Math.abs(newX - originX) < threshold) {
          newX = originX;
          snappedX = true;
        } else if (Math.abs(newX - bgCenter.x) < threshold) {
          newX = bgCenter.x;
          snappedX = true;
        }
      }

      if (!snappedY) {
        if (Math.abs(newY - originY) < threshold) {
          newY = originY;
          snappedY = true;
        } else if (Math.abs(newY - bgCenter.y) < threshold) {
          newY = bgCenter.y;
          snappedY = true;
        }
      }
    }
  }

  return { x: newX, y: newY, snappedX, snappedY };
}

// A single placed icon item on canvas (either template SVG or extracted image)
const CanvasItem: React.FC<{
  item: PlacedItem;
  iconUrl: string;
  isSelected?: boolean;
  activeItemIds?: string[];
  snapSettings?: SnapSettings;
  bgCenter: { x: number; y: number };
  effectiveCenter: { x: number; y: number };
  onSelect: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onChange: (newAttrs: Partial<PlacedItem>) => void;
  onUpdateItems?: (updates: { id: string; attrs: Partial<PlacedItem> }[]) => void;
  onSnapGuideChange?: (guideX: number | null, guideY: number | null) => void;
}> = ({ item, iconUrl, isSelected, activeItemIds, snapSettings, bgCenter, effectiveCenter, onSelect, onChange, onUpdateItems, onSnapGuideChange }) => {
  const [image] = useImage(iconUrl, 'anonymous');
  const groupRef = useRef<Konva.Group>(null);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const multiDragStartRef = useRef<Map<string, { x: number; y: number }>>(new Map());

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
      draggable
      onClick={(e) => { e.cancelBubble = true; onSelect(e); }}
      onTap={(e) => { e.cancelBubble = true; onSelect(e); }}
      onDragStart={(e) => {
        dragStartPosRef.current = { x: e.target.x(), y: e.target.y() };
        if (isSelected && activeItemIds && activeItemIds.length > 1) {
          multiDragStartRef.current.clear();
          const stage = e.target.getStage();
          if (stage) {
            activeItemIds.forEach(id => {
              const node = stage.findOne(`#${id}`);
              if (node) {
                multiDragStartRef.current.set(id, { x: node.x(), y: node.y() });
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

        // If part of multi-selection, translate other selected items
        if (isSelected && activeItemIds && activeItemIds.length > 1 && dragStartPosRef.current) {
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
          }
        }
      }}
      onDragEnd={(e) => {
        onSnapGuideChange?.(null, null);
        if (isSelected && activeItemIds && activeItemIds.length > 1 && dragStartPosRef.current && onUpdateItems) {
          const dx = e.target.x() - dragStartPosRef.current.x;
          const dy = e.target.y() - dragStartPosRef.current.y;
          const updates: { id: string; attrs: Partial<PlacedItem> }[] = [];
          multiDragStartRef.current.forEach((startPos, id) => {
            updates.push({ id, attrs: { x: startPos.x + dx, y: startPos.y + dy } });
          });
          onUpdateItems(updates);
          multiDragStartRef.current.clear();
        } else {
          onChange({ x: e.target.x(), y: e.target.y() });
        }
        dragStartPosRef.current = null;
      }}
      onTransformEnd={() => {
        const node = groupRef.current;
        if (!node) return;
        onChange({ x: node.x(), y: node.y(), rotation: node.rotation(), scaleX: node.scaleX(), scaleY: node.scaleY() });
      }}
    >
      {/* Invisible hit area: ensures the Group is always detectable for drag/click
          even though KonvaImage has listening={false} */}
      <Rect
        width={effectiveWidth}
        height={effectiveHeight}
        fill="transparent"
      />

      {/* Visual selection outline & highlight on every selected item */}
      {isSelected && (
        <>
          <Rect
            x={-3}
            y={-3}
            width={effectiveWidth + 6}
            height={effectiveHeight + 6}
            fill={activeItemIds && activeItemIds.length > 1 ? 'rgba(37, 99, 235, 0.18)' : 'rgba(37, 99, 235, 0.08)'}
            stroke="#2563eb"
            strokeWidth={1.8}
            cornerRadius={4}
            dash={activeItemIds && activeItemIds.length > 1 ? [5, 3] : undefined}
            listening={false}
          />
          {activeItemIds && activeItemIds.length > 1 && (
            <>
              {/* Corner mini handles */}
              <Rect
                x={-5}
                y={-5}
                width={5}
                height={5}
                fill="#ffffff"
                stroke="#2563eb"
                strokeWidth={1.2}
                cornerRadius={1}
                listening={false}
              />
              <Rect
                x={effectiveWidth}
                y={-5}
                width={5}
                height={5}
                fill="#ffffff"
                stroke="#2563eb"
                strokeWidth={1.2}
                cornerRadius={1}
                listening={false}
              />
              <Rect
                x={-5}
                y={effectiveHeight}
                width={5}
                height={5}
                fill="#ffffff"
                stroke="#2563eb"
                strokeWidth={1.2}
                cornerRadius={1}
                listening={false}
              />
              <Rect
                x={effectiveWidth}
                y={effectiveHeight}
                width={5}
                height={5}
                fill="#ffffff"
                stroke="#2563eb"
                strokeWidth={1.2}
                cornerRadius={1}
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
            </>
          )}
        </>
      )}

      <KonvaImage
        image={image}
        width={effectiveWidth}
        height={effectiveHeight}
        listening={false}
      />
      {showText && percInfo && (() => {
        const text = percInfo.canvasName;
        const maxFontByW = (effectiveWidth * 0.95) / Math.max(text.length * 0.62, 1);
        const maxFontByH = effectiveHeight * 0.42;
        const fontSize = Math.max(8, Math.min(maxFontByW, maxFontByH, 20));
        return (
          <Text
            text={text}
            x={0}
            y={0}
            width={effectiveWidth}
            height={effectiveHeight}
            fontSize={fontSize}
            fontFamily="Arial, sans-serif"
            fontStyle="bold"
            align="center"
            verticalAlign="middle"
            wrap="none"
            fill={item.color || '#000000'}
            listening={false}
          />
        );
      })()}
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
  onSelect?: () => void;
}> = ({ item, x, y, rotation, size, color, isSelected, extractedIcons, onSelect }) => {
  const tmpl = TEMPLATE_SHAPES.find(t => t.type === item.type || t.id === item.type || t.id === `tmpl_${item.type}`);
  const isPerc = item.type === 'percussion' || Boolean(item.percussionType) || (tmpl && tmpl.type === 'percussion');
  const percInfo = isPerc ? getPercussionInfo(item.percussionType) : null;

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
      return getPercussionDataUrl(item.percussionType || 'ティンパニ', item.color || color);
    }
    if (tmpl) return getTemplateDataUrl(tmpl, item.color || color, item.customIconStyle, item.chairType);
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

  if (img) {
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

        <KonvaImage
          image={img}
          x={-halfW}
          y={-halfH}
          width={itemW}
          height={itemH}
          listening={false}
        />
        {showText && percInfo && (() => {
          const text = percInfo.canvasName;
          const maxFontByW = (itemW * 0.95) / Math.max(text.length * 0.62, 1);
          const maxFontByH = itemH * 0.42;
          const fontSize = Math.max(8, Math.min(maxFontByW, maxFontByH, 20));
          return (
            <Text
              text={text}
              x={-halfW}
              y={-halfH}
              width={itemW}
              height={itemH}
              fontSize={fontSize}
              fontFamily="Arial, sans-serif"
              fontStyle="bold"
              align="center"
              verticalAlign="middle"
              wrap="none"
              fill={item.color || color || '#000000'}
              listening={false}
            />
          );
        })()}
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

// A bezier curve with items placed along it
const CurveCanvas: React.FC<{
  curve: CurveObject;
  isSelected: boolean;
  selectedCurveItemId?: string | null;
  onSelect: () => void;
  onSelectCurveItem?: (curveId: string, itemId: string) => void;
  onUpdatePoints: (points: [number, number, number, number, number, number]) => void;
  onUpdateCurvePos: (x: number, y: number) => void;
  scale: number;
  snapSettings?: SnapSettings;
  bgCenter: { x: number; y: number };
  effectiveCenter: { x: number; y: number };
  onSnapGuideChange?: (guideX: number | null, guideY: number | null) => void;
  extractedIcons?: ExtractedIcon[];
}> = ({
  curve,
  isSelected,
  selectedCurveItemId,
  onSelect,
  onSelectCurveItem,
  onUpdatePoints,
  onUpdateCurvePos,
  scale,
  snapSettings,
  bgCenter,
  effectiveCenter,
  onSnapGuideChange,
  extractedIcons,
}) => {
  const pts = curve.points;
  const pathData = getBezierPathData(pts);
  const handleRadius = 8 / scale;

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
    const tmpl = TEMPLATE_SHAPES.find(t => t.type === curve.itemType);
    return tmpl ? getTemplateDataUrl(tmpl, curve.color, curve.customIconStyle, curve.chairType) : '';
  };
  const [fallbackImg] = useImage(getFallbackUrl(), 'anonymous');
  const [isSnappedToMid, setIsSnappedToMid] = useState(false);

  const isEmptyCurve = hasItemsArray ? curveItems.length === 0 : curve.itemCount === 0;

  return (
    <Group
      id={curve.id}
      x={curve.x}
      y={curve.y}
      draggable
      onClick={(e) => { e.cancelBubble = true; onSelect(); }}
      onTap={(e) => { e.cancelBubble = true; onSelect(); }}
      onDragMove={(e) => {
        if (e.target !== e.currentTarget) return;
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
      }}
      onDragEnd={(e) => {
        if (e.target !== e.currentTarget) return;
        onSnapGuideChange?.(null, null);
        onUpdateCurvePos(e.target.x(), e.target.y());
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
          onClick={(e) => { e.cancelBubble = true; onSelect(); }}
          onTap={(e) => { e.cancelBubble = true; onSelect(); }}
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
        <>
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

          {/* Start handle (left point) — dragging mirrors the right point */}
          <Circle
            key="curve-handle-start"
            x={pts[0]}
            y={pts[1]}
            radius={handleRadius}
            fill="#2563eb"
            stroke="#ffffff"
            strokeWidth={2 / scale}
            draggable
            onDragStart={(e) => {
              e.cancelBubble = true;
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

              // 常に左右対称（X座標は反転、Y座標は同一）
              const newPts: [number, number, number, number, number, number] = [
                nx,
                ny,
                pts[2],
                pts[3],
                -nx,
                ny,
              ];
              onUpdatePoints(newPts);
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              let nx = e.target.x();
              let ny = e.target.y();
              if (nx > -10) nx = -10;
              e.target.position({ x: nx, y: ny });

              const newPts: [number, number, number, number, number, number] = [
                nx,
                ny,
                pts[2],
                pts[3],
                -nx,
                ny,
              ];
              onUpdatePoints(newPts);
            }}
          />

          {/* End handle (right point) — dragging mirrors the left point */}
          <Circle
            key="curve-handle-end"
            x={pts[4]}
            y={pts[5]}
            radius={handleRadius}
            fill="#2563eb"
            stroke="#ffffff"
            strokeWidth={2 / scale}
            draggable
            onDragStart={(e) => {
              e.cancelBubble = true;
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

              // 常に左右対称（X座標は反転、Y座標は同一）
              const newPts: [number, number, number, number, number, number] = [
                -nx,
                ny,
                pts[2],
                pts[3],
                nx,
                ny,
              ];
              onUpdatePoints(newPts);
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              let nx = e.target.x();
              let ny = e.target.y();
              if (nx < 10) nx = 10;
              e.target.position({ x: nx, y: ny });

              const newPts: [number, number, number, number, number, number] = [
                -nx,
                ny,
                pts[2],
                pts[3],
                nx,
                ny,
              ];
              onUpdatePoints(newPts);
            }}
          />

          {/* Control point handle (center red point with midpoint and line snap) */}
          <Circle
            key="curve-handle-ctrl"
            x={pts[2]}
            y={pts[3]}
            radius={handleRadius}
            fill={isSnappedToMid ? '#10b981' : '#ef4444'}
            stroke="#ffffff"
            strokeWidth={2.5 / scale}
            shadowColor="#000000"
            shadowBlur={isSnappedToMid ? 8 : 2}
            shadowOpacity={0.4}
            draggable
            onDragStart={(e) => {
              e.cancelBubble = true;
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
              onUpdatePoints(newPts);
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
              onUpdatePoints(newPts);
            }}
          />
        </>
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
    onAddItem,
    onDeleteItem,
    onDeleteSelected,
    onDuplicateItem,
    onDuplicateSelected,
    onCopySelected,
    onPaste,
    onUpdateCenterOffset,
    isMovingCenter = false,
    onOpenContextMenu,
    isMeasuringScale = false,
    onMeasureComplete,
    onCancelMeasure,
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
  const prevDimensionsRef = useRef(stageDimensions);
  const zoomAnchorRef = useRef<{ x: number; y: number } | null>(null);

  // Compute stage size to fit container
  useEffect(() => {
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

  // Keep zoom anchor stable so background doesn't jump
  useLayoutEffect(() => {
    const prev = prevDimensionsRef.current;
    prevDimensionsRef.current = stageDimensions;

    if (!containerRef.current) return;
    if (prev.scale === stageDimensions.scale || prev.scale === 0) return;

    const container = containerRef.current;
    const ratio = stageDimensions.scale / prev.scale;

    const anchor = zoomAnchorRef.current || {
      x: container.clientWidth / 2,
      y: container.clientHeight / 2,
    };
    zoomAnchorRef.current = null;

    container.scrollLeft = (container.scrollLeft + anchor.x) * ratio - anchor.x;
    container.scrollTop = (container.scrollTop + anchor.y) * ratio - anchor.y;
  }, [stageDimensions]);

  // Container wheel zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();

        const rect = container.getBoundingClientRect();
        zoomAnchorRef.current = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
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

  // Attach Transformer to selected placed items
  useEffect(() => {
    if (!trRef.current || !stageRef.current) return;
    if (activeItemIds.length > 0 && activeCurveIds.length === 0) {
      const nodes: Konva.Node[] = [];
      activeItemIds.forEach(id => {
        const node = stageRef.current?.findOne(`#${id}`);
        if (node) nodes.push(node);
      });
      trRef.current.nodes(nodes);
      trRef.current.getLayer()?.batchDraw();
      return;
    }
    trRef.current.nodes([]);
    trRef.current.getLayer()?.batchDraw();
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
      if (hasSelection && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
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
            if (!cur) return;
            let { x, y } = cur;
            if (e.key === 'ArrowUp') y -= step;
            if (e.key === 'ArrowDown') y += step;
            if (e.key === 'ArrowLeft') x -= step;
            if (e.key === 'ArrowRight') x += step;
            updates.push({ id, attrs: { x, y } });
          });
          if (onUpdateItems && updates.length > 0) {
            onUpdateItems(updates);
          } else if (updates[0]) {
            onUpdateItem(updates[0].id, updates[0].attrs);
          }
        }
        if (hasCurveSelection) {
          activeCurveIds.forEach(id => {
            const cur = curveObjects.find(c => c.id === id);
            if (!cur) return;
            let { x, y } = cur;
            if (e.key === 'ArrowUp') y -= step;
            if (e.key === 'ArrowDown') y += step;
            if (e.key === 'ArrowLeft') x -= step;
            if (e.key === 'ArrowRight') x += step;
            onUpdateCurve(id, { x, y });
          });
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

  // Register contextmenu via native DOM event on the Konva stage container
  // (not via React synthetic events, to avoid interfering with Konva's click handling)
  useEffect(() => {
    if (!stageRef.current) return;
    const stageContainer = stageRef.current.container();

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (!onOpenContextMenu) return;
      const stageBox = stageContainer.getBoundingClientRect();

      // Only process if the click is within the actual canvas bounds
      const relX = e.clientX - stageBox.left;
      const relY = e.clientY - stageBox.top;
      if (relX < 0 || relY < 0 || relX > stageBox.width || relY > stageBox.height) return;

      const canvasX = relX / stageDimensions.scale;
      const canvasY = relY / stageDimensions.scale;

      // Use the currently selected item as the target
      const targetItemId = activeItemIds.length === 1 ? activeItemIds[0] : null;

      onOpenContextMenu({
        x: e.clientX,
        y: e.clientY,
        canvasX,
        canvasY,
        targetItemId,
      });
    };

    stageContainer.addEventListener('contextmenu', handleContextMenu);
    return () => {
      stageContainer.removeEventListener('contextmenu', handleContextMenu);
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
  }));

  const getItemUrl = (item: PlacedItem): string => {
    // Template item
    if (item.templateType) {
      if (item.templateType === 'percussion') {
        const pType = item.percussionType || 'ティンパニ';
        return getPercussionDataUrl(pType, item.color);
      }
      const tmpl = TEMPLATE_SHAPES.find(t => t.type === item.templateType);
      if (tmpl) return getTemplateDataUrl(tmpl, item.color, item.customIconStyle, item.chairType);
    }
    // Extracted PDF icon
    const iconDef = extractedIcons.find(ic => ic.id === item.iconId);
    return iconDef?.url || '';
  };

  const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
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

  const handleStageMouseMove = () => {
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
      const xs = [curve.x + pts[0], curve.x + pts[2], curve.x + pts[4]];
      const ys = [curve.y + pts[1], curve.y + pts[3], curve.y + pts[5]];
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
    <div
      ref={containerRef}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      className={`flex-1 w-full h-full flex bg-slate-200/80 dark:bg-slate-950 overflow-auto relative select-none p-4 transition-colors ${
        isMeasuringScale ? 'cursor-crosshair' : ''
      }`}
    >
      {isMeasuringScale && (
        <div key="measuring-banner" className="absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-indigo-600 text-white text-xs font-bold px-4 py-2 rounded-full shadow-xl flex items-center gap-2.5 border border-indigo-400 animate-in fade-in slide-in-from-top-2 duration-150">
          <span className="text-sm">📏</span>
          <span>
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
            className="ml-2 bg-white/20 hover:bg-white/30 text-white px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors"
          >
            ✕ キャンセル
          </button>
        </div>
      )}
      {isMovingCenter && !isMeasuringScale && (
        <div key="moving-center-banner" className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-slate-900/90 backdrop-blur-sm text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg flex items-center gap-2.5 border border-slate-700 pointer-events-none">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff00ff] animate-pulse shrink-0" />
          <span>基準点移動モード：ピンクのマーカーをドラッグして位置を移動できます</span>
        </div>
      )}

      {/* Floating Multi-Selection Action Pill */}
      {(activeItemIds.length + activeCurveIds.length) > 1 && (
        <div key="multi-select-action-pill" className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 bg-slate-900/90 text-white backdrop-blur-md px-4 py-2 rounded-full shadow-2xl flex items-center gap-3 border border-slate-700/80 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center gap-1.5 text-xs font-bold text-blue-300">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span>{activeItemIds.length + activeCurveIds.length} 個選択中</span>
          </div>
          <div className="h-3.5 w-px bg-slate-700" />
          {onDuplicateSelected && (
            <button
              type="button"
              onClick={onDuplicateSelected}
              className="text-xs font-medium text-slate-200 hover:text-white flex items-center gap-1 hover:bg-slate-800 px-2 py-1 rounded-md transition-colors cursor-pointer"
              title="選択したアイテムを複製 (Ctrl+D)"
            >
              <span>📑</span>
              <span>複製</span>
            </button>
          )}
          {onDeleteSelected && (
            <button
              type="button"
              onClick={onDeleteSelected}
              className="text-xs font-medium text-rose-300 hover:text-rose-200 flex items-center gap-1 hover:bg-rose-950/60 px-2 py-1 rounded-md transition-colors cursor-pointer"
              title="選択したアイテムを一括削除 (Delete)"
            >
              <span>🗑️</span>
              <span>削除</span>
            </button>
          )}
          <div className="h-3.5 w-px bg-slate-700" />
          <button
            type="button"
            onClick={() => {
              if (onSelectItems) onSelectItems([]);
              else onSelectItem(null);
              if (onSelectCurves) onSelectCurves([]);
              else onSelectCurve(null);
            }}
            className="text-xs text-slate-400 hover:text-white px-1.5 py-0.5 rounded transition-colors cursor-pointer"
            title="選択を解除"
          >
            ✕
          </button>
        </div>
      )}
      <div
        key="stage-konva-wrapper"
        className="bg-white dark:bg-slate-900 shadow-xl ring-1 ring-slate-900/10 dark:ring-white/10 rounded-sm relative m-auto transition-colors"
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
                    {/* Horizontal Center Axis */}
                    <Line
                      points={isMovingCenter ? [-5000, 0, 5000, 0] : [-20 / stageDimensions.scale, 0, 20 / stageDimensions.scale, 0]}
                      stroke="#ff00ff"
                      strokeWidth={1.5 / stageDimensions.scale}
                      dash={[6 / stageDimensions.scale, 6 / stageDimensions.scale]}
                      opacity={0.65}
                      listening={false}
                    />
                    {/* Vertical Center Axis */}
                    <Line
                      points={isMovingCenter ? [0, -5000, 0, 5000] : [0, -20 / stageDimensions.scale, 0, 20 / stageDimensions.scale]}
                      stroke="#ff00ff"
                      strokeWidth={1.5 / stageDimensions.scale}
                      dash={[6 / stageDimensions.scale, 6 / stageDimensions.scale]}
                      opacity={0.65}
                      listening={false}
                    />
                    {/* Grab handle shown only when in moving mode */}
                    {isMovingCenter && (
                      <>
                        <Circle
                          radius={16 / stageDimensions.scale}
                          stroke="#ff00ff"
                          strokeWidth={2 / stageDimensions.scale}
                          dash={[4 / stageDimensions.scale, 4 / stageDimensions.scale]}
                          fill="rgba(255, 0, 255, 0.15)"
                          listening={false}
                        />
                        <Circle
                          radius={20 / stageDimensions.scale}
                          fill="transparent"
                          hitStrokeWidth={40 / stageDimensions.scale}
                        />
                      </>
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
                  selectedCurveItemId={selectedCurveItemId}
                  onSelectCurveItem={onSelectCurveItem}
                  onSelect={() => {
                    onSelectCurve(curve.id);
                    onSelectItem(null);
                  }}
                  onUpdatePoints={(points) => onUpdateCurve(curve.id, { points })}
                  onUpdateCurvePos={(x, y) => onUpdateCurve(curve.id, { x, y })}
                  scale={stageDimensions.scale}
                  snapSettings={snapSettings}
                  bgCenter={{ x: bgCenterX, y: bgCenterY }}
                  effectiveCenter={effCenter}
                  onSnapGuideChange={(gx, gy) => {
                    setActiveGuideX(gx);
                    setActiveGuideY(gy);
                  }}
                  extractedIcons={extractedIcons}
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
                  snapSettings={snapSettings}
                  bgCenter={{ x: bgCenterX, y: bgCenterY }}
                  effectiveCenter={effCenter}
                  onSelect={(e) => {
                    if (e.evt.shiftKey) {
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
                  onSnapGuideChange={(gx, gy) => {
                    setActiveGuideX(gx);
                    setActiveGuideY(gy);
                  }}
                />
              );
            })}
          </Layer>

          {/* Transformer & Selection Rectangle Layer */}
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
              enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
              borderStroke="#2563eb"
              borderStrokeWidth={1.5}
              anchorStroke="#2563eb"
              anchorFill="#ffffff"
              anchorSize={8}
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
                }
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
  );
});

StageCanvas.displayName = 'StageCanvas';
export default StageCanvas;
