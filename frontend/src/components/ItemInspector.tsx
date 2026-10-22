import React from 'react';
import type { PlacedItem } from './StageCanvas';
import type { CurveObject } from '../utils/bezierUtils';
import { TEMPLATE_SHAPES, PERCUSSION_DATA } from '../utils/templateShapes';

interface ItemInspectorProps {
  selectedItem: PlacedItem | null;
  selectedCurve: CurveObject | null;
  selectedCurveItemId?: string | null;
  onSelectCurveItem?: (itemId: string | null) => void;
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
  onUpdateAllOfType?: (type: 'stand' | 'pianoChair', style: 'default' | 'xMark' | 'doubleCircle') => void;
  onTogglePin?: () => void;
  onMoveOrder?: (direction: 'front' | 'back' | 'forward' | 'backward') => void;
  onAlign?: (type: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom' | 'distributeH' | 'distributeV') => void;
}

export const ItemInspector: React.FC<ItemInspectorProps> = ({
  selectedItem,
  selectedCurve,
  selectedCurveItemId,
  onSelectCurveItem,
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
}) => {
  if (selectedCount > 1) {
    return (
      <div key="multi-selection-inspector" className="flex flex-col gap-4 p-4 text-sm bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 w-64 flex-shrink-0 h-full overflow-y-auto transition-colors">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-700">
          <h3 className="font-semibold text-slate-800 dark:text-slate-100">複数選択</h3>
          <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
            {selectedCount} 個選択中
          </span>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          キャンバス上でまとめてドラッグ移動や回転が可能です。
        </p>
        <div className="p-3 bg-slate-50 dark:bg-slate-700/60 rounded-lg border border-slate-200 dark:border-slate-600 text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
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
          <div className="p-3 bg-slate-50 dark:bg-slate-700/60 rounded-lg border border-slate-200 dark:border-slate-600 space-y-2">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 block">📐 一括整列・均等配置:</span>
            <div className="grid grid-cols-3 gap-1 text-[11px]">
              <button
                type="button"
                onClick={() => onAlign('left')}
                className="py-1 px-1 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded text-slate-700 dark:text-slate-200 font-medium text-center"
                title="左揃え"
              >
                ⬅ 左揃え
              </button>
              <button
                type="button"
                onClick={() => onAlign('centerH')}
                className="py-1 px-1 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded text-slate-700 dark:text-slate-200 font-medium text-center"
                title="水平中央揃え"
              >
                ↔ 左右中央
              </button>
              <button
                type="button"
                onClick={() => onAlign('right')}
                className="py-1 px-1 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded text-slate-700 dark:text-slate-200 font-medium text-center"
                title="右揃え"
              >
                ➡ 右揃え
              </button>
              <button
                type="button"
                onClick={() => onAlign('top')}
                className="py-1 px-1 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded text-slate-700 dark:text-slate-200 font-medium text-center"
                title="上揃え"
              >
                ⬆ 上揃え
              </button>
              <button
                type="button"
                onClick={() => onAlign('centerV')}
                className="py-1 px-1 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded text-slate-700 dark:text-slate-200 font-medium text-center"
                title="垂直中央揃え"
              >
                ↕ 上下中央
              </button>
              <button
                type="button"
                onClick={() => onAlign('bottom')}
                className="py-1 px-1 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded text-slate-700 dark:text-slate-200 font-medium text-center"
                title="下揃え"
              >
                ⬇ 下揃え
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1 text-[11px] pt-1 border-t border-slate-200 dark:border-slate-600">
              <button
                type="button"
                onClick={() => onAlign('distributeH')}
                className="py-1 px-1.5 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded text-slate-700 dark:text-slate-200 font-medium text-center"
                title="水平等間隔に整列"
              >
                || 左右等間隔
              </button>
              <button
                type="button"
                onClick={() => onAlign('distributeV')}
                className="py-1 px-1.5 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded text-slate-700 dark:text-slate-200 font-medium text-center"
                title="垂直等間隔に整列"
              >
                = 上下等間隔
              </button>
            </div>
          </div>
        )}

        {/* Order Controls */}
        {onMoveOrder && (
          <div className="p-3 bg-slate-50 dark:bg-slate-700/60 rounded-lg border border-slate-200 dark:border-slate-600 space-y-1.5">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 block">層（重なり順）:</span>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => onMoveOrder('forward')}
                className="py-1.5 px-2 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded text-slate-700 dark:text-slate-200 font-medium text-center"
                title="1段階前面へ"
              >
                ▲ 前面へ
              </button>
              <button
                type="button"
                onClick={() => onMoveOrder('backward')}
                className="py-1.5 px-2 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded text-slate-700 dark:text-slate-200 font-medium text-center"
                title="1段階背面へ"
              >
                ▼ 背面へ
              </button>
              <button
                type="button"
                onClick={() => onMoveOrder('front')}
                className="py-1 px-2 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded text-slate-700 dark:text-slate-200 text-[11px] text-center"
                title="最前面へ"
              >
                ↑ 最前面
              </button>
              <button
                type="button"
                onClick={() => onMoveOrder('back')}
                className="py-1 px-2 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded text-slate-700 dark:text-slate-200 text-[11px] text-center"
                title="最背面へ"
              >
                ↓ 最背面
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
            >
              <span>📌</span>
              <span>選択オブジェクトを固定/解除 (Ctrl+F)</span>
            </button>
          )}
          {onDuplicateSelected && (
            <button
              type="button"
              onClick={onDuplicateSelected}
              className="w-full py-2 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-600 transition-colors flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
            >
              <span>📑</span>
              <span>選択したオブジェクトを複製</span>
            </button>
          )}
          {onDeleteSelected && (
            <button
              type="button"
              onClick={onDeleteSelected}
              className="w-full py-2.5 px-3 bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/50 text-red-600 dark:text-red-300 rounded-lg text-xs font-semibold border border-red-200 dark:border-red-800 transition-colors flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
            >
              <span>🗑️</span>
              <span>選択したアイテムを一括削除</span>
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

    const isPercussion = selectedItem.templateType === 'percussion';
    const isPiano = selectedItem.templateType === 'piano';
    const isStand = selectedItem.templateType === 'ensembleStand' ||
                    selectedItem.templateType === 'conductorStand' ||
                    selectedItem.templateType === 'ensembleChairAndStand';
    const isPianoChair = selectedItem.templateType === 'pianoChair' ||
                         selectedItem.templateType === 'turnerChair';

    return (
      <div
        key={`item-inspector-${selectedItem.id}`}
        className="flex flex-col gap-4 p-4 text-sm bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 w-64 flex-shrink-0 h-full overflow-y-auto transition-colors"
      >
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-800 dark:text-slate-100 truncate max-w-[120px]">
              {TEMPLATE_SHAPES.find(t => t.type === selectedItem.templateType)?.label || 'パーツ'}
            </h3>
            {onTogglePin && (
              <label className="text-[11px] text-blue-600 dark:text-blue-400 flex items-center gap-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={Boolean(selectedItem.isPinned)}
                  onChange={onTogglePin}
                  className="rounded text-blue-600 w-3.5 h-3.5"
                />
                <span>📌固定</span>
              </label>
            )}
          </div>
          <button
            onClick={() => onDeleteItem(selectedItem.id)}
            className="text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 px-2 py-1 rounded"
          >
            削除
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
              value={Math.round(selectedItem.width * selectedItem.scaleX)}
              onChange={(e) => {
                const w = parseFloat(e.target.value);
                if (!isNaN(w) && w > 0) {
                  onUpdateItem(selectedItem.id, { scaleX: w / selectedItem.width });
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
              value={Math.round(selectedItem.height * selectedItem.scaleY)}
              onChange={(e) => {
                const h = parseFloat(e.target.value);
                if (!isNaN(h) && h > 0) {
                  onUpdateItem(selectedItem.id, { scaleY: h / selectedItem.height });
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
                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 rounded text-slate-700 dark:text-slate-200 text-xs font-medium border border-slate-200 dark:border-slate-600"
                title="1段階前面へ"
              >
                ▲ 前面へ
              </button>
              <button
                type="button"
                onClick={() => onMoveOrder('backward')}
                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 rounded text-slate-700 dark:text-slate-200 text-xs font-medium border border-slate-200 dark:border-slate-600"
                title="1段階背面へ"
              >
                ▼ 背面へ
              </button>
            </div>
          </div>
        )}

        {isStand && (
          <div className="pt-4 border-t border-slate-100 flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-slate-700 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <span>🎼</span> 譜面台アイコン表示
              </span>
              <span className="text-[10px] text-slate-400 font-normal">
                {selectedItem.customIconStyle === 'xMark' ? 'Xマーク' : '通常 (T字)'}
              </span>
            </h4>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => onUpdateItem(selectedItem.id, { customIconStyle: 'default' })}
                className={`py-2 px-2 rounded-lg border text-xs font-bold flex flex-col items-center gap-1 transition-all ${
                  (selectedItem.customIconStyle || 'default') === 'default'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-2xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="text-sm font-black leading-none">⊥</span>
                <span className="text-[11px]">通常 (T字)</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateItem(selectedItem.id, { customIconStyle: 'xMark' })}
                className={`py-2 px-2 rounded-lg border text-xs font-bold flex flex-col items-center gap-1 transition-all ${
                  selectedItem.customIconStyle === 'xMark'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-2xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="text-sm font-black leading-none text-rose-600">✕</span>
                <span className="text-[11px]">Xマーク</span>
              </button>
            </div>
            {onUpdateAllOfType && (
              <button
                type="button"
                onClick={() => onUpdateAllOfType('stand', selectedItem.customIconStyle === 'xMark' ? 'xMark' : 'default')}
                className="mt-1 text-[11px] text-blue-600 hover:text-blue-700 hover:bg-blue-50/70 border border-blue-200 py-1.5 px-2 rounded-md transition-colors font-medium flex items-center justify-center gap-1"
                title="ステージ上のすべての譜面台をこの表示スタイルに統一"
              >
                <span>⚡</span>
                <span>すべての譜面台に一括適用</span>
              </button>
            )}
          </div>
        )}

        {/* 椅子＋譜面台 (ensembleChairAndStand) の場合の「椅子の種類」切り替え */}
        {selectedItem.templateType === 'ensembleChairAndStand' && (
          <div className="pt-4 border-t border-slate-100 flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-slate-700 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <span>🪑</span> 椅子の種類
              </span>
              <span className="text-[10px] text-slate-400 font-normal">
                {selectedItem.chairType === 'pianoChairSvg'
                  ? 'ピアノ椅子 (🪑)'
                  : selectedItem.chairType === 'pianoChair'
                  ? 'ピアノ椅子 (◎)'
                  : '合奏用椅子 (○)'}
              </span>
            </h4>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => onUpdateItem(selectedItem.id, { chairType: 'normal' })}
                className={`py-2 px-1 rounded-lg border text-xs font-bold flex flex-col items-center gap-1 transition-all ${
                  (selectedItem.chairType || 'normal') === 'normal'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-2xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="text-sm font-bold leading-none">○</span>
                <span className="text-[10px]">合奏用椅子</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateItem(selectedItem.id, { chairType: 'pianoChair' })}
                className={`py-2 px-1 rounded-lg border text-xs font-bold flex flex-col items-center gap-1 transition-all ${
                  selectedItem.chairType === 'pianoChair'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-2xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="text-sm font-black leading-none text-emerald-600">◎</span>
                <span className="text-[10px]">二重丸</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateItem(selectedItem.id, { chairType: 'pianoChairSvg' })}
                className={`py-2 px-1 rounded-lg border text-xs font-bold flex flex-col items-center gap-1 transition-all ${
                  selectedItem.chairType === 'pianoChairSvg'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-2xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="text-sm leading-none">🪑</span>
                <span className="text-[10px]">ピアノ椅子</span>
              </button>
            </div>
            <p className="text-[10px] text-slate-500 leading-tight">
              ※「二重丸」または「ピアノ椅子」を選択すると、提出書類の集計欄でもピアノ椅子として自動カウントされます。
            </p>
          </div>
        )}

        {isPianoChair && (
          <div className="pt-4 border-t border-slate-100 flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-slate-700 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <span>🪑</span> ピアノ椅子表示
              </span>
              <span className="text-[10px] text-slate-400 font-normal">
                {selectedItem.customIconStyle === 'doubleCircle' ? '二重丸 (◎)' : '通常'}
              </span>
            </h4>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => onUpdateItem(selectedItem.id, { customIconStyle: 'default' })}
                className={`py-2 px-2 rounded-lg border text-xs font-bold flex flex-col items-center gap-1 transition-all ${
                  (selectedItem.customIconStyle || 'default') === 'default'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-2xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="text-sm font-bold leading-none">🪑</span>
                <span className="text-[11px]">通常椅子</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateItem(selectedItem.id, { customIconStyle: 'doubleCircle' })}
                className={`py-2 px-2 rounded-lg border text-xs font-bold flex flex-col items-center gap-1 transition-all ${
                  selectedItem.customIconStyle === 'doubleCircle'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-2xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="text-sm font-black leading-none text-emerald-600">◎</span>
                <span className="text-[11px]">二重丸 (◎)</span>
              </button>
            </div>
            {onUpdateAllOfType && (
              <button
                type="button"
                onClick={() => onUpdateAllOfType('pianoChair', selectedItem.customIconStyle === 'doubleCircle' ? 'doubleCircle' : 'default')}
                className="mt-1 text-[11px] text-blue-600 hover:text-blue-700 hover:bg-blue-50/70 border border-blue-200 py-1.5 px-2 rounded-md transition-colors font-medium flex items-center justify-center gap-1"
                title="ステージ上のすべてのピアノ椅子をこの表示スタイルに統一"
              >
                <span>⚡</span>
                <span>すべてのピアノ椅子に一括適用</span>
              </button>
            )}
          </div>
        )}

        {isPercussion && (
          <div className="pt-4 border-t border-slate-100 flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-slate-700 flex items-center gap-1">
              <span>🥁</span> パーカッション設定
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
                {PERCUSSION_DATA.map(p => (
                  <option key={p.dropdownName} value={p.dropdownName}>{p.dropdownName} ({p.canvasName})</option>
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
          </div>
        )}

        {isPiano && (
          <div className="pt-4 border-t border-slate-100 flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-slate-700 flex items-center gap-1">
              <span>🎹</span> ピアノ設定
            </h4>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500 font-medium">蓋の状態</span>
              <select
                value={selectedItem.pianoLidState || '全開'}
                onChange={(e) => onUpdateItem(selectedItem.id, { pianoLidState: e.target.value })}
                className="px-2 py-1.5 border border-slate-300 rounded text-sm bg-white"
              >
                <option value="閉">閉</option>
                <option value="蒲鉾板">蒲鉾板</option>
                <option value="半開">半開</option>
                <option value="全開">全開</option>
              </select>
            </label>
          </div>
        )}

        <div className="pt-4 mt-auto">
          <button
            onClick={() => onDuplicateItem(selectedItem.id)}
            className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold py-2 rounded transition-colors"
          >
            複製する
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
    const hasCurveStands = selectedCurve.itemType === 'ensembleStand' ||
                           selectedCurve.itemType === 'conductorStand' ||
                           selectedCurve.itemType === 'ensembleChairAndStand' ||
                           (Array.isArray(selectedCurve.items) && selectedCurve.items.some(it =>
                             it.type === 'ensembleStand' || it.type === 'conductorStand' || it.type === 'ensembleChairAndStand'
                           ));
    const hasChairAndStand = selectedCurve.itemType === 'ensembleChairAndStand' ||
                             (Array.isArray(selectedCurve.items) && selectedCurve.items.some(it => it.type === 'ensembleChairAndStand'));

    return (
      <div
        key={`curve-inspector-${selectedCurve.id}`}
        className="flex flex-col gap-4 p-4 text-sm bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 w-64 flex-shrink-0 h-full overflow-y-auto transition-colors"
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
                <span>📌固定</span>
              </label>
            )}
          </div>
          <button
            onClick={() => onDeleteCurve(selectedCurve.id)}
            className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded cursor-pointer"
          >
            削除
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

        {/* Order Controls */}
        {onMoveOrder && (
          <div className="p-3 bg-slate-50 dark:bg-slate-700/60 rounded-lg border border-slate-200 dark:border-slate-600 space-y-1.5">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 block">層（重なり順）:</span>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => onMoveOrder('forward')}
                className="py-1.5 px-2 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded text-slate-700 dark:text-slate-200 font-medium text-center"
                title="1段階前面へ"
              >
                ▲ 前面へ
              </button>
              <button
                type="button"
                onClick={() => onMoveOrder('backward')}
                className="py-1.5 px-2 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded text-slate-700 dark:text-slate-200 font-medium text-center"
                title="1段階背面へ"
              >
                ▼ 背面へ
              </button>
              <button
                type="button"
                onClick={() => onMoveOrder('front')}
                className="py-1 px-2 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded text-slate-700 dark:text-slate-200 text-[11px] text-center"
                title="最前面へ"
              >
                ↑ 最前面
              </button>
              <button
                type="button"
                onClick={() => onMoveOrder('back')}
                className="py-1 px-2 bg-white dark:bg-slate-600 hover:bg-slate-100 border border-slate-200 dark:border-slate-500 rounded text-slate-700 dark:text-slate-200 text-[11px] text-center"
                title="最背面へ"
              >
                ↓ 最背面
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {Array.isArray(selectedCurve.items) ? (() => {
            const curveItems = selectedCurve.items || [];
            const activeItemIndex = selectedCurveItemId ? curveItems.findIndex(it => it.id === selectedCurveItemId) : -1;
            const activeItem = activeItemIndex >= 0 ? curveItems[activeItemIndex] : null;

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
                      <button
                        onClick={() => onSelectCurveItem?.(null)}
                        className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline shrink-0 cursor-pointer"
                      >
                        選択解除
                      </button>
                    </div>

                    {activeItemIndex === curveItems.length - 1 ? (
                      <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 p-1.5 rounded border border-amber-200 dark:border-amber-800 leading-snug">
                        ※ 末尾のアイテムのため、右隣に配置アイテムはありません
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1.5 pt-1.5 border-t border-blue-200/70 dark:border-blue-800/70">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                            右隣との間隔
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

                        <div className="flex items-center gap-2">
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
                            className="w-20 px-2 py-1 text-xs border border-blue-300 dark:border-blue-700 rounded bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 font-mono"
                          />
                          <span className="text-xs text-slate-500 dark:text-slate-400">px</span>
                          <div className="flex items-center gap-1 ml-auto">
                            {[-5, -1, 1, 5].map((delta) => (
                              <button
                                key={delta}
                                type="button"
                                onClick={() => {
                                  const cur = activeItem.gap !== undefined ? activeItem.gap : selectedCurve.itemGap;
                                  handleUpdateItemGap(activeItem.id, Math.max(0, cur + delta));
                                }}
                                className="px-1.5 py-0.5 text-[11px] font-mono bg-white dark:bg-slate-700 border border-blue-200 dark:border-blue-700 rounded hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-800 dark:text-blue-200 shadow-2xs cursor-pointer"
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
                      </div>
                    )}
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
                          className={`flex items-center justify-between px-2 py-1.5 rounded border text-xs cursor-pointer transition-colors shadow-2xs group ${
                            isSelected
                              ? 'bg-blue-50 dark:bg-blue-900/40 border-blue-400 dark:border-blue-600 text-blue-900 dark:text-blue-200 ring-1 ring-blue-300 dark:ring-blue-500 font-semibold'
                              : 'bg-white dark:bg-slate-750 hover:bg-slate-100 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={`font-mono text-[10px] shrink-0 ${isSelected ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-slate-400 font-bold'}`}>
                              {idx + 1}.
                            </span>
                            <span className="truncate">{it.label || it.type}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {!isLast && (
                              it.gap !== undefined ? (
                                <span className="text-[10px] bg-blue-100 dark:bg-blue-850 text-blue-800 dark:text-blue-200 px-1 py-0.5 rounded font-mono font-semibold" title="個別設定の間隔">
                                  間隔: {Math.round(it.gap)}px
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-400 font-mono">
                                  {Math.round(selectedCurve.itemGap)}px
                                </span>
                              )
                            )}
                            {isLast && (
                              <span className="text-[10px] text-slate-400 font-mono">末尾</span>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const next = [...curveItems];
                                next.splice(idx, 1);
                                if (isSelected) onSelectCurveItem?.(null);
                                onUpdateCurve(selectedCurve.id, { items: next, itemCount: next.length });
                              }}
                              className="text-slate-400 hover:text-red-600 px-1 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                              title="このアイテムを削除"
                            >
                              ✕
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

          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
            <label className="flex flex-col gap-1 col-span-2">
              <span className="text-xs text-slate-500 font-medium">アイテムサイズ</span>
              <input
                type="number"
                min="10"
                max="200"
                value={Math.round(selectedCurve.itemSize)}
                onChange={(e) => {
                  const s = parseFloat(e.target.value);
                  if (!isNaN(s) && s > 0) onUpdateCurve(selectedCurve.id, { itemSize: s });
                }}
                className="px-2 py-1 border border-slate-300 rounded text-sm w-full"
              />
            </label>
            <label className="flex flex-col gap-1 col-span-2">
              <span className="text-xs text-slate-500 font-medium">配置間隔</span>
              <input
                type="number"
                min="0"
                max="500"
                value={Math.round(selectedCurve.itemGap)}
                onChange={(e) => {
                  const g = parseFloat(e.target.value);
                  if (!isNaN(g) && g >= 0) onUpdateCurve(selectedCurve.id, { itemGap: g });
                }}
                className="px-2 py-1 border border-slate-300 rounded text-sm w-full"
              />
            </label>
            <label className="flex items-center gap-2 col-span-2 mt-1">
              <input
                type="checkbox"
                checked={selectedCurve.showLine !== false}
                onChange={(e) => onUpdateCurve(selectedCurve.id, { showLine: e.target.checked })}
                className="rounded text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs text-slate-700 font-medium">ガイド線を表示</span>
            </label>
          </div>
        </div>

        {hasCurveStands && (
          <div className="pt-3 border-t border-slate-100 flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-slate-700 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <span>🎼</span> 曲線上の譜面台表示
              </span>
              <span className="text-[10px] text-slate-400 font-normal">
                {selectedCurve.customIconStyle === 'xMark' ? 'Xマーク' : '通常 (T字)'}
              </span>
            </h4>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const nextItems = selectedCurve.items?.map(it => {
                    const isSt = it.type === 'ensembleStand' || it.type === 'conductorStand' || it.type === 'ensembleChairAndStand';
                    return isSt ? { ...it, customIconStyle: 'default' as const } : it;
                  });
                  onUpdateCurve(selectedCurve.id, {
                    customIconStyle: 'default',
                    items: nextItems || selectedCurve.items,
                  });
                }}
                className={`py-1.5 px-2 rounded-lg border text-xs font-bold flex items-center justify-center gap-1 transition-all ${
                  (selectedCurve.customIconStyle || 'default') === 'default'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-2xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="font-black text-xs">⊥</span>
                <span className="text-[11px]">通常 (T字)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextItems = selectedCurve.items?.map(it => {
                    const isSt = it.type === 'ensembleStand' || it.type === 'conductorStand' || it.type === 'ensembleChairAndStand';
                    return isSt ? { ...it, customIconStyle: 'xMark' as const } : it;
                  });
                  onUpdateCurve(selectedCurve.id, {
                    customIconStyle: 'xMark',
                    items: nextItems || selectedCurve.items,
                  });
                }}
                className={`py-1.5 px-2 rounded-lg border text-xs font-bold flex items-center justify-center gap-1 transition-all ${
                  selectedCurve.customIconStyle === 'xMark'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-2xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="font-black text-xs text-rose-600">✕</span>
                <span className="text-[11px]">Xマーク</span>
              </button>
            </div>
          </div>
        )}

        {hasChairAndStand && (
          <div className="pt-3 border-t border-slate-100 flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-slate-700 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <span>🪑</span> 曲線上の椅子の種類
              </span>
              <span className="text-[10px] text-slate-400 font-normal">
                {selectedCurve.chairType === 'pianoChairSvg'
                  ? 'ピアノ椅子 (🪑)'
                  : selectedCurve.chairType === 'pianoChair'
                  ? 'ピアノ椅子 (◎)'
                  : '合奏用椅子 (○)'}
              </span>
            </h4>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const nextItems = selectedCurve.items?.map(it => {
                    if (it.type === 'ensembleChairAndStand') {
                      return { ...it, chairType: 'normal' as const };
                    }
                    return it;
                  });
                  onUpdateCurve(selectedCurve.id, {
                    chairType: 'normal',
                    items: nextItems || selectedCurve.items,
                  });
                }}
                className={`py-1.5 px-1 rounded-lg border text-xs font-bold flex flex-col items-center justify-center gap-0.5 transition-all ${
                  (selectedCurve.chairType || 'normal') === 'normal'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-2xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="font-bold text-xs">○</span>
                <span className="text-[10px]">合奏用椅子</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextItems = selectedCurve.items?.map(it => {
                    if (it.type === 'ensembleChairAndStand') {
                      return { ...it, chairType: 'pianoChair' as const };
                    }
                    return it;
                  });
                  onUpdateCurve(selectedCurve.id, {
                    chairType: 'pianoChair',
                    items: nextItems || selectedCurve.items,
                  });
                }}
                className={`py-1.5 px-1 rounded-lg border text-xs font-bold flex flex-col items-center justify-center gap-0.5 transition-all ${
                  selectedCurve.chairType === 'pianoChair'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-2xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="font-black text-xs text-emerald-600">◎</span>
                <span className="text-[10px]">二重丸</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextItems = selectedCurve.items?.map(it => {
                    if (it.type === 'ensembleChairAndStand') {
                      return { ...it, chairType: 'pianoChairSvg' as const };
                    }
                    return it;
                  });
                  onUpdateCurve(selectedCurve.id, {
                    chairType: 'pianoChairSvg',
                    items: nextItems || selectedCurve.items,
                  });
                }}
                className={`py-1.5 px-1 rounded-lg border text-xs font-bold flex flex-col items-center justify-center gap-0.5 transition-all ${
                  selectedCurve.chairType === 'pianoChairSvg'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-2xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="text-xs">🪑</span>
                <span className="text-[10px]">ピアノ椅子</span>
              </button>
            </div>
          </div>
        )}

        {isPercussion && (
          <div className="pt-4 border-t border-slate-100 flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-slate-700 flex items-center gap-1">
              <span>🥁</span> パーカッション設定
            </h4>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500 font-medium">楽器種類</span>
              <select
                value={selectedCurve.percussionType || PERCUSSION_DATA[0].dropdownName}
                onChange={(e) => onUpdateCurve(selectedCurve.id, { percussionType: e.target.value })}
                className="px-2 py-1.5 border border-slate-300 rounded text-sm bg-white"
              >
                {PERCUSSION_DATA.map(p => (
                  <option key={p.dropdownName} value={p.dropdownName}>{p.dropdownName} ({p.canvasName})</option>
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
              className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold py-2 rounded transition-colors"
            >
              複製する
            </button>
          )}
        </div>
      </div>
    );
  }

  // Not selected
  return null;
};
