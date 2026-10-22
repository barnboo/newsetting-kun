import React, { useState, useEffect } from 'react';
import {
  getTemplateDataUrl,
  matchIconsToTemplates,
  TEMPLATE_SHAPES,
  type TemplateShape,
} from '../utils/templateShapes';
import type { ExtractedIcon } from '../App';

interface MatchingDecision {
  iconId: string;
  iconLabel: string;
  iconUrl: string;
  suggestedTemplate: TemplateShape | null;
  selectedTemplate: TemplateShape | null;
  choice: 'suggested' | 'custom' | 'pdf';
  // App.tsx との後方互換性フィールド
  matchedTemplate: TemplateShape | null;
  useTemplate: boolean;
}

interface TemplateMatchModalProps {
  extractedIcons: ExtractedIcon[];
  iconLabels: Record<string, string>;
  currentReplacements?: Record<string, string>;
  onConfirm: (decisions: MatchingDecision[]) => void;
  onSkip: () => void;
}

// テンプレートのカテゴリ別グループ定義
const TEMPLATE_GROUPS = [
  {
    category: '椅子類',
    items: TEMPLATE_SHAPES.filter(t => t.category === 'chairs'),
  },
  {
    category: '譜面台類',
    items: TEMPLATE_SHAPES.filter(t => t.category === 'stands'),
  },
  {
    category: '舞台・機材',
    items: TEMPLATE_SHAPES.filter(t => t.category === 'stage'),
  },
  {
    category: '打楽器',
    items: TEMPLATE_SHAPES.filter(t => t.category === 'percussion'),
  },
];

