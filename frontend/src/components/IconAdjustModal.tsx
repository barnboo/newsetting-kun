import React, { useState, useEffect, useRef } from 'react';
import type { ExtractedIcon } from '../App';
import { Stage, Layer, Image as KonvaImage, Rect, Transformer, Group, Circle, Line, Label, Tag, Text } from 'react-konva';
import useImage from 'use-image';
import Konva from 'konva';

interface Props {
  iconsRegionUrl: string;
  extractedIcons: ExtractedIcon[];
  fileId: string;
  iconLabels?: Record<string, string>;
  onClose: () => void;
  onSave: (newIcons: ExtractedIcon[]) => void;
}

const IconAdjustModal: React.FC<Props> = ({ iconsRegionUrl, extractedIcons, fileId, iconLabels, onClose, onSave }) => {
  const [image] = useImage(iconsRegionUrl);
  const [rects, setRects] = useState<ExtractedIcon[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [newRect, setNewRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    // Deep copy to avoid mutating props directly
    setRects(JSON.parse(JSON.stringify(extractedIcons)));
  }, [extractedIcons]);

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

  // Handle Delete / Backspace key to remove selected box
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId) {
          e.preventDefault();
          setRects(prev => prev.filter(r => r.id !== selectedId));
          setSelectedId(null);
          setHoveredId(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedId]);

  const handleMouseDown = (e: any) => {
    // If clicked on an empty area, start drawing
    const clickedOnEmpty = e.target === e.target.getStage() || e.target.name() === 'backgroundImage';
    
    if (clickedOnEmpty) {
      setSelectedId(null);
      const pos = e.target.getStage().getPointerPosition();
      setIsDrawing(true);
      setNewRect({ x: pos.x, y: pos.y, width: 0, height: 0 });
    } else {
      // Clicked on a rect or its transformer
      const id = e.target.id() || e.target.parent?.id();
      if (id) setSelectedId(id);
    }
  };

  const handleMouseMove = (e: any) => {
    if (!isDrawing || !newRect) return;
    const stage = e.target.getStage();
    const point = stage.getPointerPosition();
    
    setNewRect({
      x: newRect.x,
      y: newRect.y,
      width: point.x - newRect.x,
      height: point.y - newRect.y,
    });
  };

  const handleMouseUp = () => {
    if (isDrawing && newRect) {
      if (Math.abs(newRect.width) > 5 && Math.abs(newRect.height) > 5) {
        // Normalize rect (handle negative width/height from dragging left/up)
        const scale = stageRef.current?.scaleX() || 1;
        const normalizedRect = {
          x: (newRect.width < 0 ? newRect.x + newRect.width : newRect.x) / scale,
          y: (newRect.height < 0 ? newRect.y + newRect.height : newRect.y) / scale,
          width: Math.abs(newRect.width) / scale,
          height: Math.abs(newRect.height) / scale,
        };
        
        const id = `icon_manual_${Date.now()}`;
        setRects([...rects, { id, url: '', rect: normalizedRect }]);
        setSelectedId(id);
      }
    }
    setIsDrawing(false);
    setNewRect(null);
  };

  const handleDragEnd = (e: any) => {
    const id = e.target.id();
    const newX = Math.round(e.target.x());
    const newY = Math.round(e.target.y());
    setRects(prev => prev.map(r => r.id === id ? {
      ...r,
      rect: { ...r.rect, x: newX, y: newY }
    } : r));
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

    setRects(prev => prev.map(r => r.id === id ? {
      ...r,
      rect: {
        x: newX,
        y: newY,
        width: newWidth,
        height: newHeight,
      }
    } : r));
  };

  const handleDelete = (id: string) => {
    setRects(prev => prev.filter(r => r.id !== id));
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
          label: iconLabels?.[r.id] || r.label || ''
        }));

      const payload = {
        file_id: fileId,
        icons_region_url: iconsRegionUrl,
        rects: validRects
      };

      const res = await fetch('http://127.0.0.1:8000/api/crop-icons/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error('Failed to save adjustments');
      
      const data = await res.json();
      
      const updatedIcons = data.extracted_icons.map((icon: any) => ({
        ...icon,
        url: `http://127.0.0.1:8000${icon.url}`
      }));
      
      onSave(updatedIcons);
    } catch (err) {
      console.error(err);
      alert('保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  // Determine stage dimensions based on window size and image aspect ratio
  // Deduct 280px for the right-hand parts list panel
  let stageWidth = Math.max(400, window.innerWidth * 0.85 - 280);
  let stageHeight = window.innerHeight * 0.72;
  let scale = 1;

  if (image) {
    const scaleX = stageWidth / image.width;
    const scaleY = stageHeight / image.height;
    scale = Math.min(scaleX, scaleY, 1); // Don't scale up, only down
    stageWidth = image.width * scale;
    stageHeight = image.height * scale;
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-7xl flex flex-col h-[88vh]">
        
        <div className="p-4 border-b flex justify-between items-center shrink-0">
          <div>
            <h3 className="text-lg font-bold text-gray-800">アイコンの抽出範囲を手動調整</h3>
            <p className="text-sm text-gray-500 mt-1">
              枠をドラッグで移動・変形、余白をドラッグで新規作成できます。枠を選択して Delete / Backspace キーまたは中央の [✕] で削除できます。
            </p>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded transition-colors"
              disabled={isSaving}
            >
              キャンセル
            </button>
            <button 
              onClick={saveAdjustments}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded transition-colors"
              disabled={isSaving}
            >
              {isSaving ? '保存中...' : '確定して再切り抜き'}
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Main Canvas Area */}
          <div className="flex-1 overflow-auto bg-slate-100 p-4 flex items-center justify-center relative">
            {!image ? (
              <p>画像を読み込み中...</p>
            ) : (
              <div className="relative shadow-lg border border-gray-300 bg-white" style={{ width: stageWidth, height: stageHeight }}>
                <Stage 
                  ref={stageRef}
                  width={stageWidth} 
                  height={stageHeight}
                  scaleX={scale}
                  scaleY={scale}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                >
                  <Layer>
                    <KonvaImage 
                      image={image} 
                      name="backgroundImage" 
                    />
                    
                    {rects.map((r, idx) => {
                      const isSelected = selectedId === r.id;
                      const isHovered = hoveredId === r.id;
                      // Hide delete button if the box is too small and overlaps heavily with it
                      const isTooSmall = (r.rect.width * scale < 28) || (r.rect.height * scale < 28);
                      const showDeleteBtn = (isSelected || isHovered) && !isTooSmall;
                      const name = iconLabels?.[r.id] ?? `パーツ ${idx + 1}`;

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
                            strokeWidth={2 / scale}
                            fill={isSelected ? "rgba(59, 130, 246, 0.2)" : "rgba(34, 197, 94, 0.1)"}
                          />

                          {/* Part Name Label Badge (Visual identification) */}
                          <Label
                            x={0}
                            y={r.rect.y < 20 ? 0 : -18 / scale}
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
                              cornerRadius={3 / scale}
                              opacity={0.92}
                              shadowColor="black"
                              shadowBlur={2}
                              shadowOpacity={0.25}
                            />
                            <Text
                              text={`${idx + 1}. ${name}`}
                              fontSize={10 / scale}
                              fontFamily="sans-serif"
                              fontStyle="bold"
                              padding={3 / scale}
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
                                radius={9 / scale}
                                fill="#ef4444"
                                stroke="#ffffff"
                                strokeWidth={1.5 / scale}
                                shadowColor="black"
                                shadowBlur={3}
                                shadowOpacity={0.3}
                              />
                              <Line
                                points={[-4 / scale, -4 / scale, 4 / scale, 4 / scale]}
                                stroke="#ffffff"
                                strokeWidth={1.8 / scale}
                                lineCap="round"
                              />
                              <Line
                                points={[4 / scale, -4 / scale, -4 / scale, 4 / scale]}
                                stroke="#ffffff"
                                strokeWidth={1.8 / scale}
                                lineCap="round"
                              />
                            </Group>
                          )}
                        </Group>
                      );
                    })}
                    
                    {isDrawing && newRect && (
                      <Rect
                        x={(newRect.width < 0 ? newRect.x + newRect.width : newRect.x) / scale}
                        y={(newRect.height < 0 ? newRect.y + newRect.height : newRect.y) / scale}
                        width={Math.abs(newRect.width) / scale}
                        height={Math.abs(newRect.height) / scale}
                        stroke="#3b82f6"
                        strokeWidth={2 / scale}
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
          <div className="w-64 border-l border-slate-200 bg-white flex flex-col shrink-0">
            <div className="p-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">パーツ一覧 ({rects.length})</span>
              <span className="text-[10px] text-slate-400">クリックで選択</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {rects.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">枠がありません。<br />キャンバスをドラッグして追加できます。</p>
              ) : (
                rects.map((r, idx) => {
                  const name = iconLabels?.[r.id] ?? `パーツ ${idx + 1}`;
                  const isSelected = selectedId === r.id;
                  return (
                    <div
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      className={`flex items-center justify-between p-2 rounded-lg text-xs cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-50 border border-blue-300 text-blue-800 font-bold shadow-2xs'
                          : 'hover:bg-slate-50 border border-transparent text-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0 ${
                          isSelected ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'
                        }`}>
                          {idx + 1}
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
