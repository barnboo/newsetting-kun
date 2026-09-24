import React, { useState, useRef } from 'react';
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

export interface Region {
  type: 'background' | 'icons' | 'quantities';
  crop: PixelCrop;
}

interface RegionSelectorProps {
  imageUrl: string;
  onComplete: (regions: Region[]) => void;
}

const MODE_CONFIG = {
  background: {
    step: 1,
    title: 'ステージ図面',
    required: true,
    tagColor: 'bg-blue-600 text-white',
    badgeColor: 'bg-blue-100 text-blue-800 border-blue-200',
    borderColor: 'border-blue-500',
    bgOverlay: 'bg-blue-500/20',
    desc: '客席やひな壇、舞台全体の枠線が含まれるステージ領域をドラッグして囲んでください。',
    tip: '💡 舞台枠やひな壇、周辺の余白を少し含めて広めに囲むと綺麗に配置できます。',
    icon: '🎭',
  },
  icons: {
    step: 2,
    title: '備品記号・アイコン一覧',
    required: true,
    tagColor: 'bg-emerald-600 text-white',
    badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    borderColor: 'border-emerald-500',
    bgOverlay: 'bg-emerald-500/20',
    desc: '譜面台・椅子・打楽器などの記号（アイコン）と名称が並んでいる一覧表エリアを囲んでください。',
    tip: '💡 記号一覧表を枠線ごと囲むと、システムが個別のアイコンを自動検出して切り出します。',
    icon: '🎺',
  },
  quantities: {
    step: 3,
    title: '個数記入欄',
    required: false,
    tagColor: 'bg-amber-600 text-white',
    badgeColor: 'bg-amber-100 text-amber-800 border-amber-200',
    borderColor: 'border-amber-500',
    bgOverlay: 'bg-amber-500/20',
    desc: '椅子や譜面台などの合計数量を記入する集計表枠がある場合、その領域を囲みます（省略可能）。',
    tip: '💡 個数記入欄がない用紙や、自動集計だけで十分な場合は指定せずにスキップできます。',
    icon: '📝',
  },
} as const;

