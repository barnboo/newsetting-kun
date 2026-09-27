import React, { useState, useEffect, useRef } from 'react';
import type { ExtractedIcon } from '../App';
import { Stage, Layer, Image as KonvaImage, Rect, Transformer, Group, Circle, Line, Label, Tag, Text } from 'react-konva';
import useImage from 'use-image';
import Konva from 'konva';
import { urlToDataUrl } from '../utils/indexedDb';

interface Props {
  iconsRegionUrl: string;
  extractedIcons: ExtractedIcon[];
  fileId: string;
  iconLabels?: Record<string, string>;
  onClose: () => void;
  onSave: (newIcons: ExtractedIcon[], newLabels?: Record<string, string>) => void;
}

const IconAdjustModal: React.FC<Props> = ({ iconsRegionUrl, extractedIcons, fileId, iconLabels, onClose, onSave }) => {
  const [image] = useImage(iconsRegionUrl);
  const [rects, setRects] = useState<ExtractedIcon[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [newRect, setNewRect] = useState<{ startX: number; startY: number; curX: number; curY: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Zoom state (matching StageBuilder)
  const [zoomMultiplier, setZoomMultiplier] = useState(1.0);
  const handleZoomIn = () => setZoomMultiplier(prev => Math.min(Number((prev + 0.15).toFixed(2)), 3.0));
  const handleZoomOut = () => setZoomMultiplier(prev => Math.max(Number((prev - 0.15).toFixed(2)), 0.4));
  const handleZoomReset = () => setZoomMultiplier(1.0);

  // Undo / Redo history state
  const historyRef = useRef<ExtractedIcon[][]>([]);
  const redoStackRef = useRef<ExtractedIcon[][]>([]);
  const isRestoringRef = useRef(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Deep copy to avoid mutating props directly
    const initialLabels: Record<string, string> = { ...(iconLabels || {}) };
    const initialRects: ExtractedIcon[] = JSON.parse(JSON.stringify(extractedIcons));
    initialRects.forEach((ic, idx) => {
      if (!initialLabels[ic.id]) {
        initialLabels[ic.id] = ic.label || `パーツ ${idx + 1}`;
      }
      ic.label = initialLabels[ic.id];
    });
    setLabels(initialLabels);
    setRects(initialRects);
    historyRef.current = [];
    redoStackRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
  }, [extractedIcons, iconLabels]);

  useEffect(() => {
    if (selectedId && trRef.current && stageRef.current) {
      const node = stageRef.current.findOne(`#${selectedId}`);
      if (node) {
        trRef.current.nodes([node]);
        trRef.current.getLayer()?.batchDraw();
      }
    } else if (trRef.current) {
      trRef.current.nodes([]);
    }
  }, [selectedId]);

  // Determine stage dimensions based on window size and image aspect ratio
  // Deduct 288px for the right-hand parts list panel
  let baseStageWidth = Math.max(400, window.innerWidth * 0.85 - 288);
  let baseStageHeight = window.innerHeight * 0.72;
  let baseScale = 1;

  if (image) {
    const scaleX = baseStageWidth / image.width;
    const scaleY = baseStageHeight / image.height;
    baseScale = Math.min(scaleX, scaleY, 1); // Don't scale up, only down
  }

  const effectiveScale = baseScale * zoomMultiplier;
  const stageWidth = image ? image.width * effectiveScale : baseStageWidth;
  const stageHeight = image ? image.height * effectiveScale : baseStageHeight;

  // History push helper
  const pushHistory = (newRects: ExtractedIcon[]) => {
    if (isRestoringRef.current) return;
    historyRef.current = [...historyRef.current.slice(-50), JSON.parse(JSON.stringify(rects))];
    redoStackRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
    setRects(newRects);
  };

  const handleUndo = () => {
    if (historyRef.current.length === 0) return;
    isRestoringRef.current = true;
    redoStackRef.current = [JSON.parse(JSON.stringify(rects)), ...redoStackRef.current];
    const prev = historyRef.current[historyRef.current.length - 1];
    historyRef.current = historyRef.current.slice(0, -1);
    setRects(prev);
    // sync labels from prev
    const updatedLabels: Record<string, string> = { ...labels };
    prev.forEach(r => {
      if (r.label) updatedLabels[r.id] = r.label;
    });
    setLabels(updatedLabels);
    if (selectedId && !prev.some(r => r.id === selectedId)) {
      setSelectedId(null);
    }
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(true);
    requestAnimationFrame(() => { isRestoringRef.current = false; });
  };

  const handleRedo = () => {
    if (redoStackRef.current.length === 0) return;
    isRestoringRef.current = true;
    historyRef.current = [...historyRef.current, JSON.parse(JSON.stringify(rects))];
    const next = redoStackRef.current[0];
    redoStackRef.current = redoStackRef.current.slice(1);
    setRects(next);
    // sync labels from next
    const updatedLabels: Record<string, string> = { ...labels };
    next.forEach(r => {
      if (r.label) updatedLabels[r.id] = r.label;
    });
    setLabels(updatedLabels);
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
    requestAnimationFrame(() => { isRestoringRef.current = false; });
  };

  const handleRename = (id: string, newName: string) => {
    setLabels(prev => ({ ...prev, [id]: newName }));
    setRects(prev => prev.map(r => r.id === id ? { ...r, label: newName } : r));
  };

  // Middle-click and Space+drag canvas panning
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    let isPanning = false;
    let startX = 0;
    let startY = 0;
    let startScrollLeft = 0;
    let startScrollTop = 0;
    let isSpaceDown = false;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        return;
      }
      if (e.code === 'Space') {
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

  // Mouse wheel zoom (Ctrl/Cmd + wheel)
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoomMultiplier(prev => {
          const newZoom = e.deltaY < 0 ? prev + 0.15 : prev - 0.15;
          return Math.min(Math.max(Number(newZoom.toFixed(2)), 0.4), 3.0);
        });
      }
    };
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, []);

  // Keyboard shortcuts: Undo/Redo (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z), Zoom (+, -, 0), Delete
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        return;
      }

      const isCmdOrCtrl = e.ctrlKey || e.metaKey;

      if (isCmdOrCtrl) {
        // Undo: Ctrl/Cmd + Z
        if ((e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
          return;
        }
        // Redo: Ctrl/Cmd + Shift + Z  OR  Ctrl/Cmd + Y
        if (((e.key === 'z' || e.key === 'Z') && e.shiftKey) || e.key === 'y' || e.key === 'Y') {
          e.preventDefault();
          handleRedo();
          return;
        }
        // Zoom In: Ctrl/Cmd + +
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          handleZoomIn();
          return;
        }
        // Zoom Out: Ctrl/Cmd + -
        if (e.key === '-') {
          e.preventDefault();
          handleZoomOut();
          return;
        }
        // Zoom Reset: Ctrl/Cmd + 0
        if (e.key === '0') {
          e.preventDefault();
          handleZoomReset();
          return;
        }
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId) {
          e.preventDefault();
          handleDelete(selectedId);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedId, rects, canUndo, canRedo]);

  const handleMouseDown = (e: any) => {
    // Middle click is handled by container panning
    if (e.evt && (e.evt.button === 1 || e.evt.buttons === 4)) return;

    // If clicked on an empty area, start drawing
    const clickedOnEmpty = e.target === e.target.getStage() || e.target.name() === 'backgroundImage';
    
    if (clickedOnEmpty) {
      setSelectedId(null);
      const stage = e.target.getStage();
      const pos = stage?.getPointerPosition();
      if (!pos) return;
      setIsDrawing(true);
      const imgX = pos.x / effectiveScale;
      const imgY = pos.y / effectiveScale;
      setNewRect({ startX: imgX, startY: imgY, curX: imgX, curY: imgY });
    } else {
      // Clicked on a rect or its transformer
      const id = e.target.id() || e.target.parent?.id();
      if (id) setSelectedId(id);
    }
  };

  const handleMouseMove = (e: any) => {
    if (!isDrawing || !newRect) return;
    const stage = e.target.getStage();
    const pos = stage?.getPointerPosition();
    if (!pos) return;
    const imgX = pos.x / effectiveScale;
    const imgY = pos.y / effectiveScale;
    
    setNewRect(prev => prev ? {
      ...prev,
      curX: imgX,
      curY: imgY,
    } : null);
  };

  const handleMouseUp = (e?: any) => {
    if (e?.evt && (e.evt.button === 1 || e.evt.buttons === 4)) return;
    if (isDrawing && newRect) {
      const x = Math.round(Math.min(newRect.startX, newRect.curX));
      const y = Math.round(Math.min(newRect.startY, newRect.curY));
      const width = Math.round(Math.abs(newRect.curX - newRect.startX));
      const height = Math.round(Math.abs(newRect.curY - newRect.startY));

      if (width > 5 && height > 5) {
        const id = `icon_manual_${Date.now()}`;
        // Find next part number based on existing "パーツ N" labels so numbers never collide
        const existingNums = rects.map(r => {
          const lbl = labels[r.id] || r.label || '';
          const match = lbl.match(/パーツ\s*(\d+)/);
          return match ? parseInt(match[1], 10) : 0;
        });
        const nextNum = (existingNums.length > 0 ? Math.max(...existingNums, 0) : 0) + 1;
        const defaultName = `パーツ ${nextNum}`;

        setLabels(prev => ({ ...prev, [id]: defaultName }));
        pushHistory([...rects, { id, url: '', label: defaultName, rect: { x, y, width, height } }]);
        setSelectedId(id);

        // Auto focus input to let user immediately rename the new part if desired
        requestAnimationFrame(() => {
          nameInputRef.current?.focus();
          nameInputRef.current?.select();
        });
      }
    }
    setIsDrawing(false);
    setNewRect(null);
  };

  const handleDragEnd = (e: any) => {
    const id = e.target.id();
    const newX = Math.round(e.target.x());
    const newY = Math.round(e.target.y());
    const target = rects.find(r => r.id === id);
    if (target && (target.rect.x !== newX || target.rect.y !== newY)) {
      pushHistory(rects.map(r => r.id === id ? {
        ...r,
        rect: { ...r.rect, x: newX, y: newY }
      } : r));
    }
  };

  const handleTransformEnd = (e: any) => {
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);

    const id = node.id();
    const target = rects.find((r) => r.id === id);
    if (!target) return;

    // Use current rect dimensions from state (node.width() is 0 on Konva Group)
    const prevWidth = target.rect.width;
    const prevHeight = target.rect.height;

    const newWidth = Math.max(10, Math.round(prevWidth * Math.abs(scaleX)));
    const newHeight = Math.max(10, Math.round(prevHeight * Math.abs(scaleY)));

    let newX = Math.round(node.x());
    let newY = Math.round(node.y());

    if (scaleX < 0) {
      newX -= newWidth;
    }
    if (scaleY < 0) {
      newY -= newHeight;
    }

    if (
      target.rect.x !== newX ||
      target.rect.y !== newY ||
      target.rect.width !== newWidth ||
      target.rect.height !== newHeight
    ) {
      pushHistory(rects.map(r => r.id === id ? {
        ...r,
        rect: {
          x: newX,
          y: newY,
          width: newWidth,
          height: newHeight,
        }
      } : r));
    }
  };

  const handleDelete = (id: string) => {
    pushHistory(rects.filter(r => r.id !== id));
    if (selectedId === id) setSelectedId(null);
    if (hoveredId === id) setHoveredId(null);
  };

  const saveAdjustments = async () => {
    setIsSaving(true);
    try {
      const validRects = rects
        .filter(r => r.rect.width > 2 && r.rect.height > 2)
        .map(r => ({
          id: r.id,
          x: Math.round(r.rect.x),
          y: Math.round(r.rect.y),
          width: Math.max(5, Math.round(r.rect.width)),
          height: Math.max(5, Math.round(r.rect.height)),
          label: labels[r.id] || r.label || ''
        }));

      const payload = {
        file_id: fileId,
        icons_region_url: iconsRegionUrl,
        rects: validRects
      };

      const res = await fetch('/api/crop-icons/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error('crop-icons failed:', res.status, errText);
        throw new Error(`Failed to save adjustments: ${res.status}`);
      }
      
      const data = await res.json();
      
      const updatedIcons = await Promise.all(
        data.extracted_icons.map(async (icon: any) => ({
          ...icon,
          label: labels[icon.id] || icon.label || '',
          url: await urlToDataUrl(icon.url)
        }))
      );
      
      onSave(updatedIcons, labels);
    } catch (err) {
      console.error(err);
      alert('保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-7xl flex flex-col h-[88vh]">
        
        <div className="p-3.5 px-5 border-b border-slate-200 flex flex-wrap justify-between items-center gap-3 shrink-0 bg-white">
          <div className="flex items-center gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <span>⚙️</span>
                <span>アイコンの抽出範囲を手動調整</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                枠をドラッグで移動・変形、余白ドラッグで新規作成。ミドルクリックまたは Space+ドラッグで画面移動。枠を選択して Delete / Backspace または [✕] で削除。
              </p>
            </div>

            {/* Undo / Redo & Zoom Controls */}
            <div className="flex items-center gap-1.5 ml-4 bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
              <button
                type="button"
                onClick={handleUndo}
                disabled={!canUndo}
                className={`p-1.5 rounded transition-colors ${
                  canUndo
                    ? 'text-slate-700 hover:bg-white hover:text-slate-900 cursor-pointer'
                    : 'text-slate-300 cursor-not-allowed'
                }`}
                title={`元に戻す (Ctrl+Z) ${historyRef.current.length > 0 ? `(${historyRef.current.length}件)` : ''}`}
              >
                ↩️
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={!canRedo}
                className={`p-1.5 rounded transition-colors ${
                  canRedo
                    ? 'text-slate-700 hover:bg-white hover:text-slate-900 cursor-pointer'
                    : 'text-slate-300 cursor-not-allowed'
                }`}
                title="やり直し (Ctrl+Y / Ctrl+Shift+Z)"
              >
                ↪️
              </button>
              <div className="h-4 w-px bg-slate-300 mx-0.5" />
              <button
                type="button"
                onClick={handleZoomOut}
                className="w-7 h-7 flex items-center justify-center hover:bg-white rounded text-slate-700 text-sm font-bold transition-colors cursor-pointer select-none"
                title="ズームアウト (Ctrl + -)"
              >
                ➖
              </button>
              <button
                type="button"
                onClick={handleZoomReset}
                className="px-2 py-0.5 text-xs font-mono font-bold text-slate-800 hover:bg-white rounded transition-colors cursor-pointer select-none min-w-[3.5rem] text-center"
                title="拡大率を100%にリセット"
              >
                {Math.round(zoomMultiplier * 100)}%
              </button>
              <button
                type="button"
                onClick={handleZoomIn}
                className="w-7 h-7 flex items-center justify-center hover:bg-white rounded text-slate-700 text-sm font-bold transition-colors cursor-pointer select-none"
                title="ズームイン (Ctrl + +)"
              >
                ➕
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer border border-slate-200"
              disabled={isSaving}
            >
              キャンセル
            </button>
            <button 
              onClick={saveAdjustments}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors shadow-xs cursor-pointer flex items-center gap-1.5"
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <span className="animate-spin text-xs">⏳</span>
                  <span>保存中...</span>
                </>
              ) : (
                <>
                  <span>✓ 確定して再切り抜き</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Main Canvas Area */}
          <div 
            ref={canvasContainerRef}
            className="flex-1 overflow-auto bg-slate-100 p-6 flex relative select-none"
          >
            {!image ? (
              <div className="m-auto text-slate-500 font-medium">画像を読み込み中...</div>
            ) : (
              <div className="relative shadow-lg border border-gray-300 bg-white m-auto shrink-0" style={{ width: stageWidth, height: stageHeight }}>
                <Stage 
                  ref={stageRef}
                  width={stageWidth} 
                  height={stageHeight}
                  scaleX={effectiveScale}
                  scaleY={effectiveScale}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                >
                  <Layer>
                    <KonvaImage 
                      image={image} 
                      name="backgroundImage" 
                    />
                    
                    {rects.map((r) => {
                      const isSelected = selectedId === r.id;
                      const isHovered = hoveredId === r.id;
                      // Hide delete button if the box is too small and overlaps heavily with it
                      const isTooSmall = (r.rect.width * effectiveScale < 28) || (r.rect.height * effectiveScale < 28);
                      const showDeleteBtn = (isSelected || isHovered) && !isTooSmall;
                      const name = labels[r.id] || r.label || 'パーツ';

                      return (
                        <Group 
                          key={r.id}
                          id={r.id}
                          x={r.rect.x}
                          y={r.rect.y}
                          width={r.rect.width}
                          height={r.rect.height}
                          draggable
                          onDragEnd={handleDragEnd}
                          onTransformEnd={handleTransformEnd}
                          onMouseEnter={() => setHoveredId(r.id)}
                          onMouseLeave={() => setHoveredId(null)}
                        >
                          {/* Bounding Box Rect */}
                          <Rect
                            width={r.rect.width}
                            height={r.rect.height}
                            stroke={isSelected ? "#3b82f6" : "#22c55e"}
                            strokeWidth={2 / effectiveScale}
                            fill={isSelected ? "rgba(59, 130, 246, 0.2)" : "rgba(34, 197, 94, 0.1)"}
                          />

                          {/* Part Name Label Badge (Visual identification) */}
                          <Label
                            x={0}
                            y={r.rect.y < 20 / effectiveScale ? 0 : -18 / effectiveScale}
                            listening={true}
                            onClick={(e) => {
                              e.cancelBubble = true;
                              setSelectedId(r.id);
                            }}
                            onTap={(e) => {
                              e.cancelBubble = true;
                              setSelectedId(r.id);
                            }}
                          >
                            <Tag
                              fill={isSelected ? "#2563eb" : isHovered ? "#334155" : "#1e293b"}
                              cornerRadius={3 / effectiveScale}
                              opacity={0.92}
                              shadowColor="black"
                              shadowBlur={2}
                              shadowOpacity={0.25}
                            />
                            <Text
                              text={name}
                              fontSize={10 / effectiveScale}
                              fontFamily="sans-serif"
                              fontStyle="bold"
                              padding={3 / effectiveScale}
                              fill="#ffffff"
                            />
                          </Label>

                          {/* Delete button (drawn directly in center of box; hidden when box is too small) */}
                          {showDeleteBtn && (
                            <Group
                              x={r.rect.width / 2}
                              y={r.rect.height / 2}
                              onClick={(e) => {
                                e.cancelBubble = true;
                                handleDelete(r.id);
                              }}
                              onTap={(e) => {
                                e.cancelBubble = true;
                                handleDelete(r.id);
                              }}
                              onMouseEnter={(e) => {
                                const container = e.target.getStage()?.container();
                                if (container) container.style.cursor = 'pointer';
                              }}
                              onMouseLeave={(e) => {
                                const container = e.target.getStage()?.container();
                                if (container) container.style.cursor = 'default';
                              }}
                            >
                              <Circle
                                radius={9 / effectiveScale}
                                fill="#ef4444"
                                stroke="#ffffff"
                                strokeWidth={1.5 / effectiveScale}
                                shadowColor="black"
                                shadowBlur={3}
                                shadowOpacity={0.3}
                              />
                              <Line
                                points={[-4 / effectiveScale, -4 / effectiveScale, 4 / effectiveScale, 4 / effectiveScale]}
                                stroke="#ffffff"
                                strokeWidth={1.8 / effectiveScale}
                                lineCap="round"
                              />
                              <Line
                                points={[4 / effectiveScale, -4 / effectiveScale, -4 / effectiveScale, 4 / effectiveScale]}
                                stroke="#ffffff"
                                strokeWidth={1.8 / effectiveScale}
                                lineCap="round"
                              />
                            </Group>
                          )}
                        </Group>
                      );
                    })}
                    
                    {isDrawing && newRect && (
                      <Rect
                        x={Math.min(newRect.startX, newRect.curX)}
                        y={Math.min(newRect.startY, newRect.curY)}
                        width={Math.abs(newRect.curX - newRect.startX)}
                        height={Math.abs(newRect.curY - newRect.startY)}
                        stroke="#3b82f6"
                        strokeWidth={2 / effectiveScale}
                        fill="rgba(59, 130, 246, 0.2)"
                      />
                    )}
                    
                    <Transformer 
                      ref={trRef} 
                      boundBoxFunc={(oldBox, newBox) => {
                        if (newBox.width < 10 || newBox.height < 10) return oldBox;
                        return newBox;
                      }}
                    />
                  </Layer>
                </Stage>
              </div>
            )}
          </div>

          {/* Right Sidebar: Parts List */}
          <div className="w-72 border-l border-slate-200 bg-white flex flex-col shrink-0">
            <div className="p-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">パーツ一覧 ({rects.length})</span>
              <span className="text-[10px] text-slate-400">クリックで選択</span>
            </div>

            {/* Selected Part Name Editor */}
            {selectedId && (() => {
              const selectedItem = rects.find(r => r.id === selectedId);
              if (!selectedItem) return null;
              const currentName = labels[selectedId] || selectedItem.label || '';
              return (
                <div className="p-3 bg-blue-50/90 border-b border-blue-200 space-y-1.5 shrink-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-blue-900 flex items-center gap-1">
                      <span>✏️</span>
                      <span>パーツ名の編集</span>
                    </span>
                    <span className="text-[10px] text-blue-600 font-mono">
                      {Math.round(selectedItem.rect.width)} × {Math.round(selectedItem.rect.height)} px
                    </span>
                  </div>
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={currentName}
                    onChange={(e) => handleRename(selectedId, e.target.value)}
                    placeholder="パーツ名を入力 (例: 指揮台, ホルン)"
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-blue-300 rounded-md focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-bold text-slate-800 shadow-2xs"
                  />
                  <p className="text-[10px] text-blue-700 leading-tight">
                    ※ ここで変更した名称が配置画面や集計表に反映されます
                  </p>
                </div>
              );
            })()}

            {/* Parts List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {rects.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">
                  枠がありません。<br />キャンバスをドラッグして追加できます。
                </p>
              ) : (
                rects.map((r) => {
                  const name = labels[r.id] || r.label || 'パーツ';
                  const isSelected = selectedId === r.id;
                  return (
                    <div
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      className={`flex items-center justify-between p-2 rounded-lg text-xs cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-50 border border-blue-300 text-blue-900 font-bold shadow-2xs'
                          : 'hover:bg-slate-50 border border-transparent text-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0 ${
                          isSelected ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'
                        }`}>
                          🏷️
                        </span>
                        <div className="flex flex-col truncate">
                          <span className="truncate">{name}</span>
                          <span className="text-[9px] text-slate-400 font-normal">
                            {Math.round(r.rect.width)} × {Math.round(r.rect.height)} px
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(r.id);
                        }}
                        className="text-slate-400 hover:text-red-500 hover:bg-red-50 rounded p-1 transition-colors ml-1 shrink-0"
                        title="この枠を削除"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IconAdjustModal;
