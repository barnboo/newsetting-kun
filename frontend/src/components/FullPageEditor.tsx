import React, { useRef, useState, useEffect, useLayoutEffect, useMemo, forwardRef } from 'react';
import { Stage, Layer, Image as KonvaImage, Text, Rect, Group, Circle } from 'react-konva';
import useImage from 'use-image';

export interface OverlayNode {
  id: string;
  type: 'text' | 'circle';
  text: string;
  x: number;
  y: number;
  fontSize: number;
  radius: number;
}

export interface SceneExportData {
  sceneId: string;
  name: string;
  stageImageUrl: string;
  stageImageUrlWithCurves?: string;
  stageImageUrlWithoutCurves?: string;
  tallies: { icon_id: string; label: string; count: number; source?: 'pdf' | 'template' }[];
  initialNodes?: OverlayNode[];
}

interface FullPageEditorProps {
  fileId: string;
  pageImageUrl: string;
  stageImageUrl: string;
  backgroundCrop?: { x: number; y: number; width: number; height: number } | null;
  tallies: { icon_id: string; label: string; count: number; source?: 'pdf' | 'template' }[];
  initialNodes?: OverlayNode[];
  sceneExports?: SceneExportData[];
  onBack: () => void;
  onExport: (fullPageImages: string | string[]) => void;
}

// ─── Single Scene Canvas Component ──────────────────────────────────────────

interface SingleSceneCanvasProps {
  scene: SceneExportData;
  index: number;
  dimensions: { width: number; height: number; scale: number };
  backgroundCrop?: { x: number; y: number; width: number; height: number } | null;
  bgImage: HTMLImageElement | undefined;
  nodes: OverlayNode[];
  selectedId: string | null;
  editingId?: string | null;
  onSelectNode: (id: string | null) => void;
  onStartEditingNode?: (id: string) => void;
  onUpdateNodePos: (id: string, x: number, y: number) => void;
  onCanvasDblClick?: (docX: number, docY: number) => void;
}

