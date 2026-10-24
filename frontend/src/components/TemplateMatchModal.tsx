import React, { useState, useEffect } from 'react';
import { Sparkles, ArrowLeft } from 'lucide-react';
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
  onBack?: () => void;
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
  onBack,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-md animate-fadeIn">
      <div className="liquid-glass-heavy rounded-3xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden mx-4">
        {/* Header */}
        <div className="p-5 border-b border-slate-200/60 shrink-0 bg-white/40">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200/50">
            <button
              type="button"
              onClick={onBack || onSkip}
              className="liquid-btn px-3.5 py-1.5 text-xs font-bold text-slate-700 hover:text-slate-900 rounded-full transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs hover:scale-102 active:scale-98"
              title="一つ前の画面に戻る"
            >
              <ArrowLeft className="w-4 h-4 text-[#007AFF]" />
              <span>一つ前の画面に戻る</span>
            </button>
            <span className="text-[11px] text-slate-500 font-medium">
              テンプレート置き換え
            </span>
          </div>

          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#2e90fa] to-[#0055c0] text-white flex items-center justify-center shrink-0 shadow-sm border border-white/40">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 tracking-tight">
                標準テンプレートへの置き換え確認
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                PDFから抽出したパーツに対応する綺麗なベクターパーツをおすすめしています。<br />
                各パーツごとに「推奨テンプレ」「別のテンプレ」「PDF画像」から選択できます。
              </p>
            </div>
          </div>

          {/* Bulk Actions */}
          <div className="flex flex-wrap gap-2 mt-4">
            <button
              type="button"
              onClick={handleAllTemplate}
              className="liquid-btn-primary text-xs font-bold px-4 py-1.5 rounded-full text-white transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span>✓</span>
              <span>おすすめテンプレートに一括置換</span>
            </button>
            {(() => {
              const isAllPdf = decisions.every(d => d.choice === 'pdf');
              return (
                <button
                  type="button"
                  onClick={handleAllPdf}
                  className={`text-xs font-bold px-4 py-1.5 rounded-full transition-all flex items-center gap-1.5 cursor-pointer ${
                    isAllPdf
                      ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-sm ring-2 ring-amber-400/40'
                      : 'liquid-btn text-slate-700 hover:text-slate-900'
                  }`}
                >
                  <span>📄</span>
                  <span>すべてPDF画像のまま使う</span>
                </button>
              );
            })()}
          </div>
        </div>

        {/* Item List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-transparent">
          {decisions.map(d => {
            const isUsingTemplate = d.useTemplate && d.selectedTemplate !== null;

            return (
              <div
                key={d.iconId}
                className={`rounded-3xl p-4 transition-all border ${
                  isUsingTemplate
                    ? 'liquid-glass-card-accent'
                    : d.choice === 'pdf'
                    ? 'liquid-glass border-amber-400/50 bg-amber-500/8 dark:bg-amber-950/25 shadow-xs'
                    : 'liquid-glass-card opacity-90'
                }`}
              >
                <div className="flex items-start gap-3.5">
                  {/* PDF Extracted Preview */}
                  <div className="shrink-0 text-center">
                    <div className="w-16 h-16 liquid-glass-frame rounded-2xl flex items-center justify-center overflow-hidden">
                      <img src={d.iconUrl} alt={d.iconLabel} className="max-w-full max-h-full object-contain p-1" />
                    </div>
                    <p className="text-[10px] text-slate-400 font-medium mt-1">PDF抽出元</p>
                  </div>

                  {/* Arrow Indicator */}
                  <div className={`shrink-0 flex items-center justify-center self-center text-lg font-bold ${
                    isUsingTemplate ? 'text-[#007AFF]' : d.choice === 'pdf' ? 'text-amber-500' : 'text-slate-300'
                  }`}>
                    {isUsingTemplate ? '→' : d.choice === 'pdf' ? '➔' : '┄'}
                  </div>

                  {/* Template Preview / PDF Placeholder */}
                  <div className="shrink-0 text-center">
                    {isUsingTemplate && d.selectedTemplate ? (
                      <>
                        <div className="w-16 h-16 liquid-glass-frame rounded-2xl flex items-center justify-center overflow-hidden">
                          <img
                            src={getTemplateDataUrl(d.selectedTemplate)}
                            alt={d.selectedTemplate.label}
                            className="max-w-full max-h-full object-contain p-1.5"
                          />
                        </div>
                        <p className="text-[10px] text-emerald-700 dark:text-emerald-300 font-bold mt-1">テンプレート</p>
                      </>
                    ) : d.choice === 'pdf' ? (
                      <>
                        <div className="w-16 h-16 rounded-2xl flex items-center justify-center overflow-hidden border-2 border-amber-400/70 bg-white/80 dark:bg-slate-800/80 shadow-xs">
                          <img src={d.iconUrl} alt={d.iconLabel} className="max-w-full max-h-full object-contain p-1" />
                        </div>
                        <p className="text-[10px] text-amber-700 dark:text-amber-300 font-bold mt-1 flex items-center justify-center gap-0.5">
                          <span>📄</span>
                          <span>PDF画像配置</span>
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="w-16 h-16 liquid-glass rounded-2xl flex items-center justify-center text-slate-400 text-xs font-medium">
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
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#007AFF]/12 text-[#007AFF] font-semibold shrink-0">
                          おすすめ
                        </span>
                      )}
                      {d.choice === 'custom' && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/12 text-indigo-700 font-semibold shrink-0">
                          任意指定
                        </span>
                      )}
                      {d.choice === 'pdf' && (
                        <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-400/50 text-amber-800 dark:text-amber-200 font-bold shrink-0 flex items-center gap-1 shadow-2xs">
                          <span>📄</span>
                          <span>PDF画像を使用</span>
                        </span>
                      )}
                    </div>

                    {/* Status message */}
                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      {isUsingTemplate && d.selectedTemplate ? (
                        <span>
                          高画質ベクター「<strong className="text-slate-800">{d.selectedTemplate.label}</strong>」に置き換えます
                        </span>
                      ) : d.choice === 'pdf' ? (
                        <span className="text-amber-700 dark:text-amber-300 font-medium">
                          切り抜いたPDF画像をそのままキャンバスに配置します
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
                          className={`text-[11px] font-bold px-3 py-1 rounded-full transition-all flex items-center gap-1 cursor-pointer ${
                            d.choice === 'suggested'
                              ? 'liquid-btn-primary'
                              : 'liquid-btn text-slate-700'
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
                        className={`text-[11px] font-bold px-3 py-1 rounded-full transition-all flex items-center gap-1 cursor-pointer ${
                          d.choice === 'custom'
                            ? 'liquid-btn-primary'
                            : 'liquid-btn text-slate-700'
                        }`}
                      >
                        <span>◆</span>
                        <span>別のテンプレを選ぶ</span>
                      </button>

                      {/* Button 3: Keep PDF Image */}
                      <button
                        type="button"
                        onClick={() => handleSelectPdf(d.iconId)}
                        className={`text-[11px] font-bold px-3.5 py-1 rounded-full transition-all flex items-center gap-1 cursor-pointer ${
                          d.choice === 'pdf'
                            ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-xs ring-2 ring-amber-400/40'
                            : 'liquid-btn text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <span>{d.choice === 'pdf' ? '✓' : '○'}</span>
                        <span>PDF画像のまま</span>
                      </button>
                    </div>

                    {/* Dropdown for "別のテンプレを選ぶ" */}
                    {d.choice === 'custom' && (
                      <div className="mt-2 p-2.5 rounded-xl bg-indigo-500/8 border border-indigo-300/50 flex items-center gap-2">
                        <span className="text-[11px] font-bold text-indigo-900 shrink-0">
                          置換先テンプレ:
                        </span>
                        <select
                          value={d.selectedTemplate?.type || ''}
                          onChange={(e) => handleSelectCustom(d.iconId, e.target.value)}
                          className="flex-1 text-xs font-semibold bg-white/90 border border-indigo-300/80 rounded-lg px-2 py-1 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
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
        <div className="p-4 border-t border-slate-200/60 shrink-0 bg-white/50 flex flex-wrap justify-between items-center gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack || onSkip}
              className="liquid-btn text-xs font-semibold px-4 py-2 rounded-full text-slate-700 hover:text-slate-900 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>一つ前の画面に戻る</span>
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="text-xs text-slate-500 hover:text-slate-800 font-medium px-3.5 py-1.5 rounded-full hover:bg-black/5 transition-colors cursor-pointer"
            >
              スキップ（すべてPDF画像で配置）
            </button>
          </div>
          <button
            type="button"
            onClick={() => onConfirm(decisions)}
            className="liquid-btn-primary text-sm font-bold px-6 py-2.5 rounded-full text-white transition-all flex items-center gap-2 cursor-pointer"
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
