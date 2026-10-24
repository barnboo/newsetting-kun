import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  RotateCcw,
  RotateCw,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Plus,
  Minus,
  GripHorizontal,
  ChevronDown,
  ChevronUp,
  Gamepad2,
  Touchpad,
  Crosshair,
  Maximize2,
  Minimize2
} from 'lucide-react';

interface FloatingObjectControlPanelProps {
  isVisible?: boolean;
  hasSelection: boolean;
  hasCurveSelection?: boolean;
  selectedCount?: number;
  onNudge: (dx: number, dy: number) => void;
  onRotate: (deltaDeg: number) => void;
  onResize: (factor: number) => void;
  onRemoteDragStart?: () => void;
  onRemoteDragMove?: (totalDx: number, totalDy: number, isCtrl?: boolean, isShift?: boolean) => void;
  onRemoteDragEnd?: () => void;
  onControlPointDragStart?: () => void;
  onControlPointDragMove?: (type: 'red' | 'blue', deltaX: number, deltaY: number, isCtrl?: boolean, isShift?: boolean) => void;
  onControlPointDragEnd?: () => void;
  isControlPointSnapped?: boolean;
  zoomMultiplier?: number;
  isDarkMode?: boolean;
}

/**
 * Repeatable button hook for holding down arrow/rotate/size buttons
 */
function useRepeatAction(action: () => void, delay = 260, interval = 45) {
  const timerRef = useRef<any>(null);
  const intervalRef = useRef<any>(null);
  const actionRef = useRef(action);
  actionRef.current = action;

  const stop = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    timerRef.current = null;
    intervalRef.current = null;
  }, []);

  const start = useCallback((e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    actionRef.current();
    stop();
    timerRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        actionRef.current();
      }, interval);
    }, delay);
  }, [delay, interval, stop]);

  useEffect(() => {
    return stop;
  }, [stop]);

  return {
    onMouseDown: start,
    onMouseUp: stop,
    onMouseLeave: stop,
    onTouchStart: start,
    onTouchEnd: stop,
  };
}

