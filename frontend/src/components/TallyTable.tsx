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
  templateReplacements?: Record<string, string>;
  hoveredIconId?: string | null;
  onUpdateLabel: (iconId: string, label: string) => void;
  onAddIcon: (iconId: string) => void;
}

const TallyTable: React.FC<Props> = ({
  extractedIcons,
  placedItems,
  curveObjects = [],
  iconLabels,
  templateReplacements,
  hoveredIconId,
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

  // テンプレ置換されたID一覧
  const replacedTmplIdSet = React.useMemo(() => {
    return new Set(Object.values(templateReplacements || {}));
  }, [templateReplacements]);

  // テンプレートパーツ一覧のうち、PDFアイコンに置換（リンク）されていない独立テンプレートのみ
  const standaloneTemplateKeys = Object.keys(counts)
    .filter(k => k.startsWith('tmpl_') && counts[k] > 0 && !replacedTmplIdSet.has(k));

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
              const tmplId = templateReplacements?.[icon.id];
              const matchedTmpl = tmplId
                ? TEMPLATE_SHAPES.find(t => t.id === tmplId || t.type === tmplId.replace(/^tmpl_/, ''))
                : null;
              const effectiveTmplId = matchedTmpl ? (matchedTmpl.id || `tmpl_${matchedTmpl.type}`) : null;

              // 置換したテンプレパーツの数も含めて連動集計
              const rawCount = counts[icon.id] || 0;
              const tmplCount = effectiveTmplId ? (counts[effectiveTmplId] || 0) : 0;
              const count = rawCount + tmplCount;
              const label = iconLabels[icon.id] ?? (matchedTmpl?.label || `アイテム ${idx + 1}`);
              const isLinkedHovered = hoveredIconId === icon.id;

              return (
                <div
                  key={icon.id}
                  className={`group flex items-center gap-2 p-2 rounded-md transition-all border relative ${
                    matchedTmpl
                      ? `bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200/80 dark:border-emerald-800/60 hover:bg-emerald-50/80 dark:hover:bg-emerald-950/40 hover:border-emerald-400 ${
                          isLinkedHovered ? 'ring-2 ring-emerald-400 bg-emerald-100/60 dark:bg-emerald-900/40' : ''
                        }`
                      : 'border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/60'
                  }`}
                  title={matchedTmpl ? `ホバー中: PDF元画像を表示 | ${label}` : label}
                >
                  {/* 画像ラッパー (バッジを枠の外側に配置するため relative) */}
                  <div className="relative shrink-0">
                    <div className={`w-10 h-10 rounded flex items-center justify-center p-0.5 relative overflow-hidden transition-all ${
                      matchedTmpl
                        ? 'bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-700 group-hover:border-blue-400 group-hover:bg-white dark:group-hover:bg-slate-800'
                        : 'bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600'
                    }`}>
                      {matchedTmpl ? (
                        <>
                          {/* 通常表示: テンプレートベクター画像 */}
                          <img
                            src={getTemplateDataUrl(matchedTmpl)}
                            alt={matchedTmpl.label}
                            className={`max-w-full max-h-full object-contain pointer-events-none transition-opacity duration-150 ${
                              isLinkedHovered ? 'opacity-0' : 'opacity-100 group-hover:opacity-0'
                            }`}
                          />
                          {/* ホバー時: PDFから切り出した元画像に切り替え */}
                          <img
                            src={icon.url}
                            alt={`${icon.id} (PDF元画像)`}
                            className={`absolute inset-0.5 m-auto max-w-full max-h-full object-contain pointer-events-none transition-opacity duration-150 ${
                              isLinkedHovered ? 'opacity-100 scale-105' : 'opacity-0 group-hover:opacity-100 group-hover:scale-105'
                            }`}
                          />
                        </>
                      ) : (
                        <img src={icon.url} alt={icon.id} className="max-w-full max-h-full object-contain pointer-events-none" />
                      )}
                    </div>

                    {/* ホバー時: 画像枠の外側上部に表示する「PDF画像」フキダシバッジ */}
                    {matchedTmpl && (
                      <div
                        className={`absolute -top-3.5 left-1/2 -translate-x-1/2 pointer-events-none z-20 transition-all duration-150 flex flex-col items-center ${
                          isLinkedHovered
                            ? 'opacity-100 -translate-y-0.5'
                            : 'opacity-0 translate-y-0.5 group-hover:opacity-100 group-hover:-translate-y-0.5'
                        }`}
                      >
                        <span className="bg-blue-600 text-white text-[8px] font-bold px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap leading-none">
                          PDF画像
                        </span>
                        <div className="w-0 h-0 border-x-[3px] border-x-transparent border-t-[3px] border-t-blue-600 -mt-px" />
                      </div>
                    )}
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
                    {matchedTmpl && (
                      <div className="flex items-center gap-1 mt-0.5 px-0.5">
                        <span className="inline-flex items-center gap-0.5 text-[8.5px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100/90 dark:bg-emerald-900/60 px-1.5 py-0.2 rounded-full border border-emerald-200 dark:border-emerald-800">
                          <span>🔗</span>
                          <span>テンプレ連動中</span>
                        </span>
                      </div>
                    )}
                  </div>
                  <span className={`inline-block min-w-7 px-1.5 py-0.5 text-xs font-bold rounded ${
                    count > 0
                      ? (matchedTmpl ? 'bg-emerald-600 text-white shadow-xs' : 'bg-blue-600 text-white shadow-xs')
                      : 'bg-gray-100 dark:bg-slate-700 text-gray-400 dark:text-slate-400'
                  }`}>
                    {count}
                  </span>
                  <button
                    onClick={() => onAddIcon(effectiveTmplId || icon.id)}
                    title={matchedTmpl ? `キャンバスに「${matchedTmpl.label}」を追加` : "キャンバスに追加"}
                    className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
                      matchedTmpl
                        ? 'bg-emerald-100/80 dark:bg-emerald-900/40 hover:bg-emerald-200 dark:hover:bg-emerald-900/80 text-emerald-700 dark:text-emerald-300'
                        : 'bg-gray-100 dark:bg-slate-700 hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:text-blue-600 text-gray-500 dark:text-slate-300'
                    }`}
                  >
                    ＋
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Standalone Template Parts (not linked to any PDF icon) */}
        {standaloneTemplateKeys.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-1 px-1">
              その他のテンプレート
            </p>
            {standaloneTemplateKeys.map(key => {
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

        {extractedIcons.length === 0 && standaloneTemplateKeys.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-slate-500 text-center py-8">
            パーツを配置すると<br />ここに集計が表示されます
          </p>
        )}
      </div>
    </div>
  );
};

export default TallyTable;
