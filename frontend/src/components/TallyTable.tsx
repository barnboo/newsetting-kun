import React from 'react';
import type { ExtractedIcon } from '../App';
import type { PlacedItem } from './StageCanvas';
import type { CurveObject } from '../utils/bezierUtils';
import { TEMPLATE_SHAPES, getTemplateDataUrl } from '../utils/templateShapes';

interface Props {
  extractedIcons: ExtractedIcon[];
  placedItems: PlacedItem[];
  curveObjects?: CurveObject[];
  iconLabels: Record<string, string>;
  onUpdateLabel: (iconId: string, label: string) => void;
  onAddIcon: (iconId: string) => void;
}

const TallyTable: React.FC<Props> = ({
  extractedIcons,
  placedItems,
  curveObjects = [],
  iconLabels,
  onUpdateLabel,
  onAddIcon,
}) => {
  // Count items per iconId (placed items)
  const counts: Record<string, number> = {};
  for (const item of placedItems) {
    if (item.templateType === 'ensembleChairAndStand') {
      const isPiano = item.chairType === 'pianoChair' || item.chairType === 'pianoChairSvg';
      const chairKey = isPiano ? 'tmpl_pianoChair' : 'tmpl_chorusChair';
      counts[chairKey] = (counts[chairKey] || 0) + 1;
      counts['tmpl_ensembleStand'] = (counts['tmpl_ensembleStand'] || 0) + 1;
    } else {
      counts[item.iconId] = (counts[item.iconId] || 0) + 1;
    }
  }

  // Count items in curve objects
  for (const curve of curveObjects) {
    if (Array.isArray(curve.items)) {
      for (const it of curve.items) {
        if (it.isCustom && it.iconId) {
          counts[it.iconId] = (counts[it.iconId] || 0) + 1;
        } else if (it.type === 'ensembleChairAndStand') {
          const effectiveChairType = it.chairType || curve.chairType;
          const isPiano = effectiveChairType === 'pianoChair' || effectiveChairType === 'pianoChairSvg';
          const chairKey = isPiano ? 'tmpl_pianoChair' : 'tmpl_chorusChair';
          counts[chairKey] = (counts[chairKey] || 0) + 1;
          counts['tmpl_ensembleStand'] = (counts['tmpl_ensembleStand'] || 0) + 1;
        } else {
          const key = it.type.startsWith('tmpl_') ? it.type : `tmpl_${it.type}`;
          counts[key] = (counts[key] || 0) + 1;
        }
      }
    } else {
      const tmplType = curve.itemType;
      if (tmplType === 'ensembleChairAndStand') {
        const isPiano = curve.chairType === 'pianoChair' || curve.chairType === 'pianoChairSvg';
        const chairKey = isPiano ? 'tmpl_pianoChair' : 'tmpl_chorusChair';
        counts[chairKey] = (counts[chairKey] || 0) + curve.itemCount;
        counts['tmpl_ensembleStand'] = (counts['tmpl_ensembleStand'] || 0) + curve.itemCount;
      } else if (tmplType) {
        const key = `tmpl_${tmplType}`;
        counts[key] = (counts[key] || 0) + curve.itemCount;
      }
    }
  }

  const totalCount = placedItems.length + curveObjects.reduce((s, c) => s + (Array.isArray(c.items) ? c.items.length : c.itemCount), 0);

  // Gather all template types that have a non-zero count
  const templateKeysWithCount = Object.keys(counts)
    .filter(k => k.startsWith('tmpl_') && counts[k] > 0);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 overflow-hidden w-full transition-colors">
      <div className="p-3 bg-gray-50 dark:bg-slate-750 border-b border-gray-200 dark:border-slate-700 flex justify-between items-center shrink-0">
        <h3 className="font-bold text-gray-800 dark:text-slate-100 text-sm flex items-center gap-1.5">
          <span>📊</span>
          リアルタイム集計
        </h3>
        <span className="bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 text-xs font-semibold px-2 py-0.5 rounded-full">
          合計: {totalCount} 個
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {/* PDF Extracted Icons */}
        {extractedIcons.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-1 px-1">
              PDF パーツ
            </p>
            {extractedIcons.map((icon, idx) => {
              const count = counts[icon.id] || 0;
              const label = iconLabels[icon.id] ?? `アイテム ${idx + 1}`;

              return (
                <div
                  key={icon.id}
                  className="flex items-center gap-2 p-2 rounded-md hover:bg-gray-50 dark:hover:bg-slate-700/60 border border-gray-100 dark:border-slate-700 transition-colors"
                >
                  <div className="w-10 h-10 bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded flex items-center justify-center p-0.5 shrink-0">
                    <img src={icon.url} alt={icon.id} className="max-w-full max-h-full object-contain pointer-events-none" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <input
                      type="text"
                      value={label}
                      onChange={e => onUpdateLabel(icon.id, e.target.value)}
                      placeholder={`アイテム ${idx + 1}`}
                      className="w-full text-xs font-medium text-gray-700 dark:text-slate-200 bg-transparent border border-transparent hover:border-gray-200 dark:hover:border-slate-600 focus:border-blue-400 focus:bg-white dark:focus:bg-slate-700 rounded px-1 py-0.5 truncate outline-none transition-all"
                      title="クリックして名称を編集"
                    />
                  </div>
                  <span className={`inline-block min-w-7 px-1.5 py-0.5 text-xs font-bold rounded ${
                    count > 0 ? 'bg-blue-600 text-white shadow-xs' : 'bg-gray-100 dark:bg-slate-700 text-gray-400 dark:text-slate-400'
                  }`}>
                    {count}
                  </span>
                  <button
                    onClick={() => onAddIcon(icon.id)}
                    title="キャンバスに追加"
                    className="w-6 h-6 rounded bg-gray-100 dark:bg-slate-700 hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:text-blue-600 text-gray-500 dark:text-slate-300 flex items-center justify-center text-xs font-bold shrink-0 transition-colors"
                  >
                    ＋
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Template Parts (with count) */}
        {templateKeysWithCount.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-1 px-1">
              テンプレート パーツ
            </p>
            {templateKeysWithCount.map(key => {
              const tmplType = key.slice(5);
              const tmpl = TEMPLATE_SHAPES.find(t => t.type === tmplType);
              const count = counts[key] || 0;
              return (
                <div
                  key={key}
                  className="flex items-center gap-2 p-2 rounded-md hover:bg-gray-50 dark:hover:bg-slate-700/60 border border-gray-100 dark:border-slate-700 transition-colors"
                >
                  <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded flex items-center justify-center p-1 shrink-0">
                    {tmpl && (
                      <img src={getTemplateDataUrl(tmpl)} alt={tmpl.label} className="max-w-full max-h-full object-contain" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-700 dark:text-slate-200 truncate">
                      {tmpl?.label ?? tmplType}
                    </p>
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400">ベクターパーツ</p>
                  </div>
                  <span className="inline-block min-w-7 px-1.5 py-0.5 text-xs font-bold rounded bg-emerald-600 text-white shadow-xs">
                    {count}
                  </span>
                  <button
                    onClick={() => onAddIcon(key)}
                    title="キャンバスに追加"
                    className="w-6 h-6 rounded bg-gray-100 dark:bg-slate-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/40 hover:text-emerald-600 text-gray-500 dark:text-slate-300 flex items-center justify-center text-xs font-bold shrink-0 transition-colors"
                  >
                    ＋
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {extractedIcons.length === 0 && templateKeysWithCount.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-slate-500 text-center py-8">
            パーツを配置すると<br />ここに集計が表示されます
          </p>
        )}
      </div>
    </div>
  );
};

export default TallyTable;