const TemplateMatchModal: React.FC<TemplateMatchModalProps> = ({
  extractedIcons,
  iconLabels,
  currentReplacements,
  onConfirm,
  onSkip,
}) => {
  const buildDecisions = (): MatchingDecision[] => {
    // 1. 全アイテムに対して重複なし・最適1対1マッチングを実行
    const iconItems = extractedIcons.map((icon, idx) => ({
      id: icon.id,
      label: iconLabels[icon.id] ?? icon.label ?? `パーツ ${idx + 1}`,
      index: idx,
    }));
    const matchMap = matchIconsToTemplates(iconItems);

    return extractedIcons.map((icon, idx) => {
      const label = iconLabels[icon.id] ?? icon.label ?? `パーツ ${idx + 1}`;
      const suggested = matchMap[icon.id] ?? null;

      // 既存の置換設定があればそれを最優先で復元
      const existingReplacementId = currentReplacements ? currentReplacements[icon.id] : undefined;
      let selected: TemplateShape | null = suggested;
      let choice: 'suggested' | 'custom' | 'pdf' = suggested ? 'suggested' : 'pdf';

      if (existingReplacementId) {
        const found = TEMPLATE_SHAPES.find(
          t => t.id === existingReplacementId || t.type === existingReplacementId.replace(/^tmpl_/, '')
        );
        if (found) {
          selected = found;
          choice = suggested && suggested.type === found.type ? 'suggested' : 'custom';
        }
      } else if (currentReplacements && Object.keys(currentReplacements).length > 0 && !existingReplacementId) {
        // すでに保存されたプロジェクトでこのアイテムが置換されていない場合
        choice = 'pdf';
      }

      const useTemplate = choice !== 'pdf' && selected !== null;

      return {
        iconId: icon.id,
        iconLabel: label,
        iconUrl: icon.url,
        suggestedTemplate: suggested,
        selectedTemplate: selected,
        choice,
        matchedTemplate: useTemplate ? selected : null,
        useTemplate,
      };
    });
  };

  const [decisions, setDecisions] = useState<MatchingDecision[]>(buildDecisions);

  useEffect(() => {
    setDecisions(buildDecisions());
  }, [extractedIcons, iconLabels, currentReplacements]);

  const hasAnyMatch = decisions.some(d => d.suggestedTemplate !== null || d.selectedTemplate !== null);

  useEffect(() => {
    if (!hasAnyMatch) {
      onSkip();
    }
  }, [hasAnyMatch, onSkip]);

  if (!hasAnyMatch) {
    return null;
  }

  // 1. 推奨テンプレートを使う
  const handleSelectSuggested = (iconId: string) => {
    setDecisions(prev =>
      prev.map(d => {
        if (d.iconId !== iconId) return d;
        const target = d.suggestedTemplate || d.selectedTemplate || TEMPLATE_SHAPES[0];
        return {
          ...d,
          choice: 'suggested',
          selectedTemplate: target,
          matchedTemplate: target,
          useTemplate: true,
        };
      })
    );
  };

  // 2. 別のテンプレを選ぶ（モーダル/ドロップダウン表示用）
  const handleSelectCustom = (iconId: string, templateType?: string) => {
    setDecisions(prev =>
      prev.map(d => {
        if (d.iconId !== iconId) return d;
        let target: TemplateShape | null = d.selectedTemplate;
        if (templateType) {
          target = TEMPLATE_SHAPES.find(t => t.type === templateType) || null;
        } else if (!target) {
          target = TEMPLATE_SHAPES[0];
        }
        return {
          ...d,
          choice: 'custom',
          selectedTemplate: target,
          matchedTemplate: target,
          useTemplate: true,
        };
      })
    );
  };

  // 3. PDF画像のまま使う
  const handleSelectPdf = (iconId: string) => {
    setDecisions(prev =>
      prev.map(d => {
        if (d.iconId !== iconId) return d;
        return {
          ...d,
          choice: 'pdf',
          matchedTemplate: null,
          useTemplate: false,
        };
      })
    );
  };

  // すべて推奨テンプレートに置換
  const handleAllTemplate = () => {
    setDecisions(prev =>
      prev.map(d => {
        if (d.suggestedTemplate) {
          return {
            ...d,
            choice: 'suggested',
            selectedTemplate: d.suggestedTemplate,
            matchedTemplate: d.suggestedTemplate,
            useTemplate: true,
          };
        }
        return {
          ...d,
          choice: 'pdf',
          matchedTemplate: null,
          useTemplate: false,
        };
      })
    );
  };

  // すべてPDF画像のまま使う
  const handleAllPdf = () => {
    setDecisions(prev =>
      prev.map(d => ({
        ...d,
        choice: 'pdf',
        matchedTemplate: null,
        useTemplate: false,
      }))
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden mx-4">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 shrink-0 bg-slate-50/50">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center text-xl shrink-0 shadow-sm">
              💡
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                標準テンプレートへの置き換え確認
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                PDFから抽出したパーツに対応する綺麗なベクターパーツをおすすめしています。<br />
                各パーツごとに「推奨テンプレ」「別のテンプレ」「PDF画像」から選択できます。
              </p>
            </div>
          </div>

          {/* Bulk Actions */}
          <div className="flex flex-wrap gap-2 mt-3.5">
            <button
              type="button"
              onClick={handleAllTemplate}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-xs transition-colors flex items-center gap-1.5"
            >
              <span>✓</span>
              <span>おすすめテンプレートに一括置換</span>
            </button>
            <button
              type="button"
              onClick={handleAllPdf}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors"
            >
              すべてPDF画像のまま使う
            </button>
          </div>
        </div>

        {/* Item List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-50/30">
          {decisions.map(d => {
            const isUsingTemplate = d.useTemplate && d.selectedTemplate !== null;

            return (
              <div
                key={d.iconId}
                className={`rounded-xl border p-3.5 transition-all shadow-xs ${
                  isUsingTemplate
                    ? 'border-blue-300 bg-white ring-1 ring-blue-100'
                    : 'border-slate-200 bg-white opacity-90'
                }`}
              >
                <div className="flex items-start gap-3.5">
                  {/* PDF Extracted Preview */}
                  <div className="shrink-0 text-center">
                    <div className="w-16 h-16 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-center overflow-hidden shadow-inner">
                      <img src={d.iconUrl} alt={d.iconLabel} className="max-w-full max-h-full object-contain p-1" />
                    </div>
                    <p className="text-[10px] text-slate-400 font-medium mt-1">PDF抽出元</p>
                  </div>

                  {/* Arrow Indicator */}
                  <div className="shrink-0 flex items-center justify-center self-center text-slate-300 text-lg">
                    {isUsingTemplate ? '→' : '┄'}
                  </div>

                  {/* Template Preview / PDF Placeholder */}
                  <div className="shrink-0 text-center">
                    {isUsingTemplate && d.selectedTemplate ? (
                      <>
                        <div className="w-16 h-16 bg-emerald-50/80 border border-emerald-300 rounded-lg flex items-center justify-center overflow-hidden shadow-inner">
                          <img
                            src={getTemplateDataUrl(d.selectedTemplate)}
                            alt={d.selectedTemplate.label}
                            className="max-w-full max-h-full object-contain p-1.5"
                          />
                        </div>
                        <p className="text-[10px] text-emerald-700 font-bold mt-1">テンプレート</p>
                      </>
                    ) : (
                      <>
                        <div className="w-16 h-16 bg-slate-100 border border-dashed border-slate-300 rounded-lg flex items-center justify-center text-slate-400 text-xs font-medium">
                          PDFのまま
                        </div>
                        <p className="text-[10px] text-slate-400 font-medium mt-1">元画像を配置</p>
                      </>
                    )}
                  </div>

                  {/* Right Side: Labels, Buttons, and Dropdown */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-bold text-sm text-slate-900 truncate">{d.iconLabel}</p>
                      {d.suggestedTemplate && d.choice === 'suggested' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold shrink-0">
                          おすすめ
                        </span>
                      )}
                      {d.choice === 'custom' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-semibold shrink-0">
                          任意指定
                        </span>
                      )}
                    </div>

                    {/* Status message */}
                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      {isUsingTemplate && d.selectedTemplate ? (
                        <span>
                          高画質ベクター「<strong className="text-slate-800">{d.selectedTemplate.label}</strong>」に置き換えます
                        </span>
                      ) : (
                        <span className="text-slate-400">PDFから切り出した元画像をそのまま配置します</span>
                      )}
                    </p>

                    {/* 3 Choice Buttons */}
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {/* Button 1: Recommended Template (if available) */}
                      {d.suggestedTemplate && (
                        <button
                          type="button"
                          onClick={() => handleSelectSuggested(d.iconId)}
                          className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1 ${
                            d.choice === 'suggested'
                              ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                              : 'bg-white text-slate-700 border-slate-300 hover:border-blue-400 hover:bg-blue-50/40'
                          }`}
                        >
                          <span>◎</span>
                          <span>推奨: {d.suggestedTemplate.label}</span>
                        </button>
                      )}

                      {/* Button 2: Choose Another Template */}
                      <button
                        type="button"
                        onClick={() => handleSelectCustom(d.iconId)}
                        className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1 ${
                          d.choice === 'custom'
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                            : 'bg-white text-slate-700 border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/40'
                        }`}
                      >
                        <span>◆</span>
                        <span>別のテンプレを選ぶ</span>
                      </button>

                      {/* Button 3: Keep PDF Image */}
                      <button
                        type="button"
                        onClick={() => handleSelectPdf(d.iconId)}
                        className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1 ${
                          d.choice === 'pdf'
                            ? 'bg-slate-700 text-white border-slate-700 shadow-xs'
                            : 'bg-white text-slate-500 border-slate-300 hover:border-slate-400 hover:bg-slate-100'
                        }`}
                      >
                        <span>○</span>
                        <span>PDF画像のまま</span>
                      </button>
                    </div>

                    {/* Dropdown for "別のテンプレを選ぶ" */}
                    {d.choice === 'custom' && (
                      <div className="mt-2 p-2 rounded-lg bg-indigo-50/60 border border-indigo-200 flex items-center gap-2">
                        <span className="text-[11px] font-bold text-indigo-900 shrink-0">
                          置換先テンプレ:
                        </span>
                        <select
                          value={d.selectedTemplate?.type || ''}
                          onChange={(e) => handleSelectCustom(d.iconId, e.target.value)}
                          className="flex-1 text-xs font-semibold bg-white border border-indigo-300 rounded-md px-2 py-1 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
                        >
                          {TEMPLATE_GROUPS.map(group => (
                            <optgroup key={group.category} label={`── ${group.category} ──`}>
                              {group.items.map(t => (
                                <option key={t.type} value={t.type}>
                                  {t.label}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-100 shrink-0 bg-white flex justify-between items-center gap-3">
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-slate-500 hover:text-slate-800 font-medium px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            スキップ（すべてPDF画像で配置）
          </button>
          <button
            type="button"
            onClick={() => onConfirm(decisions)}
            className="text-sm font-bold px-6 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-sm hover:shadow-md transition-all flex items-center gap-2"
          >
            <span>確定してステージ配置へ進む</span>
            <span>→</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export type { MatchingDecision };
export default TemplateMatchModal;
