import React, { useState, useEffect } from 'react';
import { getTemplateDataUrl, findMatchingTemplate, type TemplateShape } from '../utils/templateShapes';
import type { ExtractedIcon } from '../App';

interface MatchingDecision {
  iconId: string;
  iconLabel: string;
  iconUrl: string;
  matchedTemplate: TemplateShape | null;
  useTemplate: boolean;
}

interface TemplateMatchModalProps {
  extractedIcons: ExtractedIcon[];
  iconLabels: Record<string, string>;
  onConfirm: (decisions: MatchingDecision[]) => void;
  onSkip: () => void;
}

const TemplateMatchModal: React.FC<TemplateMatchModalProps> = ({
  extractedIcons,
  iconLabels,
  onConfirm,
  onSkip,
}) => {
  const buildDecisions = () =>
    extractedIcons.map((icon, idx) => {
      const label = iconLabels[icon.id] ?? icon.label ?? `パーツ ${idx + 1}`;
      const matched = findMatchingTemplate(label, idx);
      return {
        iconId: icon.id,
        iconLabel: label,
        iconUrl: icon.url,
        matchedTemplate: matched,
        useTemplate: matched !== null,
      };
    });

  const [decisions, setDecisions] = useState<MatchingDecision[]>(buildDecisions);

  useEffect(() => {
    setDecisions(buildDecisions());
  }, [extractedIcons, iconLabels]);

  const hasAnyMatch = decisions.some(d => d.matchedTemplate !== null);

  useEffect(() => {
    if (!hasAnyMatch) {
      onSkip();
    }
  }, [hasAnyMatch, onSkip]);

  if (!hasAnyMatch) {
    return null;
  }

  const handleToggle = (iconId: string) => {
    setDecisions(prev =>
      prev.map(d => d.iconId === iconId ? { ...d, useTemplate: !d.useTemplate } : d)
    );
  };

  const handleAllTemplate = () => {
    setDecisions(prev => prev.map(d => ({ ...d, useTemplate: d.matchedTemplate !== null })));
  };

  const handleAllPdf = () => {
    setDecisions(prev => prev.map(d => ({ ...d, useTemplate: false })));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden mx-4">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 shrink-0">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-xl shrink-0">
              💡
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                標準テンプレートへの置き換え確認
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                PDFから抽出したパーツに対応する綺麗なベクターパーツが見つかりました。<br />
                どちらを使用するか選択してください。
              </p>
            </div>
          </div>

          {/* Bulk Actions */}
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleAllTemplate}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              ✓ すべてテンプレートに置換
            </button>
            <button
              onClick={handleAllPdf}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
            >
              PDF画像のまま使う
            </button>
          </div>
        </div>

        {/* Item List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {decisions.map(d => (
            <div
              key={d.iconId}
              className={`rounded-xl border p-3 transition-all ${
                d.useTemplate && d.matchedTemplate
                  ? 'border-blue-200 bg-blue-50/40'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-center gap-3">
                {/* PDF Extracted Preview */}
                <div className="shrink-0 text-center">
                  <div className="w-16 h-16 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-center overflow-hidden">
                    <img src={d.iconUrl} alt={d.iconLabel} className="max-w-full max-h-full object-contain" />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">PDF抽出</p>
                </div>

                {/* Arrow */}
                {d.matchedTemplate && (
                  <>
                    <div className="text-slate-300 text-xl shrink-0">→</div>

                    {/* Template Preview */}
                    <div className="shrink-0 text-center">
                      <div className="w-16 h-16 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-center overflow-hidden">
                        <img
                          src={getTemplateDataUrl(d.matchedTemplate)}
                          alt={d.matchedTemplate.label}
                          className="max-w-full max-h-full object-contain p-1"
                        />
                      </div>
                      <p className="text-[10px] text-emerald-600 font-semibold mt-1">テンプレート</p>
                    </div>
                  </>
                )}

                {/* Labels and Toggle */}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-slate-800 truncate">{d.iconLabel}</p>
                  {d.matchedTemplate ? (
                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      {`「${d.matchedTemplate.label}」のベクターパーツに置き換えられます`}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-400 mt-0.5">対応するテンプレートなし</p>
                  )}

                  {d.matchedTemplate && (
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => d.useTemplate || handleToggle(d.iconId)}
                        className={`text-[11px] font-bold px-3 py-1 rounded-full border transition-all ${
                          d.useTemplate
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'
                        }`}
                      >
                        ◎ テンプレートを使う（推奨）
                      </button>
                      <button
                        onClick={() => d.useTemplate && handleToggle(d.iconId)}
                        className={`text-[11px] font-bold px-3 py-1 rounded-full border transition-all ${
                          !d.useTemplate
                            ? 'bg-slate-700 text-white border-slate-700'
                            : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                        }`}
                      >
                        ○ PDF画像のまま
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-100 shrink-0 flex justify-between items-center gap-3">
          <button
            onClick={onSkip}
            className="text-xs text-slate-500 hover:text-slate-700 font-medium px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            スキップ（PDF画像をすべて使用）
          </button>
          <button
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
