import React, { useState, useRef, useEffect } from 'react';
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

export interface Region {
  type: 'background' | 'icons' | 'quantities';
  crop: PixelCrop;
  percentCrop?: { x: number; y: number; width: number; height: number };
}

interface RegionSelectorProps {
  imageUrl: string;
  onComplete: (regions: Region[]) => void;
}

const MODES = [
  {
    type: 'background' as const,
    label: '① ステージ図面',
    required: true,
    requiredLabel: '*必須',
    hint: '舞台全体の枠をドラッグで囲んでください',
    activeClass: 'bg-blue-50 text-blue-800 border-blue-500 ring-2 ring-blue-500/20 font-bold',
    borderColor: 'border-blue-500',
    bgOverlay: 'bg-blue-500/20',
    tagColor: 'bg-blue-600 text-white',
    dotColor: 'bg-blue-500',
    btnBg: 'bg-blue-600 hover:bg-blue-700',
  },
  {
    type: 'icons' as const,
    label: '② 記号一覧',
    required: false,
    requiredLabel: '任意',
    hint: '譜面台や椅子の記号一覧をドラッグで囲んでください（用紙にない場合はスキップ可）',
    activeClass: 'bg-emerald-50 text-emerald-800 border-emerald-500 ring-2 ring-emerald-500/20 font-bold',
    borderColor: 'border-emerald-500',
    bgOverlay: 'bg-emerald-500/20',
    tagColor: 'bg-emerald-600 text-white',
    dotColor: 'bg-emerald-500',
    btnBg: 'bg-emerald-600 hover:bg-emerald-700',
  },
  {
    type: 'quantities' as const,
    label: '③ 個数欄',
    required: false,
    requiredLabel: '任意',
    hint: '個数記入表をドラッグで囲んでください（用紙にない場合はスキップ可）',
    activeClass: 'bg-orange-50 text-orange-800 border-orange-500 ring-2 ring-orange-500/25 font-bold',
    borderColor: 'border-orange-500',
    bgOverlay: 'bg-orange-500/25',
    tagColor: 'bg-orange-600 text-white',
    dotColor: 'bg-orange-500',
    btnBg: 'bg-orange-600 hover:bg-orange-700',
  },
];