export const FloatingObjectControlPanel: React.FC<FloatingObjectControlPanelProps> = ({
  isVisible = true,
  hasSelection,
  hasCurveSelection = false,
  onNudge,
  onRotate,
  onResize,
  onRemoteDragStart,
  onRemoteDragMove,
  onRemoteDragEnd,
  onControlPointDragStart,
  onControlPointDragMove,
  onControlPointDragEnd,
  isControlPointSnapped = false,
  zoomMultiplier = 1.0,
  isDarkMode = false,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const trackpadRef = useRef<HTMLDivElement>(null);

  // Panel position in workspace area (null = default bottom-left placement)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(() => {
    try {
      const saved = localStorage.getItem('stage_floating_panel_pos_v2') || localStorage.getItem('stage_floating_panel_pos');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          // If migrated from old canvas-relative pos where x was small (< 72), shift by 56px to stay in canvas view
          if (!localStorage.getItem('stage_floating_panel_pos_v2') && parsed.x < 72) {
            parsed.x += 56;
          }
          return parsed;
        }
      }
    } catch {}
    return null;
  });
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [mode, setMode] = useState<'dpad' | 'trackpad'>('dpad');

  // Panel size state: false = normal (40px base unit), true = large (64px base unit - 1.6x)
  const [isLarge, setIsLarge] = useState<boolean>(() => {
    try {
      return localStorage.getItem('stage_floating_panel_large') === 'true';
    } catch {
      return false;
    }
  });

  const handleToggleLarge = () => {
    setIsLarge(prev => {
      const next = !prev;
      try {
        localStorage.setItem('stage_floating_panel_large', String(next));
      } catch {}
      return next;
    });

    if (position && panelRef.current?.parentElement) {
      const parentRect = panelRef.current.parentElement.getBoundingClientRect();
      const nextWidth = hasCurveSelection ? 448 : 320;
      const nextHeight = 160;
      const maxX = Math.max(8, parentRect.width - nextWidth - 8);
      const maxY = Math.max(8, parentRect.height - nextHeight - 8);
      setPosition(prev => {
        if (!prev) return null;
        const updated = {
          x: Math.min(prev.x, maxX),
          y: Math.min(prev.y, maxY)
        };
        try {
          localStorage.setItem('stage_floating_panel_pos_v2', JSON.stringify(updated));
          localStorage.setItem('stage_floating_panel_pos', JSON.stringify(updated));
        } catch {}
        return updated;
      });
    }
  };

  // Auto-clamp panel within parent bounds when hasCurveSelection, isLarge, or isCollapsed changes
  useEffect(() => {
    if (!position || !panelRef.current?.parentElement) return;
    const parentRect = panelRef.current.parentElement.getBoundingClientRect();
    const panelWidth = hasCurveSelection ? (isLarge ? 448 : 280) : (isLarge ? 320 : 200);
    const panelHeight = isCollapsed ? (isLarge ? 32 : 24) : (isLarge ? 160 : 104);
    const maxX = Math.max(8, parentRect.width - panelWidth - 8);
    const maxY = Math.max(8, parentRect.height - panelHeight - 8);

    if (position.x > maxX || position.y > maxY) {
      setPosition(prev => {
        if (!prev) return null;
        const updated = {
          x: Math.min(prev.x, maxX),
          y: Math.min(prev.y, maxY)
        };
        try {
          localStorage.setItem('stage_floating_panel_pos_v2', JSON.stringify(updated));
          localStorage.setItem('stage_floating_panel_pos', JSON.stringify(updated));
        } catch {}
        return updated;
      });
    }
  }, [hasCurveSelection, isLarge, isCollapsed]);

  // Visibility & sucking animation state (sucked into / emerging from the 🎮 button)
  const isFirstRender = useRef(true);
  const [animStyle, setAnimStyle] = useState<{
    transform: string;
    opacity: number;
    filter: string;
    pointerEvents: 'auto' | 'none';
    visibility: 'visible' | 'hidden';
    transition: string;
  }>(() => {
    if (!isVisible) {
      return {
        transform: 'scale(0.08)',
        opacity: 0,
        filter: 'blur(2px)',
        pointerEvents: 'none',
        visibility: 'hidden',
        transition: 'none',
      };
    }
    return {
      transform: 'translate(0px, 0px) scale(1)',
      opacity: 1,
      filter: 'none',
      pointerEvents: 'auto',
      visibility: 'visible',
      transition: 'none',
    };
  });

  const animTimerRef = useRef<any>(null);

  const getSuckVector = useCallback(() => {
    const btn = document.getElementById('panel-toggle-btn');
    if (!btn || !panelRef.current) return { x: -200, y: 200 };
    const btnRect = btn.getBoundingClientRect();
    const panelRect = panelRef.current.getBoundingClientRect();
    const btnCenterX = btnRect.left + btnRect.width / 2;
    const btnCenterY = btnRect.top + btnRect.height / 2;
    const panelCenterX = panelRect.left + panelRect.width / 2;
    const panelCenterY = panelRect.top + panelRect.height / 2;
    return {
      x: Math.round(btnCenterX - panelCenterX),
      y: Math.round(btnCenterY - panelCenterY),
    };
  }, []);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (animTimerRef.current) {
      clearTimeout(animTimerRef.current);
      animTimerRef.current = null;
    }

    const suck = getSuckVector();

    if (isVisible) {
      // Emerge from 🎮 button
      setAnimStyle({
        transform: `translate(${suck.x}px, ${suck.y}px) scale(0.08)`,
        opacity: 0,
        filter: 'blur(2px)',
        pointerEvents: 'none',
        visibility: 'visible',
        transition: 'none',
      });

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimStyle({
            transform: 'translate(0px, 0px) scale(1)',
            opacity: 1,
            filter: 'blur(0px)',
            pointerEvents: 'auto',
            visibility: 'visible',
            transition: 'transform 320ms cubic-bezier(0.16, 1, 0.3, 1), opacity 260ms ease, filter 260ms ease',
          });

          animTimerRef.current = setTimeout(() => {
            setAnimStyle(prev => ({
              ...prev,
              filter: 'none',
              transition: 'none',
            }));
            animTimerRef.current = null;
          }, 340);
        });
      });
    } else {
      // Suck into 🎮 button
      setAnimStyle({
        transform: `translate(${suck.x}px, ${suck.y}px) scale(0.08)`,
        opacity: 0,
        filter: 'blur(2px)',
        pointerEvents: 'none',
        visibility: 'visible',
        transition: 'transform 260ms cubic-bezier(0.32, 0, 0.67, 0), opacity 220ms ease, filter 220ms ease',
      });

      animTimerRef.current = setTimeout(() => {
        setAnimStyle({
          transform: `translate(${suck.x}px, ${suck.y}px) scale(0.08)`,
          opacity: 0,
          filter: 'blur(2px)',
          pointerEvents: 'none',
          visibility: 'hidden',
          transition: 'none',
        });
        animTimerRef.current = null;
      }, 270);
    }

    return () => {
      if (animTimerRef.current) {
        clearTimeout(animTimerRef.current);
        animTimerRef.current = null;
      }
    };
  }, [isVisible, getSuckVector]);

  // Trackpad interaction states
  const [isPadDragging, setIsPadDragging] = useState(false);
  const totalDeltaRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const padLastTouchRef = useRef<{ x: number; y: number } | null>(null);

  // Control point pads interaction states
  const [activeCtrlPad, setActiveCtrlPad] = useState<'red' | 'blue' | null>(null);
  const totalCtrlDeltaRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const ctrlLastTouchRef = useRef<{ x: number; y: number } | null>(null);
  const redPadRef = useRef<HTMLDivElement>(null);
  const bluePadRef = useRef<HTMLDivElement>(null);

  const dragStartRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number }>({
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
  });

  // Dragging logic for floating panel position
  const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input')) return;
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    let initX = 24;
    let initY = 100;
    if (panelRef.current && panelRef.current.parentElement) {
      const parentRect = panelRef.current.parentElement.getBoundingClientRect();
      const rect = panelRef.current.getBoundingClientRect();
      initX = rect.left - parentRect.left;
      initY = rect.top - parentRect.top;
    } else if (position) {
      initX = position.x;
      initY = position.y;
    }

    setPosition({ x: initX, y: initY });

    dragStartRef.current = {
      startX: clientX,
      startY: clientY,
      initialX: initX,
      initialY: initY,
    };
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      if ('touches' in e && e.cancelable) {
        e.preventDefault();
      }
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      const deltaX = clientX - dragStartRef.current.startX;
      const deltaY = clientY - dragStartRef.current.startY;

      const parentWidth = panelRef.current?.parentElement?.clientWidth || window.innerWidth;
      const parentHeight = panelRef.current?.parentElement?.clientHeight || window.innerHeight;
      const panelWidth = panelRef.current?.clientWidth || (hasCurveSelection ? (isLarge ? 448 : 280) : (isLarge ? 320 : 200));
      const panelHeight = panelRef.current?.clientHeight || (isCollapsed ? (isLarge ? 32 : 24) : (isLarge ? 160 : 104));

      const minX = 8;
      const maxX = Math.max(8, parentWidth - panelWidth - 8);
      const minY = 8;
      const maxY = Math.max(8, parentHeight - panelHeight - 8);

      const newX = Math.max(minX, Math.min(maxX, dragStartRef.current.initialX + deltaX));
      const newY = Math.max(minY, Math.min(maxY, dragStartRef.current.initialY + deltaY));

      setPosition({ x: newX, y: newY });
      try {
        localStorage.setItem('stage_floating_panel_pos_v2', JSON.stringify({ x: newX, y: newY }));
        localStorage.setItem('stage_floating_panel_pos', JSON.stringify({ x: newX, y: newY }));
      } catch {}
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleMouseMove, { passive: false });
    window.addEventListener('touchend', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleMouseMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [isDragging]);

  // Trackpad drag event handlers with Pointer Lock (Cursor hidden and locked in place)
  const handleTrackpadStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (!hasSelection) return;
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();

    totalDeltaRef.current = { x: 0, y: 0 };
    setIsPadDragging(true);

    if ('touches' in e) {
      const t = e.touches[0];
      if (t) padLastTouchRef.current = { x: t.clientX, y: t.clientY };
    } else {
      // Desktop mouse: Request pointer lock to lock and hide system cursor
      if (trackpadRef.current) {
        try {
          trackpadRef.current.requestPointerLock?.();
        } catch {
          // Fallback handled by cursor style
        }
      }
      document.body.style.cursor = 'none';
    }

    onRemoteDragStart?.();
  };

  useEffect(() => {
    if (!isPadDragging) return;

    const handlePadMove = (e: MouseEvent | TouchEvent) => {
      if ('touches' in e && e.cancelable) {
        e.preventDefault();
      }

      let stepX = 0;
      let stepY = 0;

      if ('movementX' in e) {
        // Pointer Lock mode: movementX/movementY directly provide delta without moving cursor
        stepX = e.movementX / (zoomMultiplier || 1);
        stepY = e.movementY / (zoomMultiplier || 1);
      } else if ('touches' in e) {
        const touch = e.touches[0];
        if (touch && padLastTouchRef.current) {
          stepX = (touch.clientX - padLastTouchRef.current.x) / (zoomMultiplier || 1);
          stepY = (touch.clientY - padLastTouchRef.current.y) / (zoomMultiplier || 1);
          padLastTouchRef.current = { x: touch.clientX, y: touch.clientY };
        }
      }

      totalDeltaRef.current.x += stepX;
      totalDeltaRef.current.y += stepY;

      const isCtrl = Boolean('ctrlKey' in e && (e.ctrlKey || e.metaKey));
      const isShift = Boolean('shiftKey' in e && e.shiftKey);

      onRemoteDragMove?.(totalDeltaRef.current.x, totalDeltaRef.current.y, isCtrl, isShift);
    };

    const handlePadEnd = () => {
      if (document.pointerLockElement) {
        try {
          document.exitPointerLock?.();
        } catch {}
      }
      document.body.style.cursor = '';
      setIsPadDragging(false);
      padLastTouchRef.current = null;
      onRemoteDragEnd?.();
    };

    const handlePointerLockChange = () => {
      if (!document.pointerLockElement && isPadDragging) {
        handlePadEnd();
      }
    };

    window.addEventListener('mousemove', handlePadMove);
    window.addEventListener('mouseup', handlePadEnd);
    window.addEventListener('touchmove', handlePadMove, { passive: false });
    window.addEventListener('touchend', handlePadEnd);
    document.addEventListener('pointerlockchange', handlePointerLockChange);

    return () => {
      window.removeEventListener('mousemove', handlePadMove);
      window.removeEventListener('mouseup', handlePadEnd);
      window.removeEventListener('touchmove', handlePadMove);
      window.removeEventListener('touchend', handlePadEnd);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      document.body.style.cursor = '';
    };
  }, [isPadDragging, onRemoteDragMove, onRemoteDragEnd, zoomMultiplier]);

  // Curve control point pads (Red & Blue) drag handlers with Pointer Lock
  const handleCtrlPadStart = (type: 'red' | 'blue', e: React.MouseEvent | React.TouchEvent) => {
    if (!hasSelection || !hasCurveSelection) return;
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();

    totalCtrlDeltaRef.current = { x: 0, y: 0 };
    setActiveCtrlPad(type);

    if ('touches' in e) {
      const t = e.touches[0];
      if (t) ctrlLastTouchRef.current = { x: t.clientX, y: t.clientY };
    } else {
      const padEl = type === 'red' ? redPadRef.current : bluePadRef.current;
      if (padEl) {
        try {
          padEl.requestPointerLock?.();
        } catch {}
      }
      document.body.style.cursor = 'none';
    }

    onControlPointDragStart?.();
  };

  useEffect(() => {
    if (!activeCtrlPad) return;

    const handleCtrlMove = (e: MouseEvent | TouchEvent) => {
      if ('touches' in e && e.cancelable) {
        e.preventDefault();
      }

      let stepX = 0;
      let stepY = 0;

      if ('movementX' in e) {
        stepX = e.movementX / (zoomMultiplier || 1);
        stepY = e.movementY / (zoomMultiplier || 1);
      } else if ('touches' in e) {
        const touch = e.touches[0];
        if (touch && ctrlLastTouchRef.current) {
          stepX = (touch.clientX - ctrlLastTouchRef.current.x) / (zoomMultiplier || 1);
          stepY = (touch.clientY - ctrlLastTouchRef.current.y) / (zoomMultiplier || 1);
          ctrlLastTouchRef.current = { x: touch.clientX, y: touch.clientY };
        }
      }

      totalCtrlDeltaRef.current.x += stepX;
      totalCtrlDeltaRef.current.y += stepY;

      const isCtrl = Boolean('ctrlKey' in e && (e.ctrlKey || e.metaKey));
      const isShift = Boolean('shiftKey' in e && e.shiftKey);

      onControlPointDragMove?.(activeCtrlPad, totalCtrlDeltaRef.current.x, totalCtrlDeltaRef.current.y, isCtrl, isShift);
    };

    const handleCtrlEnd = () => {
      if (document.pointerLockElement) {
        try {
          document.exitPointerLock?.();
        } catch {}
      }
      document.body.style.cursor = '';
      setActiveCtrlPad(null);
      ctrlLastTouchRef.current = null;
      onControlPointDragEnd?.();
    };

    const handlePointerLockChange = () => {
      if (!document.pointerLockElement && activeCtrlPad) {
        handleCtrlEnd();
      }
    };

    window.addEventListener('mousemove', handleCtrlMove);
    window.addEventListener('mouseup', handleCtrlEnd);
    window.addEventListener('touchmove', handleCtrlMove, { passive: false });
    window.addEventListener('touchend', handleCtrlEnd);
    document.addEventListener('pointerlockchange', handlePointerLockChange);

    return () => {
      window.removeEventListener('mousemove', handleCtrlMove);
      window.removeEventListener('mouseup', handleCtrlEnd);
      window.removeEventListener('touchmove', handleCtrlMove);
      window.removeEventListener('touchend', handleCtrlEnd);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      document.body.style.cursor = '';
    };
  }, [activeCtrlPad, onControlPointDragMove, onControlPointDragEnd, zoomMultiplier]);

  // Repeated action handlers for continuous smooth movement
  const upHandlers = useRepeatAction(() => onNudge(0, -2));
  const downHandlers = useRepeatAction(() => onNudge(0, 2));
  const leftHandlers = useRepeatAction(() => onNudge(-2, 0));
  const rightHandlers = useRepeatAction(() => onNudge(2, 0));

  const rotCcwHandlers = useRepeatAction(() => onRotate(-15), 320, 90);
  const rotCwHandlers = useRepeatAction(() => onRotate(15), 320, 90);

  const zoomInHandlers = useRepeatAction(() => onResize(1.08), 320, 90);
  const zoomOutHandlers = useRepeatAction(() => onResize(0.92), 320, 90);

  // Common button styles with zero padding and seamless Liquid Glass alignment
  const keyBaseStyle = `
    group select-none flex items-center justify-center transition-all duration-200 ease-out
    active:shadow-inner active:scale-[0.97]
    ${hasSelection
      ? isDarkMode
        ? 'bg-slate-800/45 hover:bg-slate-700/70 active:bg-slate-900/80 text-slate-100 cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
        : 'bg-white/55 hover:bg-white/90 active:bg-slate-100/80 text-slate-800 cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]'
      : isDarkMode
        ? 'bg-slate-900/40 text-slate-600 cursor-not-allowed opacity-50'
        : 'bg-white/30 text-slate-300 cursor-not-allowed opacity-50'
    }
  `;

  // Internal border color dividing keys (translucent glass hairlines)
  const borderColor = isDarkMode ? 'border-white/12' : 'border-slate-300/60';

  return (
    <div
      ref={panelRef}
      style={{
        ...(position
          ? {
              position: 'absolute' as const,
              left: `${position.x}px`,
              top: `${position.y}px`,
            }
          : {}),
        touchAction: 'none',
        transform: animStyle.transform,
        opacity: animStyle.opacity,
        filter: animStyle.filter,
        pointerEvents: animStyle.pointerEvents,
        visibility: animStyle.visibility,
        transition: isDragging
          ? 'none'
          : animStyle.transition !== 'none'
            ? animStyle.transition
            : 'left 200ms cubic-bezier(0.16, 1, 0.3, 1), top 200ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 150ms ease',
      }}
      className={`${
        !position ? 'absolute bottom-6 left-20' : ''
      } z-40 select-none rounded-2xl overflow-hidden ${
        isDarkMode ? 'liquid-glass-heavy-dark text-slate-100' : 'liquid-glass-heavy text-slate-800'
      } ${
        isDragging ? 'ring-2 ring-[#007AFF]/80 shadow-[0_24px_60px_rgba(0,122,255,0.28)] cursor-grabbing' : ''
      }`}
    >
      {/* Draggable Header / Handle with Mode Switcher & Size Toggle */}
      <div
        onMouseDown={handleDragStart}
        onTouchStart={handleDragStart}
        style={{ touchAction: 'none' }}
        className={`${
          isLarge ? 'h-8.5 px-2.5 gap-2' : 'h-7 px-2 gap-1.5'
        } flex items-center justify-between border-b cursor-grab active:cursor-grabbing transition-all duration-200 ease-out ${
          isDarkMode ? 'border-white/12 bg-slate-800/50' : 'border-slate-300/55 bg-white/55'
        }`}
        title="ドラッグして移動"
      >
        {/* Left: Drag Handle */}
        <div className="flex items-center">
          <GripHorizontal className={`${isLarge ? 'w-4 h-4' : 'w-3.5 h-3.5'} shrink-0 transition-all duration-200 ${isDarkMode ? 'text-slate-400' : 'text-slate-400'}`} />
        </div>

        {/* Center-Right: Mode Switch Buttons, Size Button & Collapse */}
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {/* Mode Switcher Pill */}
          <div className={`flex items-center rounded-full p-0.5 border transition-all duration-200 ${
            isDarkMode ? 'border-white/12 bg-slate-900/60' : 'border-slate-300/60 bg-slate-200/50'
          }`}>
            <button
              type="button"
              onClick={() => setMode('dpad')}
              className={`${isLarge ? 'p-1' : 'p-0.5'} rounded-full transition-all duration-200 ${
                mode === 'dpad'
                  ? 'bg-[#007AFF] text-white shadow-xs'
                  : isDarkMode
                    ? 'text-slate-400 hover:text-slate-200'
                    : 'text-slate-500 hover:text-slate-800'
              }`}
              title="十字キーモード"
            >
              <Gamepad2 className={`${isLarge ? 'w-3.5 h-3.5' : 'w-3 h-3'} transition-all duration-200`} />
            </button>
            <button
              type="button"
              onClick={() => setMode('trackpad')}
              className={`${isLarge ? 'p-1' : 'p-0.5'} rounded-full transition-all duration-200 ${
                mode === 'trackpad'
                  ? 'bg-[#007AFF] text-white shadow-xs'
                  : isDarkMode
                    ? 'text-slate-400 hover:text-slate-200'
                    : 'text-slate-500 hover:text-slate-800'
              }`}
              title="トラックパッドモード (カーソル非表示・遠隔ドラッグ)"
            >
              <Touchpad className={`${isLarge ? 'w-3.5 h-3.5' : 'w-3 h-3'} transition-all duration-200`} />
            </button>
          </div>

          {/* Panel Size Toggle Button (Normal vs Large) */}
          <button
            type="button"
            onClick={handleToggleLarge}
            className={`${isLarge ? 'p-1' : 'p-0.5'} rounded-full border transition-all duration-200 ${
              isLarge
                ? 'bg-[#007AFF] text-white border-blue-400 shadow-xs'
                : isDarkMode
                  ? 'border-white/12 bg-slate-900/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  : 'border-slate-300/60 bg-white/75 text-slate-500 hover:text-slate-800 hover:bg-white'
            }`}
            title={isLarge ? '標準サイズに戻す' : 'パネルを拡大 (大サイズ)'}
          >
            {isLarge ? (
              <Minimize2 className={`${isLarge ? 'w-3.5 h-3.5' : 'w-3 h-3'} transition-all duration-200`} />
            ) : (
              <Maximize2 className={`${isLarge ? 'w-3.5 h-3.5' : 'w-3 h-3'} transition-all duration-200`} />
            )}
          </button>

          {/* Collapse / Expand Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsCollapsed(prev => !prev);
            }}
            className={`${isLarge ? 'p-1' : 'p-0.5'} rounded-full transition-all duration-200 ${
              isDarkMode ? 'hover:bg-slate-700/70 text-slate-400' : 'hover:bg-white/80 text-slate-500'
            }`}
            title={isCollapsed ? '展開' : '折りたたむ'}
          >
            {isCollapsed ? (
              <ChevronDown className={`${isLarge ? 'w-3.5 h-3.5' : 'w-3 h-3'} transition-all duration-200`} />
            ) : (
              <ChevronUp className={`${isLarge ? 'w-3.5 h-3.5' : 'w-3 h-3'} transition-all duration-200`} />
            )}
          </button>
        </div>
      </div>

      {/* Body: Key Layout with NO PADDING */}
      {!isCollapsed && (
        <div className="flex items-center justify-center p-0 m-0 select-none">
          {/* ── Left Column: Rotation ── */}
          <div className="flex flex-col shrink-0 transition-all duration-200 ease-out">
            {/* Rotate CCW */}
            <button
              type="button"
              disabled={!hasSelection}
              {...rotCcwHandlers}
              className={`${isLarge ? 'w-16 h-16' : 'w-10 h-10'} border-r border-b ${borderColor} ${keyBaseStyle}`}
              title="左回転 -15°"
            >
              <RotateCcw className={`${isLarge ? 'w-6 h-6' : 'w-4 h-4'} text-amber-500 group-hover:scale-110 transition-all duration-200`} />
            </button>
            {/* Rotate CW */}
            <button
              type="button"
              disabled={!hasSelection}
              {...rotCwHandlers}
              className={`${isLarge ? 'w-16 h-16' : 'w-10 h-10'} border-r ${borderColor} ${keyBaseStyle}`}
              title="右回転 +15°"
            >
              <RotateCw className={`${isLarge ? 'w-6 h-6' : 'w-4 h-4'} text-amber-500 group-hover:scale-110 transition-all duration-200`} />
            </button>
          </div>

          {/* ── Center Area: Either D-Pad (3 columns) OR Trackpad ── */}
          {mode === 'dpad' ? (
            <div className={`grid grid-cols-3 gap-0 ${isLarge ? 'w-48 h-32' : 'w-[120px] h-20'} shrink-0 transition-all duration-200 ease-out`}>
              {/* Arrow Left (Tall, row-span-2) */}
              <button
                type="button"
                disabled={!hasSelection}
                {...leftHandlers}
                className={`${isLarge ? 'w-16 h-32' : 'w-10 h-20'} row-span-2 border-r ${borderColor} ${keyBaseStyle}`}
                title="左へ移動"
              >
                <ArrowLeft className={`${isLarge ? 'w-7 h-7' : 'w-4.5 h-4.5'} group-hover:scale-110 transition-all duration-200`} />
              </button>

              {/* Center Column: Up & Down */}
              <div className="flex flex-col transition-all duration-200 ease-out">
                {/* Arrow Up (Square) */}
                <button
                  type="button"
                  disabled={!hasSelection}
                  {...upHandlers}
                  className={`${isLarge ? 'w-16 h-16' : 'w-10 h-10'} border-r border-b ${borderColor} ${keyBaseStyle}`}
                  title="上へ移動"
                >
                  <ArrowUp className={`${isLarge ? 'w-7 h-7' : 'w-4.5 h-4.5'} group-hover:scale-110 transition-all duration-200`} />
                </button>

                {/* Arrow Down (Square) */}
                <button
                  type="button"
                  disabled={!hasSelection}
                  {...downHandlers}
                  className={`${isLarge ? 'w-16 h-16' : 'w-10 h-10'} border-r ${borderColor} ${keyBaseStyle}`}
                  title="下へ移動"
                >
                  <ArrowDown className={`${isLarge ? 'w-7 h-7' : 'w-4.5 h-4.5'} group-hover:scale-110 transition-all duration-200`} />
                </button>
              </div>

              {/* Arrow Right (Tall, row-span-2) */}
              <button
                type="button"
                disabled={!hasSelection}
                {...rightHandlers}
                className={`${isLarge ? 'w-16 h-32' : 'w-10 h-20'} row-span-2 border-r ${borderColor} ${keyBaseStyle}`}
                title="右へ移動"
              >
                <ArrowRight className={`${isLarge ? 'w-7 h-7' : 'w-4.5 h-4.5'} group-hover:scale-110 transition-all duration-200`} />
              </button>
            </div>
          ) : (
            /* ── Trackpad Mode: Seamless Touchpad (Pointer Lock) ── */
            <div
              ref={trackpadRef}
              onMouseDown={handleTrackpadStart}
              onTouchStart={handleTrackpadStart}
              style={{ touchAction: 'none' }}
              className={`relative ${isLarge ? 'w-48 h-32' : 'w-[120px] h-20'} border-r ${borderColor} shrink-0 select-none overflow-hidden transition-all duration-200 ease-out ${
                hasSelection
                  ? isDarkMode
                    ? isPadDragging
                      ? 'bg-slate-800/75 ring-1 ring-blue-500/50 cursor-none'
                      : 'bg-slate-800/45 hover:bg-slate-700/65 cursor-grab'
                    : isPadDragging
                      ? 'bg-blue-50/75 ring-1 ring-blue-400 cursor-none'
                      : 'bg-white/50 hover:bg-white/80 cursor-grab'
                  : isDarkMode
                    ? 'bg-slate-900/40 cursor-not-allowed opacity-40'
                    : 'bg-white/30 cursor-not-allowed opacity-40'
              }`}
              title={hasSelection ? 'ドラッグして遠隔操作 (操作中カーソル非表示)' : 'オブジェクトを選択してください'}
            >
              {/* Subtle background grid / centering crosshair */}
              <div className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-all ${
                isPadDragging ? 'opacity-70 scale-110' : 'opacity-20'
              }`}>
                <Crosshair className={`${isLarge ? 'w-9 h-9' : 'w-6 h-6'} transition-all duration-200 ${
                  isPadDragging ? 'text-blue-500 animate-pulse' : 'text-slate-500'
                }`} />
              </div>

              {/* Subtle center cross lines */}
              <div className={`absolute top-1/2 left-0 right-0 h-px pointer-events-none ${
                isPadDragging
                  ? 'bg-blue-400/40'
                  : isDarkMode ? 'bg-slate-700/40' : 'bg-slate-300/40'
              }`} />
              <div className={`absolute top-0 bottom-0 left-1/2 w-px pointer-events-none ${
                isPadDragging
                  ? 'bg-blue-400/40'
                  : isDarkMode ? 'bg-slate-700/40' : 'bg-slate-300/40'
              }`} />

              {/* Active pulsating pulse indicator in center while dragging */}
              {isPadDragging && (
                <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 ${isLarge ? 'w-5 h-5' : 'w-3 h-3'} rounded-full bg-blue-500/30 border border-blue-400 pointer-events-none shadow-md animate-ping transition-all duration-200`} />
              )}
            </div>
          )}

          {/* ── Size Controls Column ── */}
          <div className="flex flex-col shrink-0 transition-all duration-200 ease-out">
            {/* Zoom In */}
            <button
              type="button"
              disabled={!hasSelection}
              {...zoomInHandlers}
              className={`${isLarge ? 'w-16 h-16' : 'w-10 h-10'} border-b ${borderColor} ${hasCurveSelection ? `border-r ${borderColor}` : ''} ${keyBaseStyle}`}
              title="拡大"
            >
              <Plus className={`${isLarge ? 'w-7 h-7' : 'w-4.5 h-4.5'} text-emerald-500 group-hover:scale-110 transition-all duration-200`} />
            </button>
            {/* Zoom Out */}
            <button
              type="button"
              disabled={!hasSelection}
              {...zoomOutHandlers}
              className={`${isLarge ? 'w-16 h-16' : 'w-10 h-10'} ${hasCurveSelection ? `border-r ${borderColor}` : ''} ${keyBaseStyle}`}
              title="縮小"
            >
              <Minus className={`${isLarge ? 'w-7 h-7' : 'w-4.5 h-4.5'} text-emerald-500 group-hover:scale-110 transition-all duration-200`} />
            </button>
          </div>

          {/* ── Optional Curve Control Points: Red Pad & Blue Pad ── */}
          {hasCurveSelection && (
            <>
              {/* Red Control Point Pad (Center Arc / Peak) */}
              <div
                ref={redPadRef}
                onMouseDown={(e) => handleCtrlPadStart('red', e)}
                onTouchStart={(e) => handleCtrlPadStart('red', e)}
                style={{ touchAction: 'none' }}
                className={`relative ${isLarge ? 'w-16 h-32' : 'w-10 h-20'} border-r ${borderColor} shrink-0 select-none overflow-hidden transition-all duration-200 ease-out ${
                  activeCtrlPad === 'red'
                    ? isDarkMode
                      ? 'bg-red-950/60 ring-1 ring-red-500/50 cursor-none'
                      : 'bg-red-50/75 ring-1 ring-red-400 cursor-none'
                    : isDarkMode
                      ? 'bg-slate-800/45 hover:bg-slate-700/65 cursor-grab'
                      : 'bg-white/55 hover:bg-red-50/45 cursor-grab'
                }`}
                title="赤の制御点（頂点・高さ）を遠隔操作"
              >
                {/* Subtle center cross lines */}
                <div className={`absolute top-1/2 left-0 right-0 h-px pointer-events-none ${
                  activeCtrlPad === 'red' ? 'bg-red-400/40' : isDarkMode ? 'bg-white/10' : 'bg-slate-300/50'
                }`} />
                <div className={`absolute top-0 bottom-0 left-1/2 w-px pointer-events-none ${
                  activeCtrlPad === 'red' ? 'bg-red-400/40' : isDarkMode ? 'bg-white/10' : 'bg-slate-300/50'
                }`} />

                {/* Center Red Dot Handle */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className={`${isLarge ? 'w-5 h-5' : 'w-3.5 h-3.5'} rounded-full transition-all duration-200 ${
                    isControlPointSnapped
                      ? 'bg-emerald-500 scale-125 shadow-md shadow-emerald-500/50 ring-2 ring-emerald-300'
                      : activeCtrlPad === 'red'
                        ? 'bg-red-500 scale-125 shadow-md shadow-red-500/50 ring-2 ring-red-300'
                        : 'bg-red-500/90 shadow-xs ring-1 ring-red-400/50'
                  }`} />
                </div>

                {/* Active pulsating pulse indicator in center while dragging */}
                {activeCtrlPad === 'red' && (
                  <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 ${isLarge ? 'w-6 h-6' : 'w-4 h-4'} rounded-full ${
                    isControlPointSnapped ? 'bg-emerald-500/30 border border-emerald-400' : 'bg-red-500/30 border border-red-400'
                  } pointer-events-none shadow-md animate-ping transition-all duration-200`} />
                )}
              </div>

              {/* Blue Control Point Pad (Endpoints / Spread) */}
              <div
                ref={bluePadRef}
                onMouseDown={(e) => handleCtrlPadStart('blue', e)}
                onTouchStart={(e) => handleCtrlPadStart('blue', e)}
                style={{ touchAction: 'none' }}
                className={`relative ${isLarge ? 'w-16 h-32' : 'w-10 h-20'} shrink-0 select-none overflow-hidden transition-all duration-200 ease-out ${
                  activeCtrlPad === 'blue'
                    ? isDarkMode
                      ? 'bg-blue-950/60 ring-1 ring-blue-500/50 cursor-none'
                      : 'bg-blue-50/75 ring-1 ring-blue-400 cursor-none'
                    : isDarkMode
                      ? 'bg-slate-800/45 hover:bg-slate-700/65 cursor-grab'
                      : 'bg-white/55 hover:bg-blue-50/45 cursor-grab'
                }`}
                title="青の制御点（端点・幅）を遠隔操作"
              >
                {/* Subtle center cross lines */}
                <div className={`absolute top-1/2 left-0 right-0 h-px pointer-events-none ${
                  activeCtrlPad === 'blue' ? 'bg-blue-400/40' : isDarkMode ? 'bg-white/10' : 'bg-slate-300/50'
                }`} />
                <div className={`absolute top-0 bottom-0 left-1/2 w-px pointer-events-none ${
                  activeCtrlPad === 'blue' ? 'bg-blue-400/40' : isDarkMode ? 'bg-white/10' : 'bg-slate-300/50'
                }`} />

                {/* Center Single Blue Dot Handle */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className={`${isLarge ? 'w-5 h-5' : 'w-3.5 h-3.5'} rounded-full transition-all duration-200 ${
                    activeCtrlPad === 'blue'
                      ? 'bg-blue-600 scale-125 shadow-md shadow-blue-500/50 ring-2 ring-blue-300'
                      : 'bg-blue-600/90 shadow-xs ring-1 ring-blue-400/50'
                  }`} />
                </div>

                {/* Active pulsating pulse indicator in center while dragging */}
                {activeCtrlPad === 'blue' && (
                  <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 ${isLarge ? 'w-6 h-6' : 'w-4 h-4'} rounded-full bg-blue-500/30 border border-blue-400 pointer-events-none shadow-md animate-ping transition-all duration-200`} />
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default FloatingObjectControlPanel;