const SingleSceneCanvas = forwardRef<any, SingleSceneCanvasProps>(({
  scene,
  dimensions,
  backgroundCrop,
  bgImage,
  nodes,
  selectedId,
  editingId,
  onSelectNode,
  onStartEditingNode,
  onUpdateNodePos,
  onCanvasDblClick,
}, ref) => {
  const [stageImg] = useImage(scene.stageImageUrl, 'anonymous');

  // Fallback crop if backgroundCrop is null/undefined
  const crop = (backgroundCrop && backgroundCrop.width > 0)
    ? backgroundCrop
    : {
        x: 40,
        y: 120,
        width: (bgImage?.naturalWidth || 1684) - 80,
        height: (bgImage?.naturalHeight || 1191) - 200,
      };

  return (
    <Stage
      ref={ref}
      width={dimensions.width}
      height={dimensions.height}
      scaleX={dimensions.scale}
      scaleY={dimensions.scale}
      onMouseDown={(e) => {
        if (e.target === e.target.getStage()) {
          onSelectNode(null);
        }
      }}
      onDblClick={(e) => {
        const stage = e.target.getStage();
        if (!stage) return;
        const pointerPos = stage.getPointerPosition();
        if (!pointerPos) return;

        const target = e.target;
        const isBg = target === stage || 
                     target.id() === 'bgImage' || 
                     target.getLayer()?.id() === 'bgLayer' || 
                     target.getLayer()?.id() === 'stageLayoutLayer';

        if (isBg) {
          const docX = Math.round(pointerPos.x / dimensions.scale);
          const docY = Math.round(pointerPos.y / dimensions.scale);
          onCanvasDblClick?.(docX, docY);
        }
      }}
      onDblTap={(e) => {
        const stage = e.target.getStage();
        if (!stage) return;
        const pointerPos = stage.getPointerPosition();
        if (!pointerPos) return;

        const target = e.target;
        const isBg = target === stage || 
                     target.id() === 'bgImage' || 
                     target.getLayer()?.id() === 'bgLayer' || 
                     target.getLayer()?.id() === 'stageLayoutLayer';

        if (isBg) {
          const docX = Math.round(pointerPos.x / dimensions.scale);
          const docY = Math.round(pointerPos.y / dimensions.scale);
          onCanvasDblClick?.(docX, docY);
        }
      }}
    >
      {/* Background Document Layer */}
      <Layer id="bgLayer">
        {bgImage ? (
          <KonvaImage
            image={bgImage}
            x={0}
            y={0}
            width={bgImage.naturalWidth || 1684}
            height={bgImage.naturalHeight || 1191}
            listening={false}
          />
        ) : (
          <Rect
            x={0}
            y={0}
            width={1684}
            height={1191}
            fill="#ffffff"
            stroke="#cbd5e1"
            strokeWidth={1}
            listening={false}
          />
        )}
      </Layer>

      {/* Stage Layout Image Layer */}
      <Layer id="stageLayoutLayer">
        {stageImg && (
          <KonvaImage
            image={stageImg}
            x={crop.x}
            y={crop.y}
            width={crop.width}
            height={crop.height}
            listening={false}
          />
        )}
      </Layer>

      {/* Editable Overlay Elements (Text & Circles) */}
      <Layer id="overlayLayer">
        {nodes.map(t => {
          const isSelected = t.id === selectedId;
          const isCircle = t.type === 'circle';

          return (
            <Group
              key={t.id}
              id={t.id}
              x={t.x}
              y={t.y}
              draggable
              onMouseDown={(e) => {
                e.cancelBubble = true;
                onSelectNode(t.id);
              }}
              onClick={(e) => {
                e.cancelBubble = true;
                onSelectNode(t.id);
              }}
              onTap={(e) => {
                e.cancelBubble = true;
                onSelectNode(t.id);
              }}
              onDblClick={(e) => {
                e.cancelBubble = true;
                onSelectNode(t.id);
                if (t.type === 'text') {
                  onStartEditingNode?.(t.id);
                }
              }}
              onDblTap={(e) => {
                e.cancelBubble = true;
                onSelectNode(t.id);
                if (t.type === 'text') {
                  onStartEditingNode?.(t.id);
                }
              }}
              onDragStart={(e) => {
                e.cancelBubble = true;
                onSelectNode(t.id);
              }}
              onDragEnd={(e) => {
                e.cancelBubble = true;
                onUpdateNodePos(t.id, Math.round(e.target.x()), Math.round(e.target.y()));
              }}
              onMouseEnter={(e) => {
                const container = e.target.getStage()?.container();
                if (container) container.style.cursor = 'move';
              }}
              onMouseLeave={(e) => {
                const container = e.target.getStage()?.container();
                if (container) container.style.cursor = 'default';
              }}
            >
              {/* Selection Box Outline */}
              {isSelected && !isCircle && (
                <Rect
                  x={-4}
                  y={-4}
                  width={(t.text.length * t.fontSize * 0.9) + 8}
                  height={t.fontSize + 8}
                  stroke="#2563eb"
                  strokeWidth={1.5}
                  dash={[4, 3]}
                  cornerRadius={3}
                />
              )}
              {isSelected && isCircle && (
                <Rect
                  x={-(t.radius + 4)}
                  y={-(t.radius + 4)}
                  width={(t.radius + 4) * 2}
                  height={(t.radius + 4) * 2}
                  stroke="#2563eb"
                  strokeWidth={1.5}
                  dash={[4, 3]}
                  cornerRadius={3}
                />
              )}

              {isCircle ? (
                <Circle
                  radius={t.radius}
                  stroke={isSelected ? '#2563eb' : '#111827'}
                  strokeWidth={2}
                  fill="rgba(0, 0, 0, 0.001)"
                  hitFunc={(context, shape) => {
                    context.beginPath();
                    context.arc(0, 0, t.radius, 0, Math.PI * 2, true);
                    context.closePath();
                    context.fillStrokeShape(shape);
                  }}
                />
              ) : (
                <Text
                  text={t.text}
                  fontSize={t.fontSize}
                  fontFamily="'Hiragino Sans', 'Meiryo', sans-serif"
                  fill={isSelected ? '#1d4ed8' : '#111827'}
                  padding={2}
                  opacity={editingId === t.id ? 0 : 1}
                />
              )}
            </Group>
          );
        })}
      </Layer>
    </Stage>
  );
});

SingleSceneCanvas.displayName = 'SingleSceneCanvas';

// ─── Main FullPageEditor Component ──────────────────────────────────────────