export const RegionSelector: React.FC<RegionSelectorProps> = ({ imageUrl, onComplete }) => {
  const [crop, setCrop] = useState<Crop>();
  const [regions, setRegions] = useState<Region[]>([]);
  const [currentMode, setCurrentMode] = useState<'background' | 'icons' | 'quantities'>('background');
  const [imgNaturalSize, setImgNaturalSize] = useState<{ width: number; height: number } | null>(null);

  const imageRef = useRef<HTMLImageElement>(null);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setImgNaturalSize({ width: naturalWidth, height: naturalHeight });
  };

  const handleSaveRegion = () => {
    if (!crop || crop.width === 0 || crop.height === 0) {
      alert('画像の上をドラッグして、領域を四角く選択してください。');
      return;
    }

    const image = imageRef.current;
    if (!image) return;

    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;

    const pixelCrop: PixelCrop = {
      unit: 'px',
      x: crop.x * scaleX,
      y: crop.y * scaleY,
      width: crop.width * scaleX,
      height: crop.height * scaleY,
    };

    setRegions((prev) => [
      ...prev.filter(r => r.type !== currentMode),
      { type: currentMode, crop: pixelCrop },
    ]);

    setCrop(undefined);

    // Auto advance to next unselected mode
    if (currentMode === 'background') {
      const hasIcons = regions.some(r => r.type === 'icons');
      if (!hasIcons) {
        setCurrentMode('icons');
      }
    } else if (currentMode === 'icons') {
      const hasQuantities = regions.some(r => r.type === 'quantities');
      if (!hasQuantities) {
        // stay or suggest quantities
      }
    }
  };

  const handleClearRegion = (type: 'background' | 'icons' | 'quantities') => {
    setRegions(prev => prev.filter(r => r.type !== type));
    if (currentMode === type) {
      setCrop(undefined);
    }
  };

  const hasBackground = regions.some(r => r.type === 'background');
  const hasIcons = regions.some(r => r.type === 'icons');
  const hasQuantities = regions.some(r => r.type === 'quantities');
  const canProceed = hasBackground && hasIcons;

  const currentCfg = MODE_CONFIG[currentMode];
  const currentSavedRegion = regions.find(r => r.type === currentMode);

  return (
    <div className="flex flex-col items-center w-full max-w-6xl mx-auto pb-12">
      {/* ── Main Container ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200/90 w-full overflow-hidden">
        
        {/* ── Header ── */}
        <div className="px-6 py-5 border-b border-slate-100 bg-linear-to-r from-slate-50 via-white to-blue-50/30">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">✂️</span>
                <h2 className="text-lg font-bold text-slate-800">
                  領域の指定（ステージ図面と備品記号の切り出し）
                </h2>
                <span className="text-[11px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold">
                  STEP 2 / 4
                </span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                アップロードされたPDFから、配置スペースとなる<strong>「ステージ図面」</strong>と、配置パーツとなる<strong>「備品記号」</strong>の2つの領域をマウスで囲んで指定します。
              </p>
            </div>

            {/* Quick Status / Finish button */}
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => onComplete(regions)}
                disabled={!canProceed}
                className={`px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all shadow-sm ${
                  canProceed
                    ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20 hover:shadow-md cursor-pointer hover:scale-[1.02] active:scale-[0.98]'
                    : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-70'
                }`}
              >
                <span>次の段階に進む (ステージ配置へ)</span>
                <span className="text-sm">→</span>
              </button>
            </div>
          </div>
        </div>

        {/* ── Step Selection Tabs ── */}
        <div className="p-4 bg-slate-50/70 border-b border-slate-200/80">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(['background', 'icons', 'quantities'] as const).map(mode => {
              const cfg = MODE_CONFIG[mode];
              const isSelected = currentMode === mode;
              const isSaved = regions.some(r => r.type === mode);

              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setCurrentMode(mode)}
                  className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer relative flex flex-col justify-between ${
                    isSelected
                      ? `bg-white shadow-sm ring-2 ${
                          mode === 'background'
                            ? 'ring-blue-500 border-blue-400'
                            : mode === 'icons'
                            ? 'ring-emerald-500 border-emerald-400'
                            : 'ring-amber-500 border-amber-400'
                        }`
                      : 'bg-white/80 hover:bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{cfg.icon}</span>
                      <span className="text-xs font-bold text-slate-800">
                        {cfg.step}. {cfg.title}
                      </span>
                    </div>

                    {isSaved ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                        <span>✓</span> 選択完了
                      </span>
                    ) : cfg.required ? (
                      <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 border border-rose-200">
                        ※必須
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                        任意 (省略可)
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-slate-500 leading-snug line-clamp-2">
                    {cfg.desc}
                  </p>

                  {/* Active Indicator Bar */}
                  {isSelected && (
                    <div
                      className={`absolute bottom-0 left-3 right-3 h-0.5 rounded-full ${
                        mode === 'background'
                          ? 'bg-blue-600'
                          : mode === 'icons'
                          ? 'bg-emerald-600'
                          : 'bg-amber-600'
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Active Mode Instruction & Action Bar ── */}
        <div className="px-6 py-4 bg-white border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${currentCfg.tagColor}`}>
              {currentCfg.step}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold text-slate-800">
                  {currentCfg.title} を選択中
                </h3>
                {currentSavedRegion && (
                  <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-semibold">
                    設定済み ({Math.round(currentSavedRegion.crop.width)} × {Math.round(currentSavedRegion.crop.height)} px)
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 mt-0.5">
                {currentCfg.tip}
              </p>
            </div>
          </div>

          {/* Action buttons for current crop */}
          <div className="flex items-center gap-2 shrink-0">
            {crop && crop.width > 0 && crop.height > 0 ? (
              <button
                type="button"
                onClick={handleSaveRegion}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer transition-all hover:scale-[1.02]"
              >
                <span>💾</span>
                <span>この範囲で確定する</span>
              </button>
            ) : currentSavedRegion ? (
              <button
                type="button"
                onClick={() => handleClearRegion(currentMode)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-600 border border-slate-200 hover:border-rose-200 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                title="この領域の選択を解除して最初からやり直します"
              >
                <span>🔄</span>
                <span>選択を解除してやり直す</span>
              </button>
            ) : (
              <span className="text-xs text-slate-400 font-medium py-1.5 px-3 bg-slate-50 border border-dashed border-slate-200 rounded-lg">
                👇 下の画像上をドラッグして囲んでください
              </span>
            )}
          </div>
        </div>

        {/* ── Image Workspace with Crop & Saved Overlays ── */}
        <div className="p-6 bg-slate-100/80 flex flex-col items-center">
          <div className="max-w-full overflow-auto bg-white rounded-xl shadow-inner border border-slate-300 relative flex justify-center p-2">
            
            {/* The Image Container with Overlays */}
            <div className="relative inline-block select-none">
              <ReactCrop
                crop={crop}
                onChange={c => setCrop(c)}
                className="max-w-full"
              >
                <img
                  ref={imageRef}
                  src={imageUrl}
                  alt="セッティング用紙プレビュー"
                  onLoad={handleImageLoad}
                  className="max-w-full h-auto object-contain block mx-auto pointer-events-auto"
                  style={{ maxHeight: '72vh' }}
                />
              </ReactCrop>

              {/* Saved Region Overlay Boxes (Visible on top of the image) */}
              {imgNaturalSize && regions.map(reg => {
                const cfg = MODE_CONFIG[reg.type];
                const leftPct = (reg.crop.x / imgNaturalSize.width) * 100;
                const topPct = (reg.crop.y / imgNaturalSize.height) * 100;
                const widthPct = (reg.crop.width / imgNaturalSize.width) * 100;
                const heightPct = (reg.crop.height / imgNaturalSize.height) * 100;

                const isCurrentlyActive = currentMode === reg.type;

                return (
                  <div
                    key={reg.type}
                    style={{
                      left: `${leftPct}%`,
                      top: `${topPct}%`,
                      width: `${widthPct}%`,
                      height: `${heightPct}%`,
                    }}
                    className={`absolute pointer-events-none transition-all duration-200 border-2 ${cfg.borderColor} ${cfg.bgOverlay} ${
                      isCurrentlyActive ? 'ring-2 ring-white/80 ring-offset-1 z-20' : 'opacity-85 z-10'
                    }`}
                  >
                    {/* Badge Label inside overlay */}
                    <div className="absolute top-1.5 left-1.5 flex items-center gap-1 shadow-sm">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${cfg.tagColor} flex items-center gap-1`}>
                        <span>{cfg.icon}</span>
                        <span>{cfg.title}</span>
                        <span>✓</span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

          </div>

          <div className="mt-3 flex items-center justify-between w-full max-w-3xl px-2 text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <span>💡</span>
              <span>ドラッグで範囲指定後、上部の「この範囲で確定する」を押すと保存されます。</span>
            </span>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block"></span>
                <span>ステージ図面</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
                <span>備品アイコン</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span>
                <span>個数欄(任意)</span>
              </span>
            </div>
          </div>
        </div>

        {/* ── Bottom Summary & Proceed Bar ── */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-xs">
            <span className="font-bold text-slate-700">現在の選択状況:</span>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                hasBackground ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-500'
              }`}>
                {hasBackground ? '✓' : '⚠️'} ① ステージ図面
              </span>
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                hasIcons ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-500'
              }`}>
                {hasIcons ? '✓' : '⚠️'} ② 備品記号
              </span>
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                hasQuantities ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-400'
              }`}>
                {hasQuantities ? '✓' : '⚪'} ③ 個数欄 (任意)
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onComplete(regions)}
            disabled={!canProceed}
            className={`w-full sm:w-auto px-6 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-sm ${
              canProceed
                ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/25 hover:shadow-md cursor-pointer hover:scale-[1.02] active:scale-[0.98]'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
          >
            <span>次の段階に進む (ステージ配置へ)</span>
            <span className="text-sm">→</span>
          </button>
        </div>

      </div>
    </div>
  );
};
