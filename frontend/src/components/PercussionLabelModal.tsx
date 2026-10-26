import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Check, RotateCcw, Move, AlignCenter, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Type, RotateCw, MoveHorizontal, Eye, EyeOff } from 'lucide-react';
import { getPercussionDataUrl, getPercussionInfo } from '../utils/templateShapes';

export interface ItemLabelSettings {
  text?: string;
  labelOffsetX: number;
  labelOffsetY: number;
  labelRotation: number;
  labelFontSize: number;
  labelLetterSpacing: number;
  isVerticalName: boolean;
  showPercussionName?: boolean;
}

export interface ItemLabelModalTarget {
  type: 'placedItem' | 'curveItem';
  itemId: string;
  curveId?: string;
  targetType?: 'percussion' | 'symbol';
  canvasName: string;
  percussionType?: string;
  symbolShape?: 'circle' | 'cross' | 'rect' | 'triangle';
  symbolFilled?: boolean;
  initialText?: string;
  width: number;
  height: number;
  color?: string;
  currentOffsetX?: number;
  currentOffsetY?: number;
  currentRotation?: number;
  currentFontSize?: number;
  currentLetterSpacing?: number;
  isVertical?: boolean;
  showPercussionName?: boolean;
}

interface PercussionLabelModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetType?: 'percussion' | 'symbol';
  itemTitle: string;
  percussionType?: string;
  symbolShape?: 'circle' | 'cross' | 'rect' | 'triangle';
  symbolFilled?: boolean;
  color?: string;
  width: number;
  height: number;
  initialText?: string;
  initialOffsetX?: number;
  initialOffsetY?: number;
  initialRotation?: number;
  initialFontSize?: number;
  initialLetterSpacing?: number;
  initialIsVertical?: boolean;
  initialShowPercussionName?: boolean;
  onSave: (settings: ItemLabelSettings) => void;
}

