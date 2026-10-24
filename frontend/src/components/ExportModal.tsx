import React, { useState } from 'react';
import type { ExtractedIcon } from '../App';
import type { PlacedItem } from './StageCanvas';

interface Props {
  extractedIcons: ExtractedIcon[];
  placedItems: PlacedItem[];
  iconLabels: Record<string, string>;
  onClose: () => void;
  onExport: (meta: {
    organizationName: string;
    conductorName: string;
    programNumber: string;
    pianoLid: string;
  }) => Promise<string | null>; // returns download URL
}

const ExportModal: React.FC<Props> = ({
  extractedIcons,
  placedItems,
  iconLabels,
  onClose,
  onExport,
}) => {
  const [organizationName, setOrganizationName] = useState('');
  const [conductorName, setConductorName] = useState('');
  const [programNumber, setProgramNumber] = useState('');
  const [pianoLid, setPianoLid] = useState('半開');
  const [isExporting, setIsExporting] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  // Compute live tallies
  const counts = placedItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.iconId] = (acc[item.iconId] || 0) + 1;
    return acc;
  }, {});

  const handleStartExport = async () => {
    setIsExporting(true);
    try {
      const url = await onExport({
        organizationName,
        conductorName,
        programNumber,
        pianoLid,
      });
      if (url) {
        setDownloadUrl(url);
      }
    } catch (err) {
      console.error(err);
      alert('PDFの出力に失敗しました。');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 shrink-0">
          <div>
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <span className="font-mono text-sm px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold">PDF</span>
              提出用PDFの作成・出力
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              公式の提出書類フォーマットに、配置図と集計個数を合成します。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 rounded-lg p-1.5 hover:bg-gray-200 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1">
          {downloadUrl ? (
            /* Success & Download Screen */
            <div key="success-screen" className="flex flex-col items-center justify-center py-6 text-center space-y-4">
              <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-3xl shadow-xs">
                ✓
              </div>
              <div>
                <h4 className="text-lg font-bold text-gray-800">
                  完成版PDFが正常に生成されました！
                </h4>
                <p className="text-sm text-gray-500 mt-1">
                  以下のボタンからダウンロード、またはブラウザで確認できます。
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <a
                  href={downloadUrl}
                  download="stage_setting_completed.pdf"
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2.5 rounded-lg shadow-sm flex items-center gap-2 transition-colors"
                >
                  <span className="font-bold">↓</span>
                  <span>PDFをダウンロード</span>
                </a>
                <a
                  href={downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold px-5 py-2.5 rounded-lg border border-gray-300 transition-colors flex items-center gap-1.5"
                >
                  <span className="font-bold">↗</span>
                  <span>ブラウザで開く</span>
                </a>
              </div>
            </div>
          ) : (
            <div key="form-screen" className="space-y-6">
              {/* Form Meta Fields */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold text-gray-700 border-b border-gray-100 pb-1.5">
                  1. 書類ヘッダー情報（任意入力）
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      団体名
                    </label>
                    <input
                      type="text"
                      value={organizationName}
                      onChange={(e) => setOrganizationName(e.target.value)}
                      placeholder="例: 〇〇高等学校吹奏楽部"
                      className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      指揮者氏名
                    </label>
                    <input
                      type="text"
                      value={conductorName}
                      onChange={(e) => setConductorName(e.target.value)}
                      placeholder="例: 山田 太郎"
                      className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      プログラム番
                    </label>
                    <input
                      type="text"
                      value={programNumber}
                      onChange={(e) => setProgramNumber(e.target.value)}
                      placeholder="例: 12"
                      className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      ピアノ蓋の開閉状態
                    </label>
                    <select
                      value={pianoLid}
                      onChange={(e) => setPianoLid(e.target.value)}
                      className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none bg-white"
                    >
                      <option value="半開">半開</option>
                      <option value="全開">全開</option>
                      <option value="閉">閉</option>
                      <option value="蒲鉾板">蒲鉾板</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Tally Confirmation Table */}
              <div className="space-y-3">
                <div className="flex justify-between items-center border-b border-gray-100 pb-1.5">
                  <h4 className="text-sm font-bold text-gray-700">
                    2. 自動印字される集計内容の確認
                  </h4>
                  <span className="text-xs text-blue-600 font-semibold">
                    合計 {placedItems.length} 個配置済み
                  </span>
                </div>

                <div className="border border-gray-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
                      <tr>
                        <th className="py-2 px-3 font-semibold">アイコン</th>
                        <th className="py-2 px-3 font-semibold">品名 / ラベル</th>
                        <th className="py-2 px-3 font-semibold text-right">配置個数</th>
                        <th className="py-2 px-3 font-semibold text-center">印字扱い</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-gray-700">
                      {extractedIcons.map((icon, idx) => {
                        const count = counts[icon.id] || 0;
                        const label = iconLabels[icon.id] ?? `パーツ ${idx + 1}`;
                        const isChairOrStand = /椅子|譜面台|机|台/.test(label);

                        return (
                          <tr key={icon.id} className="hover:bg-gray-50/80">
                            <td className="py-1.5 px-3">
                              <img
                                src={icon.url}
                                alt={icon.id}
                                className="w-6 h-6 object-contain"
                              />
                            </td>
                            <td className="py-1.5 px-3 font-medium">{label}</td>
                            <td className="py-1.5 px-3 text-right">
                              <span
                                className={`inline-block px-2 py-0.5 rounded font-bold ${
                                  count > 0 ? 'bg-blue-100 text-blue-800' : 'text-gray-400'
                                }`}
                              >
                                {count}
                              </span>
                            </td>
                            <td className="py-1.5 px-3 text-center text-[11px] text-gray-500">
                              {isChairOrStand
                                ? count > 0
                                  ? `数字「${count}」を印字`
                                  : '未配置 (印字なし)'
                                : count > 0
                                ? '「要」に○印'
                                : '「不要」に○印'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {!downloadUrl && (
          <div className="px-6 py-3.5 bg-gray-50 border-t border-gray-200 flex justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isExporting}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              <span>キャンセル</span>
            </button>
            <button
              type="button"
              onClick={handleStartExport}
              disabled={isExporting}
              className="px-5 py-2 text-sm font-bold text-white bg-blue-600 rounded-md hover:bg-blue-700 shadow-sm transition-colors flex items-center gap-2 disabled:bg-blue-300 cursor-pointer disabled:cursor-not-allowed"
            >
              {isExporting ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
                  <span>PDF作成中...</span>
                </>
              ) : (
                <>
                  <span className="shrink-0 font-bold">↓</span>
                  <span>PDFを作成・出力する</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ExportModal;