export const RegionSelector: React.FC<RegionSelectorProps> = ({ imageUrl, onComplete }) => {
  const [crop, setCrop] = useState<Crop>();
  const [regions, setRegions] = useState<Region[]>([]);
  const [currentMode, setCurrentMode] = useState<'background' | 'icons' | 'quantities'>('background');
  const [imgNaturalSize, setImgNaturalSize] = useState<{ width: number; height: number } | null>(null);

  const imageRef = useRef<HTMLImageElement>(null);

  const checkNaturalSize = () => {
    if (imageRef.current && imageRef.current.naturalWidth > 0) {
      setImgNaturalSize({
        width: imageRef.current.naturalWidth,
        height: imageRef.current.naturalHeight,
      });
    }
  };

  useEffect(() => {
    checkNaturalSize();
  }, [imageUrl]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setImgNaturalSize({ width: naturalWidth, height: naturalHeight });
  };

  const handleSaveRegion = () => {
    if (!crop || crop.width === 0 || crop.height === 0) {
      alert('ドラッグして領域を囲んでください。');
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

    const percentCrop = {
      x: (crop.x / image.width) * 100,
      y: (crop.y / image.height) * 100,
      width: (crop.width / image.width) * 100,
      height: (crop.height / image.height) * 100,
    };

    setRegions(prev => [
      ...prev.filter(r => r.type !== currentMode),
      { type: currentMode, crop: pixelCrop, percentCrop },
    ]);

    setCrop(undefined);

    // Auto-advance to next mode to prevent accidental overwrites
    if (currentMode === 'background') {
      if (!regions.some(r => r.type === 'icons')) {
        setCurrentMode('icons');
      } else if (!regions.some(r => r.type === 'quantities')) {
        setCurrentMode('quantities');
      }
    } else if (currentMode === 'icons') {
      if (!regions.some(r => r.type === 'quantities')) {
        setCurrentMode('quantities');
      }
    }
  };

  const handleClearRegion = (type: 'background' | 'icons' | 'quantities') => {
    setRegions(prev => prev.filter(r => r.type !== type));
    if (currentMode === type) {
      setCrop(undefined);
    }
  };

  // Only ① background is strictly required; ② icons and ③ quantities are optional!
  const hasBackground = regions.some(r => r.type === 'background');
  const canProceed = hasBackground;

  const currentCfg = MODES.find(m => m.type === currentMode)!;
  const currentSaved = regions.find(r => r.type === currentMode);
  const hasValidCrop = Boolean(crop && crop.width && crop.height && crop.width > 0 && crop.height > 0);

  return (
    <div className="flex flex-col items-center w-full max-w-5xl mx-auto select-none">
      {/* ── Compact Header & Toolbar (DADS compliant) ── */}
      <div className="w-full bg-white rounded-lg shadow-2xs border border-slate-300 p-3 mb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          
          {/* Step Segmented Buttons */}
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-md border border-slate-200">
            {MODES.map(m => {
              const isSelected = currentMode === m.type;
              const isSaved = regions.some(r => r.type === m.type);

              return (
                <button
                  key={m.type}
                  type="button"
                  onClick={() => {
                    setCrop(undefined);
                    setCurrentMode(m.type);
                  }}
                  className={`px-3 py-1.5 rounded-md text-xs transition-all flex items-center gap-1.5 cursor-pointer border ${
                    isSelected
                      ? m.activeClass
                      : 'border-transparent text-slate-700 hover:text-slate-900 hover:bg-slate-200 font-medium'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${m.dotColor}`} />
                  <span>{m.label}</span>
                  <span
                    className={`text-xs ${
                      isSaved
                        ? 'text-emerald-700 font-bold'
                        : m.required
                        ? 'text-rose-600 font-bold text-[10px]'
                        : 'text-slate-500 text-[10px]'
                    }`}
                  >
                    {isSaved ? '✓ 確定済' : m.requiredLabel}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {hasValidCrop ? (
              <button
                key="confirm-btn"
                type="button"
                onClick={handleSaveRegion}
                className={`px-4 py-1.5 text-white rounded-md text-xs font-bold flex items-center gap-1.5 shadow-2xs cursor-pointer transition-all hover:opacity-90 ${currentCfg.btnBg}`}
              >
                <span>💾</span>
                <span>{currentCfg.label} を確定する</span>
              </button>
            ) : null}

            {!hasValidCrop && currentSaved ? (
              <button
                key="redo-btn"
                type="button"
                onClick={() => handleClearRegion(currentMode)}
                className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded-md text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
              >
                <span>🔄</span>
                <span>やり直す</span>
              </button>
            ) : null}

            <div className="h-5 w-px bg-slate-300 mx-1" />

            <button
              key="proceed-btn"
              type="button"
              onClick={() => onComplete(regions)}
              disabled={!canProceed}
              title={!canProceed ? '① ステージ図面を指定してください' : 'ステージ配置へ進む'}
              className={`px-4 py-2 rounded-md text-xs sm:text-sm font-bold flex items-center gap-1.5 transition-all focus:ring-4 focus:ring-amber-300 ${
                canProceed
                  ? 'bg-[#0055c0] hover:bg-[#004098] active:bg-[#002966] text-white shadow-2xs cursor-pointer'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300'
              }`}
            >
              <span>次へ進む (ステージ配置)</span>
              <span>→</span>
            </button>
          </div>

        </div>

        {/* 1-Line Instruction Hint */}
        <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600 px-1">
          <div className="flex items-center gap-2">
            <span className={`font-bold ${
              currentMode === 'background' ? 'text-blue-700' : currentMode === 'icons' ? 'text-emerald-700' : 'text-orange-700'
            }`}>
              {currentCfg.label}:
            </span>
            <span>{currentCfg.hint}</span>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              <span>図面 (必須)</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>記号 (任意)</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-orange-500" />
              <span>個数 (任意)</span>
            </span>
          </div>
        </div>
      </div>

      {/* ── Image Workspace ── */}
      <div className={`w-full bg-slate-100 rounded-xl border border-slate-200 p-2 flex justify-center overflow-auto max-h-[78vh] crop-mode-${currentMode}`}>
        <div className="relative inline-block select-none bg-white shadow-xs rounded">
          <ReactCrop
            crop={crop}
            onChange={c => setCrop(c)}
            className="max-w-full"
          >
            <img
              ref={imageRef}
              src={imageUrl}
              alt="セッティング用紙"
              onLoad={handleImageLoad}
              className="max-w-full h-auto object-contain block mx-auto"
              style={{ maxHeight: '74vh' }}
            />
          </ReactCrop>

          {/* Overlaid Saved Regions */}
          {regions.map(reg => {
            const cfg = MODES.find(m => m.type === reg.type)!;
            const isActive = currentMode === reg.type;

            // Prefer precomputed percentCrop, fallback to image natural size
            let leftPct = reg.percentCrop?.x;
            let topPct = reg.percentCrop?.y;
            let widthPct = reg.percentCrop?.width;
            let heightPct = reg.percentCrop?.height;

            if (leftPct === undefined && imgNaturalSize && imgNaturalSize.width > 0) {
              leftPct = (reg.crop.x / imgNaturalSize.width) * 100;
              topPct = (reg.crop.y / imgNaturalSize.height) * 100;
              widthPct = (reg.crop.width / imgNaturalSize.width) * 100;
              heightPct = (reg.crop.height / imgNaturalSize.height) * 100;
            }

            if (leftPct === undefined || widthPct === undefined) return null;

            return (
              <div
                key={reg.type}
                style={{
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  width: `${widthPct}%`,
                  height: `${heightPct}%`,
                }}
                className={`absolute pointer-events-none border-[2.5px] ${cfg.borderColor} ${cfg.bgOverlay} ${
                  isActive ? 'ring-2 ring-white/90 shadow-md z-20' : 'opacity-90 z-10'
                }`}
              >
                <span className={`absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-bold shadow-xs ${cfg.tagColor}`}>
                  {cfg.label} ✓
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
