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
  onUpdateLabel: (iconId: string, label: string) => void;
  onAddIcon: (iconId: string) => void;
}

const TallyTable: React.FC<Props> = ({
  extractedIcons,
  placedItems,
  curveObjects = [],
  iconLabels,
  templateReplacements,
  onUpdateLabel,
  onAddIcon,
}) => {
  // ヘルパー: アイテムが打楽器の場合の集計キーを判定（PDFの特定打楽器・打楽器枠に合算、または tmpl_percussion に集約）
  const getPercussionCountKey = (pType?: string): string => {
    // 1. もしPDF抽出アイコンの中にこの打楽器名（例: チャイム、ドラ等）と合致するラベルがあればそのアイコンID
    if (pType && extractedIcons.length > 0) {
      const matchedSpecific = extractedIcons.find(ic => {
        const lbl = (iconLabels[ic.id] || ic.label || '').trim();
        return lbl === pType;
      });
      if (matchedSpecific) return matchedSpecific.id;
    }
    // 2. もしPDF抽出アイコンの中に「打楽器」「パーカッション」等があり、tmpl_percussion に置換されているか打楽器ラベルなら
    if (extractedIcons.length > 0) {
      const generalPerc = extractedIcons.find(ic => {
        if (templateReplacements?.[ic.id] === 'tmpl_percussion' || templateReplacements?.[ic.id] === 'percussion') return true;
        const lbl = (iconLabels[ic.id] || ic.label || '').trim();
        return lbl.includes('打楽器') || lbl.includes('パーカッション') || lbl.toLowerCase().includes('perc');
      });
      if (generalPerc) {
        if (templateReplacements?.[generalPerc.id]) {
          return 'tmpl_percussion';
        }
        return generalPerc.id;
      }
    }
    return 'tmpl_percussion';
  };

  // Count items per iconId (placed items)
  const counts: Record<string, number> = {};
  for (const item of placedItems) {
    if (item.templateType === 'ensembleChairAndStand') {
      const isPiano = item.chairType === 'pianoChair' || item.chairType === 'pianoChairSvg' || item.chairType === 'pianoChairPi';
      const chairKey = isPiano ? 'tmpl_pianoChair' : 'tmpl_chorusChair';
      counts[chairKey] = (counts[chairKey] || 0) + 1;
      counts['tmpl_ensembleStand'] = (counts['tmpl_ensembleStand'] || 0) + 1;
    } else if (
      item.templateType === 'percussion' ||
      Boolean(item.percussionType) ||
      item.iconId === 'tmpl_percussion' ||
      item.iconId.startsWith('tmpl_percussion_')
    ) {
      const pKey = getPercussionCountKey(item.percussionType);
      counts[pKey] = (counts[pKey] || 0) + 1;
    } else {
      counts[item.iconId] = (counts[item.iconId] || 0) + 1;
    }
  }

  // Count items in curve objects
  for (const curve of curveObjects) {
    if (Array.isArray(curve.items)) {
      for (const it of curve.items) {
        if (
          it.type === 'percussion' ||
          Boolean(it.percussionType) ||
          it.iconId === 'tmpl_percussion' ||
          (it.iconId && it.iconId.startsWith('tmpl_percussion_'))
        ) {
          const pKey = getPercussionCountKey(it.percussionType);
          counts[pKey] = (counts[pKey] || 0) + 1;
        } else if (it.isCustom && it.iconId) {
          counts[it.iconId] = (counts[it.iconId] || 0) + 1;
        } else if (it.type === 'ensembleChairAndStand') {
          const effectiveChairType = it.chairType || curve.chairType;
          const isPiano = effectiveChairType === 'pianoChair' || effectiveChairType === 'pianoChairSvg' || effectiveChairType === 'pianoChairPi';
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
        const isPiano = curve.chairType === 'pianoChair' || curve.chairType === 'pianoChairSvg' || curve.chairType === 'pianoChairPi';
        const chairKey = isPiano ? 'tmpl_pianoChair' : 'tmpl_chorusChair';
        counts[chairKey] = (counts[chairKey] || 0) + curve.itemCount;
        counts['tmpl_ensembleStand'] = (counts['tmpl_ensembleStand'] || 0) + curve.itemCount;
      } else if (tmplType === 'percussion' || tmplType?.startsWith('percussion_')) {
        const pKey = getPercussionCountKey(curve.percussionType);
        counts[pKey] = (counts[pKey] || 0) + curve.itemCount;
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
    <div className="flex flex-col h-full bg-transparent text-slate-800 dark:text-slate-100 overflow-hidden w-full transition-colors">
      <div className="p-3.5 bg-white/40 dark:bg-slate-800/40 border-b border-white/60 dark:border-white/10 flex justify-between items-center shrink-0">
        <h3 className="font-bold text-slate-800 dark:text-slate-100 text-xs sm:text-sm flex items-center gap-1.5 tracking-tight">
          <span className="font-bold">∑</span>
          リアルタイム集計
        </h3>
        <span className="liquid-glass-pill text-[#007AFF] dark:text-sky-300 text-xs font-bold px-3 py-0.5 rounded-full">
          合計: {totalCount} 個
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
        {/* PDF Extracted Icons */}
        {extractedIcons.length > 0 && (
          <div className="space-y-1.5">
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
              return (
                <div
                  key={icon.id}
                  className={`group flex items-center gap-2 p-2 rounded-2xl transition-all duration-200 relative ${
                    matchedTmpl
                      ? 'liquid-glass-card-accent'
                      : 'liquid-glass-card'
                  }`}
                  title={matchedTmpl ? `ホバー中: PDF元画像を表示 | ${label}` : label}
                >
                  {/* 画像ラッパー (バッジを枠の外側に配置するため relative) */}
                  <div className="relative shrink-0">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center p-0.5 relative overflow-hidden transition-all liquid-glass-frame group-hover:scale-105">
                      {matchedTmpl ? (
                        <>
                          {/* 通常表示: テンプレートベクター画像 */}
                          <img
                            src={getTemplateDataUrl(matchedTmpl)}
                            alt={matchedTmpl.label}
                            className="max-w-full max-h-full object-contain pointer-events-none transition-opacity duration-150 opacity-100 group-hover:opacity-0"
                          />
                          {/* ホバー時: PDFから切り出した元画像に切り替え */}
                          <img
                            src={icon.url}
                            alt={`${icon.id} (PDF元画像)`}
                            className="absolute inset-0.5 m-auto max-w-full max-h-full object-contain pointer-events-none transition-opacity duration-150 opacity-0 group-hover:opacity-100 group-hover:scale-105"
                          />
                        </>
                      ) : (
                        <img src={icon.url} alt={icon.id} className="max-w-full max-h-full object-contain pointer-events-none" />
                      )}
                    </div>

                    {/* ホバー時: 画像枠の外側上部に表示する「PDF画像」フキダシバッジ */}
                    {matchedTmpl && (
                      <div
                        className="absolute -top-3.5 left-1/2 -translate-x-1/2 pointer-events-none z-20 transition-all duration-150 flex flex-col items-center opacity-0 translate-y-0.5 group-hover:opacity-100 group-hover:-translate-y-0.5"
                      >
                        <span className="bg-[#007AFF] text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full shadow-sm whitespace-nowrap leading-none">
                          PDF画像
                        </span>
                        <div className="w-0 h-0 border-x-[3px] border-x-transparent border-t-[3px] border-t-[#007AFF] -mt-px" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <input
                      type="text"
                      value={label}
                      onChange={e => onUpdateLabel(icon.id, e.target.value)}
                      placeholder={`アイテム ${idx + 1}`}
                      className="w-full text-xs font-semibold text-slate-700 dark:text-slate-200 bg-transparent border border-transparent hover:border-white/60 focus:border-[#007AFF] focus:bg-white/90 dark:focus:bg-slate-800 rounded-lg px-1.5 py-0.5 truncate outline-none transition-all"
                      title="クリックして名称を編集"
                    />
                    {matchedTmpl && (
                      <div className="flex items-center gap-1 mt-0.5 px-0.5">
                        <span className="inline-flex items-center gap-1 text-[8.5px] font-bold text-lime-900 dark:text-lime-200 liquid-glass-pill px-2 py-0.5 rounded-full">
                          <span>⇄</span>
                          <span>テンプレ連動中</span>
                        </span>
                      </div>
                    )}
                  </div>
                  <span className={`inline-flex items-center justify-center min-w-7 px-2 py-0.5 text-xs font-bold rounded-full ${
                    count > 0
                      ? (matchedTmpl ? 'liquid-glass-badge-mint' : 'bg-gradient-to-b from-sky-400 to-[#007AFF] text-white shadow-xs')
                      : 'bg-slate-200/60 dark:bg-slate-700/60 text-slate-400 dark:text-slate-400'
                  }`}>
                    {count}
                  </span>
                  <button
                    onClick={() => onAddIcon(effectiveTmplId || icon.id)}
                    title={matchedTmpl ? `キャンバスに「${matchedTmpl.label}」を追加` : "キャンバスに追加"}
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 cursor-pointer ${
                      matchedTmpl
                        ? 'liquid-glass-btn-accent'
                        : 'liquid-btn hover:!bg-[#007AFF] hover:!text-white text-slate-600 dark:text-slate-300'
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
          <div className="mt-3 space-y-1.5">
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
                  className="flex items-center gap-2 p-2 rounded-2xl liquid-glass-card transition-all"
                >
                  <div className="w-10 h-10 liquid-glass-frame rounded-xl flex items-center justify-center p-1 shrink-0">
                    {tmpl && (
                      <img src={getTemplateDataUrl(tmpl)} alt={tmpl.label} className="max-w-full max-h-full object-contain" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                      {tmpl?.label ?? tmplType}
                    </p>
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">ベクターパーツ</p>
                  </div>
                  <span className="inline-flex items-center justify-center min-w-7 px-2 py-0.5 text-xs font-bold rounded-full liquid-glass-badge-mint">
                    {count}
                  </span>
                  <button
                    onClick={() => onAddIcon(key)}
                    title="キャンバスに追加"
                    className="w-6 h-6 rounded-full liquid-glass-btn-accent flex items-center justify-center text-xs font-bold shrink-0 cursor-pointer"
                  >
                    ＋
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {extractedIcons.length === 0 && standaloneTemplateKeys.length === 0 && (
          <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-8">
            パーツを配置すると<br />ここに集計が表示されます
          </p>
        )}
      </div>
    </div>
  );
};

export default React.memo(TallyTable);
