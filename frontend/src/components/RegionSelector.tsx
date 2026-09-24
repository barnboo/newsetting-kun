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

const MODES = [
  {
    type: 'background' as const,
    label: '① ステージ図面',
    required: true,
    hint: '舞台全体の枠をドラッグで囲んでください',
    color: 'blue',
    borderColor: 'border-blue-500',
    bgOverlay: 'bg-blue-500/20',
    tagColor: 'bg-blue-600 text-white',
  },
  {
    type: 'icons' as const,
    label: '② 記号一覧',
    required: true,
    hint: '譜面台や椅子などの記号一覧をドラッグで囲んでください',
    color: 'emerald',
    borderColor: 'border-emerald-500',
    bgOverlay: 'bg-emerald-500/20',
    tagColor: 'bg-emerald-600 text-white',
  },
  {
    type: 'quantities' as const,
    label: '③ 個数欄',
    required: false,
    hint: '個数記入表をドラッグで囲んでください（なければ省略可）',
    color: 'amber',
    borderColor: 'border-amber-500',
    bgOverlay: 'bg-amber-500/20',
    tagColor: 'bg-amber-600 text-white',
  },
];

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

    setRegions(prev => [
      ...prev.filter(r => r.type !== currentMode),
      { type: currentMode, crop: pixelCrop },
    ]);

    setCrop(undefined);

    // Auto-advance to next needed step
    if (currentMode === 'background') {
      if (!regions.some(r => r.type === 'icons')) {
        setCurrentMode('icons');
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
  const canProceed = hasBackground && hasIcons;

  const currentCfg = MODES.find(m => m.type === currentMode)!;
  const currentSaved = regions.find(r => r.type === currentMode);

  return (
    <div className="flex flex-col items-center w-full max-w-5xl mx-auto">
      {/* ── Compact Header & Toolbar ── */}
      <div className="w-full bg-white rounded-xl shadow-xs border border-slate-200 p-3 mb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          
          {/* Step Segmented Buttons */}
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg">
            {MODES.map(m => {
              const isSelected = currentMode === m.type;
              const isSaved = regions.some(r => r.type === m.type);

              return (
                <button
                  key={m.type}
                  type="button"
                  onClick={() => setCurrentMode(m.type)}
                  className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    isSelected
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${
                    m.type === 'background' ? 'bg-blue-500' : m.type === 'icons' ? 'bg-emerald-500' : 'bg-amber-500'
                  }`} />
                  <span>{m.label}</span>
                  {isSaved ? (
                    <span className="text-emerald-600 text-xs">✓</span>
                  ) : m.required ? (
                    <span className="text-[10px] text-rose-500 font-semibold">*必須</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {crop && crop.width > 0 && crop.height > 0 ? (
              <button
                type="button"
                onClick={handleSaveRegion}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
              >
                <span>💾</span>
                <span>確定する</span>
              </button>
            ) : currentSaved ? (
              <button
                type="button"
                onClick={() => handleClearRegion(currentMode)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
              >
                <span>🔄</span>
                <span>やり直す</span>
              </button>
            ) : null}

            <div className="h-4 w-px bg-slate-200 mx-1" />

            <button
              type="button"
              onClick={() => onComplete(regions)}
              disabled={!canProceed}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                canProceed
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              <span>次へ (配置)</span>
              <span>→</span>
            </button>
          </div>

        </div>

        {/* 1-Line Instruction Hint */}
        <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600 px-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800">{currentCfg.label}:</span>
            <span>{currentCfg.hint}</span>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              <span>図面</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>記号</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span>個数(任意)</span>
            </span>
          </div>
        </div>
      </div>

      {/* ── Image Workspace ── */}
      <div className="w-full bg-slate-100 rounded-xl border border-slate-200 p-2 flex justify-center overflow-auto max-h-[78vh]">
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
          {imgNaturalSize && regions.map(reg => {
            const cfg = MODES.find(m => m.type === reg.type)!;
            const leftPct = (reg.crop.x / imgNaturalSize.width) * 100;
            const topPct = (reg.crop.y / imgNaturalSize.height) * 100;
            const widthPct = (reg.crop.width / imgNaturalSize.width) * 100;
            const heightPct = (reg.crop.height / imgNaturalSize.height) * 100;
            const isActive = currentMode === reg.type;

            return (
              <div
                key={reg.type}
                style={{
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  width: `${widthPct}%`,
                  height: `${heightPct}%`,
                }}
                className={`absolute pointer-events-none border-2 ${cfg.borderColor} ${cfg.bgOverlay} ${
                  isActive ? 'ring-2 ring-white/90 z-20' : 'opacity-85 z-10'
                }`}
              >
                <span className={`absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${cfg.tagColor}`}>
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