export const FullPageEditor: React.FC<FullPageEditorProps> = ({
  pageImageUrl,
  stageImageUrl,
  backgroundCrop,
  tallies,
  initialNodes,
  sceneExports,
  onBack,
  onExport,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRefs = useRef<Record<string, any>>({});
  const [bgImage] = useImage(pageImageUrl, 'anonymous');

  // Toggle Bezier curves in output
  const [showCurveLines, setShowCurveLines] = useState<boolean>(true);

  // Multi-scene normalization
  const effectiveScenes = useMemo<SceneExportData[]>(() => {
    const rawList = (sceneExports && sceneExports.length > 0)
      ? sceneExports
      : [
          {
            sceneId: 'scene-default',
            name: '場面 1',
            stageImageUrl,
            tallies,
            initialNodes,
          },
        ];

    return rawList.map(sc => ({
      ...sc,
      stageImageUrl: showCurveLines
        ? (sc.stageImageUrlWithCurves || sc.stageImageUrl)
        : (sc.stageImageUrlWithoutCurves || sc.stageImageUrl),
    }));
  }, [sceneExports, stageImageUrl, tallies, initialNodes, showCurveLines]);

  // Active scene tracking
  const [activeSceneIdx, setActiveSceneIdx] = useState<number>(0);
  const activeScene = effectiveScenes[activeSceneIdx] || effectiveScenes[0];

  // View & Zoom State
  const [fitMode, setFitMode] = useState<'width' | 'page'>('width');
  const [zoomMultiplier, setZoomMultiplier] = useState(1.0);
  const [dimensions, setDimensions] = useState({ width: 900, height: 636, scale: 1 });
  const [isExporting, setIsExporting] = useState(false);

  // Overlay Nodes State per Scene
  const [sceneNodesMap, setSceneNodesMap] = useState<Record<string, OverlayNode[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const editingNodeIdRef = useRef<string | null>(null);
  editingNodeIdRef.current = editingNodeId;
  const inlineTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Undo / Redo history state
  const historyRef = useRef<Record<string, OverlayNode[]>[]>([]);
  const redoStackRef = useRef<Record<string, OverlayNode[]>[]>([]);
  const isRestoringRef = useRef(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const textPreEditMapRef = useRef<Record<string, OverlayNode[]> | null>(null);

  // Focus inline textarea on editing start
  useEffect(() => {
    if (editingNodeId && inlineTextareaRef.current) {
      inlineTextareaRef.current.focus();
      inlineTextareaRef.current.select();
    }
  }, [editingNodeId]);

  // Initialize nodes for all scenes
  useEffect(() => {
    setSceneNodesMap(prevMap => {
      const newMap: Record<string, OverlayNode[]> = { ...prevMap };

      effectiveScenes.forEach((sc, idx) => {
        if (!newMap[sc.sceneId] || newMap[sc.sceneId].length === 0) {
          const defaultSceneNode: OverlayNode | null = effectiveScenes.length > 1 ? {
            id: 'text_scene_name',
            type: 'text',
            text: `【${sc.name}】`,
            x: 650,
            y: 65,
            fontSize: 20,
            radius: 15,
          } : null;

          const scInitial = (sc.initialNodes || (idx === 0 ? initialNodes : []) || []).filter(
            n => n.id !== 'text_org' && !n.text?.includes('〇〇吹奏楽団')
          );
          const initialList: OverlayNode[] = [];
          if (defaultSceneNode) {
            initialList.push(defaultSceneNode);
          }
          initialList.push(...scInitial);
          newMap[sc.sceneId] = initialList;
        } else {
          // If nodes exist, filter out any default 'text_org' or '〇〇吹奏楽団'
          newMap[sc.sceneId] = newMap[sc.sceneId].filter(
            n => n.id !== 'text_org' && !n.text?.includes('〇〇吹奏楽団')
          );
        }
      });

      return newMap;
    });
  }, [effectiveScenes, initialNodes]);

  // Active tallies based on selected scene
  const activeTallies = activeScene?.tallies || tallies;

  const pdfTallies = useMemo(
    () => activeTallies.filter(t => (t.source === 'pdf' || !t.icon_id.startsWith('tmpl_')) && t.count > 0),
    [activeTallies]
  );
  const tmplTallies = useMemo(
    () => activeTallies.filter(t => (t.source === 'template' || t.icon_id.startsWith('tmpl_')) && t.count > 0),
    [activeTallies]
  );

  // Initialize stage dimensions dynamically
  useEffect(() => {
    if (!containerRef.current) return;

    const updateDimensions = () => {
      if (!containerRef.current) return;
      const containerW = containerRef.current.clientWidth - 48;
      const containerH = containerRef.current.clientHeight - 48;

      const imgW = bgImage?.naturalWidth || 1684;
      const imgH = bgImage?.naturalHeight || 1191;

      if (containerW <= 0 || containerH <= 0) return;

      let baseScale = 1.0;
      if (fitMode === 'width') {
        baseScale = containerW / imgW;
      } else {
        baseScale = Math.min(containerW / imgW, containerH / imgH);
      }

      const finalScale = baseScale * zoomMultiplier;

      setDimensions({
        width: Math.round(imgW * finalScale),
        height: Math.round(imgH * finalScale),
        scale: finalScale,
      });
    };

    const observer = new ResizeObserver(updateDimensions);
    observer.observe(containerRef.current);
    updateDimensions();

    return () => observer.disconnect();
  }, [bgImage, fitMode, zoomMultiplier]);

  // Stable zoom anchor refs
  const prevDimensionsRef = useRef(dimensions);
  const zoomAnchorRef = useRef<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const prev = prevDimensionsRef.current;
    prevDimensionsRef.current = dimensions;

    if (!containerRef.current) return;
    if (prev.scale === dimensions.scale || prev.scale === 0) return;

    const container = containerRef.current;
    const ratio = dimensions.scale / prev.scale;

    const anchor = zoomAnchorRef.current || {
      x: container.clientWidth / 2,
      y: container.clientHeight / 2,
    };
    zoomAnchorRef.current = null;

    container.scrollLeft = (container.scrollLeft + anchor.x) * ratio - anchor.x;
    container.scrollTop = (container.scrollTop + anchor.y) * ratio - anchor.y;
  }, [dimensions]);

  // Container mouse wheel zoom
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

        setZoomMultiplier(prev => {
          const delta = e.deltaY < 0 ? 0.1 : -0.1;
          return Math.min(Math.max(Number((prev + delta).toFixed(2)), 0.5), 2.5);
        });
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  // Middle mouse or Space+Drag pan
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
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.code === 'Space') {
        if (!isSpaceDown) {
          isSpaceDown = true;
          if (!isPanning) {
            container.style.cursor = 'grab';
          }
        }
      } else if (e.key === '+' || e.key === '=' || (e.ctrlKey && e.key === '=')) {
        e.preventDefault();
        setZoomMultiplier(prev => Math.min(Number((prev + 0.1).toFixed(2)), 3.0));
      } else if (e.key === '-' || (e.ctrlKey && e.key === '-')) {
        e.preventDefault();
        setZoomMultiplier(prev => Math.max(Number((prev - 0.1).toFixed(2)), 0.3));
      } else if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setZoomMultiplier(1.0);
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

  const handleZoomIn = () => setZoomMultiplier(prev => Math.min(Number((prev + 0.1).toFixed(2)), 3.0));
  const handleZoomOut = () => setZoomMultiplier(prev => Math.max(Number((prev - 0.1).toFixed(2)), 0.3));
  const handleZoomReset = () => setZoomMultiplier(1.0);

  const scrollToScene = (idx: number) => {
    setActiveSceneIdx(idx);
    const el = document.getElementById(`scene-sheet-${idx}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // Node editing handlers for active scene
  const activeSceneId = activeScene.sceneId;
  const currentNodes = sceneNodesMap[activeSceneId] || [];

  const pushHistory = (newMap: Record<string, OverlayNode[]>) => {
    if (isRestoringRef.current) return;
    historyRef.current = [...historyRef.current.slice(-50), JSON.parse(JSON.stringify(sceneNodesMap))];
    redoStackRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
    setSceneNodesMap(newMap);
  };

  const handleUndo = () => {
    if (historyRef.current.length === 0) return;
    isRestoringRef.current = true;
    redoStackRef.current = [JSON.parse(JSON.stringify(sceneNodesMap)), ...redoStackRef.current];
    const prev = historyRef.current[historyRef.current.length - 1];
    historyRef.current = historyRef.current.slice(0, -1);
    setSceneNodesMap(prev);
    if (selectedId) {
      const exists = Object.values(prev).some(list => list.some(n => n.id === selectedId));
      if (!exists) setSelectedId(null);
    }
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(true);
    requestAnimationFrame(() => { isRestoringRef.current = false; });
  };

  const handleRedo = () => {
    if (redoStackRef.current.length === 0) return;
    isRestoringRef.current = true;
    historyRef.current = [...historyRef.current, JSON.parse(JSON.stringify(sceneNodesMap))];
    const next = redoStackRef.current[0];
    redoStackRef.current = redoStackRef.current.slice(1);
    setSceneNodesMap(next);
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
    requestAnimationFrame(() => { isRestoringRef.current = false; });
  };

  const handleStartTextEdit = () => {
    if (!textPreEditMapRef.current) {
      textPreEditMapRef.current = JSON.parse(JSON.stringify(sceneNodesMap));
    }
  };

  const handleCommitTextEdit = () => {
    if (textPreEditMapRef.current) {
      const isDifferent = JSON.stringify(textPreEditMapRef.current) !== JSON.stringify(sceneNodesMap);
      if (isDifferent) {
        historyRef.current = [...historyRef.current.slice(-50), textPreEditMapRef.current];
        redoStackRef.current = [];
        setCanUndo(true);
        setCanRedo(false);
      }
      textPreEditMapRef.current = null;
    }
  };

  const handleUpdateNodeText = (sceneId: string, nodeId: string, newText: string) => {
    handleStartTextEdit();
    setSceneNodesMap(prev => ({
      ...prev,
      [sceneId]: (prev[sceneId] || []).map(t =>
        t.id === nodeId ? { ...t, text: newText } : t
      ),
    }));
  };

  const handleAddText = (defaultText = '新規テキスト', x = 300, y = 150, fontSize = 22, startEditing = false) => {
    const newId = `text_${Date.now()}`;
    const nextNodes = [
      ...(sceneNodesMap[activeSceneId] || []),
      {
        id: newId,
        type: 'text' as const,
        text: defaultText,
        x,
        y,
        fontSize,
        radius: 15,
      },
    ];
    pushHistory({
      ...sceneNodesMap,
      [activeSceneId]: nextNodes,
    });
    setSelectedId(newId);
    if (startEditing) {
      handleStartTextEdit();
      setEditingNodeId(newId);
    }
  };

  const handleAddCircle = () => {
    const newId = `circle_${Date.now()}`;
    const nextNodes = [
      ...(sceneNodesMap[activeSceneId] || []),
      {
        id: newId,
        type: 'circle' as const,
        text: '',
        x: 300,
        y: 150,
        fontSize: 22,
        radius: 15,
      },
    ];
    pushHistory({
      ...sceneNodesMap,
      [activeSceneId]: nextNodes,
    });
    setSelectedId(newId);
  };

  const handleDeleteSelected = () => {
    const targetId = selectedIdRef.current || selectedId;
    if (targetId) {
      const next: Record<string, OverlayNode[]> = {};
      for (const [sId, nodes] of Object.entries(sceneNodesMap)) {
        next[sId] = nodes.filter(t => t.id !== targetId);
      }
      pushHistory(next);
      setSelectedId(null);
      setEditingNodeId(null);
    }
  };

  // Keyboard shortcut: Backspace / Delete, Undo / Redo (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const targetTag = (e.target as HTMLElement)?.tagName;
      const isInput =
        targetTag === 'INPUT' ||
        targetTag === 'TEXTAREA' ||
        activeEl?.tagName === 'INPUT' ||
        activeEl?.tagName === 'TEXTAREA' ||
        (activeEl as HTMLElement)?.isContentEditable;

      const isCmdOrCtrl = e.ctrlKey || e.metaKey;

      // When inside an input/textarea, let the browser handle typing/internal undo
      if (isInput) return;

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
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        const curSelectedId = selectedIdRef.current;
        const curEditingId = editingNodeIdRef.current;
        if (curSelectedId && !curEditingId) {
          e.preventDefault();
          e.stopPropagation();
          handleDeleteSelected();
        }
      } else if (e.key === 'Escape') {
        if (selectedIdRef.current) {
          setSelectedId(null);
          setEditingNodeId(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sceneNodesMap, canUndo, canRedo]);

  const handleUpdateSelectedText = (newText: string) => {
    if (!selectedId) return;
    handleStartTextEdit();

    // If updating the organization name (text_org), sync across all scenes
    if (selectedId === 'text_org') {
      setSceneNodesMap(prev => {
        const next: Record<string, OverlayNode[]> = {};
        for (const sId of Object.keys(prev)) {
          next[sId] = prev[sId].map(t => (t.id === 'text_org' ? { ...t, text: newText } : t));
        }
        return next;
      });
      return;
    }

    setSceneNodesMap(prev => ({
      ...prev,
      [activeSceneId]: (prev[activeSceneId] || []).map(t =>
        t.id === selectedId ? { ...t, text: newText } : t
      ),
    }));
  };

  const handleUpdateSelectedFontSize = (fontSize: number) => {
    if (!selectedId) return;
    pushHistory({
      ...sceneNodesMap,
      [activeSceneId]: (sceneNodesMap[activeSceneId] || []).map(t =>
        t.id === selectedId ? { ...t, fontSize } : t
      ),
    });
  };

  const handleUpdateSelectedRadius = (radius: number) => {
    if (!selectedId) return;
    pushHistory({
      ...sceneNodesMap,
      [activeSceneId]: (sceneNodesMap[activeSceneId] || []).map(t =>
        t.id === selectedId ? { ...t, radius } : t
      ),
    });
  };

  const handleUpdateNodePos = (sId: string, id: string, x: number, y: number) => {
    const current = sceneNodesMap[sId]?.find(t => t.id === id);
    if (current && (current.x !== x || current.y !== y)) {
      pushHistory({
        ...sceneNodesMap,
        [sId]: (sceneNodesMap[sId] || []).map(t => (t.id === id ? { ...t, x, y } : t)),
      });
    }
  };

  const handleExport = () => {
    setSelectedId(null);
    setEditingNodeId(null);
    setIsExporting(true);

    try {
      const exportedImages: string[] = [];
      const exportPixelRatio = (1 / dimensions.scale) * 2.0;

      for (const sc of effectiveScenes) {
        const stage = stageRefs.current[sc.sceneId];
        if (!stage) continue;

        // Hide background layer to export transparent overlay
        const bgLayer = stage.findOne('#bgLayer');
        if (bgLayer) bgLayer.visible(false);

        const dataUrl = stage.toDataURL({
          pixelRatio: exportPixelRatio,
          mimeType: 'image/png',
        });

        if (bgLayer) bgLayer.visible(true);
        exportedImages.push(dataUrl);
      }

      if (exportedImages.length === 0) {
        alert('書き出し対象のプレビューがありません。');
        return;
      }

      onExport(exportedImages.length === 1 ? exportedImages[0] : exportedImages);
    } catch (e) {
      console.error(e);
      alert('PDF書き出し用画像の生成に失敗しました。');
    } finally {
      setIsExporting(false);
    }
  };

  const selectedNode = currentNodes.find(t => t.id === selectedId);

  return (
    <div className="flex flex-col h-full bg-slate-100 select-none">
      {/* Top Studio Toolbar */}
      <header className="min-h-14 py-2 px-4 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-y-2 gap-x-3 shrink-0 shadow-xs z-20">
        {/* Left: Navigation & Title */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition-colors shrink-0"
            title="ステージ配置画面に戻る"
          >
            <span>←</span>
            <span>ステージへ</span>
          </button>
          <div className="h-4 w-px bg-slate-200" />
          <h2 className="text-xs sm:text-sm font-bold text-slate-800 flex items-center gap-1.5 shrink-0">
            <span>📄</span>
            <span>全体プレビュー</span>
            {effectiveScenes.length > 1 && (
              <span className="text-[11px] font-normal text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200 ml-1">
                全 {effectiveScenes.length} 場面を一望中
              </span>
            )}
          </h2>
        </div>

        {/* Scene Navigation Quick Jump (When multiple scenes exist) */}
        {effectiveScenes.length > 1 && (
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs shrink-0 max-w-full overflow-x-auto">
            <span className="text-[11px] text-slate-500 font-bold px-1 shrink-0">場面ジャンプ:</span>
            {effectiveScenes.map((sc, idx) => (
              <button
                key={sc.sceneId}
                type="button"
                onClick={() => scrollToScene(idx)}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all shrink-0 ${
                  activeSceneIdx === idx
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-white text-slate-700 hover:text-slate-900 border border-slate-200 hover:bg-slate-50'
                }`}
                title={`第${idx + 1}ページ（${sc.name}）へスクロール`}
              >
                {sc.name}
              </button>
            ))}
          </div>
        )}

        {/* Right: Controls & Actions */}
        <div className="flex items-center gap-2 shrink-0 flex-nowrap">
          {/* Undo / Redo Buttons */}
          <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs shrink-0">
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
          </div>

          <div className="h-4 w-px bg-slate-200 mx-0.5 hidden sm:block" />

          {/* View Controls: Fit Mode Switcher */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs shrink-0">
            <button
              type="button"
              onClick={() => {
                setFitMode('page');
                setZoomMultiplier(1.0);
              }}
              className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                fitMode === 'page'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="画面内に用紙全体が収まるよう縮小表示"
            >
              全体
            </button>
            <button
              type="button"
              onClick={() => {
                setFitMode('width');
                setZoomMultiplier(1.0);
              }}
              className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                fitMode === 'width'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="用紙の横幅を画面いっぱいに拡大表示"
            >
              幅に合わせる
            </button>
          </div>

          {/* Zoom Buttons */}
          <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleZoomOut();
              }}
              className="w-7 h-7 flex items-center justify-center hover:bg-white rounded text-slate-700 text-sm font-bold transition-colors cursor-pointer select-none"
              title="ズームアウト (-10%)"
            >
              −
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleZoomReset();
              }}
              className="px-2 py-0.5 text-xs font-mono font-bold text-slate-800 hover:bg-white rounded transition-colors cursor-pointer select-none min-w-[3.5rem] text-center"
              title="拡大率を100%にリセット"
            >
              {Math.round(zoomMultiplier * 100)}%
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleZoomIn();
              }}
              className="w-7 h-7 flex items-center justify-center hover:bg-white rounded text-slate-700 text-sm font-bold transition-colors cursor-pointer select-none"
              title="ズームイン (+10%)"
            >
              +
            </button>
          </div>

          <div className="h-4 w-px bg-slate-200 mx-1 hidden sm:block" />

          {/* Add Text / Circle Nodes */}
          <button
            type="button"
            onClick={() => handleAddText()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50/70 hover:bg-blue-100/70 text-blue-700 text-xs font-semibold shadow-2xs transition-colors shrink-0"
            title="文字を追加して任意の場所に配置"
          >
            <span>✍️</span>
            <span>文字追加</span>
          </button>

          <button
            type="button"
            onClick={handleAddCircle}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition-colors shrink-0"
            title="丸囲み枠を追加"
          >
            <span>⭕</span>
            <span>丸印追加</span>
          </button>

          {/* Toggle Bezier Curves in Output */}
          <button
            type="button"
            onClick={() => setShowCurveLines(prev => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold shadow-2xs transition-all shrink-0 ${
              showCurveLines
                ? 'bg-purple-50 border-purple-300 text-purple-700 hover:bg-purple-100'
                : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
            title="出力プレビュー内のベジェ曲線の線（ガイド線）の表示/非表示を切り替えます"
          >
            <span>〰️</span>
            <span>ベジェ曲線: {showCurveLines ? '表示' : '非表示'}</span>
          </button>

          <div className="h-4 w-px bg-slate-200 mx-1 hidden sm:block" />

          {/* Main Action: Export PDF */}
          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs hover:shadow transition-all shrink-0 disabled:opacity-50"
          >
            <span>{isExporting ? '⏳' : '📥'}</span>
            <span>
              {isExporting
                ? '書き出し中...'
                : effectiveScenes.length > 1
                ? `全${effectiveScenes.length}場面を一括PDF出力`
                : 'PDFをダウンロード'}
            </span>
          </button>
        </div>
      </header>

      {/* Main Studio Viewport (Canvas + Inspector) */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Canvas Scrollable Workspace: Multi-scene sheets stacked vertically */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto bg-slate-200/80 p-6 flex flex-col items-center gap-10"
        >
          {effectiveScenes.map((sc, idx) => {
            const isActive = activeSceneIdx === idx;
            const currentSceneNodes = sceneNodesMap[sc.sceneId] || [];

            return (
              <div
                key={sc.sceneId}
                id={`scene-sheet-${idx}`}
                className="flex flex-col items-center gap-2.5 shrink-0"
                onClick={() => {
                  if (activeSceneIdx !== idx) {
                    setActiveSceneIdx(idx);
                    setSelectedId(null);
                  }
                }}
              >
                {/* Scene Header Badge Bar (for multi-scene clarity) */}
                {effectiveScenes.length > 1 && (
                  <div
                    className="flex items-center justify-between w-full px-2"
                    style={{ width: dimensions.width }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold shadow-xs transition-colors ${
                          isActive
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-700 text-slate-200'
                        }`}
                      >
                        <span>📑</span>
                        <span>{sc.name}</span>
                      </span>
                      <span className="text-xs text-slate-600 font-bold">
                        ページ {idx + 1} / {effectiveScenes.length}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {isActive ? (
                        <span className="text-[11px] font-bold text-blue-700 bg-blue-100 px-2.5 py-0.5 rounded-full border border-blue-300 shadow-2xs">
                          ● 編集対象（選択中）
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveSceneIdx(idx);
                            setSelectedId(null);
                          }}
                          className="text-xs text-slate-700 bg-white hover:bg-slate-100 px-3 py-1 rounded-md border border-slate-300 font-semibold shadow-2xs transition-colors"
                        >
                          この場面を選択して編集
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Printable A4 Sheet Paper */}
                <div
                  className={`relative bg-white rounded-xs transition-all ${
                    isActive
                      ? 'ring-4 ring-blue-500/80 shadow-2xl'
                      : 'ring-1 ring-slate-300 shadow-lg opacity-95 hover:opacity-100 hover:ring-2 hover:ring-slate-400'
                  }`}
                  style={{
                    width: dimensions.width,
                    height: dimensions.height,
                  }}
                >
                  <SingleSceneCanvas
                    ref={(el) => {
                      stageRefs.current[sc.sceneId] = el;
                    }}
                    scene={sc}
                    index={idx}
                    dimensions={dimensions}
                    backgroundCrop={backgroundCrop}
                    bgImage={bgImage}
                    nodes={currentSceneNodes}
                    selectedId={isActive ? selectedId : null}
                    editingId={isActive ? editingNodeId : null}
                    onSelectNode={(id) => {
                      setActiveSceneIdx(idx);
                      setSelectedId(id);
                      if (id !== editingNodeId) {
                        setEditingNodeId(null);
                      }
                    }}
                    onStartEditingNode={(id) => {
                      setActiveSceneIdx(idx);
                      setSelectedId(id);
                      setEditingNodeId(id);
                    }}
                    onUpdateNodePos={(nodeId, x, y) => handleUpdateNodePos(sc.sceneId, nodeId, x, y)}
                    onCanvasDblClick={(docX, docY) => {
                      setActiveSceneIdx(idx);
                      handleAddText('新規テキスト', docX, docY, 22, true);
                    }}
                  />

                  {/* Inline Text Editor Overlay */}
                  {isActive && (() => {
                    const editingNode = currentSceneNodes.find(t => t.id === editingNodeId);
                    if (!editingNode || editingNode.type !== 'text') return null;

                    return (
                      <textarea
                        ref={inlineTextareaRef}
                        value={editingNode.text}
                        onFocus={handleStartTextEdit}
                        onChange={(e) => handleUpdateNodeText(sc.sceneId, editingNode.id, e.target.value)}
                        onBlur={() => {
                          handleCommitTextEdit();
                          setEditingNodeId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleCommitTextEdit();
                            setEditingNodeId(null);
                          } else if (e.key === 'Escape') {
                            handleCommitTextEdit();
                            setEditingNodeId(null);
                          }
                        }}
                        style={{
                          position: 'absolute',
                          left: `${editingNode.x * dimensions.scale}px`,
                          top: `${editingNode.y * dimensions.scale}px`,
                          fontSize: `${Math.max(12, editingNode.fontSize * dimensions.scale)}px`,
                          lineHeight: 1.25,
                          width: `${Math.max(130, (editingNode.text.length * editingNode.fontSize * 0.95 + 32) * dimensions.scale)}px`,
                          minHeight: `${(editingNode.fontSize * 1.5 + 8) * dimensions.scale}px`,
                          zIndex: 40,
                        }}
                        className="bg-white/95 border-2 border-blue-600 rounded px-1.5 py-1 text-blue-900 shadow-2xl outline-none resize font-sans"
                        autoFocus
                      />
                    );
                  })()}
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Inspector Panel */}
        <aside className="w-80 bg-white border-l border-slate-200 flex flex-col shrink-0 shadow-sm overflow-hidden z-10">
          <div className="p-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
              <span>📋</span>
              <span>出力確認 & 設定パネル</span>
            </h3>
            {effectiveScenes.length > 1 && (
              <span className="text-[11px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                {activeScene.name}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
            {/* Multi-scene switcher within Inspector */}
            {effectiveScenes.length > 1 && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                <label className="block text-[11px] font-bold text-slate-700">
                  編集対象の場面を選択:
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {effectiveScenes.map((sc, idx) => (
                    <button
                      key={sc.sceneId}
                      type="button"
                      onClick={() => scrollToScene(idx)}
                      className={`py-1.5 px-2 rounded-lg text-xs font-bold border transition-all text-center truncate ${
                        activeSceneIdx === idx
                          ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {sc.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 1. Selected Node Inspector */}
            {selectedNode && (
              <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-3.5 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-blue-950 flex items-center gap-1">
                    <span>✏️</span>
                    <span>選択中{selectedNode.type === 'circle' ? '丸囲み' : 'テキスト'}の編集</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleDeleteSelected}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded font-semibold text-[11px] transition-colors cursor-pointer flex items-center gap-1"
                    title="BackspaceまたはDeleteキーでも削除できます"
                  >
                    <span>🗑</span>
                    <span>削除 (Backspace)</span>
                  </button>
                </div>

                {selectedNode.type === 'text' && (
                  <>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        入力文字:
                      </label>
                      <input
                        type="text"
                        value={selectedNode.text}
                        onFocus={handleStartTextEdit}
                        onChange={(e) => handleUpdateSelectedText(e.target.value)}
                        onBlur={handleCommitTextEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleCommitTextEdit();
                            (e.target as HTMLElement).blur();
                          }
                        }}
                        className="w-full bg-white border border-blue-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 font-medium focus:ring-2 focus:ring-blue-400 focus:outline-none shadow-2xs"
                        placeholder="文字を入力..."
                      />
                      {selectedNode.id === 'text_org' && effectiveScenes.length > 1 && (
                        <p className="text-[10px] text-blue-600 mt-1">
                          ※団体名はすべての場面に自動で同期反映されます。
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        文字サイズ:
                      </label>
                      <div className="grid grid-cols-4 gap-1.5">
                        {[16, 20, 24, 32].map(size => (
                          <button
                            key={size}
                            type="button"
                            onClick={() => handleUpdateSelectedFontSize(size)}
                            className={`py-1 text-[11px] font-bold rounded-md border transition-all ${
                              selectedNode.fontSize === size
                                ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            {size}px
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {selectedNode.type === 'circle' && (
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      丸の大きさ (半径):
                    </label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[10, 15, 20, 25].map(radius => (
                        <button
                          key={radius}
                          type="button"
                          onClick={() => handleUpdateSelectedRadius(radius)}
                          className={`py-1 text-[11px] font-bold rounded-md border transition-all ${
                            selectedNode.radius === radius
                              ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {radius}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-[10px] text-slate-500 leading-tight space-y-0.5">
                  <span>※キャンバス上の{selectedNode.type === 'circle' ? '丸' : '文字'}を直接ドラッグして移動できます。</span>
                  <br />
                  <span className="text-slate-600 font-medium">※選択中にBackspaceまたはDeleteキーで削除できます。</span>
                </p>
              </div>
            )}

            {/* 2. Automated Tally & Circles Verification Card */}
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-[10px]">
                  ✓
                </span>
                <span className="font-bold text-emerald-950 text-xs">
                  自動入力（数字・丸印）配置済み
                </span>
              </div>
              <p className="text-[11px] text-emerald-800 leading-relaxed">
                表内の「本・脚・台」の数字や「要・不要」の丸印は自動配置されています。キャンバス上でクリックして直接ドラッグ移動や編集・削除が可能です。
              </p>
            </div>

            {/* 3. Tally Breakdown: PDF extracted items */}
            <div className="space-y-1.5">
              <div className="font-bold text-slate-700 text-xs flex justify-between items-center px-1">
                <span className="flex items-center gap-1">
                  <span>📄</span>
                  <span>PDF読み取りパーツ ({activeScene.name})</span>
                </span>
                <span className="text-[11px] text-slate-400 font-normal">
                  合計 {pdfTallies.reduce((s, t) => s + t.count, 0)} 個
                </span>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden shadow-2xs">
                {pdfTallies.length === 0 ? (
                  <p className="text-center text-slate-400 py-3 text-xs">
                    配置されたパーツはありません
                  </p>
                ) : (
                  pdfTallies.map(t => (
                    <div
                      key={t.icon_id}
                      className="flex justify-between items-center py-2 px-3 hover:bg-slate-50/60 transition-colors"
                    >
                      <span className="text-slate-700 font-medium truncate pr-2">
                        {t.label}
                      </span>
                      <span className="font-bold text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full text-xs shrink-0">
                        {t.count}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 4. Tally Breakdown: Template items */}
            <div className="space-y-1.5">
              <div className="font-bold text-slate-700 text-xs flex justify-between items-center px-1">
                <span className="flex items-center gap-1">
                  <span>📐</span>
                  <span>テンプレパーツ ({activeScene.name})</span>
                </span>
                <span className="text-[11px] text-slate-400 font-normal">
                  合計 {tmplTallies.reduce((s, t) => s + t.count, 0)} 個
                </span>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden shadow-2xs">
                {tmplTallies.length === 0 ? (
                  <p className="text-center text-slate-400 py-3 text-xs">
                    配置されたパーツはありません
                  </p>
                ) : (
                  tmplTallies.map(t => (
                    <div
                      key={t.icon_id}
                      className="flex justify-between items-center py-2 px-3 hover:bg-slate-50/60 transition-colors"
                    >
                      <span className="text-slate-700 font-medium truncate pr-2">
                        {t.label}
                      </span>
                      <span className="font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full text-xs shrink-0">
                        {t.count}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default FullPageEditor;
