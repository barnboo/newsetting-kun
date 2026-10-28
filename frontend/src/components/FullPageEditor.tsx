import React, { useRef, useState, useEffect, useLayoutEffect, useMemo, forwardRef } from 'react';
import { Stage, Layer, Image as KonvaImage, Text, Rect, Group, Ellipse, Line } from 'react-konva';
import useImage from 'use-image';
import { Layers, Trash2, FileText, Shapes, Type, Spline, Copy, ClipboardPaste, CopyPlus, X, Check, Highlighter, Edit3, MessageSquareHeart, ExternalLink } from 'lucide-react';

export type ShapeKind = 'circle' | 'cross' | 'rect' | 'triangle';

export interface OverlayNode {
  id: string;
  type: 'text' | 'circle' | 'shape';
  text: string;
  x: number;
  y: number;
  fontSize: number;
  radius: number;
  width?: number;
  height?: number;
  shapeKind?: ShapeKind;
  isFilled?: boolean;
  color?: string;
  strokeWidth?: number;
}

export interface PreviewSettings {
  sceneNodesMap: Record<string, OverlayNode[]>;
  showCurveLines: boolean;
}

export interface SceneExportData {
  sceneId: string;
  name: string;
  stageImageUrl: string;
  stageImageUrlWithCurves?: string;
  stageImageUrlWithoutCurves?: string;
  tallies: { icon_id: string; label: string; count: number; source?: 'pdf' | 'template' }[];
  initialNodes?: OverlayNode[];
  savedNodes?: OverlayNode[];
}

interface FullPageEditorProps {
  fileId: string;
  pageImageUrl: string;
  stageImageUrl: string;
  backgroundCrop?: { x: number; y: number; width: number; height: number } | null;
  tallies: { icon_id: string; label: string; count: number; source?: 'pdf' | 'template' }[];
  initialNodes?: OverlayNode[];
  sceneExports?: SceneExportData[];
  initialPreviewSettings?: PreviewSettings;
  onUpdatePreviewSettings?: (settings: PreviewSettings) => void;
  projectName?: string;
  onUpdateProjectName?: (name: string) => void;
  onBack: () => void;
  onExport: (fullPageImages: string | string[]) => void;
  onExportJson?: () => void;
}

// ─── Preview Context Menu Component ─────────────────────────────────────────

interface PreviewContextMenuProps {
  position: { x: number; y: number };
  docPos: { x: number; y: number };
  targetNodeId?: string | null;
  selectedNode: OverlayNode | null;
  showCurveLines: boolean;
  canPaste: boolean;
  hasMultipleScenes?: boolean;
  highlightUserObjects?: boolean;
  onToggleHighlightUserObjects?: () => void;
  onOpenCopyScene?: () => void;
  onAddText: (docX: number, docY: number) => void;
  onAddShape: (kind: ShapeKind, docX: number, docY: number) => void;
  onToggleCurveLines: () => void;
  onCopy?: () => void;
  onPaste?: (docX: number, docY: number) => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onClose: () => void;
}

