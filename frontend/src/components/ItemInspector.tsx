import React, { useState } from 'react';
import { 
  AlignJustify, 
  Lock, 
  Copy, 
  Trash2, 
  Sparkles, 
  Music, 
  Square, 
  X,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Move,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import type { PlacedItem } from './StageCanvas';
import type { CurveObject, CurveItem } from '../utils/bezierUtils';
import { TEMPLATE_SHAPES, PERCUSSION_DATA, getPercussionInfo, getGroupedPercussionData } from '../utils/templateShapes';
import type { ItemLabelModalTarget } from './PercussionLabelModal';

interface ItemInspectorProps {
  selectedItem: PlacedItem | null;
  selectedCurve: CurveObject | null;
  selectedCurveItemId?: string | null;
  onSelectCurveItem?: (itemId: string | null) => void;
  onMoveCurveItemOrder?: (curveId: string, itemId: string, direction: 'left' | 'right') => void;
  onDeleteCurveItem?: (curveId: string, itemId: string) => void;
  selectedCount?: number;
  centerPos?: { x: number; y: number };
  onUpdateItem: (id: string, updates: Partial<PlacedItem>) => void;
  onUpdateCurve: (id: string, updates: Partial<CurveObject>) => void;
  onDuplicateItem: (id: string) => void;
  onDuplicateCurve?: (id: string) => void;
  onDuplicateSelected?: () => void;
  onDeleteItem: (id: string) => void;
  onDeleteCurve: (id: string) => void;
  onDeleteSelected?: () => void;
  onUpdateAllOfType?: (type: 'stand' | 'pianoChair', style: 'default' | 'xMark' | 'doubleCircle' | 'circlePi') => void;
  onTogglePin?: () => void;
  onMoveOrder?: (direction: 'front' | 'back' | 'forward' | 'backward') => void;
  onAlign?: (type: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom' | 'distributeH' | 'distributeV') => void;
  onOpenPercussionLabelModal?: (target: ItemLabelModalTarget) => void;
  templateReplacements?: Record<string, string>;
  pianoLidOptions?: string[];
  iconLabels?: Record<string, string>;
  extractedIcons?: { id: string; label?: string }[];
}

export const ItemInspector: React.FC<ItemInspectorProps> = ({
  selectedItem,
  selectedCurve,
  selectedCurveItemId,
  onSelectCurveItem,
  onMoveCurveItemOrder,
  onDeleteCurveItem,
  selectedCount = 0,
  centerPos,
  onUpdateItem,
  onUpdateCurve,
  onDuplicateItem,
  onDuplicateCurve,
  onDuplicateSelected,
  onDeleteItem,
  onDeleteCurve,
  onDeleteSelected,
  onUpdateAllOfType,
  onTogglePin,
  onMoveOrder,
  onAlign,
  onOpenPercussionLabelModal,
  templateReplacements,
  pianoLidOptions,
  iconLabels,
  extractedIcons,
}) => {
  const [openCurveItemSections, setOpenCurveItemSections] = useState<Record<string, boolean>>({});

  const toggleCurveItemSection = (key: string) => {
    setOpenCurveItemSections(prev => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  if (selectedCount > 1) {
    return (
      <div key="multi-selection-inspector" className="flex flex-col gap-4 p-4 text-sm liquid-glass border-l text-slate-800 dark:text-slate-100 w-64 flex-shrink-0 h-full overflow-y-auto transition-colors">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-700">
          <h3 className="font-semibold text-slate-800 dark:text-slate-100">複数選択</h3>
          <span className="text-xs font-bold text-[#007AFF] liquid-glass-pill px-2.5 py-0.5 rounded-full">
            {selectedCount} 個選択中
          </span>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          キャンバス上でまとめてドラッグ移動や回転が可能です。
        </p>
        <div className="p-3 liquid-card rounded-2xl text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
          <p className="font-semibold text-slate-700 dark:text-slate-200">ショートカット操作:</p>
          <div className="space-y-1 text-[11px]">
            <div>• <kbd className="px-1 py-0.5 bg-white dark:bg-slate-600 border border-slate-300 dark:border-slate-500 rounded font-mono text-[10px]">Ctrl</kbd>+<kbd className="px-1 py-0.5 bg-white dark:bg-slate-600 border border-slate-300 dark:border-slate-500 rounded font-mono text-[10px]">C</kbd> / <kbd className="px-1 py-0.5 bg-white dark:bg-slate-600 border border-slate-300 dark:border-slate-500 rounded font-mono text-[10px]">V</kbd>: 複製貼り付け</div>
            <div>• <kbd className="px-1 py-0.5 bg-white dark:bg-slate-600 border border-slate-300 dark:border-slate-500 rounded font-mono text-[10px]">Ctrl</kbd>+<kbd className="px-1 py-0.5 bg-white dark:bg-slate-600 border border-slate-300 dark:border-slate-500 rounded font-mono text-[10px]">D</kbd>: 複製</div>
            <div>• <kbd className="px-1.5 py-0.5 bg-white dark:bg-slate-600 border border-slate-300 dark:border-slate-500 rounded font-mono text-[10px]">Delete</kbd>: 一括削除</div>
            <div>• <kbd className="px-1.5 py-0.5 bg-white dark:bg-slate-600 border border-slate-300 dark:border-slate-500 rounded font-mono text-[10px]">矢印キー</kbd>: 微調整移動</div>
          </div>
        </div>
        {/* Align Controls */}
        {onAlign && (
          <div className="p-3 liquid-card rounded-2xl space-y-2">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              <AlignJustify className="w-3.5 h-3.5 text-[#007AFF]" />
              <span>一括整列・均等配置:</span>
            </span>
            <div className="grid grid-cols-3 gap-1 text-xs">
              <button
                type="button"
                onClick={() => onAlign('left')}
                className="py-1.5 px-1 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded font-bold text-center text-slate-700 dark:text-slate-200"
                title="左揃え"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => onAlign('centerH')}
                className="py-1.5 px-1 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded font-bold text-center text-slate-700 dark:text-slate-200"
                title="水平中央揃え"
              >
                ↔
              </button>
              <button
                type="button"
                onClick={() => onAlign('right')}
                className="py-1.5 px-1 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded font-bold text-center text-slate-700 dark:text-slate-200"
                title="右揃え"
              >
                →
              </button>
              <button
                type="button"
                onClick={() => onAlign('top')}
                className="py-1.5 px-1 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded font-bold text-center text-slate-700 dark:text-slate-200"
                title="上揃え"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => onAlign('centerV')}
                className="py-1.5 px-1 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded font-bold text-center text-slate-700 dark:text-slate-200"
                title="垂直中央揃え"
              >
                ↕
              </button>
              <button
                type="button"
                onClick={() => onAlign('bottom')}
                className="py-1.5 px-1 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded font-bold text-center text-slate-700 dark:text-slate-200"
                title="下揃え"
              >
                ↓
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1 text-xs pt-1 border-t border-slate-200 dark:border-slate-600">
              <button
                type="button"
                onClick={() => onAlign('distributeH')}
                className="py-1.5 px-1.5 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded font-bold text-center text-slate-700 dark:text-slate-200"
                title="水平等間隔に整列"
              >
                ||
              </button>
              <button
                type="button"
                onClick={() => onAlign('distributeV')}
                className="py-1.5 px-1.5 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded font-bold text-center text-slate-700 dark:text-slate-200"
                title="垂直等間隔に整列"
              >
                =
              </button>
            </div>
          </div>
        )}

        {/* Order Controls */}
        {onMoveOrder && (
          <div className="p-3 liquid-card rounded-2xl space-y-1.5">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 block">層（重なり順）:</span>
            <div className="grid grid-cols-4 gap-1 text-xs">
              <button
                type="button"
                onClick={() => onMoveOrder('forward')}
                className="py-1.5 px-1 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded font-bold text-center text-slate-700 dark:text-slate-200"
                title="1段階前面へ"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => onMoveOrder('backward')}
                className="py-1.5 px-1 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded font-bold text-center text-slate-700 dark:text-slate-200"
                title="1段階背面へ"
              >
                ▼
              </button>
              <button
                type="button"
                onClick={() => onMoveOrder('front')}
                className="py-1.5 px-1 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded font-bold text-center text-slate-700 dark:text-slate-200"
                title="最前面へ"
              >
                ⇈
              </button>
              <button
                type="button"
                onClick={() => onMoveOrder('back')}
                className="py-1.5 px-1 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded font-bold text-center text-slate-700 dark:text-slate-200"
                title="最背面へ"
              >
                ⇊
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 mt-auto">
          {onTogglePin && (
            <button
              type="button"
              onClick={onTogglePin}
              className="w-full py-2 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-600 transition-colors flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
              title="選択オブジェクトを固定/解除 (Ctrl+F)"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>固定 / 解除</span>
            </button>
          )}
          {onDuplicateSelected && (
            <button
              type="button"
              onClick={onDuplicateSelected}
              className="w-full py-2 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-600 transition-colors flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
              title="選択したオブジェクトを複製 (Ctrl+D)"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>複製</span>
            </button>
          )}
          {onDeleteSelected && (
            <button
              type="button"
              onClick={onDeleteSelected}
              className="w-full py-2.5 px-3 bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/50 text-red-600 dark:text-red-300 rounded-lg text-xs font-semibold border border-red-200 dark:border-red-800 transition-colors flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
              title="選択したアイテムを一括削除 (Delete)"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>一括削除</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  if (selectedItem && !selectedCurve) {
    const refX = centerPos?.x ?? 0;
    const refY = centerPos?.y ?? 0;

    const handleCoordChange = (field: 'x' | 'y', value: string) => {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        const base = field === 'x' ? refX : refY;
        onUpdateItem(selectedItem.id, { [field]: base + num });
      }
    };

    const handleNumberChange = (field: keyof PlacedItem, value: string) => {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        onUpdateItem(selectedItem.id, { [field]: num });
      }
    };

    const matchedTmplId = selectedItem ? templateReplacements?.[selectedItem.iconId] : undefined;
    const itemCustomLabel = iconLabels?.[selectedItem.iconId] || extractedIcons?.find(ic => ic.id === selectedItem.iconId)?.label || '';
    const isPianoByLabel = (() => {
      const norm = itemCustomLabel.trim();
      if (!norm) return false;
      if (norm.includes('椅子') || norm.includes('イス') || norm.includes('いす') || norm.includes('蓋') || norm.includes('屋根')) return false;
      return norm.includes('ピアノ') || norm.toLowerCase().includes('piano');
    })();
    const isPercussion = selectedItem.templateType === 'percussion' || matchedTmplId === 'tmpl_percussion';
    const isPiano = selectedItem.templateType === 'piano' || matchedTmplId === 'tmpl_piano' || isPianoByLabel;
    const isSymbol = selectedItem.templateType === 'symbol' ||
                     matchedTmplId === 'tmpl_symbol' ||
                     matchedTmplId?.replace(/^tmpl_/, '') === 'symbol';
    const isStand = selectedItem.templateType === 'ensembleStand' ||
                    selectedItem.templateType === 'conductorStand' ||
                    selectedItem.templateType === 'ensembleChairAndStand';
    const isPianoChair = selectedItem.templateType === 'pianoChair' ||
                         selectedItem.templateType === 'turnerChair';
    const lidChoices = pianoLidOptions && pianoLidOptions.length > 0
      ? pianoLidOptions
      : ['閉', '蒲鉾板', '半開', '全開'];

    return (
      <div
        key={`item-inspector-${selectedItem.id}`}
        className="flex flex-col gap-4 p-4 text-sm liquid-glass border-l text-slate-800 dark:text-slate-100 w-64 flex-shrink-0 h-full overflow-y-auto transition-colors"
      >
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-800 dark:text-slate-100 truncate max-w-[120px]">
              {TEMPLATE_SHAPES.find(t => t.type === selectedItem.templateType)?.label || itemCustomLabel || 'パーツ'}
            </h3>
            {onTogglePin && (
              <label className="text-[11px] text-blue-600 dark:text-blue-400 flex items-center gap-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={Boolean(selectedItem.isPinned)}
                  onChange={onTogglePin}
                  className="rounded text-blue-600 w-3.5 h-3.5"
                />
                <span>固定</span>
              </label>
            )}
          </div>
          <button
            onClick={() => onDeleteItem(selectedItem.id)}
            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded transition-colors cursor-pointer"
            title="削除"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500 font-medium">X座標</span>
            <input
              type="number"
              step="1"
              value={Math.round(selectedItem.x - refX)}
              onChange={(e) => handleCoordChange('x', e.target.value)}
              className="px-2 py-1 border border-slate-300 rounded text-sm w-full"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500 font-medium">Y座標</span>
            <input
              type="number"
              step="1"
              value={Math.round(selectedItem.y - refY)}
              onChange={(e) => handleCoordChange('y', e.target.value)}
              className="px-2 py-1 border border-slate-300 rounded text-sm w-full"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500 font-medium">幅 (W)</span>
            <input
              type="number"
              step="1"
              min="10"
              value={Math.round(selectedItem.width * (selectedItem.scaleX || 1))}
              onChange={(e) => {
                const w = parseFloat(e.target.value);
                if (!isNaN(w) && w > 0) {
                  if (isSymbol) {
                    onUpdateItem(selectedItem.id, { width: w, scaleX: 1 });
                  } else {
                    onUpdateItem(selectedItem.id, { scaleX: w / selectedItem.width });
                  }
                }
              }}
              className="px-2 py-1 border border-slate-300 rounded text-sm w-full"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500 font-medium">高さ (H)</span>
            <input
              type="number"
              step="1"
              min="10"
              value={Math.round(selectedItem.height * (selectedItem.scaleY || 1))}
              onChange={(e) => {
                const h = parseFloat(e.target.value);
                if (!isNaN(h) && h > 0) {
                  if (isSymbol) {
                    onUpdateItem(selectedItem.id, { height: h, scaleY: 1 });
                  } else {
                    onUpdateItem(selectedItem.id, { scaleY: h / selectedItem.height });
                  }
                }
              }}
              className="px-2 py-1 border border-slate-300 rounded text-sm w-full"
            />
          </label>
          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-xs text-slate-500 font-medium">回転角度 (度)</span>
            <input
              type="number"
              step="1"
              value={Math.round(selectedItem.rotation)}
              onChange={(e) => handleNumberChange('rotation', e.target.value)}
              className="px-2 py-1 border border-slate-300 rounded text-sm w-full"
            />
          </label>
        </div>

        {onMoveOrder && (
          <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-100 dark:border-slate-700">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">重なり順:</span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => onMoveOrder('forward')}
                className="w-7 h-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 rounded text-slate-700 dark:text-slate-200 text-xs font-bold border border-slate-200 dark:border-slate-600 cursor-pointer"
                title="1段階前面へ"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => onMoveOrder('backward')}
                className="w-7 h-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 rounded text-slate-700 dark:text-slate-200 text-xs font-bold border border-slate-200 dark:border-slate-600 cursor-pointer"
                title="1段階背面へ"
              >
                ▼
              </button>
            </div>
          </div>
        )}

        {isStand && (
          <div className="pt-4 border-t border-slate-100 flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-slate-700 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <span>♪</span> 譜面台アイコン表示
              </span>
              <span className="text-[10px] text-slate-400 font-normal">
                {selectedItem.customIconStyle === 'xMark' ? 'Xマーク' : '通常 (T字)'}
              </span>
            </h4>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => onUpdateItem(selectedItem.id, { customIconStyle: 'default' })}
                className={`py-2 px-2 rounded-xl text-xs font-bold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                  (selectedItem.customIconStyle || 'default') === 'default'
                    ? 'liquid-btn-primary'
                    : 'liquid-btn text-slate-700 dark:text-slate-300'
                }`}
              >
                <span className="text-sm font-black leading-none">⊥</span>
                <span className="text-[11px]">通常 (T字)</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateItem(selectedItem.id, { customIconStyle: 'xMark' })}
                className={`py-2 px-2 rounded-xl text-xs font-bold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                  selectedItem.customIconStyle === 'xMark'
                    ? 'liquid-btn-primary'
                    : 'liquid-btn text-slate-700 dark:text-slate-300'
                }`}
              >
                <span className={`text-sm font-black leading-none ${selectedItem.customIconStyle === 'xMark' ? 'text-white' : 'text-rose-600'}`}>✕</span>
                <span className="text-[11px]">Xマーク</span>
              </button>
            </div>
            {onUpdateAllOfType && (
              <button
                type="button"
                onClick={() => onUpdateAllOfType('stand', selectedItem.customIconStyle === 'xMark' ? 'xMark' : 'default')}
                className="mt-1 text-[11px] liquid-btn text-[#007AFF] hover:text-blue-700 py-1.5 px-2 rounded-full transition-colors font-medium flex items-center justify-center gap-1 cursor-pointer"
                title="ステージ上のすべての譜面台をこの表示スタイルに統一"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>すべての譜面台に一括適用</span>
              </button>
            )}
          </div>
        )}

        {/* 椅子＋譜面台 (ensembleChairAndStand) の場合の「椅子の種類」切り替え */}
        {selectedItem.templateType === 'ensembleChairAndStand' && (
          <div className="pt-4 border-t border-slate-200/60 dark:border-slate-700/60 flex flex-col gap-2.5">
            <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Square className="w-3.5 h-3.5 text-[#007AFF]" /> 椅子の種類
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">
                {selectedItem.chairType === 'pianoChairSvg'
                  ? 'ピアノ椅子 (角型)'
                  : selectedItem.chairType === 'pianoChair'
                  ? 'ピアノ椅子 (◎)'
                  : selectedItem.chairType === 'pianoChairPi'
                  ? 'ピアノ椅子 (ピ)'
                  : '合奏用椅子 (○)'}
              </span>
            </h4>

            {/* 1. 椅子の分類選択 (合奏用椅子 vs ピアノ椅子) */}
            <div>
              <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5 block">
                1. 椅子の種類を選択:
              </span>
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100/80 dark:bg-slate-800/80 rounded-xl">
                <button
                  type="button"
                  onClick={() => onUpdateItem(selectedItem.id, { chairType: 'normal' })}
                  className={`py-2 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    (selectedItem.chairType || 'normal') === 'normal'
                      ? 'liquid-btn-primary shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <span className="text-xs">○</span>
                  <span>合奏用椅子</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const currentIsPiano = selectedItem.chairType === 'pianoChair' || selectedItem.chairType === 'pianoChairSvg' || selectedItem.chairType === 'pianoChairPi';
                    const targetType = currentIsPiano ? selectedItem.chairType : 'pianoChairSvg';
                    onUpdateItem(selectedItem.id, { chairType: targetType });
                  }}
                  className={`py-2 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    selectedItem.chairType === 'pianoChair' || selectedItem.chairType === 'pianoChairSvg' || selectedItem.chairType === 'pianoChairPi'
                      ? 'liquid-btn-primary shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>ピアノ椅子</span>
                </button>
              </div>
            </div>

            {/* 2. それに連続してスタイルの選択 */}
            <div className="pt-1">
              <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5 block">
                2. 表示スタイルを選択:
              </span>
              {(selectedItem.chairType || 'normal') === 'normal' ? (
                /* 合奏用椅子のスタイル: 丸 */
                <div className="p-2.5 liquid-card rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-lg bg-[#007AFF]/15 text-[#007AFF] font-bold flex items-center justify-center text-sm shadow-2xs">
                      ○
                    </span>
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">丸 (○)</span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">通常の合奏用丸椅子として表示・集計</span>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-[#007AFF] bg-[#007AFF]/10 px-2 py-0.5 rounded-full">選択中</span>
                </div>
              ) : (
                /* ピアノ椅子のスタイル: ピアノ椅子の画像 か 二重丸 か 丸の中にピ */
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => onUpdateItem(selectedItem.id, { chairType: 'pianoChairSvg' })}
                    className={`py-2 px-1 rounded-xl text-xs font-bold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                      selectedItem.chairType === 'pianoChairSvg'
                        ? 'liquid-btn-primary shadow-xs'
                        : 'liquid-btn text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <Square className="w-4 h-4" />
                    <span className="text-[10px]">画像</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateItem(selectedItem.id, { chairType: 'pianoChair' })}
                    className={`py-2 px-1 rounded-xl text-xs font-bold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                      selectedItem.chairType === 'pianoChair'
                        ? 'liquid-btn-primary shadow-xs'
                        : 'liquid-btn text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <span className={`font-black text-sm leading-none ${selectedItem.chairType === 'pianoChair' ? 'text-white' : 'text-emerald-600'}`}>◎</span>
                    <span className="text-[10px]">二重丸 (◎)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateItem(selectedItem.id, { chairType: 'pianoChairPi' })}
                    className={`py-2 px-1 rounded-xl text-xs font-bold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                      selectedItem.chairType === 'pianoChairPi'
                        ? 'liquid-btn-primary shadow-xs'
                        : 'liquid-btn text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <span className={`w-4 h-4 rounded-full border border-current flex items-center justify-center font-bold text-[10px] leading-none ${selectedItem.chairType === 'pianoChairPi' ? 'text-white' : 'text-amber-600 dark:text-amber-400'}`}>ピ</span>
                    <span className="text-[10px]">丸ピ (ピ)</span>
                  </button>
                </div>
              )}
            </div>

            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
              {(selectedItem.chairType || 'normal') === 'normal'
                ? '※ 提出書類の集計欄では「合奏用椅子」として自動カウントされます。'
                : '※「ピアノ椅子画像」「二重丸」「丸ピ」を選択すると、提出書類の集計欄でも「ピアノ椅子」として自動カウントされます。'}
            </p>
          </div>
        )}

        {isPianoChair && (
          <div className="pt-4 border-t border-slate-100 flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-slate-700 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Square className="w-3.5 h-3.5 text-[#007AFF]" /> ピアノ椅子表示
              </span>
              <span className="text-[10px] text-slate-400 font-normal">
                {selectedItem.customIconStyle === 'doubleCircle'
                  ? '二重丸 (◎)'
                  : selectedItem.customIconStyle === 'circlePi'
                  ? '丸ピ (ピ)'
                  : '通常'}
              </span>
            </h4>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => onUpdateItem(selectedItem.id, { customIconStyle: 'default' })}
                className={`py-2 px-1 rounded-xl text-xs font-bold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                  (selectedItem.customIconStyle || 'default') === 'default'
                    ? 'liquid-btn-primary'
                    : 'liquid-btn text-slate-700 dark:text-slate-300'
                }`}
              >
                <Square className="w-3.5 h-3.5" />
                <span className="text-[10px]">通常椅子</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateItem(selectedItem.id, { customIconStyle: 'doubleCircle' })}
                className={`py-2 px-1 rounded-xl text-xs font-bold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                  selectedItem.customIconStyle === 'doubleCircle'
                    ? 'liquid-btn-primary'
                    : 'liquid-btn text-slate-700 dark:text-slate-300'
                }`}
              >
                <span className={`text-sm font-black leading-none ${selectedItem.customIconStyle === 'doubleCircle' ? 'text-white' : 'text-emerald-600'}`}>◎</span>
                <span className="text-[10px]">二重丸 (◎)</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateItem(selectedItem.id, { customIconStyle: 'circlePi' })}
                className={`py-2 px-1 rounded-xl text-xs font-bold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                  selectedItem.customIconStyle === 'circlePi'
                    ? 'liquid-btn-primary'
                    : 'liquid-btn text-slate-700 dark:text-slate-300'
                }`}
              >
                <span className={`w-4 h-4 rounded-full border border-current flex items-center justify-center font-bold text-[10px] leading-none ${selectedItem.customIconStyle === 'circlePi' ? 'text-white' : 'text-amber-600 dark:text-amber-400'}`}>ピ</span>
                <span className="text-[10px]">丸ピ (ピ)</span>
              </button>
            </div>
            {onUpdateAllOfType && (
              <button
                type="button"
                onClick={() => onUpdateAllOfType('pianoChair', selectedItem.customIconStyle || 'default')}
                className="mt-1 text-[11px] liquid-btn text-[#007AFF] hover:text-blue-700 py-1.5 px-2 rounded-full transition-colors font-medium flex items-center justify-center gap-1 cursor-pointer"
                title="ステージ上のすべてのピアノ椅子をこの表示スタイルに統一"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>すべてのピアノ椅子に一括適用</span>
              </button>
            )}
          </div>
        )}

        {isPercussion && (
          <div className="pt-4 border-t border-slate-100 flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-slate-700 flex items-center gap-1">
              <span>●</span> パーカッション設定
            </h4>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500 font-medium">楽器種類</span>
              <select
                value={selectedItem.percussionType || PERCUSSION_DATA[0].dropdownName}
                onChange={(e) => {
                  const newType = e.target.value;
                  const pData = PERCUSSION_DATA.find(p => p.dropdownName === newType);
                  if (pData) {
                    const newW = Math.round((pData.defaultW || 1.34) * 30);
                    const newH = Math.round((pData.defaultH || 1.34) * 30);
                    onUpdateItem(selectedItem.id, {
                      percussionType: newType,
                      width: newW,
                      height: newH,
                    });
                  } else {
                    onUpdateItem(selectedItem.id, { percussionType: newType });
                  }
                }}
                className="px-2 py-1.5 border border-slate-300 rounded text-sm bg-white"
              >
                {getGroupedPercussionData().map(group => (
                  <optgroup key={group.category} label={group.category}>
                    {group.items.map(p => (
                      <option key={p.dropdownName} value={p.dropdownName}>{p.dropdownName} ({p.canvasName})</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 mt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedItem.showPercussionName !== false}
                onChange={(e) => onUpdateItem(selectedItem.id, { showPercussionName: e.target.checked })}
                className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4"
              />
              <span className="text-xs text-slate-600 font-medium">名前をキャンバスに表示</span>
            </label>

            {selectedItem.showPercussionName !== false && onOpenPercussionLabelModal && (
              <button
                type="button"
                onClick={() => {
                  const percInfo = getPercussionInfo(selectedItem.percussionType);
                  const targetAspect = percInfo ? (percInfo.defaultW || 1.34) / (percInfo.defaultH || 1.34) : 1;
                  const currentAspect = selectedItem.width / selectedItem.height;
                  const effW = Math.abs(currentAspect - targetAspect) > 0.25 ? Math.round(selectedItem.height * targetAspect) : selectedItem.width;
                  const effH = selectedItem.height;
                  onOpenPercussionLabelModal({
                    type: 'placedItem',
                    itemId: selectedItem.id,
                    targetType: 'percussion',
                    canvasName: percInfo?.canvasName || selectedItem.percussionType || '打楽器',
                    percussionType: selectedItem.percussionType || 'ティンパニ',
                    initialText: percInfo?.canvasName || '',
                    width: effW,
                    height: effH,
                    color: selectedItem.color,
                    currentOffsetX: selectedItem.labelOffsetX || 0,
                    currentOffsetY: selectedItem.labelOffsetY || 0,
                    currentRotation: selectedItem.labelRotation || 0,
                    currentFontSize: selectedItem.labelFontSize,
                    currentLetterSpacing: selectedItem.labelLetterSpacing || 0,
                    isVertical: Boolean(selectedItem.isVerticalName),
                    showPercussionName: selectedItem.showPercussionName !== false,
                  });
                }}
                className="mt-1 py-1.5 px-2.5 rounded-xl text-xs font-semibold liquid-btn text-[#007AFF] hover:text-blue-700 flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs hover:scale-101 active:scale-99"
              >
                <Move className="w-3.5 h-3.5" />
                <span>名前の位置・回転・サイズを設定...</span>
              </button>
            )}
          </div>
        )}

        {isPiano && (
          <div className="pt-4 border-t border-slate-100 dark:border-slate-700 flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              <Music className="w-3.5 h-3.5 text-[#007AFF]" />
              <span>ピアノ設定（蓋の状態）</span>
            </h4>
            <div className="grid grid-cols-2 gap-1.5">
              {lidChoices.map((opt) => {
                const currentVal = selectedItem.pianoLidState || lidChoices[0] || '全開';
                const isActive = currentVal === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => onUpdateItem(selectedItem.id, { pianoLidState: opt })}
                    className={`py-1.5 px-2 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                      isActive
                        ? 'bg-[#007AFF] text-white border-[#007AFF] shadow-2xs'
                        : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-600 hover:border-[#007AFF]/50'
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {isSymbol && (
          <div className="pt-4 border-t border-slate-100 dark:border-slate-700 flex flex-col gap-3">
            <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1">
              <span>◇</span> 記号の設定
            </h4>

            {/* 形状選択 */}
            <div className="flex flex-col gap-1">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">図形の形状</span>
              <div className="grid grid-cols-4 gap-1">
                {[
                  { shape: 'circle', label: '○ 丸' },
                  { shape: 'cross', label: '✕ バツ' },
                  { shape: 'rect', label: '□ 四角' },
                  { shape: 'triangle', label: '△ 三角' },
                ].map(({ shape, label }) => {
                  const active = (selectedItem.symbolShape || 'circle') === shape;
                  return (
                    <button
                      key={shape}
                      type="button"
                      onClick={() => onUpdateItem(selectedItem.id, { symbolShape: shape as any })}
                      className={`py-1.5 px-1 text-xs rounded-xl text-center transition-all cursor-pointer ${
                        active
                          ? 'liquid-btn-primary'
                          : 'liquid-btn text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 塗りつぶしの有無 */}
            <div className="flex flex-col gap-1">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">塗りつぶし</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onUpdateItem(selectedItem.id, { symbolFilled: false })}
                  className={`py-1.5 px-2 text-xs rounded-xl text-center transition-all cursor-pointer ${
                    !selectedItem.symbolFilled
                      ? 'liquid-btn-primary'
                      : 'liquid-btn text-slate-700 dark:text-slate-300'
                  }`}
                >
                  □ 枠線のみ
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateItem(selectedItem.id, { symbolFilled: true })}
                  className={`py-1.5 px-2 text-xs rounded-xl text-center transition-all cursor-pointer ${
                    selectedItem.symbolFilled
                      ? 'liquid-btn-primary'
                      : 'liquid-btn text-slate-700 dark:text-slate-300'
                  }`}
                >
                  ■ 塗りつぶし
                </button>
              </div>
            </div>

            {/* 枠内の文字 */}
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">枠内の文字（Wクリックでも編集可）</span>
              <input
                type="text"
                value={selectedItem.symbolText || ''}
                onChange={(e) => onUpdateItem(selectedItem.id, { symbolText: e.target.value })}
                placeholder="例: A, 1, Solo, 譜 等"
                className="px-2.5 py-1.5 border border-slate-300 dark:border-slate-600 rounded text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </label>

            {/* 文字サイズ */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">文字サイズ</span>
                <span className="text-xs text-slate-400 font-mono">{selectedItem.symbolFontSize || 16}px</span>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {[12, 16, 20, 24].map((sz) => {
                  const active = (selectedItem.symbolFontSize || 16) === sz;
                  return (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => onUpdateItem(selectedItem.id, { symbolFontSize: sz })}
                      className={`py-1 text-xs rounded-xl text-center transition-all cursor-pointer ${
                        active
                          ? 'liquid-btn-primary'
                          : 'liquid-btn text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {sz}px
                    </button>
                  );
                })}
              </div>
              <input
                type="range"
                min={8}
                max={36}
                value={selectedItem.symbolFontSize || 16}
                onChange={(e) => onUpdateItem(selectedItem.id, { symbolFontSize: Number(e.target.value) })}
                className="w-full mt-1 accent-blue-600"
              />
            </div>

            {onOpenPercussionLabelModal && (
              <button
                type="button"
                onClick={() => {
                  onOpenPercussionLabelModal({
                    type: 'placedItem',
                    itemId: selectedItem.id,
                    targetType: 'symbol',
                    canvasName: '記号テキスト',
                    symbolShape: selectedItem.symbolShape || 'circle',
                    symbolFilled: Boolean(selectedItem.symbolFilled),
                    initialText: selectedItem.symbolText || '',
                    width: selectedItem.width,
                    height: selectedItem.height,
                    color: selectedItem.color,
                    currentOffsetX: selectedItem.labelOffsetX || 0,
                    currentOffsetY: selectedItem.labelOffsetY || 0,
                    currentRotation: selectedItem.labelRotation || 0,
                    currentFontSize: selectedItem.labelFontSize || selectedItem.symbolFontSize,
                    currentLetterSpacing: selectedItem.labelLetterSpacing || 0,
                    isVertical: Boolean(selectedItem.isVerticalName),
                  });
                }}
                className="mt-1 py-1.5 px-2.5 rounded-xl text-xs font-semibold liquid-btn text-[#007AFF] hover:text-blue-700 flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs hover:scale-101 active:scale-99"
              >
                <Move className="w-3.5 h-3.5" />
                <span>文字の位置・回転・サイズを設定...</span>
              </button>
            )}
          </div>
        )}

        <div className="pt-4 mt-auto">
          <button
            onClick={() => onDuplicateItem(selectedItem.id)}
            className="w-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
            title="複製 (Ctrl+D)"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>複製</span>
          </button>
        </div>
      </div>
    );
  }

  if (selectedCurve) {
    const refX = centerPos?.x ?? 0;
    const refY = centerPos?.y ?? 0;

    const handleCurveCoordChange = (field: 'x' | 'y', value: string) => {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        const base = field === 'x' ? refX : refY;
        onUpdateCurve(selectedCurve.id, { [field]: base + num });
      }
    };

    const isPercussion = selectedCurve.itemType === 'percussion';



    return (
      <div
        key={`curve-inspector-${selectedCurve.id}`}
        className="flex flex-col gap-4 p-4 text-sm liquid-glass border-l text-slate-800 dark:text-slate-100 w-64 flex-shrink-0 h-full overflow-y-auto transition-colors"
      >
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-800 dark:text-slate-100">
              ベジェ曲線 設定
            </h3>
            {onTogglePin && (
              <label className="text-[11px] text-blue-600 dark:text-blue-400 flex items-center gap-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={Boolean(selectedCurve.isPinned)}
                  onChange={onTogglePin}
                  className="rounded text-blue-600 w-3.5 h-3.5"
                />
                <span>固定</span>
              </label>
            )}
          </div>
          <button
            onClick={() => onDeleteCurve(selectedCurve.id)}
            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded transition-colors cursor-pointer"
            title="曲線を削除"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* Coordinates (X, Y) relative to center */}
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500 font-medium">X座標</span>
            <input
              type="number"
              step="1"
              value={Math.round(selectedCurve.x - refX)}
              onChange={(e) => handleCurveCoordChange('x', e.target.value)}
              className="px-2 py-1 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 rounded text-sm w-full font-mono"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500 font-medium">Y座標</span>
            <input
              type="number"
              step="1"
              value={Math.round(selectedCurve.y - refY)}
              onChange={(e) => handleCurveCoordChange('y', e.target.value)}
              className="px-2 py-1 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 rounded text-sm w-full font-mono"
            />
          </label>
        </div>

        {/* Rotation Controls */}
        <div className="flex flex-col gap-1.5 p-2.5 bg-slate-50/70 dark:bg-slate-800/50 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
              <RotateCw className="w-3.5 h-3.5 text-[#007AFF]" />
              回転角度
            </span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="1"
                min="-360"
                max="360"
                value={Math.round(selectedCurve.rotation || 0)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) {
                    let norm = Math.round(val % 360);
                    if (norm < 0) norm += 360;
                    onUpdateCurve(selectedCurve.id, { rotation: norm });
                  }
                }}
                className="w-16 px-1.5 py-0.5 text-xs border border-slate-300 dark:border-slate-600 dark:bg-slate-700 rounded text-right font-mono"
              />
              <span className="text-xs text-slate-500 dark:text-slate-400">度</span>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-0.5">
            <input
              type="range"
              min="0"
              max="360"
              step="1"
              value={Math.round(((selectedCurve.rotation || 0) % 360 + 360) % 360)}
              onChange={(e) => {
                onUpdateCurve(selectedCurve.id, { rotation: parseFloat(e.target.value) });
              }}
              className="w-full accent-[#007AFF] cursor-pointer"
            />
          </div>

          {/* Quick Rotation Buttons */}
          <div className="grid grid-cols-5 gap-1 pt-0.5">
            {[
              { label: '-90°', delta: -90 },
              { label: '-15°', delta: -15 },
              { label: '0°', reset: 0 },
              { label: '+15°', delta: 15 },
              { label: '+90°', delta: 90 },
            ].map((btn, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  if (btn.reset !== undefined) {
                    onUpdateCurve(selectedCurve.id, { rotation: 0 });
                  } else if (btn.delta !== undefined) {
                    const cur = selectedCurve.rotation || 0;
                    let next = Math.round((cur + btn.delta) % 360);
                    if (next < 0) next += 360;
                    onUpdateCurve(selectedCurve.id, { rotation: next });
                  }
                }}
                className={`py-1 rounded text-[11px] font-mono font-medium transition-all cursor-pointer ${
                  btn.reset !== undefined && (selectedCurve.rotation || 0) === 0
                    ? 'liquid-btn-primary shadow-xs'
                    : 'liquid-btn text-slate-700 dark:text-slate-300 hover:text-slate-900'
                }`}
                title={btn.reset !== undefined ? '角度を0°にリセット' : `${btn.label} 回転`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {/* Order Controls */}
        {onMoveOrder && (
          <div className="p-3 liquid-card rounded-2xl space-y-1.5">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 block">層（重なり順）:</span>
            <div className="grid grid-cols-4 gap-1 text-xs">
              <button
                type="button"
                onClick={() => onMoveOrder('forward')}
                className="py-1.5 px-1 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded font-bold text-center text-slate-700 dark:text-slate-200"
                title="1段階前面へ"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => onMoveOrder('backward')}
                className="py-1.5 px-1 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded font-bold text-center text-slate-700 dark:text-slate-200"
                title="1段階背面へ"
              >
                ▼
              </button>
              <button
                type="button"
                onClick={() => onMoveOrder('front')}
                className="py-1.5 px-1 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded font-bold text-center text-slate-700 dark:text-slate-200"
                title="最前面へ"
              >
                ⇈
              </button>
              <button
                type="button"
                onClick={() => onMoveOrder('back')}
                className="py-1.5 px-1 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded font-bold text-center text-slate-700 dark:text-slate-200"
                title="最背面へ"
              >
                ⇊
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {Array.isArray(selectedCurve.items) ? (() => {
            const curveItems = selectedCurve.items || [];
            const activeItemIndex = selectedCurveItemId ? curveItems.findIndex(it => it.id === selectedCurveItemId) : -1;
            const activeItem = activeItemIndex >= 0 ? curveItems[activeItemIndex] : null;

            const isEnsembleChairAndStand = (it?: CurveItem | null) => {
              if (!it) return false;
              const t = it.type || '';
              return t === 'ensembleChairAndStand' ||
                Boolean(it.label && (it.label.includes('椅子') || it.label.includes('イス')) && (it.label.includes('譜面台') || it.label.includes('スタンド')));
            };

            const isPianoChairItem = (it?: CurveItem | null) => {
              if (!it) return false;
              if (isEnsembleChairAndStand(it)) return false;
              const t = it.type || '';
              return t === 'pianoChair' ||
                t === 'turnerChair' ||
                Boolean(it.label && (it.label.includes('ピアノ') && (it.label.includes('椅子') || it.label.includes('イス'))));
            };

            const isStandItem = (it?: CurveItem | null) => {
              if (!it) return false;
              const t = it.type || '';
              return t === 'ensembleStand' ||
                t === 'conductorStand' ||
                t === 'ensembleChairAndStand' ||
                t.includes('Stand') ||
                Boolean(it.label && (it.label.includes('譜面台') || it.label.includes('スタンド')));
            };

            const handleUpdateItemGap = (itemId: string, newGap: number | undefined) => {
              const nextItems = curveItems.map(it => {
                if (it.id === itemId) {
                  const copy = { ...it };
                  if (newGap === undefined) {
                    delete copy.gap;
                  } else {
                    copy.gap = Math.max(0, newGap);
                  }
                  return copy;
                }
                return it;
              });
              onUpdateCurve(selectedCurve.id, { items: nextItems });
            };

            return (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    曲線上のアイテム ({curveItems.length})
                  </span>
                  {curveItems.length > 0 && (
                    <button
                      onClick={() => {
                        onSelectCurveItem?.(null);
                        onUpdateCurve(selectedCurve.id, { items: [], itemCount: 0 });
                      }}
                      className="text-[11px] text-red-600 hover:text-red-700 hover:underline cursor-pointer"
                    >
                      全クリア
                    </button>
                  )}
                </div>

                {/* 選択中アイテムの個別間隔設定パネル */}
                {activeItem && (
                  <div className="p-2.5 bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-lg flex flex-col gap-2 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0"></span>
                        <span className="text-xs font-bold text-blue-900 dark:text-blue-200 truncate">
                          選択中: {activeItemIndex + 1}. {activeItem.label || activeItem.type}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (onDeleteCurveItem) {
                              onDeleteCurveItem(selectedCurve.id, activeItem.id);
                            } else {
                              const next = curveItems.filter(it => it.id !== activeItem.id);
                              onSelectCurveItem?.(null);
                              onUpdateCurve(selectedCurve.id, { items: next, itemCount: next.length });
                            }
                          }}
                          className="p-1 rounded text-red-500 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-500/10 cursor-pointer transition-colors"
                          title="このオブジェクトを曲線から削除 (Deleteキー)"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onSelectCurveItem?.(null)}
                          className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline shrink-0 cursor-pointer"
                        >
                          選択解除
                        </button>
                      </div>
                    </div>

                    {/* 左右への順序移動ボタン */}
                    <div className="flex items-center justify-between pt-1.5 border-t border-blue-200/70 dark:border-blue-800/70">
                      <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        並び順を移動:
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={activeItemIndex <= 0}
                          onClick={() => onMoveCurveItemOrder?.(selectedCurve.id, activeItem.id, 'left')}
                          className="w-8 h-7 text-xs font-semibold rounded-lg liquid-btn text-slate-700 dark:text-slate-200 disabled:opacity-35 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer transition-all hover:scale-105 active:scale-95"
                          title="左隣（始点側）へ移動 ([ または Alt+←])"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={activeItemIndex >= curveItems.length - 1}
                          onClick={() => onMoveCurveItemOrder?.(selectedCurve.id, activeItem.id, 'right')}
                          className="w-8 h-7 text-xs font-semibold rounded-lg liquid-btn text-slate-700 dark:text-slate-200 disabled:opacity-35 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer transition-all hover:scale-105 active:scale-95"
                          title="右隣（終点側）へ移動 (] または Alt+→)"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* 右隣との間隔 */}
                    <div className="pt-1.5 border-t border-blue-200/70 dark:border-blue-800/70">
                      <button
                        type="button"
                        onClick={() => toggleCurveItemSection('gap')}
                        className="w-full flex items-center justify-between text-left py-1 px-1 rounded-lg hover:bg-blue-100/50 dark:hover:bg-blue-900/40 transition-colors cursor-pointer group"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-blue-500 group-hover:text-blue-600 transition-colors">
                            {openCurveItemSections['gap'] ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          </span>
                          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                            {activeItemIndex === curveItems.length - 1 ? '右の間隔（曲線の終点側）' : '右隣との間隔'}
                          </span>
                        </div>
                        <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-white/80 dark:bg-slate-800/80 border border-blue-200/60 dark:border-blue-700/60 text-blue-800 dark:text-blue-200 font-semibold shadow-2xs">
                          {Math.round(activeItem.gap !== undefined ? activeItem.gap : selectedCurve.itemGap)}px
                        </span>
                      </button>

                      {openCurveItemSections['gap'] && (
                        <div className="mt-2 space-y-2 pl-1 pr-1 pb-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                              個別間隔の微調整
                            </span>
                            {activeItem.gap !== undefined && (
                              <button
                                onClick={() => handleUpdateItemGap(activeItem.id, undefined)}
                                className="text-[10px] text-slate-500 hover:text-blue-700 dark:text-slate-400 dark:hover:text-blue-300 underline cursor-pointer"
                                title="曲線全体の標準間隔に戻す"
                              >
                                標準 ({Math.round(selectedCurve.itemGap)}px) に戻す
                              </button>
                            )}
                          </div>

                          <div className="flex items-center justify-between gap-1 w-full min-w-0">
                            <div className="flex items-center gap-1 shrink-0">
                              <input
                                type="number"
                                min="0"
                                max="500"
                                value={Math.round(activeItem.gap !== undefined ? activeItem.gap : selectedCurve.itemGap)}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value);
                                  if (!isNaN(val) && val >= 0) {
                                    handleUpdateItemGap(activeItem.id, val);
                                  }
                                }}
                                className="w-12 px-1 py-0.5 text-xs border border-blue-300 dark:border-blue-700 rounded bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 font-mono text-right"
                              />
                              <span className="text-[11px] text-slate-500 dark:text-slate-400">px</span>
                            </div>
                            <div className="flex items-center gap-0.5 shrink-0">
                              {[-5, -1, 1, 5].map((delta) => (
                                <button
                                  key={delta}
                                  type="button"
                                  onClick={() => {
                                    const cur = activeItem.gap !== undefined ? activeItem.gap : selectedCurve.itemGap;
                                    handleUpdateItemGap(activeItem.id, Math.max(0, cur + delta));
                                  }}
                                  className="w-[23px] h-5.5 flex items-center justify-center text-[10px] font-mono bg-white dark:bg-slate-700 border border-blue-200 dark:border-blue-700 rounded hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-800 dark:text-blue-200 shadow-2xs cursor-pointer"
                                >
                                  {delta > 0 ? `+${delta}` : delta}
                                </button>
                              ))}
                            </div>
                          </div>

                          <input
                            type="range"
                            min="0"
                            max="200"
                            value={Math.round(activeItem.gap !== undefined ? activeItem.gap : selectedCurve.itemGap)}
                            onChange={(e) => handleUpdateItemGap(activeItem.id, parseFloat(e.target.value))}
                            className="w-full accent-blue-600 mt-0.5 cursor-pointer"
                          />

                          {activeItemIndex === curveItems.length - 1 && (
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                              ※ 右端のオブジェクトの右側に空ける間隔（余白）としてキャンバス上に直接反映されます
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* 合奏用椅子＋譜面台 (ensembleChairAndStand) の時だけ表示する「椅子の種類」設定 */}
                    {isEnsembleChairAndStand(activeItem) && (() => {
                      const activeChairType: 'normal' | 'pianoChair' | 'pianoChairSvg' | 'pianoChairPi' =
                        activeItem.chairType || selectedCurve.chairType || 'normal';

                      const handleUpdateActiveChairType = (targetType: 'normal' | 'pianoChair' | 'pianoChairSvg' | 'pianoChairPi') => {
                        const nextItems = curveItems.map(it => {
                          if (it.id === activeItem.id) {
                            return { ...it, chairType: targetType };
                          }
                          return it;
                        });
                        onUpdateCurve(selectedCurve.id, {
                          items: nextItems,
                        });
                      };

                      const handleApplyToAllCurveChairs = () => {
                        const targetType = activeItem.chairType || selectedCurve.chairType || 'normal';
                        const nextItems = curveItems.map(it => {
                          if (isEnsembleChairAndStand(it)) {
                            return { ...it, chairType: targetType };
                          }
                          return it;
                        });
                        onUpdateCurve(selectedCurve.id, {
                          chairType: targetType,
                          items: nextItems,
                        });
                      };

                      return (
                        <div className="pt-1.5 border-t border-blue-200/70 dark:border-blue-800/70">
                          <button
                            type="button"
                            onClick={() => toggleCurveItemSection('chairType')}
                            className="w-full flex items-center justify-between text-left py-1 px-1 rounded-lg hover:bg-blue-100/50 dark:hover:bg-blue-900/40 transition-colors cursor-pointer group"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-blue-500 group-hover:text-blue-600 transition-colors">
                                {openCurveItemSections['chairType'] ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                              </span>
                              <Square className="w-3.5 h-3.5 text-[#007AFF] shrink-0" />
                              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                                椅子の種類設定
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal shrink-0">
                              {activeChairType === 'pianoChairSvg'
                                ? 'ピアノ椅子 (画像)'
                                : activeChairType === 'pianoChair'
                                ? 'ピアノ椅子 (◎)'
                                : activeChairType === 'pianoChairPi'
                                ? 'ピアノ椅子 (ピ)'
                                : '合奏用椅子 (○)'}
                            </span>
                          </button>

                          {openCurveItemSections['chairType'] && (
                            <div className="mt-2 space-y-2.5 pl-1 pr-1 pb-1">
                              {/* 1. 椅子の分類選択 (合奏用椅子 vs ピアノ椅子) */}
                              <div>
                                <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 mb-1 block">
                                  1. 椅子の種類
                                </span>
                                <div className="grid grid-cols-2 gap-1 p-0.5 bg-white/70 dark:bg-slate-800/70 border border-blue-200/60 dark:border-blue-800/60 rounded-xl">
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateActiveChairType('normal')}
                                    className={`py-1.5 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                                      activeChairType === 'normal'
                                        ? 'liquid-btn-primary shadow-xs'
                                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                  >
                                    <span className="text-xs">○</span>
                                    <span>合奏用椅子</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const isPiano = activeChairType === 'pianoChair' || activeChairType === 'pianoChairSvg' || activeChairType === 'pianoChairPi';
                                      const targetType = isPiano ? activeChairType : 'pianoChairSvg';
                                      handleUpdateActiveChairType(targetType);
                                    }}
                                    className={`py-1.5 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                                      activeChairType === 'pianoChair' || activeChairType === 'pianoChairSvg' || activeChairType === 'pianoChairPi'
                                        ? 'liquid-btn-primary shadow-xs'
                                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                  >
                                    <Square className="w-3.5 h-3.5" />
                                    <span>ピアノ椅子</span>
                                  </button>
                                </div>
                              </div>

                              {/* 2. それに連続して表示スタイルの選択 */}
                              <div>
                                <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 mb-1 block">
                                  2. 表示スタイル
                                </span>
                                {activeChairType === 'normal' ? (
                                  <div className="p-2 liquid-card rounded-xl flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <span className="w-6 h-6 rounded-lg bg-[#007AFF]/15 text-[#007AFF] font-bold flex items-center justify-center text-xs shadow-2xs">
                                        ○
                                      </span>
                                      <div className="flex flex-col">
                                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">丸 (○)</span>
                                        <span className="text-[10px] text-slate-500 dark:text-slate-400">通常の合奏用丸椅子として表示・集計</span>
                                      </div>
                                    </div>
                                    <span className="text-[11px] font-bold text-[#007AFF] bg-[#007AFF]/10 px-2 py-0.5 rounded-full">選択中</span>
                                  </div>
                                ) : (
                                  <div className="grid grid-cols-3 gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => handleUpdateActiveChairType('pianoChairSvg')}
                                      className={`py-2 px-1 rounded-xl text-xs font-bold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                                        activeChairType === 'pianoChairSvg'
                                          ? 'liquid-btn-primary shadow-xs'
                                          : 'liquid-btn text-slate-700 dark:text-slate-300'
                                      }`}
                                    >
                                      <Square className="w-3.5 h-3.5" />
                                      <span className="text-[10px]">画像</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleUpdateActiveChairType('pianoChair')}
                                      className={`py-2 px-1 rounded-xl text-xs font-bold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                                        activeChairType === 'pianoChair'
                                          ? 'liquid-btn-primary shadow-xs'
                                          : 'liquid-btn text-slate-700 dark:text-slate-300'
                                      }`}
                                    >
                                      <span className={`font-black text-xs leading-none ${activeChairType === 'pianoChair' ? 'text-white' : 'text-emerald-600'}`}>◎</span>
                                      <span className="text-[10px]">二重丸 (◎)</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleUpdateActiveChairType('pianoChairPi')}
                                      className={`py-2 px-1 rounded-xl text-xs font-bold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                                        activeChairType === 'pianoChairPi'
                                          ? 'liquid-btn-primary shadow-xs'
                                          : 'liquid-btn text-slate-700 dark:text-slate-300'
                                      }`}
                                    >
                                      <span className={`w-4 h-4 rounded-full border border-current flex items-center justify-center font-bold text-[10px] leading-none ${activeChairType === 'pianoChairPi' ? 'text-white' : 'text-amber-600 dark:text-amber-400'}`}>ピ</span>
                                      <span className="text-[10px]">丸ピ (ピ)</span>
                                    </button>
                                  </div>
                                )}
                              </div>

                              {/* 全てに適応ボタン (ベジェ上のみ) */}
                              <button
                                type="button"
                                onClick={handleApplyToAllCurveChairs}
                                className="w-full mt-0.5 py-1.5 px-2.5 rounded-xl text-xs font-semibold liquid-btn text-[#007AFF] hover:text-blue-700 dark:text-sky-400 dark:hover:text-sky-300 flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs hover:scale-[1.01] active:scale-[0.99]"
                                title="このベジェ曲線上のすべての合奏用椅子・譜面台をこの設定に一括適用します"
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                                <span>この曲線のすべての合奏用椅子・譜面台に適用</span>
                              </button>

                              <p className="text-[9.5px] text-slate-500 dark:text-slate-400 leading-tight">
                                {activeChairType === 'normal'
                                  ? '※ この椅子は「合奏用椅子」として自動カウントされます。'
                                  : '※ この椅子は「ピアノ椅子」として自動カウントされます。'}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* ピアノ椅子単体の場合: 通常オブジェクトと同様の「ピアノ椅子表示 (通常椅子 vs 二重丸 vs 丸ピ)」 */}
                    {isPianoChairItem(activeItem) && (() => {
                      const activeIconStyle: 'default' | 'doubleCircle' | 'circlePi' =
                        activeItem.customIconStyle === 'doubleCircle'
                          ? 'doubleCircle'
                          : activeItem.customIconStyle === 'circlePi'
                          ? 'circlePi'
                          : activeItem.customIconStyle === 'default'
                          ? 'default'
                          : selectedCurve.customIconStyle === 'doubleCircle'
                          ? 'doubleCircle'
                          : selectedCurve.customIconStyle === 'circlePi'
                          ? 'circlePi'
                          : 'default';

                      const handleUpdateActivePianoChairStyle = (targetStyle: 'default' | 'doubleCircle' | 'circlePi') => {
                        const nextItems = curveItems.map(it => {
                          if (it.id === activeItem.id) {
                            return { ...it, customIconStyle: targetStyle };
                          }
                          return it;
                        });
                        onUpdateCurve(selectedCurve.id, {
                          items: nextItems,
                        });
                      };

                      const handleApplyToAllCurvePianoChairs = () => {
                        const targetStyle = activeIconStyle;
                        const nextItems = curveItems.map(it => {
                          if (isPianoChairItem(it)) {
                            return { ...it, customIconStyle: targetStyle };
                          }
                          return it;
                        });
                        onUpdateCurve(selectedCurve.id, {
                          items: nextItems,
                        });
                      };

                      return (
                        <div className="pt-1.5 border-t border-blue-200/70 dark:border-blue-800/70">
                          <button
                            type="button"
                            onClick={() => toggleCurveItemSection('pianoChairStyle')}
                            className="w-full flex items-center justify-between text-left py-1 px-1 rounded-lg hover:bg-blue-100/50 dark:hover:bg-blue-900/40 transition-colors cursor-pointer group"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-blue-500 group-hover:text-blue-600 transition-colors">
                                {openCurveItemSections['pianoChairStyle'] ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                              </span>
                              <Square className="w-3.5 h-3.5 text-[#007AFF] shrink-0" />
                              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                                ピアノ椅子表示
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal shrink-0">
                              {activeIconStyle === 'doubleCircle'
                                ? '二重丸 (◎)'
                                : activeIconStyle === 'circlePi'
                                ? '丸ピ (ピ)'
                                : '通常'}
                            </span>
                          </button>

                          {openCurveItemSections['pianoChairStyle'] && (
                            <div className="mt-2 space-y-2 pl-1 pr-1 pb-1">
                              <div className="grid grid-cols-3 gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleUpdateActivePianoChairStyle('default')}
                                  className={`py-2 px-1 rounded-xl text-xs font-bold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                                    activeIconStyle === 'default'
                                      ? 'liquid-btn-primary shadow-xs'
                                      : 'liquid-btn text-slate-700 dark:text-slate-300'
                                  }`}
                                >
                                  <Square className="w-3.5 h-3.5" />
                                  <span className="text-[10px]">通常椅子</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateActivePianoChairStyle('doubleCircle')}
                                  className={`py-2 px-1 rounded-xl text-xs font-bold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                                    activeIconStyle === 'doubleCircle'
                                      ? 'liquid-btn-primary shadow-xs'
                                      : 'liquid-btn text-slate-700 dark:text-slate-300'
                                  }`}
                                >
                                  <span className={`text-sm font-black leading-none ${activeIconStyle === 'doubleCircle' ? 'text-white' : 'text-emerald-600'}`}>◎</span>
                                  <span className="text-[10px]">二重丸 (◎)</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateActivePianoChairStyle('circlePi')}
                                  className={`py-2 px-1 rounded-xl text-xs font-bold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                                    activeIconStyle === 'circlePi'
                                      ? 'liquid-btn-primary shadow-xs'
                                      : 'liquid-btn text-slate-700 dark:text-slate-300'
                                  }`}
                                >
                                  <span className={`w-4 h-4 rounded-full border border-current flex items-center justify-center font-bold text-[10px] leading-none ${activeIconStyle === 'circlePi' ? 'text-white' : 'text-amber-600 dark:text-amber-400'}`}>ピ</span>
                                  <span className="text-[10px]">丸ピ (ピ)</span>
                                </button>
                              </div>

                              {/* すべてのピアノ椅子に適用ボタン (ベジェ上のみ) */}
                              <button
                                type="button"
                                onClick={handleApplyToAllCurvePianoChairs}
                                className="w-full mt-0.5 py-1.5 px-2.5 rounded-xl text-xs font-semibold liquid-btn text-[#007AFF] hover:text-blue-700 dark:text-sky-400 dark:hover:text-sky-300 flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs hover:scale-[1.01] active:scale-[0.99]"
                                title="このベジェ曲線上のすべてのピアノ椅子をこの表示スタイルに一括適用します"
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                                <span>この曲線のすべてのピアノ椅子に適用</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* 譜面台が含まれるオブジェクトを選択した時だけ表示する「譜面台の表示スタイル」設定 */}
                    {isStandItem(activeItem) && (() => {
                      const activeStandStyle: 'default' | 'xMark' =
                        activeItem.customIconStyle === 'xMark'
                          ? 'xMark'
                          : activeItem.customIconStyle === 'default'
                          ? 'default'
                          : selectedCurve.customIconStyle === 'xMark'
                          ? 'xMark'
                          : 'default';

                      const handleUpdateActiveStandStyle = (targetStyle: 'default' | 'xMark') => {
                        const nextItems = curveItems.map(it => {
                          if (it.id === activeItem.id) {
                            return { ...it, customIconStyle: targetStyle };
                          }
                          return it;
                        });
                        onUpdateCurve(selectedCurve.id, {
                          items: nextItems,
                        });
                      };

                      const handleApplyToAllCurveStands = () => {
                        const targetStyle = activeStandStyle;
                        const nextItems = curveItems.map(it => {
                          if (isStandItem(it)) {
                            return { ...it, customIconStyle: targetStyle };
                          }
                          return it;
                        });
                        onUpdateCurve(selectedCurve.id, {
                          customIconStyle: targetStyle,
                          items: nextItems,
                        });
                      };

                      return (
                        <div className="pt-1.5 border-t border-blue-200/70 dark:border-blue-800/70">
                          <button
                            type="button"
                            onClick={() => toggleCurveItemSection('standStyle')}
                            className="w-full flex items-center justify-between text-left py-1 px-1 rounded-lg hover:bg-blue-100/50 dark:hover:bg-blue-900/40 transition-colors cursor-pointer group"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-blue-500 group-hover:text-blue-600 transition-colors">
                                {openCurveItemSections['standStyle'] ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                              </span>
                              <Music className="w-3.5 h-3.5 text-[#007AFF] shrink-0" />
                              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                                譜面台の表示スタイル
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal shrink-0">
                              {activeStandStyle === 'xMark' ? 'Xマーク' : '通常 (T字)'}
                            </span>
                          </button>

                          {openCurveItemSections['standStyle'] && (
                            <div className="mt-2 space-y-2 pl-1 pr-1 pb-1">
                              <div className="grid grid-cols-2 gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleUpdateActiveStandStyle('default')}
                                  className={`py-1.5 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                                    activeStandStyle === 'default'
                                      ? 'liquid-btn-primary shadow-xs'
                                      : 'liquid-btn text-slate-700 dark:text-slate-300'
                                  }`}
                                >
                                  <span className="font-black text-xs">⊥</span>
                                  <span className="text-[11px]">通常 (T字)</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateActiveStandStyle('xMark')}
                                  className={`py-1.5 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                                    activeStandStyle === 'xMark'
                                      ? 'liquid-btn-primary shadow-xs'
                                      : 'liquid-btn text-slate-700 dark:text-slate-300'
                                  }`}
                                >
                                  <span className={`font-black text-xs ${activeStandStyle === 'xMark' ? 'text-white' : 'text-rose-600'}`}>✕</span>
                                  <span className="text-[11px]">Xマーク</span>
                                </button>
                              </div>

                              {/* 全てに適応ボタン (ベジェ上のみ) */}
                              <button
                                type="button"
                                onClick={handleApplyToAllCurveStands}
                                className="w-full mt-0.5 py-1.5 px-2.5 rounded-xl text-xs font-semibold liquid-btn text-[#007AFF] hover:text-blue-700 dark:text-sky-400 dark:hover:text-sky-300 flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs hover:scale-[1.01] active:scale-[0.99]"
                                title="このベジェ曲線上のすべての譜面台をこの表示スタイルに一括適用します"
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                                <span>この曲線のすべての譜面台に適用</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* 打楽器が選択された場合 */}
                    {(activeItem.type === 'percussion' || Boolean(activeItem.percussionType)) && (() => {
                      const currentType = activeItem.percussionType || selectedCurve.percussionType || PERCUSSION_DATA[0].dropdownName;
                      const percInfo = getPercussionInfo(currentType);
                      const size = activeItem.size || selectedCurve.itemSize;
                      const aspect = (percInfo?.defaultH || 1.34) / (percInfo?.defaultW || 1.34);

                      const handleUpdateActivePercussionType = (newType: string) => {
                        const nextItems = curveItems.map(it => {
                          if (it.id === activeItem.id) {
                            return { ...it, percussionType: newType };
                          }
                          return it;
                        });
                        onUpdateCurve(selectedCurve.id, {
                          items: nextItems,
                        });
                      };

                      return (
                        <div className="pt-1.5 border-t border-blue-200/70 dark:border-blue-800/70">
                          <button
                            type="button"
                            onClick={() => toggleCurveItemSection('percussion')}
                            className="w-full flex items-center justify-between text-left py-1 px-1 rounded-lg hover:bg-blue-100/50 dark:hover:bg-blue-900/40 transition-colors cursor-pointer group"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-blue-500 group-hover:text-blue-600 transition-colors">
                                {openCurveItemSections['percussion'] ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                              </span>
                              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                                楽器種類・ラベル設定
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal shrink-0 truncate max-w-[100px]">
                              {currentType}
                            </span>
                          </button>

                          {openCurveItemSections['percussion'] && (
                            <div className="mt-2 space-y-2 pl-1 pr-1 pb-1">
                              <label className="flex flex-col gap-1">
                                <span className="text-xs text-slate-500 font-medium">楽器種類</span>
                                <select
                                  value={currentType}
                                  onChange={(e) => handleUpdateActivePercussionType(e.target.value)}
                                  className="px-2 py-1.5 border border-slate-300 rounded text-sm bg-white"
                                >
                                  {getGroupedPercussionData().map(group => (
                                    <optgroup key={group.category} label={group.category}>
                                      {group.items.map(p => (
                                        <option key={p.dropdownName} value={p.dropdownName}>
                                          {p.dropdownName} ({p.canvasName})
                                        </option>
                                      ))}
                                    </optgroup>
                                  ))}
                                </select>
                              </label>
                              {onOpenPercussionLabelModal && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onOpenPercussionLabelModal({
                                      type: 'curveItem',
                                      itemId: activeItem.id,
                                      curveId: selectedCurve.id,
                                      targetType: 'percussion',
                                      canvasName: percInfo?.canvasName || currentType || '打楽器',
                                      percussionType: currentType,
                                      initialText: percInfo?.canvasName || '',
                                      width: size,
                                      height: size * aspect,
                                      color: activeItem.color || selectedCurve.color,
                                      currentOffsetX: activeItem.labelOffsetX || 0,
                                      currentOffsetY: activeItem.labelOffsetY || 0,
                                      currentRotation: activeItem.labelRotation || 0,
                                      currentFontSize: activeItem.labelFontSize,
                                      currentLetterSpacing: activeItem.labelLetterSpacing || 0,
                                      isVertical: Boolean(activeItem.isVerticalName),
                                      showPercussionName: activeItem.showPercussionName !== false,
                                    });
                                  }}
                                  className="w-full py-1.5 px-2.5 rounded-xl text-xs font-semibold liquid-btn text-[#007AFF] hover:text-blue-700 flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs hover:scale-101 active:scale-99"
                                >
                                  <Move className="w-3.5 h-3.5" />
                                  <span>名前の位置・回転・サイズを設定...</span>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* 記号が選択された場合の文字位置・回転・サイズ設定 */}
                    {(() => {
                      const itemMatchedTmplId = activeItem.iconId ? templateReplacements?.[activeItem.iconId] : undefined;
                      const isCurveItemSymbol = activeItem.type === 'symbol' ||
                                                activeItem.symbolShape !== undefined ||
                                                itemMatchedTmplId === 'tmpl_symbol' ||
                                                itemMatchedTmplId?.replace(/^tmpl_/, '') === 'symbol';
                      if (!isCurveItemSymbol || !onOpenPercussionLabelModal) return null;
                      const size = activeItem.size || selectedCurve.itemSize;
                      return (
                        <div className="pt-1.5 border-t border-blue-200/70 dark:border-blue-800/70">
                          <button
                            type="button"
                            onClick={() => toggleCurveItemSection('symbol')}
                            className="w-full flex items-center justify-between text-left py-1 px-1 rounded-lg hover:bg-blue-100/50 dark:hover:bg-blue-900/40 transition-colors cursor-pointer group"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-blue-500 group-hover:text-blue-600 transition-colors">
                                {openCurveItemSections['symbol'] ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                              </span>
                              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                                記号テキスト設定
                              </span>
                            </div>
                          </button>

                          {openCurveItemSections['symbol'] && (
                            <div className="mt-2 pl-1 pr-1 pb-1">
                              <button
                                type="button"
                                onClick={() => {
                                  onOpenPercussionLabelModal({
                                    type: 'curveItem',
                                    itemId: activeItem.id,
                                    curveId: selectedCurve.id,
                                    targetType: 'symbol',
                                    canvasName: '記号テキスト',
                                    symbolShape: activeItem.symbolShape || 'circle',
                                    symbolFilled: Boolean(activeItem.symbolFilled),
                                    initialText: activeItem.symbolText || '',
                                    width: size,
                                    height: size,
                                    color: activeItem.color || selectedCurve.color,
                                    currentOffsetX: activeItem.labelOffsetX || 0,
                                    currentOffsetY: activeItem.labelOffsetY || 0,
                                    currentRotation: activeItem.labelRotation || 0,
                                    currentFontSize: activeItem.labelFontSize || activeItem.symbolFontSize,
                                    currentLetterSpacing: activeItem.labelLetterSpacing || 0,
                                    isVertical: Boolean(activeItem.isVerticalName),
                                  });
                                }}
                                className="w-full py-1.5 px-2.5 rounded-xl text-xs font-semibold liquid-btn text-[#007AFF] hover:text-blue-700 flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs hover:scale-101 active:scale-99"
                              >
                                <Move className="w-3.5 h-3.5" />
                                <span>文字の位置・回転・サイズを設定...</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {curveItems.length === 0 ? (
                  <div className="p-3 bg-purple-50/70 dark:bg-purple-950/40 border border-dashed border-purple-200 dark:border-purple-800 rounded-lg text-xs text-purple-700 dark:text-purple-300 text-center leading-relaxed">
                    <p className="font-semibold">アイテムがありません</p>
                    <p className="text-[11px] text-purple-600/80 dark:text-purple-400/80 mt-1">
                      上部パレットのアイテムをクリックすると、この曲線上に次々追加されます。
                    </p>
                  </div>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-1 pr-1 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 bg-slate-50/60 dark:bg-slate-900/40">
                    {curveItems.map((it, idx) => {
                      const isSelected = selectedCurveItemId === it.id;
                      const isLast = idx === curveItems.length - 1;
                      return (
                        <div
                          key={it.id || idx}
                          onClick={() => onSelectCurveItem?.(isSelected ? null : it.id)}
                          className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs cursor-pointer transition-all group ${
                            isSelected
                              ? 'liquid-glass-card-accent font-semibold text-blue-900 dark:text-blue-100'
                              : 'liquid-card hover:bg-white/90 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={`font-mono text-[10px] shrink-0 ${isSelected ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-slate-400 font-bold'}`}>
                              {idx + 1}.
                            </span>
                            <span className="truncate">{it.label || it.type}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {/* 左右への順序移動ボタン */}
                            <div className="flex items-center gap-0.5 mr-0.5">
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onMoveCurveItemOrder?.(selectedCurve.id, it.id, 'left');
                                }}
                                className="p-1 rounded text-slate-400 hover:text-[#007AFF] dark:hover:text-blue-400 disabled:opacity-20 disabled:hover:text-slate-400 transition-colors cursor-pointer"
                                title="左隣（始点側）へ移動"
                              >
                                <ArrowLeft className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                disabled={isLast}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onMoveCurveItemOrder?.(selectedCurve.id, it.id, 'right');
                                }}
                                className="p-1 rounded text-slate-400 hover:text-[#007AFF] dark:hover:text-blue-400 disabled:opacity-20 disabled:hover:text-slate-400 transition-colors cursor-pointer"
                                title="右隣（終点側）へ移動"
                              >
                                <ArrowRight className="w-3 h-3" />
                              </button>
                            </div>

                            {it.gap !== undefined ? (
                              <span className="text-[10px] bg-blue-100 dark:bg-blue-850 text-blue-800 dark:text-blue-200 px-1 py-0.5 rounded font-mono font-semibold" title={isLast ? "個別設定の間隔 (末尾)" : "個別設定の間隔"}>
                                間隔: {Math.round(it.gap)}px{isLast && ' (末尾)'}
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400 font-mono" title={isLast ? "標準間隔 (末尾)" : "標準間隔"}>
                                {Math.round(selectedCurve.itemGap)}px{isLast && ' (末尾)'}
                              </span>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (onDeleteCurveItem) {
                                  onDeleteCurveItem(selectedCurve.id, it.id);
                                } else {
                                  const next = [...curveItems];
                                  next.splice(idx, 1);
                                  if (isSelected) onSelectCurveItem?.(null);
                                  onUpdateCurve(selectedCurve.id, { items: next, itemCount: next.length });
                                }
                              }}
                              className="text-slate-400 hover:text-red-600 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer flex items-center justify-center"
                              title="このアイテムを削除"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })() : (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500 font-medium">配置アイテム数: {selectedCurve.itemCount}</span>
              <input
                type="range"
                min="1"
                max="50"
                value={selectedCurve.itemCount}
                onChange={(e) => onUpdateCurve(selectedCurve.id, { itemCount: parseInt(e.target.value, 10) })}
                className="w-full"
              />
            </label>
          )}

          <div className="grid grid-cols-2 gap-3 pt-2.5 border-t border-slate-200/60 dark:border-slate-700/60">
            {/* アイテムサイズ */}
            <div className="flex flex-col gap-1.5 col-span-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">アイテムサイズ</span>
                <span className="font-mono text-xs font-bold text-slate-700 dark:text-slate-200">
                  {Math.round(selectedCurve.itemSize)} px
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="10"
                  max="120"
                  value={Math.round(selectedCurve.itemSize)}
                  onChange={(e) => onUpdateCurve(selectedCurve.id, { itemSize: parseFloat(e.target.value) })}
                  className="flex-1 accent-[#007AFF] cursor-pointer"
                />
                <input
                  type="number"
                  min="10"
                  max="200"
                  value={Math.round(selectedCurve.itemSize)}
                  onChange={(e) => {
                    const s = parseFloat(e.target.value);
                    if (!isNaN(s) && s > 0) onUpdateCurve(selectedCurve.id, { itemSize: s });
                  }}
                  className="w-16 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded text-xs bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 font-mono text-right"
                />
              </div>
            </div>

            {/* 配置間隔（スライダ + 数値入力） */}
            <div className="flex flex-col gap-1.5 col-span-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">配置間隔</span>
                <span className="font-mono text-xs font-bold text-slate-700 dark:text-slate-200">
                  {Math.round(selectedCurve.itemGap)} px
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="150"
                  value={Math.round(selectedCurve.itemGap)}
                  onChange={(e) => onUpdateCurve(selectedCurve.id, { itemGap: parseFloat(e.target.value) })}
                  className="flex-1 accent-[#007AFF] cursor-pointer"
                />
                <input
                  type="number"
                  min="0"
                  max="500"
                  value={Math.round(selectedCurve.itemGap)}
                  onChange={(e) => {
                    const g = parseFloat(e.target.value);
                    if (!isNaN(g) && g >= 0) onUpdateCurve(selectedCurve.id, { itemGap: g });
                  }}
                  className="w-16 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded text-xs bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 font-mono text-right"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 col-span-2 mt-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={selectedCurve.showLine !== false}
                onChange={(e) => onUpdateCurve(selectedCurve.id, { showLine: e.target.checked })}
                className="rounded text-[#007AFF] focus:ring-[#007AFF] w-4 h-4 cursor-pointer"
              />
              <span className="text-xs text-slate-700 dark:text-slate-300 font-medium">ガイド線を表示</span>
            </label>
          </div>
        </div>





        {isPercussion && (
          <div className="pt-4 border-t border-slate-100 flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-slate-700 flex items-center gap-1">
              <span>●</span> パーカッション設定
            </h4>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500 font-medium">楽器種類</span>
              <select
                value={selectedCurve.percussionType || PERCUSSION_DATA[0].dropdownName}
                onChange={(e) => onUpdateCurve(selectedCurve.id, { percussionType: e.target.value })}
                className="px-2 py-1.5 border border-slate-300 rounded text-sm bg-white"
              >
                {getGroupedPercussionData().map(group => (
                  <optgroup key={group.category} label={group.category}>
                    {group.items.map(p => (
                      <option key={p.dropdownName} value={p.dropdownName}>{p.dropdownName} ({p.canvasName})</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 mt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedCurve.showPercussionName !== false}
                onChange={(e) => onUpdateCurve(selectedCurve.id, { showPercussionName: e.target.checked })}
                className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4"
              />
              <span className="text-xs text-slate-600 font-medium">名前をキャンバスに表示</span>
            </label>
          </div>
        )}

        <div className="pt-4 mt-auto">
          {onDuplicateCurve && (
            <button
              onClick={() => onDuplicateCurve(selectedCurve.id)}
              className="w-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
              title="曲線を複製"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>複製</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // Not selected
  return null;
};
