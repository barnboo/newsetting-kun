import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

export interface Region {
  type: 'background' | 'icons' | 'quantities';
  crop: PixelCrop;
  percentCrop?: { x: number; y: number; width: number; height: number };
}

interface RegionSelectorProps {
  imageUrl: string;
  initialRegions?: Region[];
  onComplete: (regions: Region[]) => void;
}

const MODES = [
  {
    type: 'background' as const,
    label: 'ステージ図面',
    required: true,
    requiredLabel: '*必須',
    hint: '舞台全体の枠をドラッグで囲んで「次へ進む」を押してください（記号一覧・個数欄は自動検出されます）',
    activeClass: 'bg-blue-50 text-blue-800 border-blue-500 ring-2 ring-blue-500/20 font-bold',
    borderColor: 'border-blue-500',
    bgOverlay: 'bg-blue-500/20',
    tagColor: 'bg-blue-600 text-white',
    dotColor: 'bg-blue-500',
    btnBg: 'bg-blue-600 hover:bg-blue-700',
  },
];

export const RegionSelector: React.FC<RegionSelectorProps> = ({ imageUrl, initialRegions, onComplete }) => {
  const [crop, setCrop] = useState<Crop | undefined>(() => {
    const bg = initialRegions?.find(r => r.type === 'background');
    if (bg?.percentCrop) {
      return { unit: '%', ...bg.percentCrop };
    }
    return undefined;
  });
  const [regions, setRegions] = useState<Region[]>(() =>
    (initialRegions || []).filter(r => r.type === 'background')
  );
  const currentMode = 'background' as const;

  // initialRegions が変更された場合の同期（空から渡された場合など）
  useEffect(() => {
    if (initialRegions && initialRegions.length > 0 && regions.length === 0) {
      const bgOnly = initialRegions.filter(r => r.type === 'background');
      setRegions(bgOnly);
    }
  }, [initialRegions]);
  const [imgNaturalSize, setImgNaturalSize] = useState<{ width: number; height: number } | null>(null);

  // Zoom state
  const [zoom, setZoom] = useState(1.0);
  const [baseDisplayWidth, setBaseDisplayWidth] = useState<number>(0);
  const [isMultiTouch, setIsMultiTouch] = useState(false);
  const handleZoomIn = () => setZoom(prev => Math.min(3.0, Number((prev + 0.2).toFixed(1))));
  const handleZoomOut = () => setZoom(prev => Math.max(0.6, Number((prev - 0.2).toFixed(1))));
  const handleZoomReset = () => setZoom(1.0);

  const imageRef = useRef<HTMLImageElement>(null);
  const imageWrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevZoomRef = useRef(zoom);
  const zoomAnchorRef = useRef<{
    rx: number;
    ry: number;
    clientX: number;
    clientY: number;
  } | null>(null);

  // Keep zoom anchor stable so zoomed position stays under finger
  useLayoutEffect(() => {
    const prevZoom = prevZoomRef.current;
    prevZoomRef.current = zoom;

    if (!containerRef.current || !imageWrapperRef.current) return;

    const container = containerRef.current;
    const wrapper = imageWrapperRef.current;

    // 新サイズ適用時に同期解除
    wrapper.style.transform = '';
    wrapper.style.transformOrigin = '';
    wrapper.style.willChange = '';

    if (prevZoom === zoom) return;

    const anchor = zoomAnchorRef.current;

    if (anchor) {
      const targetContentX = wrapper.offsetLeft + anchor.rx * wrapper.offsetWidth;
      const targetContentY = wrapper.offsetTop + anchor.ry * wrapper.offsetHeight;

      container.scrollLeft = targetContentX - anchor.clientX;
      container.scrollTop = targetContentY - anchor.clientY;

      zoomAnchorRef.current = null;
    } else {
      const box = container.getBoundingClientRect();
      const centerX = box.width / 2;
      const centerY = box.height / 2;

      const prevContentX = container.scrollLeft + centerX;
      const prevContentY = container.scrollTop + centerY;
      const prevWidth = baseDisplayWidth * prevZoom;
      const prevHeight = wrapper.offsetHeight * (prevZoom / (zoom || 1));
      const rx = (prevContentX - wrapper.offsetLeft) / (prevWidth || 1);
      const ry = (prevContentY - wrapper.offsetTop) / (prevHeight || 1);

      const targetContentX = wrapper.offsetLeft + rx * wrapper.offsetWidth;
      const targetContentY = wrapper.offsetTop + ry * wrapper.offsetHeight;

      container.scrollLeft = targetContentX - centerX;
      container.scrollTop = targetContentY - centerY;
    }
  }, [zoom, baseDisplayWidth]);

  const updateBaseDisplayWidth = (naturalWidth?: number, naturalHeight?: number) => {
    const natW = naturalWidth || imgNaturalSize?.width || imageRef.current?.naturalWidth || 0;
    const natH = naturalHeight || imgNaturalSize?.height || imageRef.current?.naturalHeight || 0;
    if (!containerRef.current || natW === 0 || natH === 0) return;

    // コンテナの内側利用可能幅（左右パディングを差し引いた幅）
    const availW = Math.max(280, containerRef.current.clientWidth - 32);
    // 画面の高さに収まる最大の高さ（上下パディングを差し引いた高さ）
    const containerH = containerRef.current.clientHeight;
    const availH = Math.max(200, (containerH > 0 ? containerH : (window.innerHeight * 0.72)) - 32);

    const scaleW = availW / natW;
    const scaleH = availH / natH;
    // 縦・横どちらも枠内に確実に収まり、端が切れない縮小スケール（拡大はせず縮小のみ）
    const fitScale = Math.min(scaleW, scaleH, 1.0);
    const computedW = Math.round(natW * fitScale);
    setBaseDisplayWidth(computedW);
  };

  useEffect(() => {
    updateBaseDisplayWidth();
    const handleResize = () => updateBaseDisplayWidth();
    window.addEventListener('resize', handleResize);
    
    let observer: ResizeObserver | null = null;
    if (containerRef.current) {
      observer = new ResizeObserver(() => updateBaseDisplayWidth());
      observer.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      observer?.disconnect();
    };
  }, [imageUrl, imgNaturalSize]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setImgNaturalSize({ width: naturalWidth, height: naturalHeight });
    updateBaseDisplayWidth(naturalWidth, naturalHeight);
  };

  // High-performance Gesture-driven Pinch-to-zoom & 2-finger Pan via GPU CSS Transform
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let isPinching = false;
    let startDist = 0;
    let initialZoom = zoom;
    let startMidX = 0;
    let startMidY = 0;
    let currentMidX = 0;
    let currentMidY = 0;
    let currentScale = 1.0;
    let currentDx = 0;
    let currentDy = 0;
    let rx = 0.5;
    let ry = 0.5;

    // Prevent Safari default full-page zoom
    const preventGestures = (e: Event) => e.preventDefault();

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        setIsMultiTouch(true);
        isPinching = true;
        // 2本指操作が始まったら、1本目の指で作られかけたクロップ枠を即座に破棄
        setCrop(undefined);

        const wrapper = imageWrapperRef.current;
        if (!wrapper) return;

        const t1 = e.touches[0];
        const t2 = e.touches[1];
        startDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        initialZoom = zoom;
        startMidX = (t1.clientX + t2.clientX) / 2;
        startMidY = (t1.clientY + t2.clientY) / 2;
        currentMidX = startMidX;
        currentMidY = startMidY;
        currentScale = 1.0;
        currentDx = 0;
        currentDy = 0;

        const wrapperRect = wrapper.getBoundingClientRect();
        const originX = startMidX - wrapperRect.left;
        const originY = startMidY - wrapperRect.top;
        rx = wrapperRect.width > 0 ? originX / wrapperRect.width : 0.5;
        ry = wrapperRect.height > 0 ? originY / wrapperRect.height : 0.5;

        wrapper.style.transformOrigin = `${originX}px ${originY}px`;
        wrapper.style.willChange = 'transform';
        wrapper.style.transition = 'none';

        e.preventDefault();
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2 && isPinching) {
        setIsMultiTouch(true);
        setCrop(undefined);

        const wrapper = imageWrapperRef.current;
        if (!wrapper) return;

        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const curDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        currentMidX = (t1.clientX + t2.clientX) / 2;
        currentMidY = (t1.clientY + t2.clientY) / 2;

        const rawScale = startDist > 10 ? curDist / startDist : 1.0;
        const minScale = 0.6 / (initialZoom || 1);
        const maxScale = 3.0 / (initialZoom || 1);
        currentScale = Math.min(maxScale, Math.max(minScale, rawScale));
        currentDx = currentMidX - startMidX;
        currentDy = currentMidY - startMidY;

        // GPU コンポジタによる直接レンダリング (超高速・完全滑らか)
        wrapper.style.transform = `translate3d(${currentDx}px, ${currentDy}px, 0) scale(${currentScale})`;

        e.preventDefault();
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2 && isPinching) {
        isPinching = false;

        const wrapper = imageWrapperRef.current;
        if (!wrapper) return;

        const finalZoom = Math.min(3.0, Math.max(0.6, Number((initialZoom * currentScale).toFixed(2))));

        if (Math.abs(finalZoom - initialZoom) < 0.02) {
          wrapper.style.transform = '';
          wrapper.style.transformOrigin = '';
          wrapper.style.willChange = '';
          container.scrollLeft -= currentDx;
          container.scrollTop -= currentDy;
        } else {
          const box = container.getBoundingClientRect();
          zoomAnchorRef.current = {
            rx,
            ry,
            clientX: currentMidX - box.left,
            clientY: currentMidY - box.top,
          };
          setZoom(finalZoom);
        }

        setTimeout(() => setIsMultiTouch(false), 120);
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const wrapper = imageWrapperRef.current;
        if (!wrapper) return;

        const box = container.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();

        const rx = (e.clientX - wrapperRect.left) / wrapperRect.width;
        const ry = (e.clientY - wrapperRect.top) / wrapperRect.height;

        zoomAnchorRef.current = {
          rx,
          ry,
          clientX: e.clientX - box.left,
          clientY: e.clientY - box.top,
        };

        const delta = e.deltaY < 0 ? 0.15 : -0.15;
        const next = Math.min(3.0, Math.max(0.6, Number((zoom + delta).toFixed(2))));
        if (next !== zoom) {
          setZoom(next);
        }
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchEnd);
    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('gesturestart', preventGestures);
    container.addEventListener('gesturechange', preventGestures);
    container.addEventListener('gestureend', preventGestures);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('gesturestart', preventGestures);
      container.removeEventListener('gesturechange', preventGestures);
      container.removeEventListener('gestureend', preventGestures);
    };
  }, [zoom]);

  const buildRegionFromCrop = (): Region | null => {
    if (!crop || crop.width === 0 || crop.height === 0) return null;
    const image = imageRef.current;
    if (!image) return null;

    let pixelCrop: PixelCrop;
    let percentCrop: { x: number; y: number; width: number; height: number };

    if (crop.unit === '%') {
      pixelCrop = {
        unit: 'px',
        x: Math.round((crop.x / 100) * image.naturalWidth),
        y: Math.round((crop.y / 100) * image.naturalHeight),
        width: Math.round((crop.width / 100) * image.naturalWidth),
        height: Math.round((crop.height / 100) * image.naturalHeight),
      };
      percentCrop = {
        x: crop.x,
        y: crop.y,
        width: crop.width,
        height: crop.height,
      };
    } else {
      const scaleX = image.naturalWidth / image.width;
      const scaleY = image.naturalHeight / image.height;
      pixelCrop = {
        unit: 'px',
        x: Math.round(crop.x * scaleX),
        y: Math.round(crop.y * scaleY),
        width: Math.round(crop.width * scaleX),
        height: Math.round(crop.height * scaleY),
      };
      percentCrop = {
        x: (crop.x / image.width) * 100,
        y: (crop.y / image.height) * 100,
        width: (crop.width / image.width) * 100,
        height: (crop.height / image.height) * 100,
      };
    }

    return { type: currentMode, crop: pixelCrop, percentCrop };
  };

  const handleClearRegion = () => {
    setRegions([]);
    setCrop(undefined);
  };

  const handleProceed = () => {
    const activeRegion = buildRegionFromCrop();
    if (activeRegion) {
      const nextRegions = [activeRegion];
      setRegions(nextRegions);
      onComplete(nextRegions);
      return;
    }
    if (regions.some(r => r.type === 'background')) {
      onComplete(regions.filter(r => r.type === 'background'));
    }
  };

  const hasBackground = regions.some(r => r.type === 'background');
  const hasValidCrop = Boolean(crop && crop.width && crop.height && crop.width > 0 && crop.height > 0);
  const canProceed = hasValidCrop || hasBackground;

  const currentCfg = MODES[0];

  return (
    <div className="flex flex-col items-center w-full max-w-5xl mx-auto select-none">
      {/* ── Compact Header & Toolbar (Liquid Glass) ── */}
      <div className="w-full liquid-glass rounded-3xl p-4 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          
          {/* Stage Diagram Status Badge */}
          <div className="flex items-center gap-1.5 liquid-segment-track p-1.5 rounded-full shrink-0">
            <div className="px-3.5 py-1.5 rounded-full text-xs flex items-center gap-1.5 border bg-white/95 dark:bg-slate-800/95 text-slate-900 dark:text-white border-white/80 shadow-[0_2px_10px_rgba(15,23,42,0.10),inset_0_1px_0.5px_rgba(255,255,255,0.9)] font-bold">
              <span className={`w-2 h-2 rounded-full ${currentCfg.dotColor} shadow-2xs`} />
              <span>{currentCfg.label}</span>
              <span
                className={`text-xs ${
                  canProceed
                    ? 'text-emerald-600 font-bold'
                    : 'text-rose-500 font-bold text-[10px]'
                }`}
              >
                {canProceed ? '✓ 選択済' : currentCfg.requiredLabel}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Zoom Controls */}
            <div className="flex items-center liquid-btn rounded-full overflow-hidden p-0.5">
              <button
                type="button"
                onClick={handleZoomOut}
                className="w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center transition-colors hover:bg-slate-200/60 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 cursor-pointer"
                title="縮小 (2本指ピンチインでも可能)"
              >
                −
              </button>
              <button
                type="button"
                onClick={handleZoomReset}
                className="text-[11px] font-bold font-mono px-2 min-w-[3.2rem] text-center text-slate-800 dark:text-slate-100 hover:text-[#007AFF] cursor-pointer"
                title="100%にリセット"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={handleZoomIn}
                className="w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center transition-colors hover:bg-slate-200/60 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 cursor-pointer"
                title="拡大 (2本指ピンチアウトでも可能)"
              >
                ＋
              </button>
            </div>

            <div className="h-5 w-px bg-slate-300/60 dark:bg-slate-600/60 mx-0.5" />

            <button
              key="redo-btn"
              type="button"
              onClick={handleClearRegion}
              disabled={!canProceed}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1 shrink-0 transition-all ${
                canProceed
                  ? 'liquid-btn text-slate-800 dark:text-slate-100 cursor-pointer'
                  : 'bg-slate-200/60 dark:bg-slate-700/60 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-white/30'
              }`}
              title="選択枠をクリアして囲み直す"
            >
              <span>↺</span>
              <span>やり直す</span>
            </button>

            <div className="h-5 w-px bg-slate-300/60 dark:bg-slate-600/60 mx-1" />

            <button
              key="proceed-btn"
              type="button"
              onClick={handleProceed}
              disabled={!canProceed}
              title={!canProceed ? 'ステージ図面をドラッグして囲んでください' : 'ステージ配置へ進む'}
              className={`px-5 py-2 rounded-full text-xs sm:text-sm font-bold flex items-center gap-1.5 transition-all ${
                canProceed
                  ? 'liquid-btn-primary cursor-pointer'
                  : 'bg-slate-200/70 text-slate-400 cursor-not-allowed border border-white/50'
              }`}
            >
              <span>次へ進む (ステージ配置)</span>
              <span>→</span>
            </button>
          </div>

        </div>

        {/* 1-Line Instruction Hint */}
        <div className="mt-3 pt-2.5 border-t border-white/60 dark:border-slate-700/50 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300 px-1.5">
          <div className="flex items-center gap-2">
            <span className="font-bold text-[#007AFF]">
              {currentCfg.label}:
            </span>
            <span>{currentCfg.hint}</span>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#007AFF]" />
              <span>ステージ図面を1つ囲むだけ</span>
            </span>
          </div>
        </div>
      </div>

      {/* ── Image Workspace (Liquid Glass Frame) ── */}
      <div 
        ref={containerRef}
        className={`w-full liquid-glass rounded-3xl p-3 flex overflow-auto max-h-[78vh] crop-mode-${currentMode} select-none transition-colors`}
        style={{ touchAction: 'pan-x pan-y' }}
      >
        <div className="min-w-full min-h-full w-max h-max flex items-center justify-center p-2 shrink-0 m-auto">
          <div 
            ref={imageWrapperRef}
            className="relative inline-block select-none bg-white shadow-lg rounded-2xl overflow-hidden shrink-0 transition-colors"
            style={{
              width: baseDisplayWidth > 0 ? `${Math.round(baseDisplayWidth * zoom)}px` : 'auto',
              maxWidth: zoom <= 1.0 ? '100%' : 'none',
            }}
          >
            <ReactCrop
              crop={crop}
              onChange={(_, percentCrop) => {
                if (isNaN(percentCrop.width) || isNaN(percentCrop.height)) return;
                setCrop(percentCrop);
              }}
              minWidth={8}
              minHeight={8}
              disabled={isMultiTouch}
              className="max-w-full block"
            >
              <img
                ref={imageRef}
                src={imageUrl}
                alt="セッティング用紙"
                onLoad={handleImageLoad}
                className="w-full h-auto block select-none"
              />
            </ReactCrop>

          {/* Overlaid Saved Regions (when returning without an active crop) */}
          {!hasValidCrop && regions.map(reg => {
            const cfg = MODES.find(m => m.type === reg.type);
            if (!cfg) return null;

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
                className={`absolute pointer-events-none border-[2.5px] ${cfg.borderColor} ${cfg.bgOverlay} ring-2 ring-white/90 shadow-md z-20`}
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
    </div>
  );
};