export const PercussionLabelModal: React.FC<PercussionLabelModalProps> = ({
  isOpen,
  onClose,
  targetType = 'percussion',
  itemTitle,
  percussionType,
  symbolShape = 'circle',
  symbolFilled = false,
  color = '#000000',
  width,
  height,
  initialText = '',
  initialOffsetX = 0,
  initialOffsetY = 0,
  initialRotation = 0,
  initialFontSize,
  initialLetterSpacing = 0,
  initialIsVertical = false,
  initialShowPercussionName = true,
  onSave,
}) => {
  const isSymbol = targetType === 'symbol';
  const percInfo = !isSymbol && percussionType ? getPercussionInfo(percussionType) : null;
  // キャンバス上で実際に表示される文字 (initialText または percInfo.canvasName) を最優先
  const defaultText = initialText || (percInfo?.canvasName || itemTitle || percussionType || (isSymbol ? '記' : '打楽器'));

  const [text, setText] = useState(defaultText);
  const [showName, setShowName] = useState(initialShowPercussionName !== false);
  const [offsetX, setOffsetX] = useState(initialOffsetX);
  const [offsetY, setOffsetY] = useState(initialOffsetY);
  const [rotation, setRotation] = useState(initialRotation);
  const [isVertical, setIsVertical] = useState(initialIsVertical);
  const [letterSpacing, setLetterSpacing] = useState(initialLetterSpacing || 0);

  // Default font size calculation
  const calcDefaultFontSize = useCallback((isVert: boolean) => {
    if (initialFontSize && initialFontSize > 0) return initialFontSize;
    if (isSymbol) return 16;
    const txt = defaultText || '打楽器';
    const maxFontByW = isVert ? width * 0.42 : (width * 0.95) / Math.max(txt.length * 0.62, 1);
    const maxFontByH = isVert ? (height * 0.95) / Math.max(txt.length * 1.05, 1) : height * 0.42;
    return Math.round(Math.max(10, Math.min(maxFontByW, maxFontByH, 24)));
  }, [initialFontSize, isSymbol, defaultText, width, height]);

  const [fontSize, setFontSize] = useState(() => calcDefaultFontSize(initialIsVertical));

  // Sync state when modal opens
  useEffect(() => {
    if (isOpen) {
      setText(defaultText);
      setShowName(initialShowPercussionName !== false);
      setOffsetX(initialOffsetX || 0);
      setOffsetY(initialOffsetY || 0);
      setRotation(initialRotation || 0);
      setIsVertical(Boolean(initialIsVertical));
      setFontSize(calcDefaultFontSize(initialIsVertical));
      setLetterSpacing(initialLetterSpacing || 0);
    }
  }, [isOpen, defaultText, initialOffsetX, initialOffsetY, initialRotation, initialIsVertical, initialLetterSpacing, initialShowPercussionName, calcDefaultFontSize]);

  const iconUrl = !isSymbol && percussionType ? getPercussionDataUrl(percussionType, color) : '';

  // Allowable offset range: within 2x object size (from -width to +width, -height to +height)
  const maxRangeX = Math.max(20, Math.round(width));
  const maxRangeY = Math.max(20, Math.round(height));

  // Preview box dimensions
  const previewBoxW = 340;
  const previewBoxH = 300;
  const centerX = previewBoxW / 2;
  const centerY = previewBoxH / 2;

  // Calculate preview scale so that 2x range fits in box
  const previewScale = Math.min(
    (previewBoxW - 48) / (width * 2.2),
    (previewBoxH - 48) / (height * 2.2),
    2.4
  );

  const scaledW = width * previewScale;
  const scaledH = height * previewScale;
  const scaledRangeW = maxRangeX * 2 * previewScale;
  const scaledRangeH = maxRangeY * 2 * previewScale;

  // Dragging state for position
  const isDraggingRef = useRef(false);
  const dragStartPosRef = useRef<{ clientX: number; clientY: number; initOffsetX: number; initOffsetY: number }>({
    clientX: 0,
    clientY: 0,
    initOffsetX: 0,
    initOffsetY: 0,
  });

  const handlePointerDown = (clientX: number, clientY: number) => {
    isDraggingRef.current = true;
    dragStartPosRef.current = {
      clientX,
      clientY,
      initOffsetX: offsetX,
      initOffsetY: offsetY,
    };
  };

  const handlePointerMove = useCallback((clientX: number, clientY: number) => {
    if (!isDraggingRef.current) return;
    const dx = (clientX - dragStartPosRef.current.clientX) / previewScale;
    const dy = (clientY - dragStartPosRef.current.clientY) / previewScale;

    const nextX = Math.round(Math.max(-maxRangeX, Math.min(maxRangeX, dragStartPosRef.current.initOffsetX + dx)));
    const nextY = Math.round(Math.max(-maxRangeY, Math.min(maxRangeY, dragStartPosRef.current.initOffsetY + dy)));

    setOffsetX(nextX);
    setOffsetY(nextY);
  }, [maxRangeX, maxRangeY, previewScale]);

  const handlePointerUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current) {
        e.preventDefault();
        handlePointerMove(e.clientX, e.clientY);
      }
    };
    const onMouseUp = () => {
      if (isDraggingRef.current) {
        handlePointerUp();
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (isDraggingRef.current && e.touches[0]) {
        e.preventDefault();
        handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const onTouchEnd = () => {
      if (isDraggingRef.current) {
        handlePointerUp();
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [handlePointerMove, handlePointerUp]);

  if (!isOpen) return null;

  // Format display text (vertical supports vertical line replacement for ー)
  const displayText = text || (isSymbol ? '記' : '打楽器');
  const displayChars = displayText.split('').map(c => (c === 'ー' || c === '―' ? '丨' : c));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs select-none animate-in fade-in duration-150">
      <div 
        className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#007AFF]/15 text-[#007AFF] flex items-center justify-center shadow-2xs font-bold text-xs">
              <Move className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                {isSymbol ? '記号文字' : '打楽器名'} 表示・回転・サイズ設定
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {isSymbol ? `記号図形 (${symbolShape})` : `${defaultText} (${percussionType || 'percussion'})`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 flex flex-col gap-3.5 overflow-y-auto max-h-[calc(90vh-115px)]">
          {/* 打楽器の名前 表示/非表示切り替え */}
          {!isSymbol && (
            <div className="flex items-center justify-between p-2.5 bg-blue-50/80 dark:bg-blue-950/40 rounded-xl border border-blue-200/80 dark:border-blue-800/80 transition-all">
              <div className="flex items-center gap-2.5">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                  showName ? 'bg-[#007AFF]/15 text-[#007AFF]' : 'bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
                }`}>
                  {showName ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                    キャンバスに名前を表示
                    <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                      showName ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300' : 'bg-slate-200 text-slate-600 dark:bg-slate-750 dark:text-slate-400'
                    }`}>
                      {showName ? '表示中' : '非表示'}
                    </span>
                  </span>
                  <span className="text-[10.5px] text-slate-500 dark:text-slate-400">
                    {showName ? 'ステージ上に「大太鼓」等の文字が表示されます' : 'アイコン画像のみ表示され、文字は非表示になります'}
                  </span>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={showName}
                  onChange={(e) => setShowName(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-[#007AFF]"></div>
              </label>
            </div>
          )}

          {/* Symbol Text Input (Only for Symbols) */}
          {isSymbol && (
            <div className="flex flex-col gap-1 p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                表示する文字:
              </span>
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="文字を入力 (例: A, 1, 記)"
                className="w-full px-3 py-1.5 text-sm font-bold border border-slate-300 dark:border-slate-600 dark:bg-slate-700 rounded-lg text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-[#007AFF] focus:border-transparent"
                autoFocus
              />
            </div>
          )}

          {/* Writing Mode: Horizontal vs Vertical */}
          <div className={`flex items-center justify-between gap-3 p-2 bg-slate-100/70 dark:bg-slate-800/60 rounded-xl border border-slate-200/60 dark:border-slate-700/60 transition-opacity ${
            !showName ? 'opacity-40 pointer-events-none' : ''
          }`}>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 ml-1">
              <Type className="w-3.5 h-3.5 text-[#007AFF]" />
              文字の向き:
            </span>
            <div className="grid grid-cols-2 gap-1 p-0.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setIsVertical(false)}
                className={`px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                  !isVertical
                    ? 'liquid-btn-primary shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                }`}
              >
                横書き
              </button>
              <button
                type="button"
                onClick={() => setIsVertical(true)}
                className={`px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                  isVertical
                    ? 'liquid-btn-primary shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                }`}
              >
                縦書き
              </button>
            </div>
          </div>

          {/* Interactive Drag Preview Box */}
          <div className="flex flex-col items-center gap-1">
            <div className="w-full flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 px-1">
              <span>青いラベルをドラッグして移動（可動範囲：2倍まで）</span>
              <span className="font-mono text-slate-600 dark:text-slate-300 font-semibold">
                X:{offsetX > 0 ? `+${offsetX}` : offsetX} Y:{offsetY > 0 ? `+${offsetY}` : offsetY} / {rotation}° / {fontSize}px
              </span>
            </div>

            <div
              className="relative rounded-2xl border-2 border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-50 dark:bg-slate-950/80 shadow-inner flex items-center justify-center cursor-crosshair touch-none"
              style={{ width: previewBoxW, height: previewBoxH }}
              onClick={(e) => {
                // Click anywhere within box to position label
                const rect = e.currentTarget.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const clickY = e.clientY - rect.top;
                const relX = (clickX - centerX) / previewScale;
                const relY = (clickY - centerY) / previewScale;
                setOffsetX(Math.round(Math.max(-maxRangeX, Math.min(maxRangeX, relX))));
                setOffsetY(Math.round(Math.max(-maxRangeY, Math.min(maxRangeY, relY))));
              }}
            >
              {/* Background Crosshair & Grid */}
              <div
                className="absolute inset-0 pointer-events-none opacity-20 dark:opacity-30"
                style={{
                  backgroundImage: `radial-gradient(circle, #64748b 1px, transparent 1px)`,
                  backgroundSize: '16px 16px',
                  backgroundPosition: `${centerX}px ${centerY}px`,
                }}
              />
              <div className="absolute w-full h-px bg-slate-300/80 dark:bg-slate-700/80 pointer-events-none" style={{ top: centerY }} />
              <div className="absolute h-full w-px bg-slate-300/80 dark:bg-slate-700/80 pointer-events-none" style={{ left: centerX }} />

              {/* Allowed Range Area (2x Object Size) */}
              <div
                className="absolute border-2 border-dashed border-[#007AFF]/40 bg-[#007AFF]/5 rounded-xl pointer-events-none transition-all flex items-start justify-end p-1"
                style={{
                  width: scaledRangeW,
                  height: scaledRangeH,
                  left: centerX - scaledRangeW / 2,
                  top: centerY - scaledRangeH / 2,
                }}
              >
                <span className="text-[9px] font-bold text-[#007AFF]/80 bg-white/80 dark:bg-slate-900/80 px-1 py-0.5 rounded shadow-2xs">
                  最大可動範囲 (2倍)
                </span>
              </div>

              {/* Object Render (Percussion Image or Symbol Shape) */}
              <div
                className="absolute pointer-events-none flex items-center justify-center transition-all opacity-85"
                style={{
                  width: scaledW,
                  height: scaledH,
                  left: centerX - scaledW / 2,
                  top: centerY - scaledH / 2,
                }}
              >
                {isSymbol ? (
                  <svg width={scaledW} height={scaledH} viewBox="0 0 100 100" className="w-full h-full drop-shadow-xs">
                    {symbolShape === 'circle' && (
                      <circle cx="50" cy="50" r="44" fill={symbolFilled ? color : 'none'} stroke={color} strokeWidth="5" />
                    )}
                    {symbolShape === 'rect' && (
                      <rect x="8" y="8" width="84" height="84" rx="10" fill={symbolFilled ? color : 'none'} stroke={color} strokeWidth="5" />
                    )}
                    {symbolShape === 'triangle' && (
                      <polygon points="50,8 92,90 8,90" fill={symbolFilled ? color : 'none'} stroke={color} strokeWidth="5" strokeLinejoin="round" />
                    )}
                    {symbolShape === 'cross' && (
                      symbolFilled ? (
                        <g transform="translate(50,50) rotate(45) translate(-50,-50)">
                          <rect x="36" y="8" width="28" height="84" rx="6" fill={color} stroke={color} strokeWidth="4" />
                          <rect x="8" y="36" width="84" height="28" rx="6" fill={color} stroke={color} strokeWidth="4" />
                        </g>
                      ) : (
                        <g stroke={color} strokeWidth="6" strokeLinecap="round">
                          <line x1="16" y1="16" x2="84" y2="84" />
                          <line x1="84" y1="16" x2="16" y2="84" />
                        </g>
                      )
                    )}
                  </svg>
                ) : (
                  <img
                    src={iconUrl}
                    alt={displayText}
                    className="w-full h-full pointer-events-none drop-shadow-xs"
                  />
                )}
              </div>

              {/* Draggable & Rotatable Label: 中心ピボットを完全に一致させ、キャンバスと同じ位置に描画 */}
              {showName ? (
                <div
                  className="absolute z-10 cursor-grab active:cursor-grabbing group select-none"
                  style={{
                    left: `${centerX + offsetX * previewScale}px`,
                    top: `${centerY + offsetY * previewScale}px`,
                    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                    transformOrigin: 'center center',
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    handlePointerDown(e.clientX, e.clientY);
                  }}
                  onTouchStart={(e) => {
                    e.stopPropagation();
                    if (e.touches[0]) {
                      handlePointerDown(e.touches[0].clientX, e.touches[0].clientY);
                    }
                  }}
                >
                  <div
                    className={`relative px-1.5 py-0.5 rounded border border-dashed border-[#007AFF] bg-white/80 dark:bg-slate-900/80 hover:bg-[#007AFF]/10 shadow-xs flex items-center justify-center select-none transition-colors ${
                      isVertical ? 'flex-col' : 'flex-row'
                    }`}
                    style={{
                      color: isSymbol && symbolFilled ? '#ffffff' : (color || '#000000'),
                      fontSize: Math.max(9, Math.round(fontSize * previewScale)),
                      fontFamily: 'Arial, sans-serif',
                      lineHeight: isVertical ? (fontSize > 0 ? (fontSize * 1.15 + letterSpacing) / fontSize : 1.15) : 1,
                      letterSpacing: isVertical ? 'normal' : `${letterSpacing * previewScale}px`,
                      gap: isVertical ? `${Math.max(0, letterSpacing * previewScale * 0.8)}px` : undefined,
                    }}
                  >
                    {/* 四隅の操作ハンドルインジケーター */}
                    <span className="absolute -top-1 -left-1 w-2 h-2 bg-[#007AFF] border border-white dark:border-slate-900 rounded-full" />
                    <span className="absolute -top-1 -right-1 w-2 h-2 bg-[#007AFF] border border-white dark:border-slate-900 rounded-full" />
                    <span className="absolute -bottom-1 -left-1 w-2 h-2 bg-[#007AFF] border border-white dark:border-slate-900 rounded-full" />
                    <span className="absolute -bottom-1 -right-1 w-2 h-2 bg-[#007AFF] border border-white dark:border-slate-900 rounded-full" />

                    {isVertical ? (
                      displayChars.map((char, idx) => (
                        <span key={idx} className="font-bold leading-tight">
                          {char}
                        </span>
                      ))
                    ) : (
                      <span className="whitespace-nowrap font-bold leading-none">
                        {displayText}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="absolute z-10 bottom-3 px-3 py-1.5 bg-slate-900/80 backdrop-blur-xs text-white text-[11px] font-bold rounded-full shadow-lg flex items-center gap-1.5 pointer-events-none">
                  <EyeOff className="w-3.5 h-3.5 text-amber-400" />
                  <span>名前は非表示に設定されています</span>
                </div>
              )}
            </div>
          </div>

          {/* Quick Placement Presets */}
          <div className={`flex flex-col gap-1 transition-opacity ${!showName ? 'opacity-40 pointer-events-none' : ''}`}>
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              位置プリセット:
            </span>
            <div className="grid grid-cols-5 gap-1.5">
              <button
                type="button"
                onClick={() => { setOffsetX(0); setOffsetY(0); }}
                className={`py-1 px-1 rounded-lg text-xs font-semibold liquid-btn flex flex-col items-center gap-0.5 transition-all cursor-pointer ${
                  offsetX === 0 && offsetY === 0 ? 'liquid-btn-primary shadow-xs' : 'text-slate-700 dark:text-slate-300'
                }`}
                title="中央に配置"
              >
                <AlignCenter className="w-3.5 h-3.5" />
                <span className="text-[10px]">中央</span>
              </button>
              <button
                type="button"
                onClick={() => { setOffsetX(0); setOffsetY(-Math.round(height * 0.85)); }}
                className="py-1 px-1 rounded-lg text-xs font-semibold liquid-btn text-slate-700 dark:text-slate-300 flex flex-col items-center gap-0.5 transition-all cursor-pointer hover:text-slate-900"
                title="真上に配置"
              >
                <ArrowUp className="w-3.5 h-3.5" />
                <span className="text-[10px]">上部</span>
              </button>
              <button
                type="button"
                onClick={() => { setOffsetX(0); setOffsetY(Math.round(height * 0.85)); }}
                className="py-1 px-1 rounded-lg text-xs font-semibold liquid-btn text-slate-700 dark:text-slate-300 flex flex-col items-center gap-0.5 transition-all cursor-pointer hover:text-slate-900"
                title="真下に配置"
              >
                <ArrowDown className="w-3.5 h-3.5" />
                <span className="text-[10px]">下部</span>
              </button>
              <button
                type="button"
                onClick={() => { setOffsetX(-Math.round(width * 0.85)); setOffsetY(0); }}
                className="py-1 px-1 rounded-lg text-xs font-semibold liquid-btn text-slate-700 dark:text-slate-300 flex flex-col items-center gap-0.5 transition-all cursor-pointer hover:text-slate-900"
                title="左側に配置"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span className="text-[10px]">左側</span>
              </button>
              <button
                type="button"
                onClick={() => { setOffsetX(Math.round(width * 0.85)); setOffsetY(0); }}
                className="py-1 px-1 rounded-lg text-xs font-semibold liquid-btn text-slate-700 dark:text-slate-300 flex flex-col items-center gap-0.5 transition-all cursor-pointer hover:text-slate-900"
                title="右側に配置"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span className="text-[10px]">右側</span>
              </button>
            </div>
          </div>

          {/* Rotation, Size & Letter Spacing Controls */}
          <div className={`grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 border-t border-slate-100 dark:border-slate-800 transition-opacity ${
            !showName ? 'opacity-40 pointer-events-none' : ''
          }`}>
            {/* Rotation Control */}
            <div className="flex flex-col gap-1 p-2 bg-slate-50/70 dark:bg-slate-800/40 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                <span className="flex items-center gap-1">
                  <RotateCw className="w-3.5 h-3.5 text-[#007AFF]" />
                  回転角度:
                </span>
                <span className="font-mono text-slate-600 dark:text-slate-400 font-bold">{rotation}°</span>
              </div>
              <input
                type="range"
                min="0"
                max="360"
                step="1"
                value={(rotation % 360 + 360) % 360}
                onChange={(e) => setRotation(parseInt(e.target.value, 10))}
                className="w-full accent-[#007AFF] cursor-pointer"
              />
              <div className="grid grid-cols-4 gap-1 pt-0.5">
                {[
                  { label: '-90°', delta: -90 },
                  { label: '0°', reset: 0 },
                  { label: '+90°', delta: 90 },
                  { label: '180°', reset: 180 },
                ].map((btn, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      if (btn.reset !== undefined) {
                        setRotation(btn.reset);
                      } else if (btn.delta !== undefined) {
                        let n = (rotation + btn.delta) % 360;
                        if (n < 0) n += 360;
                        setRotation(n);
                      }
                    }}
                    className="py-1 rounded text-[10px] font-mono font-medium liquid-btn text-slate-700 dark:text-slate-300 hover:text-slate-900 cursor-pointer"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Font Size Control */}
            <div className="flex flex-col gap-1 p-2 bg-slate-50/70 dark:bg-slate-800/40 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                <span className="flex items-center gap-1">
                  <Type className="w-3.5 h-3.5 text-[#007AFF]" />
                  文字サイズ:
                </span>
                <span className="font-mono text-slate-600 dark:text-slate-400 font-bold">{fontSize}px</span>
              </div>
              <input
                type="range"
                min="8"
                max="48"
                step="1"
                value={fontSize}
                onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
                className="w-full accent-[#007AFF] cursor-pointer"
              />
              <div className="grid grid-cols-4 gap-1 pt-0.5">
                {[
                  { label: '小 (10)', sz: 10 },
                  { label: '中 (14)', sz: 14 },
                  { label: '大 (20)', sz: 20 },
                  { label: '特大 (28)', sz: 28 },
                ].map((btn, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setFontSize(btn.sz)}
                    className="py-1 rounded text-[10px] font-medium liquid-btn text-slate-700 dark:text-slate-300 hover:text-slate-900 cursor-pointer"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Letter Spacing Control */}
            <div className="flex flex-col gap-1 p-2 bg-slate-50/70 dark:bg-slate-800/40 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                <span className="flex items-center gap-1">
                  <MoveHorizontal className="w-3.5 h-3.5 text-[#007AFF]" />
                  字間:
                </span>
                <span className="font-mono text-slate-600 dark:text-slate-400 font-bold">{letterSpacing > 0 ? `+${letterSpacing}` : letterSpacing}px</span>
              </div>
              <input
                type="range"
                min="-4"
                max="24"
                step="1"
                value={letterSpacing}
                onChange={(e) => setLetterSpacing(parseInt(e.target.value, 10))}
                className="w-full accent-[#007AFF] cursor-pointer"
              />
              <div className="grid grid-cols-4 gap-1 pt-0.5">
                {[
                  { label: '標準 (0)', val: 0 },
                  { label: '+2', val: 2 },
                  { label: '+5', val: 5 },
                  { label: '+10', val: 10 },
                ].map((btn, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setLetterSpacing(btn.val)}
                    className="py-1 rounded text-[10px] font-mono font-medium liquid-btn text-slate-700 dark:text-slate-300 hover:text-slate-900 cursor-pointer"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850">
          <button
            type="button"
            onClick={() => {
              setOffsetX(0);
              setOffsetY(0);
              setRotation(0);
              setFontSize(calcDefaultFontSize(false));
              setLetterSpacing(0);
              setIsVertical(false);
            }}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold liquid-btn text-slate-600 dark:text-slate-300 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
            title="中央・0°・字間0・横書きに初期化"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>初期位置へ</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold liquid-btn text-slate-700 dark:text-slate-300 hover:text-slate-900 cursor-pointer"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={() => {
                onSave({
                  text: isSymbol ? text : undefined,
                  labelOffsetX: offsetX,
                  labelOffsetY: offsetY,
                  labelRotation: rotation,
                  labelFontSize: fontSize,
                  labelLetterSpacing: letterSpacing,
                  isVerticalName: isVertical,
                  showPercussionName: !isSymbol ? showName : undefined,
                });
                onClose();
              }}
              className="px-5 py-2 rounded-xl text-xs font-bold liquid-btn-primary shadow-md flex items-center gap-1.5 cursor-pointer hover:scale-102 active:scale-98 transition-all"
            >
              <Check className="w-4 h-4" />
              <span>保存して適用</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