const PreviewContextMenu: React.FC<PreviewContextMenuProps> = ({
  position,
  docPos,
  targetNodeId: _targetNodeId,
  selectedNode,
  showCurveLines,
  canPaste,
  hasMultipleScenes,
  highlightUserObjects,
  onToggleHighlightUserObjects,
  onOpenCopyScene,
  onAddText,
  onAddShape,
  onToggleCurveLines,
  onCopy,
  onPaste,
  onDuplicate,
  onDelete,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState({ x: position.x, y: position.y });
  const [showShapeSubmenu, setShowShapeSubmenu] = useState(false);
  const submenuTimeoutRef = useRef<any>(null);

  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    let x = position.x;
    let y = position.y;
    if (x + rect.width > window.innerWidth - 8) {
      x = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (y + rect.height > window.innerHeight - 8) {
      y = Math.max(8, window.innerHeight - rect.height - 8);
    }
    setAdjustedPos({ x, y });
  }, [position]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const handleSubmenuEnter = () => {
    if (submenuTimeoutRef.current) clearTimeout(submenuTimeoutRef.current);
    setShowShapeSubmenu(true);
  };

  const handleSubmenuLeave = () => {
    submenuTimeoutRef.current = setTimeout(() => {
      setShowShapeSubmenu(false);
    }, 250);
  };

  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const modKey = isMac ? '⌘' : 'Ctrl+';

  return (
    <div
      ref={menuRef}
      className="fixed z-50 liquid-context-menu rounded-2xl p-1.5 min-w-[210px] text-xs select-none shadow-2xl border border-slate-200/60 dark:border-white/10 animate-in fade-in zoom-in-95 duration-100"
      style={{ left: adjustedPos.x, top: adjustedPos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* ── テキストを追加 ── */}
      <div
        onClick={() => {
          onAddText(docPos.x, docPos.y);
          onClose();
        }}
        className="px-3 py-2 rounded-xl hover:bg-[#007AFF]/12 text-slate-800 dark:text-slate-100 hover:text-[#007AFF] dark:hover:text-blue-400 flex items-center justify-between cursor-pointer transition-colors"
      >
        <div className="flex items-center gap-2">
          <Type className="w-4 h-4 text-[#007AFF]" />
          <span className="font-semibold">テキストを追加</span>
        </div>
        <span className="text-[10px] text-slate-400 font-mono">ダブルクリック</span>
      </div>

      {/* ── 図形を追加 ── */}
      <div
        className="relative group px-3 py-2 rounded-xl hover:bg-[#007AFF]/12 text-slate-800 dark:text-slate-100 hover:text-[#007AFF] dark:hover:text-blue-400 flex items-center justify-between cursor-pointer transition-colors"
        onMouseEnter={handleSubmenuEnter}
        onMouseLeave={handleSubmenuLeave}
      >
        <div className="flex items-center gap-2">
          <Shapes className="w-4 h-4 text-emerald-600" />
          <span className="font-semibold">図形を追加</span>
        </div>
        <span className="text-[10px] text-slate-400 font-bold">›</span>

        {showShapeSubmenu && (
          <div
            className="absolute left-full top-0 ml-1.5 liquid-context-menu rounded-2xl p-1.5 min-w-[145px] shadow-2xl border border-slate-200/60 dark:border-white/10 z-50"
            onMouseEnter={() => {
              if (submenuTimeoutRef.current) clearTimeout(submenuTimeoutRef.current);
            }}
            onMouseLeave={handleSubmenuLeave}
          >
            {[
              { kind: 'circle' as ShapeKind, label: '○ 丸 (円)' },
              { kind: 'cross' as ShapeKind, label: '✕ バツ (十字)' },
              { kind: 'rect' as ShapeKind, label: '□ 四角' },
              { kind: 'triangle' as ShapeKind, label: '△ 三角' },
            ].map(({ kind, label }) => (
              <div
                key={kind}
                onClick={() => {
                  onAddShape(kind, docPos.x, docPos.y);
                  onClose();
                }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-[#007AFF]/12 text-slate-800 dark:text-slate-200 hover:text-[#007AFF] cursor-pointer transition-colors"
              >
                <span className="font-medium">{label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── ベジェ曲線の有無 ── */}
      <div
        onClick={() => {
          onToggleCurveLines();
          onClose();
        }}
        className="px-3 py-2 rounded-xl hover:bg-purple-500/12 text-slate-800 dark:text-slate-100 hover:text-purple-600 dark:hover:text-purple-400 flex items-center justify-between cursor-pointer transition-colors"
      >
        <div className="flex items-center gap-2">
          <Spline className="w-4 h-4 text-purple-500" />
          <span className="font-semibold">ベジェ線</span>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
          showCurveLines
            ? 'bg-purple-500/20 text-purple-700 dark:text-purple-300'
            : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
        }`}>
          {showCurveLines ? '✓ 表示中' : '非表示'}
        </span>
      </div>

      {/* ── 追加要素の強調表示トグル ── */}
      {onToggleHighlightUserObjects && (
        <div
          onClick={() => {
            onToggleHighlightUserObjects();
            onClose();
          }}
          className="px-3 py-2 rounded-xl hover:bg-amber-500/12 text-slate-800 dark:text-slate-100 hover:text-amber-600 dark:hover:text-amber-400 flex items-center justify-between cursor-pointer transition-colors"
        >
          <div className="flex items-center gap-2">
            <Highlighter className="w-4 h-4 text-amber-500" />
            <span className="font-semibold">追加要素を強調</span>
          </div>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
            highlightUserObjects
              ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
              : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
          }`}>
            {highlightUserObjects ? '✓ 強調中' : '通常'}
          </span>
        </div>
      )}

      {/* ── コピー / 貼り付け / 複製 / 削除 ── */}
      {(selectedNode || canPaste) && (
        <div className="h-px bg-slate-200/60 dark:bg-white/10 my-1 mx-2" />
      )}

      {selectedNode && onCopy && (
        <div
          onClick={() => {
            onCopy();
            onClose();
          }}
          className="px-3 py-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-slate-800 dark:text-slate-200 flex items-center justify-between cursor-pointer transition-colors"
        >
          <div className="flex items-center gap-2">
            <Copy className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
            <span>コピー</span>
          </div>
          <span className="text-[10px] text-slate-400 font-mono">{modKey}C</span>
        </div>
      )}

      {canPaste && onPaste && (
        <div
          onClick={() => {
            onPaste(docPos.x, docPos.y);
            onClose();
          }}
          className="px-3 py-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-slate-800 dark:text-slate-200 flex items-center justify-between cursor-pointer transition-colors"
        >
          <div className="flex items-center gap-2">
            <ClipboardPaste className="w-3.5 h-3.5 text-[#007AFF]" />
            <span className="font-semibold text-[#007AFF]">貼り付け</span>
          </div>
          <span className="text-[10px] text-slate-400 font-mono">{modKey}V</span>
        </div>
      )}

      {selectedNode && onDuplicate && (
        <div
          onClick={() => {
            onDuplicate();
            onClose();
          }}
          className="px-3 py-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-slate-800 dark:text-slate-200 flex items-center justify-between cursor-pointer transition-colors"
        >
          <div className="flex items-center gap-2">
            <CopyPlus className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
            <span>複製</span>
          </div>
          <span className="text-[10px] text-slate-400 font-mono">{modKey}D</span>
        </div>
      )}

      {selectedNode && onDelete && (
        <div
          onClick={() => {
            onDelete();
            onClose();
          }}
          className="px-3 py-1.5 rounded-xl hover:bg-rose-500/12 text-rose-600 dark:text-rose-400 flex items-center justify-between cursor-pointer transition-colors"
        >
          <div className="flex items-center gap-2">
            <Trash2 className="w-3.5 h-3.5" />
            <span>削除</span>
          </div>
          <span className="text-[10px] text-rose-400 font-mono">Delete</span>
        </div>
      )}

      {hasMultipleScenes && onOpenCopyScene && (
        <>
          <div className="h-px bg-slate-200/80 dark:border-white/10 my-1" />
          <div
            onClick={() => {
              onOpenCopyScene();
              onClose();
            }}
            className="px-3 py-2 rounded-xl hover:bg-[#007AFF]/12 text-slate-800 dark:text-slate-100 hover:text-[#007AFF] dark:hover:text-blue-400 flex items-center justify-between cursor-pointer transition-colors"
          >
            <div className="flex items-center gap-2">
              <Copy className="w-4 h-4 text-[#007AFF]" />
              <span className="font-semibold">他の場面に複製...</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">全場面対応</span>
          </div>
        </>
      )}
    </div>
  );
};

// ─── Copy Scene Modal Component ─────────────────────────────────────────────

interface CopySceneModalProps {
  isOpen: boolean;
  sourceScene: SceneExportData;
  scenes: SceneExportData[];
  onClose: () => void;
  onCopy: (targetSceneIds: string[], options: {
    copyMode: 'replace' | 'merge';
    autoRenameTitle: boolean;
    includeCurveSetting: boolean;
  }) => void;
}

const CopySceneModal: React.FC<CopySceneModalProps> = ({
  isOpen,
  sourceScene,
  scenes,
  onClose,
  onCopy,
}) => {
  const otherScenes = useMemo(() => scenes.filter(s => s.sceneId !== sourceScene.sceneId), [scenes, sourceScene]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [copyMode, setCopyMode] = useState<'replace' | 'merge'>('replace');
  const [autoRenameTitle, setAutoRenameTitle] = useState(true);
  const [includeCurveSetting, setIncludeCurveSetting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedIds(otherScenes.map(s => s.sceneId));
    }
  }, [isOpen, otherScenes]);

  if (!isOpen) return null;

  const toggleSelectAll = () => {
    if (selectedIds.length === otherScenes.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(otherScenes.map(s => s.sceneId));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleExecute = () => {
    if (selectedIds.length === 0) return;
    onCopy(selectedIds, { copyMode, autoRenameTitle, includeCurveSetting });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200/70 dark:border-white/10 flex items-center justify-between bg-slate-50/50 dark:bg-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-blue-500/10 text-[#007AFF] flex items-center justify-center font-bold">
              <Copy className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100">プレビュー配置の複製</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                【{sourceScene.name}】の内容を他の場面に反映します
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-700 dark:text-slate-300">
          {/* Target Scene Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-slate-800 dark:text-slate-200">複製先の場面を選択:</span>
              <button
                type="button"
                onClick={toggleSelectAll}
                className="text-[11px] text-[#007AFF] hover:underline font-semibold"
              >
                {selectedIds.length === otherScenes.length ? 'すべて解除' : 'すべて選択'}
              </button>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {otherScenes.map(sc => {
                const isChecked = selectedIds.includes(sc.sceneId);
                return (
                  <div
                    key={sc.sceneId}
                    onClick={() => toggleSelect(sc.sceneId)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all cursor-pointer ${
                      isChecked
                        ? 'border-[#007AFF]/60 bg-[#007AFF]/5 text-slate-900 dark:text-white font-medium'
                        : 'border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      readOnly
                      className="rounded text-[#007AFF] focus:ring-0 focus:outline-hidden cursor-pointer"
                    />
                    <span>{sc.name}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Options */}
          <div className="space-y-3 pt-2 border-t border-slate-200/70 dark:border-white/10">
            <span className="font-bold text-slate-800 dark:text-slate-200 block">複製オプション:</span>

            {/* Auto Rename Scene Title */}
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRenameTitle}
                onChange={e => setAutoRenameTitle(e.target.checked)}
                className="mt-0.5 rounded text-[#007AFF] focus:ring-0 cursor-pointer"
              />
              <div>
                <span className="font-medium text-slate-800 dark:text-slate-200">場面名テキストを複製先に自動置換</span>
                <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
                  「【{sourceScene.name}】」などのタイトルを各場面の名前に自動で書き換えます。
                </p>
              </div>
            </label>

            {/* Include Bezier Curve Setting */}
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={includeCurveSetting}
                onChange={e => setIncludeCurveSetting(e.target.checked)}
                className="mt-0.5 rounded text-[#007AFF] focus:ring-0 cursor-pointer"
              />
              <div>
                <span className="font-medium text-slate-800 dark:text-slate-200">ベジェ線の表示・非表示設定も合わせる</span>
                <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
                  現在のプレビューのベジェ線設定を適用します。
                </p>
              </div>
            </label>

            {/* Mode: Replace vs Merge */}
            <div className="pt-2">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1.5">配置方法:</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCopyMode('replace')}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    copyMode === 'replace'
                      ? 'border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF] font-bold'
                      : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5'
                  }`}
                >
                  <div className="text-xs">上書き置換</div>
                  <div className="text-[10px] font-normal opacity-80 mt-0.5">既存の配置を入れ替える（推奨）</div>
                </button>
                <button
                  type="button"
                  onClick={() => setCopyMode('merge')}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    copyMode === 'merge'
                      ? 'border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF] font-bold'
                      : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5'
                  }`}
                >
                  <div className="text-xs">追加統合</div>
                  <div className="text-[10px] font-normal opacity-80 mt-0.5">既存の配置を残して追加</div>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200/70 dark:border-white/10 bg-slate-50/50 dark:bg-white/5 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-white transition-colors"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleExecute}
            disabled={selectedIds.length === 0}
            className="px-5 py-2 rounded-xl text-xs font-bold bg-[#007AFF] hover:bg-blue-600 text-white shadow-md shadow-blue-500/20 disabled:opacity-40 disabled:pointer-events-none transition-all flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{selectedIds.length > 0 ? `${selectedIds.length}個の場面に複製` : '複製先を選択'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

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
  highlightUserObjects?: boolean;
  isExporting?: boolean;
  onSelectNode: (id: string | null) => void;
  onStartEditingNode?: (id: string) => void;
  onUpdateNodePos: (id: string, x: number, y: number) => void;
  onCanvasDblClick?: (docX: number, docY: number) => void;
  onContextMenu?: (info: {
    clientX: number;
    clientY: number;
    docX: number;
    docY: number;
    targetNodeId?: string | null;
    sceneId: string;
  }) => void;
}

const SingleSceneCanvas = forwardRef<any, SingleSceneCanvasProps>(({
  scene,
  dimensions,
  backgroundCrop,
  bgImage,
  nodes,
  selectedId,
  editingId,
  highlightUserObjects,
  isExporting,
  onSelectNode,
  onStartEditingNode,
  onUpdateNodePos,
  onCanvasDblClick,
  onContextMenu,
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
      onContextMenu={(e) => {
        e.evt.preventDefault();
        const stage = e.target.getStage();
        if (!stage) return;
        const pointerPos = stage.getPointerPosition();
        if (!pointerPos) return;

        const docX = Math.round(pointerPos.x / dimensions.scale);
        const docY = Math.round(pointerPos.y / dimensions.scale);

        let targetNodeId: string | null = null;
        let curr: any = e.target;
        while (curr && curr !== stage) {
          if (curr.id && nodes.some(n => n.id === curr.id())) {
            targetNodeId = curr.id();
            break;
          }
          curr = curr.parent;
        }

        if (targetNodeId) {
          onSelectNode(targetNodeId);
        }

        onContextMenu?.({
          clientX: e.evt.clientX,
          clientY: e.evt.clientY,
          docX,
          docY,
          targetNodeId,
          sceneId: scene.sceneId,
        });
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
      <Layer id="stageLayoutLayer" opacity={highlightUserObjects && !isExporting ? 0.65 : 1.0}>
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

      {/* Editable Overlay Elements (Text & Shapes) */}
      <Layer id="overlayLayer">
        {nodes.map(t => {
          const isSelected = t.id === selectedId;
          const isShape = t.type === 'circle' || t.type === 'shape';
          const shapeKind: ShapeKind = t.shapeKind || (t.type === 'circle' ? 'circle' : 'circle');
          const isFilled = Boolean(t.isFilled);
          const effectiveW = t.width || (t.radius ? t.radius * 2 : 30);
          const effectiveH = t.height || (t.radius ? t.radius * 2 : 30);
          const halfW = effectiveW / 2;
          const halfH = effectiveH / 2;

          const strokeColor = isSelected ? '#2563eb' : (t.color || '#111827');
          const fillColor = isFilled ? strokeColor : 'rgba(0, 0, 0, 0.001)';
          const strokeWidth = 2;

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
              onContextMenu={(e) => {
                e.cancelBubble = true;
                e.evt.preventDefault();
                onSelectNode(t.id);
                const stage = e.target.getStage();
                const pointerPos = stage?.getPointerPosition();
                const docX = pointerPos ? Math.round(pointerPos.x / dimensions.scale) : t.x;
                const docY = pointerPos ? Math.round(pointerPos.y / dimensions.scale) : t.y;

                onContextMenu?.({
                  clientX: e.evt.clientX,
                  clientY: e.evt.clientY,
                  docX,
                  docY,
                  targetNodeId: t.id,
                  sceneId: scene.sceneId,
                });
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
              {/* Highlight Underlay when Highlight Mode is ON (User-added elements differentiation) */}
              {highlightUserObjects && !isExporting && (
                <Group listening={false}>
                  {isShape ? (
                    <>
                      <Rect
                        x={-(halfW + 6)}
                        y={-(halfH + 6)}
                        width={effectiveW + 12}
                        height={effectiveH + 12}
                        fill="rgba(245, 158, 11, 0.18)"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        dash={[5, 3]}
                        cornerRadius={6}
                      />
                      <Rect
                        x={-(halfW + 6)}
                        y={-(halfH + 18)}
                        width={30}
                        height={13}
                        fill="#f59e0b"
                        cornerRadius={3}
                      />
                      <Text
                        text="図形"
                        x={-(halfW + 3)}
                        y={-(halfH + 17)}
                        fontSize={8.5}
                        fontFamily="sans-serif"
                        fontStyle="bold"
                        fill="#ffffff"
                      />
                    </>
                  ) : (
                    <>
                      <Rect
                        x={-5}
                        y={-5}
                        width={(t.text.length * t.fontSize * 0.9) + 10}
                        height={t.fontSize + 10}
                        fill="rgba(245, 158, 11, 0.2)"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        dash={[5, 3]}
                        cornerRadius={5}
                      />
                      <Rect
                        x={-5}
                        y={-17}
                        width={30}
                        height={13}
                        fill="#f59e0b"
                        cornerRadius={3}
                      />
                      <Text
                        text="追加"
                        x={-2}
                        y={-16}
                        fontSize={8.5}
                        fontFamily="sans-serif"
                        fontStyle="bold"
                        fill="#ffffff"
                      />
                    </>
                  )}
                </Group>
              )}

              {/* Selection Box Outline */}
              {isSelected && !isShape && (
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
              {isSelected && isShape && (
                <Rect
                  x={-(halfW + 4)}
                  y={-(halfH + 4)}
                  width={effectiveW + 8}
                  height={effectiveH + 8}
                  stroke="#2563eb"
                  strokeWidth={1.5}
                  dash={[4, 3]}
                  cornerRadius={3}
                />
              )}

              {/* Render Shape or Text */}
              {isShape ? (
                (() => {
                  switch (shapeKind) {
                    case 'circle':
                      return (
                        <Ellipse
                          radiusX={halfW}
                          radiusY={halfH}
                          stroke={strokeColor}
                          strokeWidth={strokeWidth}
                          fill={fillColor}
                        />
                      );
                    case 'rect':
                      return (
                        <Rect
                          x={-halfW}
                          y={-halfH}
                          width={effectiveW}
                          height={effectiveH}
                          stroke={strokeColor}
                          strokeWidth={strokeWidth}
                          fill={fillColor}
                          cornerRadius={2}
                        />
                      );
                    case 'triangle':
                      return (
                        <Line
                          points={[
                            0, -halfH,
                            halfW * 0.95, halfH * 0.85,
                            -halfW * 0.95, halfH * 0.85,
                          ]}
                          closed
                          stroke={strokeColor}
                          strokeWidth={strokeWidth}
                          fill={fillColor}
                          lineJoin="round"
                        />
                      );
                    case 'cross':
                      if (isFilled) {
                        const armX = halfW * 0.35;
                        const armY = halfH * 0.35;
                        return (
                          <Line
                            points={[
                              0, -armY,
                              halfW - armX, -halfH,
                              halfW, -halfH + armY,
                              armX, 0,
                              halfW, halfH - armY,
                              halfW - armX, halfH,
                              0, armY,
                              -halfW + armX, halfH,
                              -halfW, halfH - armY,
                              -armX, 0,
                              -halfW, -halfH + armY,
                              -halfW + armX, -halfH,
                            ]}
                            closed
                            stroke={strokeColor}
                            strokeWidth={1.5}
                            fill={strokeColor}
                            lineJoin="round"
                          />
                        );
                      }
                      return (
                        <Group>
                          <Line
                            points={[-halfW * 0.8, -halfH * 0.8, halfW * 0.8, halfH * 0.8]}
                            stroke={strokeColor}
                            strokeWidth={strokeWidth + 0.8}
                            lineCap="round"
                          />
                          <Line
                            points={[halfW * 0.8, -halfH * 0.8, -halfW * 0.8, halfH * 0.8]}
                            stroke={strokeColor}
                            strokeWidth={strokeWidth + 0.8}
                            lineCap="round"
                          />
                          {/* Hit area for cross */}
                          <Rect
                            x={-halfW}
                            y={-halfH}
                            width={effectiveW}
                            height={effectiveH}
                            fill="rgba(0,0,0,0.001)"
                          />
                        </Group>
                      );
                    default:
                      return null;
                  }
                })()
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
  fileId,
  pageImageUrl,
  stageImageUrl,
  backgroundCrop,
  tallies,
  initialNodes,
  sceneExports,
  initialPreviewSettings,
  onUpdatePreviewSettings,
  projectName,
  onUpdateProjectName,
  onBack,
  onExport,
  onExportJson,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRefs = useRef<Record<string, any>>({});
  const [bgImage] = useImage(pageImageUrl, 'anonymous');

  // Project Name Editing State in Preview
  const [localProjectName, setLocalProjectName] = useState<string>(projectName || 'セッティング図');
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const projectNameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (projectName) setLocalProjectName(projectName);
  }, [projectName]);

  const handleCommitProjectName = (newName?: string) => {
    const raw = (newName !== undefined ? newName : localProjectName).trim();
    const finalName = raw || projectName || 'セッティング図';
    setLocalProjectName(finalName);
    setIsEditingProjectName(false);
    onUpdateProjectName?.(finalName);
  };

  // Toggle Bezier curves in output
  const [showCurveLines, setShowCurveLines] = useState<boolean>(initialPreviewSettings?.showCurveLines ?? true);

  // Highlight user-added objects mode (distinguish from background elements)
  const [highlightUserObjects, setHighlightUserObjects] = useState<boolean>(false);

  // First-time export feedback prompt modal
  const [showFeedbackModal, setShowFeedbackModal] = useState<boolean>(false);

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
  const [dragOverSceneId, setDragOverSceneId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const editingNodeIdRef = useRef<string | null>(null);
  editingNodeIdRef.current = editingNodeId;
  const inlineTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Copy & Paste Clipboard for Overlay Nodes
  const clipboardNodeRef = useRef<OverlayNode | null>(null);
  const [canPasteNode, setCanPasteNode] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<any>(null);

  // Right-click Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    docPos: { x: number; y: number };
    targetNodeId?: string | null;
  } | null>(null);

  const showToast = (msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 1800);
  };

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

  // Copy Scene Modal State
  const [isCopySceneModalOpen, setIsCopySceneModalOpen] = useState(false);

  const handleOpenCopySceneModal = () => {
    setIsCopySceneModalOpen(true);
  };

  const handleExecuteCopyScene = (
    targetSceneIds: string[],
    options: {
      copyMode: 'replace' | 'merge';
      autoRenameTitle: boolean;
      includeCurveSetting: boolean;
    }
  ) => {
    if (targetSceneIds.length === 0) return;

    const sourceNodes = sceneNodesMap[activeScene.sceneId] || [];
    const newMap: Record<string, OverlayNode[]> = { ...sceneNodesMap };

    targetSceneIds.forEach(targetId => {
      const targetScene = effectiveScenes.find(s => s.sceneId === targetId);
      const targetSceneName = targetScene?.name || '場面';

      const clonedNodes: OverlayNode[] = sourceNodes.map((node, index) => {
        let newText = node.text;
        if (options.autoRenameTitle && (node.id === 'text_scene_name' || node.text === `【${activeScene.name}】` || node.text.includes(activeScene.name))) {
          if (node.id === 'text_scene_name' || node.text === `【${activeScene.name}】`) {
            newText = `【${targetSceneName}】`;
          } else {
            newText = node.text.replace(activeScene.name, targetSceneName);
          }
        }

        return {
          ...node,
          id: node.id === 'text_scene_name' ? 'text_scene_name' : `node_copy_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
          text: newText,
        };
      });

      if (options.copyMode === 'replace') {
        newMap[targetId] = clonedNodes;
      } else {
        const existing = (newMap[targetId] || []).filter(n => n.id !== 'text_scene_name');
        newMap[targetId] = [...existing, ...clonedNodes];
      }
    });

    pushHistory(newMap);
    setIsCopySceneModalOpen(false);
    showToast(`${targetSceneIds.length} 個の場面に配置を複製しました`);
  };

  // Synchronize changes to parent and localStorage cache
  useEffect(() => {
    if (Object.keys(sceneNodesMap).length === 0) return;
    const settings: PreviewSettings = {
      sceneNodesMap,
      showCurveLines,
    };
    onUpdatePreviewSettings?.(settings);
    try {
      localStorage.setItem(`stajet_preview_settings_${fileId}`, JSON.stringify(settings));
    } catch (e) {
      console.warn('Failed to save preview settings cache to localStorage', e);
    }
  }, [sceneNodesMap, showCurveLines, fileId, onUpdatePreviewSettings]);

  // Initialize nodes for all scenes (restoring from initialPreviewSettings or scene.savedNodes if available)
  // 保存済みノードを復元する場合も、自動集計ノード（id が 'auto_' で始まるもの）は毎回最新の集計結果に置き換える。
  // 自動検出されたテキスト入力欄（id が 'field_' で始まるもの）は、ユーザーが編集済みの場合は保存値を維持し、未保存の場合は新規追加する。
  useEffect(() => {
    const isOrgNode = (n: OverlayNode) => n.id === 'text_org' || !!n.text?.includes('〇〇吹奏楽団');
    const isAutoNode = (n: OverlayNode) => typeof n.id === 'string' && n.id.startsWith('auto_');
    const isFieldNode = (n: OverlayNode) => typeof n.id === 'string' && n.id.startsWith('field_');

    setSceneNodesMap(prevMap => {
      const newMap: Record<string, OverlayNode[]> = { ...prevMap };

      effectiveScenes.forEach((sc, idx) => {
        const freshInitialNodes = (sc.initialNodes || (idx === 0 ? initialNodes : []) || []).filter(
          n => !isOrgNode(n)
        );
        const mergeWithFreshAuto = (saved: OverlayNode[]) => {
          const keptSaved = saved.filter(n => !isOrgNode(n) && !isAutoNode(n));
          const savedFieldIds = new Set(keptSaved.filter(isFieldNode).map(n => n.id));
          const missingFreshFields = freshInitialNodes.filter(n => isFieldNode(n) && !savedFieldIds.has(n.id));
          return [
            ...keptSaved,
            ...missingFreshFields,
            ...freshInitialNodes.filter(isAutoNode),
          ];
        };

        // If already initialized in component state, just filter text_org
        if (newMap[sc.sceneId] && newMap[sc.sceneId].length > 0) {
          newMap[sc.sceneId] = newMap[sc.sceneId].filter(n => !isOrgNode(n));
          return;
        }

        // 1. Check initialPreviewSettings first
        if (initialPreviewSettings?.sceneNodesMap?.[sc.sceneId] && initialPreviewSettings.sceneNodesMap[sc.sceneId].length > 0) {
          newMap[sc.sceneId] = mergeWithFreshAuto(initialPreviewSettings.sceneNodesMap[sc.sceneId]);
          return;
        }

        // 2. Check scene.savedNodes
        if (sc.savedNodes && sc.savedNodes.length > 0) {
          newMap[sc.sceneId] = mergeWithFreshAuto(sc.savedNodes);
          return;
        }

        // 3. Fallback to default generated nodes
        const defaultSceneNode: OverlayNode | null = effectiveScenes.length > 1 ? {
          id: 'text_scene_name',
          type: 'text',
          text: `【${sc.name}】`,
          x: 650,
          y: 65,
          fontSize: 20,
          radius: 15,
        } : null;

        const initialList: OverlayNode[] = [];
        if (defaultSceneNode) {
          initialList.push(defaultSceneNode);
        }
        initialList.push(...freshInitialNodes);
        newMap[sc.sceneId] = initialList;
      });

      return newMap;
    });
  }, [effectiveScenes, initialNodes, initialPreviewSettings]);

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

  const handleDropTallyNumber = (targetSceneId: string, text: string, docX: number, docY: number) => {
    const newId = `text_${Date.now()}`;
    const nextNodes = [
      ...(sceneNodesMap[targetSceneId] || []),
      {
        id: newId,
        type: 'text' as const,
        text,
        x: Math.max(0, docX - 10),
        y: Math.max(0, docY - 10),
        fontSize: 22,
        radius: 15,
      },
    ];
    pushHistory({
      ...sceneNodesMap,
      [targetSceneId]: nextNodes,
    });
    setSelectedId(newId);
  };

  const [selectedShapeKind, setSelectedShapeKind] = useState<ShapeKind>('circle');
  const [selectedShapeFilled, setSelectedShapeFilled] = useState<boolean>(false);

  const handleAddShape = (
    kind: ShapeKind = selectedShapeKind,
    isFilled: boolean = selectedShapeFilled,
    x = 300,
    y = 150
  ) => {
    setSelectedShapeKind(kind);
    setSelectedShapeFilled(isFilled);
    const newId = `shape_${Date.now()}`;
    const nextNodes = [
      ...(sceneNodesMap[activeSceneId] || []),
      {
        id: newId,
        type: 'shape' as const,
        shapeKind: kind,
        isFilled,
        text: '',
        x,
        y,
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

  const handleCopyNode = (nodeId?: string) => {
    const targetId = nodeId || selectedIdRef.current || selectedId;
    if (!targetId) return;

    const currentList = sceneNodesMap[activeSceneId] || [];
    const targetNode = currentList.find(n => n.id === targetId);
    if (targetNode) {
      clipboardNodeRef.current = JSON.parse(JSON.stringify(targetNode));
      setCanPasteNode(true);
      showToast(targetNode.type === 'text' ? 'テキストをコピーしました' : '図形をコピーしました');
    }
  };

  const handlePasteNode = (targetDocX?: number, targetDocY?: number) => {
    const copied = clipboardNodeRef.current;
    if (!copied) return;

    const newId = `${copied.type}_${Date.now()}`;
    const posX = typeof targetDocX === 'number' ? Math.max(0, targetDocX) : copied.x + 25;
    const posY = typeof targetDocY === 'number' ? Math.max(0, targetDocY) : copied.y + 25;

    const newNode: OverlayNode = {
      ...copied,
      id: newId,
      x: posX,
      y: posY,
    };

    const nextNodes = [
      ...(sceneNodesMap[activeSceneId] || []),
      newNode,
    ];

    pushHistory({
      ...sceneNodesMap,
      [activeSceneId]: nextNodes,
    });
    setSelectedId(newId);
    showToast(copied.type === 'text' ? 'テキストを貼り付けました' : '図形を貼り付けました');
  };

  const handleDuplicateNode = (nodeId?: string) => {
    const targetId = nodeId || selectedIdRef.current || selectedId;
    if (!targetId) return;

    const currentList = sceneNodesMap[activeSceneId] || [];
    const targetNode = currentList.find(n => n.id === targetId);
    if (!targetNode) return;

    const newId = `${targetNode.type}_${Date.now()}`;
    const newNode: OverlayNode = {
      ...targetNode,
      id: newId,
      x: targetNode.x + 20,
      y: targetNode.y + 20,
    };

    const nextNodes = [
      ...currentList,
      newNode,
    ];

    pushHistory({
      ...sceneNodesMap,
      [activeSceneId]: nextNodes,
    });
    setSelectedId(newId);
    showToast(targetNode.type === 'text' ? 'テキストを複製しました' : '図形を複製しました');
  };

  const handleUpdateSelectedShapeKind = (kind: ShapeKind) => {
    if (!selectedId) return;
    setSelectedShapeKind(kind);
    const nextNodes = (sceneNodesMap[activeSceneId] || []).map(t =>
      t.id === selectedId ? { ...t, type: 'shape' as const, shapeKind: kind } : t
    );
    pushHistory({
      ...sceneNodesMap,
      [activeSceneId]: nextNodes,
    });
  };

  const handleUpdateSelectedShapeFill = (isFilled: boolean) => {
    if (!selectedId) return;
    setSelectedShapeFilled(isFilled);
    const nextNodes = (sceneNodesMap[activeSceneId] || []).map(t =>
      t.id === selectedId ? { ...t, isFilled } : t
    );
    pushHistory({
      ...sceneNodesMap,
      [activeSceneId]: nextNodes,
    });
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

  // Keyboard shortcut: Backspace / Delete, Copy / Paste / Duplicate, Undo / Redo (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z)
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

      // When inside an input/textarea, let the browser handle typing/internal undo/copy/paste
      if (isInput) return;

      if (isCmdOrCtrl) {
        // Copy: Ctrl/Cmd + C
        if (e.key === 'c' || e.key === 'C') {
          if (selectedIdRef.current && !editingNodeIdRef.current) {
            e.preventDefault();
            handleCopyNode();
            return;
          }
        }
        // Paste: Ctrl/Cmd + V
        if (e.key === 'v' || e.key === 'V') {
          if (!editingNodeIdRef.current && clipboardNodeRef.current) {
            e.preventDefault();
            handlePasteNode();
            return;
          }
        }
        // Duplicate: Ctrl/Cmd + D
        if (e.key === 'd' || e.key === 'D') {
          if (selectedIdRef.current && !editingNodeIdRef.current) {
            e.preventDefault();
            handleDuplicateNode();
            return;
          }
        }
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

  const handleUpdateSelectedWidth = (w: number) => {
    if (!selectedId) return;
    const newWidth = Math.max(6, w);
    pushHistory({
      ...sceneNodesMap,
      [activeSceneId]: (sceneNodesMap[activeSceneId] || []).map(t =>
        t.id === selectedId ? { ...t, width: newWidth, radius: Math.round(newWidth / 2) } : t
      ),
    });
  };

  const handleUpdateSelectedHeight = (h: number) => {
    if (!selectedId) return;
    const newHeight = Math.max(6, h);
    pushHistory({
      ...sceneNodesMap,
      [activeSceneId]: (sceneNodesMap[activeSceneId] || []).map(t =>
        t.id === selectedId ? { ...t, height: newHeight } : t
      ),
    });
  };

  const handleUpdateSelectedDimensions = (w: number, h: number) => {
    if (!selectedId) return;
    pushHistory({
      ...sceneNodesMap,
      [activeSceneId]: (sceneNodesMap[activeSceneId] || []).map(t =>
        t.id === selectedId ? { ...t, width: w, height: h, radius: Math.round(Math.min(w, h) / 2) } : t
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

  const FEEDBACK_FORM_URL = 'https://forms.gle/fujpm76eSrSao8549';
  const FEEDBACK_STORAGE_KEY = 'stajet_feedback_form_prompted';

  const executeActualExport = () => {
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

  const handleExport = () => {
    // 初回出力時のみアンケートフォーム回答を促すモーダルを表示
    let hasPrompted = false;
    try {
      hasPrompted = Boolean(localStorage.getItem(FEEDBACK_STORAGE_KEY));
    } catch (e) {
      console.warn('localStorage is not available', e);
    }

    if (!hasPrompted) {
      setShowFeedbackModal(true);
      return;
    }

    executeActualExport();
  };

  const handleConfirmFeedback = (openForm: boolean) => {
    try {
      localStorage.setItem(FEEDBACK_STORAGE_KEY, 'true');
    } catch (e) {
      console.warn('Failed to set feedback prompt in localStorage', e);
    }
    setShowFeedbackModal(false);

    if (openForm) {
      window.open(FEEDBACK_FORM_URL, '_blank', 'noopener,noreferrer');
    }

    executeActualExport();
  };

  const selectedNode = currentNodes.find(t => t.id === selectedId);

  return (
    <div className="flex flex-col h-full liquid-bg select-none">
      {/* Top Studio Toolbar with Apple Liquid Glass layout */}
      <header className="min-h-14 py-2 px-5 liquid-glass border-b flex flex-wrap items-center justify-between gap-y-2 gap-x-3 shrink-0 z-20 select-none">
        {/* Left: Navigation & Title */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onBack}
            className="liquid-btn flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-slate-800 text-xs font-bold transition-all shrink-0 cursor-pointer"
            title="ステージ配置画面に戻る"
          >
            <span>←</span>
            <span>ステージへ戻る</span>
          </button>
          <div className="h-5 w-px bg-slate-300/60" />
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#2e90fa] to-[#0055c0] text-white flex items-center justify-center font-bold text-xs shadow-sm border border-white/30 font-mono">
              PDF
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                {isEditingProjectName ? (
                  <input
                    ref={projectNameInputRef}
                    type="text"
                    value={localProjectName}
                    onChange={(e) => setLocalProjectName(e.target.value)}
                    onBlur={() => handleCommitProjectName()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCommitProjectName();
                      if (e.key === 'Escape') setIsEditingProjectName(false);
                    }}
                    className="text-xs sm:text-sm font-bold bg-white dark:bg-slate-800 border-2 border-[#007AFF] rounded-lg px-2 py-0.5 outline-hidden shadow-xs text-slate-900 dark:text-slate-100 min-w-[120px] max-w-[220px]"
                    autoFocus
                    placeholder="プロジェクト名"
                  />
                ) : (
                  <div
                    onClick={() => {
                      setIsEditingProjectName(true);
                      setTimeout(() => projectNameInputRef.current?.select(), 50);
                    }}
                    className="flex items-center gap-1 cursor-pointer group hover:opacity-85 transition-opacity"
                    title="クリックしてプロジェクト名を変更"
                  >
                    <h2 className="text-xs sm:text-sm font-bold text-slate-900 tracking-tight leading-tight max-w-[160px] sm:max-w-[240px] truncate">
                      {localProjectName}
                    </h2>
                    <Edit3 className="w-3 h-3 text-slate-400 group-hover:text-[#007AFF] transition-colors shrink-0" />
                  </div>
                )}
              </div>
              <p className="text-[10px] text-slate-500 font-medium leading-tight">
                {effectiveScenes.length > 1 ? `全 ${effectiveScenes.length} 場面の出力プレビュー` : '印刷・提出用プレビュー'}
              </p>
            </div>
          </div>
        </div>

        {/* Center: Apple Liquid Glass Capsule Stepper */}
        <div className="hidden xl:flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 px-2.5 py-1 liquid-segment-track rounded-full text-xs">
            <div className="flex items-center gap-1 text-slate-500 px-2 py-0.5">
              <span className="w-4 h-4 rounded-full bg-slate-300 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px] font-bold flex items-center justify-center">1</span>
              <span>PDF読込</span>
            </div>
            <span className="text-slate-300">›</span>
            <div className="flex items-center gap-1 text-slate-500 px-2 py-0.5">
              <span className="w-4 h-4 rounded-full bg-slate-300 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px] font-bold flex items-center justify-center">2</span>
              <span>領域設定</span>
            </div>
            <span className="text-slate-300">›</span>
            <div className="flex items-center gap-1 text-slate-500 px-2 py-0.5">
              <span className="w-4 h-4 rounded-full bg-slate-300 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px] font-bold flex items-center justify-center">3</span>
              <span>ステージ配置</span>
            </div>
            <span className="text-slate-300">›</span>
            <div className="flex items-center gap-1.5 font-bold text-[#007AFF] bg-white/90 px-3 py-1 rounded-full shadow-xs border border-white/80">
              <span className="w-4 h-4 rounded-full bg-[#007AFF] text-white text-[10px] font-bold flex items-center justify-center shadow-2xs">4</span>
              <span>プレビュー・出力 (現在地)</span>
            </div>
          </div>
        </div>

        {/* Scene Navigation Quick Jump (When multiple scenes exist) */}
        {effectiveScenes.length > 1 && (
          <div className="flex items-center gap-1.5 liquid-segment-track p-1 rounded-full text-xs shrink-0 max-w-full overflow-x-auto">
            <span className="text-[11px] text-slate-600 font-bold px-2 shrink-0">場面切替:</span>
            {effectiveScenes.map((sc, idx) => (
              <button
                key={sc.sceneId}
                type="button"
                onClick={() => scrollToScene(idx)}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer ${
                  activeSceneIdx === idx
                    ? 'liquid-btn-primary text-white'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
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
          <div className="flex items-center gap-1 liquid-segment-track p-1 rounded-full text-xs shrink-0">
            <button
              type="button"
              onClick={handleUndo}
              disabled={!canUndo}
              className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors ${
                canUndo
                  ? 'text-slate-800 hover:bg-white/90 hover:text-slate-900 cursor-pointer'
                  : 'text-slate-400 cursor-not-allowed'
              }`}
              title={`元に戻す (Ctrl+Z) ${historyRef.current.length > 0 ? `(${historyRef.current.length}件)` : ''}`}
            >
              ↩
            </button>
            <button
              type="button"
              onClick={handleRedo}
              disabled={!canRedo}
              className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors ${
                canRedo
                  ? 'text-slate-800 hover:bg-white/90 hover:text-slate-900 cursor-pointer'
                  : 'text-slate-400 cursor-not-allowed'
              }`}
              title="やり直し (Ctrl+Y / Ctrl+Shift+Z)"
            >
              ↪
            </button>
          </div>

          <div className="h-4 w-px bg-slate-300/60 mx-0.5 hidden sm:block" />

          {/* View Controls: Fit Mode Switcher */}
          <div className="flex items-center liquid-segment-track p-1 rounded-full text-xs shrink-0">
            <button
              type="button"
              onClick={() => {
                setFitMode('page');
                setZoomMultiplier(1.0);
              }}
              className={`px-3 py-1 rounded-full font-semibold transition-all cursor-pointer ${
                fitMode === 'page'
                  ? 'bg-white text-[#007AFF] shadow-2xs font-bold'
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
              className={`px-3 py-1 rounded-full font-semibold transition-all cursor-pointer ${
                fitMode === 'width'
                  ? 'bg-white text-[#007AFF] shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="用紙の横幅を画面いっぱいに拡大表示"
            >
              幅に合わせる
            </button>
          </div>

          {/* Zoom Buttons */}
          <div className="flex items-center liquid-segment-track p-1 rounded-full text-xs shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleZoomOut();
              }}
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/90 text-slate-700 font-bold transition-colors cursor-pointer select-none"
              title="縮小 (-10%)"
            >
              −
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleZoomReset();
              }}
              className="px-2 py-0.5 text-xs font-mono font-bold text-slate-800 hover:bg-white/90 rounded-full transition-colors cursor-pointer select-none min-w-[3.2rem] text-center"
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
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/90 text-slate-700 font-bold transition-colors cursor-pointer select-none"
              title="拡大 (+10%)"
            >
              ＋
            </button>
          </div>

          <div className="h-4 w-px bg-slate-300/60 mx-0.5 hidden sm:block" />

          {/* Add Text / Circle Nodes */}
          <button
            type="button"
            onClick={() => handleAddText()}
            className="liquid-btn flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[#007AFF] text-xs font-bold transition-all shrink-0 cursor-pointer"
            title="文字を追加して任意の場所に配置"
          >
            <span className="font-bold">T</span>
            <span>文字追加</span>
          </button>

          <button
            type="button"
            onClick={() => handleAddShape()}
            className="liquid-btn flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-slate-800 text-xs font-bold transition-all shrink-0 cursor-pointer"
            title="図形（丸・ばつ・四角・三角）を追加して配置"
          >
            <span>◇</span>
            <span>図形追加</span>
          </button>

          {/* Toggle Bezier Curves in Output */}
          <button
            type="button"
            onClick={() => setShowCurveLines(prev => !prev)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-xs font-semibold shadow-2xs transition-all shrink-0 cursor-pointer ${
              showCurveLines
                ? 'bg-purple-500/15 border-purple-400/50 text-purple-700 hover:bg-purple-500/20'
                : 'liquid-btn text-slate-600'
            }`}
            title="出力プレビュー内のベジェ曲線の線（ガイド線）の表示/非表示を切り替えます"
          >
            <span className="font-bold">〜</span>
            <span>ベジェ線: {showCurveLines ? '表示' : '非表示'}</span>
          </button>

          {/* Highlight User-added Objects Mode Button */}
          <button
            type="button"
            onClick={() => {
              setHighlightUserObjects(prev => {
                const next = !prev;
                showToast(next ? '追加要素の強調モードをONにしました（元データと区別しやすく表示中）' : '追加要素の強調モードをOFFにしました');
                return next;
              });
            }}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-xs font-bold transition-all shrink-0 cursor-pointer ${
              highlightUserObjects
                ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600 shadow-md shadow-amber-500/30 ring-2 ring-amber-400/50'
                : 'liquid-btn text-slate-700 dark:text-slate-200 border-slate-300/80 dark:border-white/10 hover:border-amber-400 hover:text-amber-600'
            }`}
            title="プレビュー上で入力・配置した文字や図形を枠線とバッジで強調表示し、元のPDF用紙やステージ画像と見分けやすくします（出力時は強調されません）"
          >
            <Highlighter className="w-3.5 h-3.5" />
            <span>{highlightUserObjects ? '追加要素: 強調中' : '追加要素を強調'}</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
              highlightUserObjects ? 'bg-white/30 text-white' : 'bg-slate-200/80 dark:bg-slate-700 text-slate-500'
            }`}>
              {highlightUserObjects ? 'ON' : 'OFF'}
            </span>
          </button>

          {effectiveScenes.length > 1 && (
            <button
              type="button"
              onClick={handleOpenCopySceneModal}
              className="liquid-btn flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-blue-600 dark:text-blue-400 text-xs font-bold transition-all shrink-0 cursor-pointer border border-blue-200/60 dark:border-blue-500/30 bg-blue-50/50 dark:bg-blue-500/10 hover:bg-blue-100/60"
              title="現在の場面で配置した文字や図形を、他の場面へ一括で複製します"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>他場面に複製</span>
            </button>
          )}

          <div className="h-4 w-px bg-slate-300/60 mx-0.5 hidden sm:block" />

          {onExportJson && (
            <button
              type="button"
              onClick={onExportJson}
              className="liquid-btn flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-slate-800 text-xs font-bold transition-all shrink-0 cursor-pointer"
              title="現在の全場面・配置データをJSONファイルとしてダウンロード保存します"
            >
              <span>↓</span>
              <span>JSON保存</span>
            </button>
          )}

          {/* Main Action: Export PDF in Apple Liquid Glass Blue */}
          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting}
            className="liquid-btn-primary flex items-center gap-2 px-5 py-2 rounded-full text-white text-xs sm:text-sm font-bold transition-all shrink-0 disabled:opacity-50 cursor-pointer"
          >
            {isExporting ? (
              <span className="animate-spin inline-block text-xs font-bold">↻</span>
            ) : (
              <span className="font-bold">↓</span>
            )}
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
          className="flex-1 overflow-auto bg-transparent p-6 flex flex-col items-center gap-10"
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
                        <Layers className="w-3.5 h-3.5" />
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
                  } ${dragOverSceneId === sc.sceneId ? 'ring-4 ring-emerald-500 shadow-2xl' : ''}`}
                  style={{
                    width: dimensions.width,
                    height: dimensions.height,
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setActiveSceneIdx(idx);
                    const rect = e.currentTarget.getBoundingClientRect();
                    const scale = dimensions.scale > 0 ? dimensions.scale : 1;
                    const docX = Math.round((e.clientX - rect.left) / scale);
                    const docY = Math.round((e.clientY - rect.top) / scale);
                    setContextMenu({
                      position: { x: e.clientX, y: e.clientY },
                      docPos: { x: docX, y: docY },
                      targetNodeId: selectedId,
                    });
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    if (dragOverSceneId !== sc.sceneId) {
                      setDragOverSceneId(sc.sceneId);
                    }
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDragOverSceneId(null);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverSceneId(null);
                    setActiveSceneIdx(idx);

                    const textData = e.dataTransfer.getData('application/settingkun-tally-number') || e.dataTransfer.getData('text/plain');
                    if (!textData) return;

                    const rect = e.currentTarget.getBoundingClientRect();
                    const scale = dimensions.scale > 0 ? dimensions.scale : 1;
                    const docX = Math.round((e.clientX - rect.left) / scale);
                    const docY = Math.round((e.clientY - rect.top) / scale);

                    handleDropTallyNumber(sc.sceneId, textData, docX, docY);
                  }}
                >
                  {/* Drag Over Visual Guide */}
                  {dragOverSceneId === sc.sceneId && (
                    <div className="absolute inset-0 z-30 bg-emerald-500/10 backdrop-blur-[0.5px] border-2 border-dashed border-emerald-500 rounded-xs flex items-center justify-center pointer-events-none transition-all">
                      <div className="bg-emerald-600 text-white font-bold text-sm px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
                        <span className="font-bold">↓</span>
                        <span>ここにドロップして数字を配置</span>
                      </div>
                    </div>
                  )}
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
                    highlightUserObjects={highlightUserObjects}
                    isExporting={isExporting}
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
                    onContextMenu={({ clientX, clientY, docX, docY, targetNodeId }) => {
                      setActiveSceneIdx(idx);
                      setContextMenu({
                        position: { x: clientX, y: clientY },
                        docPos: { x: docX, y: docY },
                        targetNodeId,
                      });
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
        <aside className="w-80 liquid-glass border-l flex flex-col shrink-0 overflow-hidden z-10">
          <div className="p-3.5 px-4 border-b border-slate-200/60 flex items-center justify-between">
            <h3 className="font-bold text-slate-800 text-xs flex items-center gap-1.5 tracking-tight">
              <span>≡</span>
              <span>出力確認 & 設定パネル</span>
            </h3>
            {effectiveScenes.length > 1 && (
              <span className="text-[11px] font-bold text-[#007AFF] bg-[#007AFF]/10 px-2.5 py-0.5 rounded-full border border-[#007AFF]/20">
                {activeScene.name}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
            {/* Multi-scene switcher within Inspector */}
            {effectiveScenes.length > 1 && (
              <div className="liquid-card rounded-2xl p-3.5 space-y-2">
                <label className="block text-[11px] font-bold text-slate-700">
                  編集対象の場面を選択:
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {effectiveScenes.map((sc, idx) => (
                    <button
                      key={sc.sceneId}
                      type="button"
                      onClick={() => scrollToScene(idx)}
                      className={`py-1.5 px-2.5 rounded-xl text-xs font-bold border transition-all text-center truncate cursor-pointer ${
                        activeSceneIdx === idx
                          ? 'liquid-btn-primary text-white border-transparent'
                          : 'bg-white/70 text-slate-700 border-slate-200/80 hover:bg-white'
                      }`}
                    >
                      {sc.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 1. Selected Node Inspector / Shapes Palette */}
            {selectedNode ? (
              (() => {
                const isShape = selectedNode.type === 'circle' || selectedNode.type === 'shape';
                const currentKind: ShapeKind = selectedNode.shapeKind || (selectedNode.type === 'circle' ? 'circle' : 'circle');
                const isFilled = Boolean(selectedNode.isFilled);

                return (
                  <div className="liquid-card bg-[#007AFF]/8 border-[#007AFF]/25 rounded-2xl p-3.5 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-[#007AFF] flex items-center gap-1">
                        <span>✎</span>
                        <span>選択中{isShape ? '図形' : 'テキスト'}の編集</span>
                      </span>
                      <button
                        type="button"
                        onClick={handleDeleteSelected}
                        className="text-rose-600 hover:text-rose-700 hover:bg-rose-500/10 px-2.5 py-1 rounded-full font-semibold text-[11px] transition-colors cursor-pointer flex items-center gap-1"
                        title="BackspaceまたはDeleteキーでも削除できます"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
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
                            className="w-full bg-white/90 border border-[#007AFF]/30 rounded-xl px-2.5 py-1.5 text-xs text-slate-800 font-medium focus:ring-2 focus:ring-[#007AFF]/40 focus:outline-none shadow-2xs"
                            placeholder="文字を入力..."
                          />
                          {selectedNode.id === 'text_org' && effectiveScenes.length > 1 && (
                            <p className="text-[10px] text-[#007AFF] mt-1">
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
                                className={`py-1.5 text-[11px] font-bold rounded-xl border transition-all cursor-pointer ${
                                  selectedNode.fontSize === size
                                    ? 'liquid-btn-primary text-white border-transparent'
                                    : 'bg-white/80 text-slate-700 border-slate-200/80 hover:bg-white'
                                }`}
                              >
                                {size}px
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}

                    {isShape && (
                      <div className="space-y-3">
                        {/* Shape Kind Selector */}
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            図形の種類:
                          </label>
                          <div className="grid grid-cols-4 gap-1.5">
                            {[
                              { kind: 'circle', label: '丸', icon: '○' },
                              { kind: 'cross', label: 'ばつ', icon: '✕' },
                              { kind: 'rect', label: '四角', icon: '□' },
                              { kind: 'triangle', label: '三角', icon: '△' },
                            ].map(({ kind, label, icon }) => (
                              <button
                                key={kind}
                                type="button"
                                onClick={() => handleUpdateSelectedShapeKind(kind as ShapeKind)}
                                className={`py-1.5 px-1 text-xs font-bold rounded-xl border flex flex-col items-center gap-0.5 transition-all cursor-pointer ${
                                  currentKind === kind
                                    ? 'liquid-btn-primary text-white border-transparent'
                                    : 'bg-white/80 text-slate-700 border-slate-200/80 hover:bg-white'
                                }`}
                              >
                                <span className="text-sm font-bold leading-none">{icon}</span>
                                <span className="text-[10px]">{label}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Fill Mode Selector */}
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            塗りつぶし:
                          </label>
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleUpdateSelectedShapeFill(false)}
                              className={`py-1.5 text-xs font-semibold rounded-xl border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                !isFilled
                                  ? 'liquid-btn-primary text-white border-transparent font-bold'
                                  : 'bg-white/80 text-slate-700 border-slate-200/80 hover:bg-white'
                              }`}
                            >
                              <span>□</span>
                              <span>枠線のみ</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUpdateSelectedShapeFill(true)}
                              className={`py-1.5 text-xs font-semibold rounded-xl border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                isFilled
                                  ? 'liquid-btn-primary text-white border-transparent font-bold'
                                  : 'bg-white/80 text-slate-700 border-slate-200/80 hover:bg-white'
                              }`}
                            >
                              <span>■</span>
                              <span>塗りつぶし</span>
                            </button>
                          </div>
                        </div>

                        {/* Width & Height Dimensions Controls */}
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <label className="text-[11px] font-semibold text-slate-600">
                              図形のサイズ (縦横比):
                            </label>
                            <span className="text-[10px] text-slate-400 font-mono">
                              W: {selectedNode.width || (selectedNode.radius ? selectedNode.radius * 2 : 30)}px × H: {selectedNode.height || (selectedNode.radius ? selectedNode.radius * 2 : 30)}px
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <label className="flex flex-col gap-0.5">
                              <span className="text-[10px] text-slate-500 font-medium">幅 (W)</span>
                              <input
                                type="number"
                                min={6}
                                max={200}
                                value={selectedNode.width || (selectedNode.radius ? selectedNode.radius * 2 : 30)}
                                onChange={(e) => handleUpdateSelectedWidth(Number(e.target.value))}
                                className="px-2 py-1 border border-slate-300 rounded text-xs w-full bg-white font-mono"
                              />
                            </label>
                            <label className="flex flex-col gap-0.5">
                              <span className="text-[10px] text-slate-500 font-medium">高さ (H)</span>
                              <input
                                type="number"
                                min={6}
                                max={200}
                                value={selectedNode.height || (selectedNode.radius ? selectedNode.radius * 2 : 30)}
                                onChange={(e) => handleUpdateSelectedHeight(Number(e.target.value))}
                                className="px-2 py-1 border border-slate-300 rounded text-xs w-full bg-white font-mono"
                              />
                            </label>
                          </div>

                          {/* Proportion Presets */}
                          <div className="flex flex-wrap gap-1 pt-1">
                            {[
                              { label: '正円/正方形 (20×20)', w: 20, h: 20 },
                              { label: '正円/正方形 (30×30)', w: 30, h: 30 },
                              { label: '正円/正方形 (40×40)', w: 40, h: 40 },
                              { label: '横長 (40×24)', w: 40, h: 24 },
                              { label: '横長 (50×28)', w: 50, h: 28 },
                              { label: '縦長 (24×40)', w: 24, h: 40 },
                              { label: '縦長 (28×50)', w: 28, h: 50 },
                            ].map(({ label, w, h }) => {
                              const curW = selectedNode.width || (selectedNode.radius ? selectedNode.radius * 2 : 30);
                              const curH = selectedNode.height || (selectedNode.radius ? selectedNode.radius * 2 : 30);
                              const isMatch = curW === w && curH === h;
                              return (
                                <button
                                  key={label}
                                  type="button"
                                  onClick={() => handleUpdateSelectedDimensions(w, h)}
                                  className={`px-2 py-1 text-[10px] font-semibold rounded-lg border transition-all cursor-pointer ${
                                    isMatch
                                      ? 'liquid-btn-primary text-white border-transparent'
                                      : 'bg-white/80 text-slate-700 border-slate-200/80 hover:bg-white'
                                  }`}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    <p className="text-[10px] text-slate-500 leading-tight space-y-0.5">
                      <span>※キャンバス上の{isShape ? '図形' : '文字'}を直接ドラッグして移動できます。</span>
                      <br />
                      <span className="text-slate-600 font-medium">※選択中にBackspaceまたはDeleteキーで削除できます。</span>
                    </p>
                  </div>
                );
              })()
            ) : null}

            {/* 2. Automated Tally & Circles Verification Card */}
            <div className="liquid-card bg-emerald-500/8 border-emerald-500/25 rounded-2xl p-3.5 space-y-2">
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold text-[10px] shadow-2xs">
                  ✓
                </span>
                <span className="font-bold text-emerald-950 text-xs">
                  自動入力（数字・丸印）配置済み
                </span>
              </div>
              <p className="text-[11px] text-emerald-800 leading-relaxed">
                表内の「本・脚・台」の数字や「要・不要」の丸印は自動配置されています。キャンバス上でクリックして直接ドラッグ移動や編集・削除が可能です。
              </p>
              <div className="pt-1.5 border-t border-emerald-500/20 text-[10px] text-emerald-700 flex items-center gap-1 font-medium">
                <span>※</span>
                <span>下の各パーツ行をプレビューへドラッグ＆ドロップすると個数の数字を文字配置できます。</span>
              </div>
            </div>

            {/* 3. Tally Breakdown: PDF extracted items */}
            <div className="space-y-1.5">
              <div className="font-bold text-slate-700 text-xs flex justify-between items-center px-1">
                <span className="flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-[#007AFF]" />
                  <span>PDF読み取りパーツ ({activeScene.name})</span>
                </span>
                <span className="text-[11px] text-slate-400 font-normal">
                  合計 {pdfTallies.reduce((s, t) => s + t.count, 0)} 個
                </span>
              </div>

              <div className="liquid-card rounded-2xl divide-y divide-slate-200/50 overflow-hidden">
                {pdfTallies.length === 0 ? (
                  <p className="text-center text-slate-400 py-3 text-xs">
                    配置されたパーツはありません
                  </p>
                ) : (
                  pdfTallies.map(t => (
                    <div
                      key={t.icon_id}
                      draggable={t.count > 0}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', String(t.count));
                        e.dataTransfer.setData('application/settingkun-tally-number', String(t.count));
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      className="flex justify-between items-center py-2 px-3 hover:bg-[#007AFF]/8 transition-colors cursor-grab active:cursor-grabbing group select-none"
                      title={`ドラッグ＆ドロップでこの数字「${t.count}」をプレビュー上に配置`}
                    >
                      <span className="text-slate-700 font-medium truncate pr-2 group-hover:text-[#007AFF]">
                        {t.label}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] text-slate-300 group-hover:text-[#007AFF] font-mono">
                          ⋮⋮
                        </span>
                        <span className="font-bold text-[#007AFF] bg-[#007AFF]/10 group-hover:bg-[#007AFF]/20 border border-[#007AFF]/25 px-2.5 py-0.5 rounded-full text-xs">
                          {t.count}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 4. Tally Breakdown: Template items */}
            <div className="space-y-1.5">
              <div className="font-bold text-slate-700 text-xs flex justify-between items-center px-1">
                <span className="flex items-center gap-1.5">
                  <Shapes className="w-3.5 h-3.5 text-indigo-500" />
                  <span>テンプレパーツ ({activeScene.name})</span>
                </span>
                <span className="text-[11px] text-slate-400 font-normal">
                  合計 {tmplTallies.reduce((s, t) => s + t.count, 0)} 個
                </span>
              </div>

              <div className="liquid-card rounded-2xl divide-y divide-slate-200/50 overflow-hidden">
                {tmplTallies.length === 0 ? (
                  <p className="text-center text-slate-400 py-3 text-xs">
                    配置されたパーツはありません
                  </p>
                ) : (
                  tmplTallies.map(t => (
                    <div
                      key={t.icon_id}
                      draggable={t.count > 0}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', String(t.count));
                        e.dataTransfer.setData('application/settingkun-tally-number', String(t.count));
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      className="flex justify-between items-center py-2 px-3 hover:bg-indigo-500/8 transition-colors cursor-grab active:cursor-grabbing group select-none"
                      title={`ドラッグ＆ドロップでこの数字「${t.count}」をプレビュー上に配置`}
                    >
                      <span className="text-slate-700 font-medium truncate pr-2 group-hover:text-indigo-700">
                        {t.label}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] text-slate-300 group-hover:text-indigo-400 font-mono">
                          ⋮⋮
                        </span>
                        <span className="font-bold text-indigo-600 bg-indigo-500/10 group-hover:bg-indigo-500/20 border border-indigo-500/25 px-2.5 py-0.5 rounded-full text-xs">
                          {t.count}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 liquid-glass-heavy text-slate-800 dark:text-white px-4 py-2 rounded-full text-xs font-bold shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-150 pointer-events-none">
          <span className="w-2 h-2 rounded-full bg-[#007AFF] animate-ping" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Right-click Context Menu */}
      {contextMenu && (
        <PreviewContextMenu
          position={contextMenu.position}
          docPos={contextMenu.docPos}
          targetNodeId={contextMenu.targetNodeId}
          selectedNode={currentNodes.find(n => n.id === (contextMenu.targetNodeId || selectedId)) || null}
          showCurveLines={showCurveLines}
          canPaste={canPasteNode}
          hasMultipleScenes={effectiveScenes.length > 1}
          highlightUserObjects={highlightUserObjects}
          onToggleHighlightUserObjects={() => {
            setHighlightUserObjects(prev => {
              const next = !prev;
              showToast(next ? '追加要素の強調モードをONにしました' : '追加要素の強調モードをOFFにしました');
              return next;
            });
          }}
          onOpenCopyScene={handleOpenCopySceneModal}
          onAddText={(docX, docY) => {
            handleAddText('新規テキスト', docX, docY, 22, true);
          }}
          onAddShape={(kind, docX, docY) => {
            handleAddShape(kind, selectedShapeFilled, docX, docY);
          }}
          onToggleCurveLines={() => {
            setShowCurveLines(prev => !prev);
            showToast(!showCurveLines ? 'ベジェ線を表示しました' : 'ベジェ線を非表示にしました');
          }}
          onCopy={() => handleCopyNode(contextMenu.targetNodeId || undefined)}
          onPaste={(docX, docY) => handlePasteNode(docX, docY)}
          onDuplicate={() => handleDuplicateNode(contextMenu.targetNodeId || undefined)}
          onDelete={() => handleDeleteSelected()}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Copy Scene Modal */}
      <CopySceneModal
        isOpen={isCopySceneModalOpen}
        sourceScene={activeScene}
        scenes={effectiveScenes}
        onClose={() => setIsCopySceneModalOpen(false)}
        onCopy={handleExecuteCopyScene}
      />

      {/* ── First-time Export Feedback Prompt Modal ── */}
      {showFeedbackModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setShowFeedbackModal(false)}
        >
          <div
            className="liquid-glass-heavy rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-white/70 dark:border-white/10 text-slate-800 dark:text-slate-100 flex flex-col items-center text-center relative animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              type="button"
              onClick={() => setShowFeedbackModal(false)}
              className="absolute top-4 right-4 w-8 h-8 rounded-full liquid-btn flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-bold transition-all cursor-pointer"
              title="閉じる"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Icon Badge */}
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 text-white flex items-center justify-center shadow-lg shadow-orange-500/25 mb-4">
              <MessageSquareHeart className="w-7 h-7" />
            </div>

            {/* Title */}
            <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight">
              アンケートご協力のお願い
            </h3>

            {/* Description */}
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed mt-2.5 mb-6">
              StaJet（ステージレイアウトプランナー）をご利用いただきありがとうございます！
              <br className="hidden sm:inline" />
              今後の改善のため、<span className="font-bold text-amber-600 dark:text-amber-400">1〜2分程度の簡単なアンケート</span>へのご協力をお願いいたします。
            </p>

            {/* Action Buttons */}
            <div className="w-full flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => handleConfirmFeedback(true)}
                className="w-full py-3 px-4 rounded-full font-bold text-xs sm:text-sm text-white bg-gradient-to-r from-[#007AFF] via-blue-600 to-[#0055c0] hover:opacity-95 shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-[0.98]"
              >
                <span>アンケートに回答する (PDFも保存)</span>
                <ExternalLink className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => handleConfirmFeedback(false)}
                className="w-full py-2.5 px-4 rounded-full text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100/50 dark:hover:bg-slate-800/50 cursor-pointer transition-all"
              >
                今回は回答せずにPDFをダウンロード
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FullPageEditor;
