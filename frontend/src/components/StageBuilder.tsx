import React, { useState, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import axios from 'axios';
import type { ExtractedIcon } from '../App';
import IconAdjustModal from './IconAdjustModal';
import StageCanvas, { type PlacedItem, type StageCanvasRef, type SnapSettings } from './StageCanvas';
import TallyTable from './TallyTable';
import { ItemInspector } from './ItemInspector';
import { FullPageEditor, type SceneExportData } from './FullPageEditor';
import { TEMPLATE_SHAPES, getTemplateDataUrl, getPercussionInfo } from '../utils/templateShapes';
import { createDefaultCurveObject, type CurveObject, type CurveItem } from '../utils/bezierUtils';
import { ContextMenu } from './ContextMenu';
import { copyStageObjects, pasteStageObjects, duplicateStageObjects, hasStageObjectsInClipboard } from '../utils/clipboard';
import { updateSessionTimestampInIndexedDB } from '../utils/indexedDb';

export interface Scene {
  id: string;
  name: string;
  placedItems: PlacedItem[];
  curveObjects: CurveObject[];
  snapSettings?: SnapSettings;
}


export interface StageSnapshot {
  placedItems: PlacedItem[];
  curveObjects: CurveObject[];
  scenes: Scene[];
  currentSceneId: string;
  snapSettings: SnapSettings;
  backgroundCrop?: { x: number; y: number; width: number; height: number } | null;
  pageImageUrl?: string;
  backgroundUrl?: string;
  iconsRegionUrl?: string;
  extractedIcons?: ExtractedIcon[];
  iconLabels?: Record<string, string>;
}

interface Props {
  backgroundUrl: string | null;
  iconsRegionUrl: string | null;
  extractedIcons: ExtractedIcon[];
  backgroundCrop: { x: number; y: number; width: number; height: number } | null;
  fileId: string | null;
  pageImageUrl: string;
  initialIconLabels?: Record<string, string>;
  onIconsUpdated: (icons: ExtractedIcon[], newLabels?: Record<string, string>) => void;
  onBack: () => void;
  onPhaseChange?: (phase: 3 | 4) => void;
}

type PaletteTab = 'template' | 'pdf';

const StageBuilder: React.FC<Props> = ({
  backgroundUrl,
  iconsRegionUrl,
  extractedIcons,
  backgroundCrop,
  fileId,
  pageImageUrl,
  initialIconLabels,
  onIconsUpdated,
  onBack,
  onPhaseChange,
}) => {
  const BACKUP_KEY = `settingkun_backup_${fileId || 'default'}`;

  // Load initial backup from localStorage if available
  const [initialBackup] = useState<StageSnapshot | null>(() => {
    try {
      const saved = localStorage.getItem(BACKUP_KEY);
      if (saved) {
        return JSON.parse(saved) as StageSnapshot;
      }
    } catch (e) {
      console.warn('Failed to parse backup:', e);
    }
    return null;
  });

  const initialScenes: Scene[] = (initialBackup?.scenes && initialBackup.scenes.length > 0)
    ? initialBackup.scenes
    : [
        {
          id: `scene_${Date.now()}`,
          name: '場面 1',
          placedItems: initialBackup?.placedItems || [],
          curveObjects: initialBackup?.curveObjects || [],
        },
      ];

  const initialCurrentSceneId: string =
    initialBackup?.currentSceneId && initialScenes.some(s => s.id === initialBackup.currentSceneId)
      ? initialBackup.currentSceneId
      : initialScenes[0].id;

  const activeInitialScene = initialScenes.find(s => s.id === initialCurrentSceneId) || initialScenes[0];

  const initialPlacedItems: PlacedItem[] =
    activeInitialScene.placedItems && activeInitialScene.placedItems.length > 0
      ? activeInitialScene.placedItems
      : (initialBackup?.placedItems || []);

  const initialCurveObjects: CurveObject[] =
    activeInitialScene.curveObjects && activeInitialScene.curveObjects.length > 0
      ? activeInitialScene.curveObjects
      : (initialBackup?.curveObjects || []);

  const [isAdjusting, setIsAdjusting] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [stageImageUrl, setStageImageUrl] = useState<string | null>(null);
  const [placedItems, setPlacedItems] = useState<PlacedItem[]>(initialPlacedItems);
  const [curveObjects, setCurveObjects] = useState<CurveObject[]>(initialCurveObjects);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedCurveIds, setSelectedCurveIds] = useState<string[]>([]);
  const [selectedCurveItemId, setSelectedCurveItemId] = useState<string | null>(null);

  // Derived single selections for inspector compatibility
  const selectedId = selectedIds.length === 1 && selectedCurveIds.length === 0 ? selectedIds[0] : null;
  const selectedCurveId = selectedCurveIds.length === 1 && selectedIds.length === 0 ? selectedCurveIds[0] : null;

  const setSelectedId = (id: string | null) => {
    setSelectedIds(id ? [id] : []);
    if (id) setSelectedCurveItemId(null);
  };
  const setSelectedCurveId = (id: string | null) => {
    setSelectedCurveIds(id ? [id] : []);
    if (!id) setSelectedCurveItemId(null);
  };

  useEffect(() => {
    if (!selectedCurveId) {
      setSelectedCurveItemId(null);
    }
  }, [selectedCurveId]);

  const [paletteTab, setPaletteTab] = useState<PaletteTab>('pdf');
  const [iconLabels, setIconLabels] = useState<Record<string, string>>(() => {
    const merged: Record<string, string> = {
      ...(initialBackup?.iconLabels ?? {}),
      ...(initialIconLabels ?? {})
    };
    extractedIcons.forEach((ic, idx) => {
      if (!merged[ic.id]) {
        merged[ic.id] = ic.label || `パーツ ${idx + 1}`;
      }
    });
    return merged;
  });

  const iconLabelsRef = useRef(iconLabels);
  iconLabelsRef.current = iconLabels;

  useEffect(() => {
    setIconLabels(prev => {
      const next = { ...prev };
      let changed = false;
      extractedIcons.forEach((ic, idx) => {
        if (!next[ic.id]) {
          next[ic.id] = ic.label || `パーツ ${idx + 1}`;
          changed = true;
        } else if (ic.label && ic.label !== next[ic.id]) {
          next[ic.id] = ic.label;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [extractedIcons]);

  // Auto-heal custom curve items if their URL was a stale /static/ URL by applying the working data URL from extractedIcons
  useEffect(() => {
    if (extractedIcons && extractedIcons.length > 0) {
      setCurveObjects(prev => {
        let changed = false;
        const next = prev.map(c => {
          if (!Array.isArray(c.items)) return c;
          const nextItems = c.items.map(it => {
            if (it.isCustom && it.iconId) {
              const def = extractedIcons.find(ic => ic.id === it.iconId);
              if (def?.url && def.url.startsWith('data:') && it.url !== def.url) {
                changed = true;
                return { ...it, url: def.url };
              }
            }
            return it;
          });
          return changed ? { ...c, items: nextItems } : c;
        });
        return changed ? next : prev;
      });
    }
  }, [extractedIcons]);

  // Scenes management (Phase 3 scenes logic ported from prototype)
  const [scenes, setScenes] = useState<Scene[]>(initialScenes);
  const [currentSceneId, setCurrentSceneId] = useState<string>(initialCurrentSceneId);
  const [drawerSubmenu, setDrawerSubmenu] = useState<'scenes' | 'settings' | null>(null);

  const [snapSettings, setSnapSettings] = useState<SnapSettings>(() => {
    const defaultSettings: SnapSettings = {
      showGrid: false,
      gridSize: 50,
      showCenterMarker: false,
      centerOffset: { x: 0, y: 0 },
      snapToCenter: true,
      snapToGrid: false,
      snapAngle: true,
    };
    if (initialBackup?.snapSettings) {
      return {
        ...defaultSettings,
        ...initialBackup.snapSettings,
        showCenterMarker: false, // Default to hidden for clean view
      };
    }
    return defaultSettings;
  });

  const [isMovingCenter, setIsMovingCenter] = useState(false);

  // Scale Measurement State (2 points distance defining meters, ported from prototype)
  const [isMeasuringScale, setIsMeasuringScale] = useState(false);
  const [measuredDistance, setMeasuredDistance] = useState<number | null>(null);
  const [measureMetersInput, setMeasureMetersInput] = useState<string>('1');

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    canvasX: number;
    canvasY: number;
    targetItemId?: string | null;
  } | null>(null);

  const stageCanvasRef = useRef<StageCanvasRef>(null);
  const paletteScrollRef = useRef<HTMLDivElement>(null);

  // Dark Mode State (synced with localStorage and html class)
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('settingkun_dark_mode') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('settingkun_dark_mode', 'true');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('settingkun_dark_mode', 'false');
    }
  }, [isDarkMode]);

  const toggleDarkMode = () => setIsDarkMode(prev => !prev);

  // Zoom state
  const [zoomMultiplier, setZoomMultiplier] = useState(1.0);
  const handleZoomIn = () => setZoomMultiplier(prev => Math.min(Number((prev + 0.15).toFixed(2)), 2.5));
  const handleZoomOut = () => setZoomMultiplier(prev => Math.max(Number((prev - 0.15).toFixed(2)), 0.5));

  // Global mouse wheel zoom for phase 3
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (isExportModalOpen) return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoomMultiplier(prev => {
          const newZoom = e.deltaY < 0 ? prev + 0.1 : prev - 0.1;
          return Math.min(Math.max(Number(newZoom.toFixed(2)), 0.5), 2.5);
        });
      }
    };
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [isExportModalOpen]);

  const placedItemsRef = useRef(placedItems);
  placedItemsRef.current = placedItems;
  const curveObjectsRef = useRef(curveObjects);
  curveObjectsRef.current = curveObjects;
  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;
  const currentSceneIdRef = useRef(currentSceneId);
  currentSceneIdRef.current = currentSceneId;
  const snapSettingsRef = useRef(snapSettings);
  snapSettingsRef.current = snapSettings;

  const HISTORY_MAX = 50;
  const historyRef = useRef<StageSnapshot[]>([]);      // past snapshots (oldest first)
  const redoStackRef = useRef<StageSnapshot[]>([]);    // future snapshots for redo
  const isRestoringRef = useRef(false);                // flag: skip pushing while restoring

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // ─── Backup (localStorage auto-save + 5 MB warning) ─────────────────────────
  const [backupWarning, setBackupWarning] = useState<string | null>(null);

  const saveBackup = (snapshot: StageSnapshot) => {
    try {
      const json = JSON.stringify(snapshot);
      const bytes = new TextEncoder().encode(json).length;
      const MB = bytes / (1024 * 1024);
      if (MB > 5) {
        setBackupWarning(`バックアップデータが ${MB.toFixed(1)} MB に達しました（5MB 超）。データが多い場合はブラウザの容量に注意してください。`);
      } else {
        setBackupWarning(null);
      }
      localStorage.setItem(BACKUP_KEY, json);
      localStorage.setItem(BACKUP_KEY + '_ts', Date.now().toString());
      if (fileId) {
        updateSessionTimestampInIndexedDB(fileId);
      }
    } catch {
      setBackupWarning('バックアップの保存に失敗しました（ストレージ容量不足の可能性）。');
    }
  };

  // Build a snapshot of the current working state (deep copy to prevent mutations)
  const buildSnapshot = (): StageSnapshot => JSON.parse(JSON.stringify({
    placedItems: placedItemsRef.current,
    curveObjects: curveObjectsRef.current,
    // Merge current working state into scenes list before saving
    scenes: scenesRef.current.map(sc =>
      sc.id === currentSceneIdRef.current ? { ...sc, placedItems: placedItemsRef.current, curveObjects: curveObjectsRef.current, snapSettings: snapSettingsRef.current } : sc
    ),
    currentSceneId: currentSceneIdRef.current,
    snapSettings: snapSettingsRef.current,
    backgroundCrop: backgroundCrop || initialBackup?.backgroundCrop,
    pageImageUrl: pageImageUrl || initialBackup?.pageImageUrl,
    backgroundUrl: backgroundUrl || initialBackup?.backgroundUrl,
    iconsRegionUrl: iconsRegionUrl || initialBackup?.iconsRegionUrl,
    extractedIcons: extractedIcons || initialBackup?.extractedIcons,
    iconLabels: iconLabelsRef.current,
  }));

  const handleBack = () => {
    saveBackup(buildSnapshot());
    onBack();
  };

  const handleExportJson = () => {
    try {
      const snap = buildSnapshot();
      saveBackup(snap);

      const d = new Date();
      const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
      const fileName = `settingkun_${fileId ? fileId.substring(0, 8) : 'project'}_${dateStr}.json`;

      const exportPayload = {
        version: '2.0',
        projectId: fileId || 'default',
        name: `セッティング_${dateStr}`,
        exportedAt: Date.now(),
        ...snap,
      };

      const jsonStr = JSON.stringify(exportPayload, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to export JSON:', e);
      alert('JSONファイルの書き出しに失敗しました。');
    }
  };

  // Push current state onto history (called after every meaningful user action)
  const pushHistory = () => {
    if (isRestoringRef.current) return;
    const snap = buildSnapshot();
    historyRef.current = [...historyRef.current.slice(-HISTORY_MAX + 1), snap];
    redoStackRef.current = [];
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(false);
    saveBackup(snap);
  };

  // Restore a snapshot to the React state
  const restoreSnapshot = (snap: StageSnapshot) => {
    isRestoringRef.current = true;
    const safeSnap = JSON.parse(JSON.stringify(snap));
    setScenes(safeSnap.scenes);
    setCurrentSceneId(safeSnap.currentSceneId);
    setPlacedItems(safeSnap.placedItems);
    setCurveObjects(safeSnap.curveObjects);
    if (safeSnap.iconLabels) {
      setIconLabels(prev => ({ ...prev, ...safeSnap.iconLabels }));
      iconLabelsRef.current = { ...iconLabelsRef.current, ...safeSnap.iconLabels };
    }
    setSnapSettings(prev => ({
      ...prev,
      ...safeSnap.snapSettings,
      showCenterMarker: prev.showCenterMarker,
    }));
    setSelectedIds([]);
    setSelectedCurveIds([]);
    saveBackup(safeSnap);
    // Allow tick for state to settle before re-enabling history tracking
    requestAnimationFrame(() => { isRestoringRef.current = false; });
  };

  const handleUndo = () => {
    if (historyRef.current.length === 0) return;
    // Save current state to redo stack
    redoStackRef.current = [buildSnapshot(), ...redoStackRef.current];
    const snap = historyRef.current[historyRef.current.length - 1];
    historyRef.current = historyRef.current.slice(0, -1);
    restoreSnapshot(snap);
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(true);
  };

  const handleRedo = () => {
    if (redoStackRef.current.length === 0) return;
    // Save current state to undo stack
    historyRef.current = [...historyRef.current, buildSnapshot()];
    const snap = redoStackRef.current[0];
    redoStackRef.current = redoStackRef.current.slice(1);
    restoreSnapshot(snap);
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
  };

  // Keyboard shortcuts for Undo / Redo (Ctrl/Cmd+Z, Ctrl/Cmd+Y, Ctrl/Cmd+Shift+Z)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      if (isExportModalOpen) return;
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      if (!isCmdOrCtrl) return;

      // Undo: Ctrl/Cmd + Z (without Shift)
      if ((e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }
      // Redo: Ctrl/Cmd + Shift + Z  OR  Ctrl/Cmd + Y
      if (((e.key === 'z' || e.key === 'Z') && e.shiftKey) || e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        handleRedo();
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExportModalOpen, canUndo, canRedo, placedItems, curveObjects, scenes, currentSceneId, snapSettings]);

  const scrollPalette = (direction: 'left' | 'right') => {
    if (paletteScrollRef.current) {
      paletteScrollRef.current.scrollBy({
        left: direction === 'left' ? -260 : 260,
        behavior: 'smooth',
      });
    }
  };


  // ─── Placed Item Handlers ───────────────────────────────────────────────────

  const handleAddItem = (iconId: string, x?: number, y?: number) => {
    // Check if iconId refers to a template (prefixed with 'tmpl_')
    const isTemplate = iconId.startsWith('tmpl_');
    const tmpl = isTemplate ? TEMPLATE_SHAPES.find(t => t.id === iconId || t.type === iconId.slice(5)) : undefined;
    const templateType = tmpl?.type ?? (isTemplate ? iconId.slice(5) : undefined);
    const iconDef = !isTemplate ? extractedIcons.find(ic => ic.id === iconId) : undefined;

    const defaultSize = 50;
    const percussionType = tmpl?.percussionType || (templateType === 'percussion' ? 'ティンパニ' : undefined);
    const pData = percussionType ? getPercussionInfo(percussionType) : undefined;

    let defaultWidth = isTemplate ? (tmpl?.defaultW ?? defaultSize) : (iconDef?.rect?.width ?? defaultSize) / 2.0;
    let defaultHeight = isTemplate ? (tmpl?.defaultH ?? defaultSize) : (iconDef?.rect?.height ?? defaultSize) / 2.0;
    if (pData) {
      defaultWidth = Math.round((pData.defaultW || 1.34) * 30);
      defaultHeight = Math.round((pData.defaultH || 1.34) * 30);
    }

    const effCenter = stageCanvasRef.current?.getEffectiveCenter();
    const spawnX = x ?? (effCenter?.x ?? 600);
    const spawnY = y ?? (effCenter?.y ?? 300);

    const newItem: PlacedItem = {
      id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      iconId,
      templateType,
      percussionType,
      showPercussionName: true,
      x: spawnX,
      y: spawnY,
      width: defaultWidth,
      height: defaultHeight,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    };
    pushHistory();
    setPlacedItems(prev => [...prev, newItem]);
    setSelectedId(newItem.id);
    setSelectedCurveId(null);
  };

  const handleUpdateItem = (id: string, newAttrs: Partial<PlacedItem>) => {
    const currentItem = placedItemsRef.current.find(i => i.id === id);
    if (currentItem) {
      const isChanged = Object.keys(newAttrs).some(
        key => (newAttrs as any)[key] !== (currentItem as any)[key]
      );
      if (!isChanged) return;
    }
    pushHistory();
    setPlacedItems(prev => prev.map(item => item.id === id ? { ...item, ...newAttrs } : item));
  };

  const handleDeleteItem = (id: string) => {
    pushHistory();
    setPlacedItems(prev => prev.filter(item => item.id !== id));
    setSelectedIds(prev => prev.filter(i => i !== id));
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length > 0 || selectedCurveIds.length > 0) {
      pushHistory();
    }
    if (selectedIds.length > 0) {
      setPlacedItems(prev => prev.filter(item => !selectedIds.includes(item.id)));
      setSelectedIds([]);
    }
    if (selectedCurveIds.length > 0) {
      setCurveObjects(prev => prev.filter(c => !selectedCurveIds.includes(c.id)));
      setSelectedCurveIds([]);
    }
  };

  const handleUpdateItems = (updates: { id: string; attrs: Partial<PlacedItem> }[]) => {
    if (updates.length === 0) return;
    const hasAnyChange = updates.some(u => {
      const item = placedItemsRef.current.find(i => i.id === u.id);
      if (!item) return false;
      return Object.keys(u.attrs).some(k => (u.attrs as any)[k] !== (item as any)[k]);
    });
    if (!hasAnyChange) return;

    pushHistory();
    setPlacedItems(prev => prev.map(item => {
      const u = updates.find(x => x.id === item.id);
      return u ? { ...item, ...u.attrs } : item;
    }));
  };

  const getSelectedObjects = () => {
    let itemsToProcess = placedItems.filter(i => selectedIds.includes(i.id));
    let curvesToProcess = curveObjects.filter(c => selectedCurveIds.includes(c.id));

    if (itemsToProcess.length === 0 && selectedId) {
      const singleItem = placedItems.find(i => i.id === selectedId);
      if (singleItem) itemsToProcess = [singleItem];
    }
    if (curvesToProcess.length === 0 && selectedCurveId) {
      const singleCurve = curveObjects.find(c => c.id === selectedCurveId);
      if (singleCurve) curvesToProcess = [singleCurve];
    }
    return { items: itemsToProcess, curves: curvesToProcess };
  };

  const handleCopySelected = () => {
    const { items, curves } = getSelectedObjects();
    copyStageObjects(items, curves);
  };

  const handlePaste = () => {
    const res = pasteStageObjects();
    if (!res) return;
    const { newItems, newCurves } = res;
    if (newItems.length === 0 && newCurves.length === 0) return;

    pushHistory();
    setPlacedItems(prev => [...prev, ...newItems]);
    setCurveObjects(prev => [...prev, ...newCurves]);

    const newItemIds = newItems.map(i => i.id);
    const newCurveIds = newCurves.map(c => c.id);
    setSelectedIds(newItemIds);
    setSelectedCurveIds(newCurveIds);
    setSelectedId(newItemIds.length === 1 && newCurveIds.length === 0 ? newItemIds[0] : null);
    setSelectedCurveId(newCurveIds.length === 1 && newItemIds.length === 0 ? newCurveIds[0] : null);
  };

  const handleDuplicateSelected = () => {
    const { items, curves } = getSelectedObjects();
    if (items.length === 0 && curves.length === 0) return;

    pushHistory();
    const { newItems, newCurves } = duplicateStageObjects(items, curves);
    setPlacedItems(prev => [...prev, ...newItems]);
    setCurveObjects(prev => [...prev, ...newCurves]);

    const newItemIds = newItems.map(i => i.id);
    const newCurveIds = newCurves.map(c => c.id);
    setSelectedIds(newItemIds);
    setSelectedCurveIds(newCurveIds);
    setSelectedId(newItemIds.length === 1 && newCurveIds.length === 0 ? newItemIds[0] : null);
    setSelectedCurveId(newCurveIds.length === 1 && newItemIds.length === 0 ? newCurveIds[0] : null);
  };

  const handleDuplicateItem = (id: string) => {
    const itemToDup = placedItems.find(i => i.id === id);
    if (!itemToDup) return;
    pushHistory();
    const { newItems } = duplicateStageObjects([itemToDup], []);
    if (newItems[0]) {
      setPlacedItems(prev => [...prev, newItems[0]]);
      setSelectedId(newItems[0].id);
      setSelectedIds([newItems[0].id]);
      setSelectedCurveId(null);
      setSelectedCurveIds([]);
    }
  };

  const handleDuplicateCurve = (id: string) => {
    const curveToDup = curveObjects.find(c => c.id === id);
    if (!curveToDup) return;
    pushHistory();
    const { newCurves } = duplicateStageObjects([], [curveToDup]);
    if (newCurves[0]) {
      setCurveObjects(prev => [...prev, newCurves[0]]);
      setSelectedCurveId(newCurves[0].id);
      setSelectedCurveIds([newCurves[0].id]);
      setSelectedId(null);
      setSelectedIds([]);
    }
  };

  // ─── Curve Object Handlers ──────────────────────────────────────────────────

  const handleAddEmptyCurve = (x?: number, y?: number) => {
    const effCenter = stageCanvasRef.current?.getEffectiveCenter();
    const spawnX = x ?? effCenter?.x ?? 600;
    const spawnY = y ?? effCenter?.y ?? 400;
    const curve = createDefaultCurveObject(spawnX, spawnY);
    pushHistory();
    setCurveObjects(prev => [...prev, curve]);
    setSelectedCurveId(curve.id);
    setSelectedId(null);
  };

  const handleMoveCenterTo = (canvasX: number, canvasY: number) => {
    const bgCenter = stageCanvasRef.current?.getStageCenter();
    const bgCenterX = bgCenter?.x ?? 600;
    const bgCenterY = bgCenter?.y ?? 400;
    pushHistory();
    setSnapSettings(prev => ({
      ...prev,
      showCenterMarker: false,
      centerOffset: {
        x: Math.round(canvasX - bgCenterX),
        y: Math.round(canvasY - bgCenterY),
      },
    }));
  };

  const handleUpdateCenterOffset = (offset: { x: number; y: number }) => {
    pushHistory();
    setSnapSettings(prev => ({ ...prev, centerOffset: offset, showCenterMarker: false }));
  };

  const addItemToSelectedCurve = (iconId: string) => {
    if (!selectedCurveId) return;
    const isTemplate = iconId.startsWith('tmpl_');
    const tmpl = isTemplate ? TEMPLATE_SHAPES.find(t => t.id === iconId || t.type === iconId.slice(5)) : undefined;
    const templateType = tmpl?.type ?? (isTemplate ? iconId.slice(5) : undefined);
    const iconDef = !isTemplate ? extractedIcons.find(ic => ic.id === iconId) : undefined;

    const defaultSize = 32;
    const size = isTemplate ? (tmpl?.defaultW ?? defaultSize) : (iconDef?.rect?.width ?? defaultSize) / 2.0;
    const percussionType = tmpl?.percussionType || (templateType === 'percussion' ? 'ティンパニ' : undefined);

    const newItem: CurveItem = {
      id: `ci_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      type: isTemplate ? (templateType || 'chorusChair') : iconId,
      percussionType,
      showPercussionName: true,
      label: isTemplate ? tmpl?.label : (iconLabels[iconId] || 'パーツ'),
      size: Math.max(20, Math.min(80, size)),
      isCustom: !isTemplate,
      iconId: !isTemplate ? iconId : undefined,
      url: !isTemplate ? iconDef?.url : undefined,
    };

    pushHistory();
    setCurveObjects(prev => prev.map(c => {
      if (c.id !== selectedCurveId) return c;
      const currentItems = c.items || [];
      const nextItems = [...currentItems, newItem];
      return {
        ...c,
        items: nextItems,
        itemCount: nextItems.length,
      };
    }));
  };

  const handlePaletteItemClick = (iconId: string) => {
    if (selectedCurveId) {
      addItemToSelectedCurve(iconId);
    } else {
      handleAddItem(iconId);
    }
  };

  const handleUpdateCurve = (id: string, updates: Partial<CurveObject>) => {
    const currentCurve = curveObjectsRef.current.find(c => c.id === id);
    if (currentCurve) {
      const isChanged = Object.keys(updates).some(
        key => (updates as any)[key] !== (currentCurve as any)[key]
      );
      if (!isChanged) return;
    }
    pushHistory();
    setCurveObjects(prev => prev.map(c => {
      if (c.id !== id) return c;
      const nextCurve = { ...c, ...updates };
      
      // When the curve's overall itemSize is updated from the inspector,
      // proportionally scale the explicit sizes of any items already placed on the curve.
      if (updates.itemSize !== undefined && c.itemSize > 0) {
        const ratio = updates.itemSize / c.itemSize;
        if (Array.isArray(nextCurve.items)) {
          nextCurve.items = nextCurve.items.map(it => ({
            ...it,
            size: (it.size || c.itemSize) * ratio
          }));
        }
      }
      return nextCurve;
    }));
  };

  const handleDeleteCurve = (id: string) => {
    pushHistory();
    setCurveObjects(prev => prev.filter(c => c.id !== id));
    setSelectedCurveIds(prev => prev.filter(i => i !== id));
  };

  const handleUpdateAllOfType = (type: 'stand' | 'pianoChair', style: 'default' | 'xMark' | 'doubleCircle') => {
    pushHistory();
    if (type === 'stand') {
      setPlacedItems(prev =>
        prev.map(item => {
          const isSt = item.templateType === 'ensembleStand' || item.templateType === 'conductorStand' || item.templateType === 'ensembleChairAndStand';
          return isSt ? { ...item, customIconStyle: style } : item;
        })
      );
      setCurveObjects(prev =>
        prev.map(curve => {
          const hasSt = curve.itemType === 'ensembleStand' || curve.itemType === 'conductorStand' || curve.itemType === 'ensembleChairAndStand';
          const nextItems = curve.items?.map(it => {
            const isItSt = it.type === 'ensembleStand' || it.type === 'conductorStand' || it.type === 'ensembleChairAndStand';
            return isItSt ? { ...it, customIconStyle: style } : it;
          });
          return {
            ...curve,
            customIconStyle: hasSt ? style : curve.customIconStyle,
            items: nextItems || curve.items,
          };
        })
      );
    } else if (type === 'pianoChair') {
      setPlacedItems(prev =>
        prev.map(item => {
          const isPc = item.templateType === 'pianoChair' || item.templateType === 'turnerChair';
          return isPc ? { ...item, customIconStyle: style } : item;
        })
      );
      setCurveObjects(prev =>
        prev.map(curve => {
          const hasPc = curve.itemType === 'pianoChair' || curve.itemType === 'turnerChair';
          const nextItems = curve.items?.map(it => {
            const isItPc = it.type === 'pianoChair' || it.type === 'turnerChair';
            return isItPc ? { ...it, customIconStyle: style } : it;
          });
          return {
            ...curve,
            customIconStyle: hasPc ? style : curve.customIconStyle,
            items: nextItems || curve.items,
          };
        })
      );
    }
  };

  // ─── Label & Tally Handlers ─────────────────────────────────────────────────

  const handleUpdateLabel = (iconId: string, label: string) => {
    setIconLabels(prev => {
      const next = { ...prev, [iconId]: label };
      iconLabelsRef.current = next;
      saveBackup({ ...buildSnapshot(), iconLabels: next });
      return next;
    });
  };

  // Compute tallies: merge placed items + curve items
  const computeTallies = (items: PlacedItem[] = placedItems, curves: CurveObject[] = curveObjects) => {
    const counts: Record<string, number> = {};

    // Count normal placed items
    for (const item of items) {
      if (item.templateType === 'ensembleChairAndStand') {
        const isPiano = item.chairType === 'pianoChair' || item.chairType === 'pianoChairSvg';
        const chairKey = isPiano ? 'tmpl_pianoChair' : 'tmpl_chorusChair';
        counts[chairKey] = (counts[chairKey] || 0) + 1;
        counts['tmpl_ensembleStand'] = (counts['tmpl_ensembleStand'] || 0) + 1;
      } else {
        counts[item.iconId] = (counts[item.iconId] || 0) + 1;
      }
    }

    // Count items in curve objects
    for (const curve of curves) {
      if (Array.isArray(curve.items)) {
        for (const it of curve.items) {
          if (it.isCustom && it.iconId) {
            counts[it.iconId] = (counts[it.iconId] || 0) + 1;
          } else if (it.type === 'ensembleChairAndStand') {
            const effectiveChairType = it.chairType || curve.chairType;
            const isPiano = effectiveChairType === 'pianoChair' || effectiveChairType === 'pianoChairSvg';
            const chairKey = isPiano ? 'tmpl_pianoChair' : 'tmpl_chorusChair';
            counts[chairKey] = (counts[chairKey] || 0) + 1;
            counts['tmpl_ensembleStand'] = (counts['tmpl_ensembleStand'] || 0) + 1;
          } else {
            const key = it.type.startsWith('tmpl_') ? it.type : `tmpl_${it.type}`;
            counts[key] = (counts[key] || 0) + 1;
          }
        }
      } else {
        const tmplType = curve.itemType;
        if (tmplType === 'ensembleChairAndStand') {
          const isPiano = curve.chairType === 'pianoChair' || curve.chairType === 'pianoChairSvg';
          const chairKey = isPiano ? 'tmpl_pianoChair' : 'tmpl_chorusChair';
          counts[chairKey] = (counts[chairKey] || 0) + curve.itemCount;
          counts['tmpl_ensembleStand'] = (counts['tmpl_ensembleStand'] || 0) + curve.itemCount;
        } else if (tmplType) {
          const key = `tmpl_${tmplType}`;
          counts[key] = (counts[key] || 0) + curve.itemCount;
        }
      }
    }

    // Build tallies from extracted icons
    const iconTallies = extractedIcons.map((icon) => ({
      icon_id: icon.id,
      label: iconLabels[icon.id] || icon.label || 'パーツ',
      count: counts[icon.id] || 0,
      source: 'pdf' as const,
    }));

    // Add template-only tallies (placed items or curve items using templates)
    const templateKeys = Object.keys(counts).filter(k => k.startsWith('tmpl_'));
    const templateTallies = templateKeys
      .filter(k => !extractedIcons.some(ic => ic.id === k))
      .map(k => {
        const tmplType = k.slice(5);
        const tmpl = TEMPLATE_SHAPES.find(t => t.type === tmplType);
        return {
          icon_id: k,
          label: tmpl?.label ?? tmplType,
          count: counts[k] || 0,
          source: 'template' as const,
        };
      });

    return [...iconTallies, ...templateTallies];
  };

  // ─── Scene Handlers (Ported from Prototype) ─────────────────────────────────

  const handleSwitchScene = (targetSceneId: string) => {
    if (targetSceneId === currentSceneId) return;

    // 1. Flush current scene items to scenes list
    setScenes(prev =>
      prev.map(sc =>
        sc.id === currentSceneId
          ? { ...sc, placedItems, curveObjects, snapSettings }
          : sc
      )
    );

    // 2. Find target scene and load its data
    const target = scenes.find(sc => sc.id === targetSceneId);
    if (target) {
      setPlacedItems(target.placedItems || []);
      setCurveObjects(target.curveObjects || []);
      if (target.snapSettings) {
        setSnapSettings(prev => ({
          ...prev,
          ...target.snapSettings,
          showCenterMarker: prev.showCenterMarker,
        }));
      }
    }

    // 3. Clear selections & switch active id
    setSelectedIds([]);
    setSelectedCurveIds([]);
    setCurrentSceneId(targetSceneId);
  };

  const handleAddScene = () => {
    // Save current active scene
    const updatedScenes = scenes.map(sc =>
      sc.id === currentSceneId
        ? { ...sc, placedItems, curveObjects, snapSettings }
        : sc
    );

    const newId = `scene_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newName = `場面 ${updatedScenes.length + 1}`;
    const newScene: Scene = {
      id: newId,
      name: newName,
      placedItems: [],
      curveObjects: [],
      snapSettings: { ...snapSettings },
    };

    setScenes([...updatedScenes, newScene]);
    setCurrentSceneId(newId);
    setPlacedItems([]);
    setCurveObjects([]);
    setSelectedIds([]);
    setSelectedCurveIds([]);
  };

  const handleDuplicateScene = (sceneId: string) => {
    const currentScenes = scenes.map(sc =>
      sc.id === currentSceneId
        ? { ...sc, placedItems, curveObjects, snapSettings }
        : sc
    );
    const source = currentScenes.find(sc => sc.id === sceneId);
    if (!source) return;

    const newId = `scene_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const clonedItems: PlacedItem[] = (source.placedItems || []).map(item => ({
      ...item,
      id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    }));
    const clonedCurves: CurveObject[] = (source.curveObjects || []).map(curve => ({
      ...curve,
      id: `curve_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    }));

    const newScene: Scene = {
      id: newId,
      name: `${source.name} (コピー)`,
      placedItems: clonedItems,
      curveObjects: clonedCurves,
      snapSettings: source.snapSettings ? { ...source.snapSettings } : undefined,
    };

    setScenes([...currentScenes, newScene]);
    setCurrentSceneId(newId);
    setPlacedItems(clonedItems);
    setCurveObjects(clonedCurves);
    setSelectedIds([]);
    setSelectedCurveIds([]);
  };

  const handleRenameScene = (sceneId: string, newName: string) => {
    setScenes(prev => prev.map(sc => (sc.id === sceneId ? { ...sc, name: newName } : sc)));
  };

  const handleDeleteScene = (sceneId: string) => {
    if (scenes.length <= 1) {
      alert('最後のシート（場面）は削除できません。');
      return;
    }
    const sceneToDelete = scenes.find(sc => sc.id === sceneId);
    if (!confirm(`「${sceneToDelete?.name || 'この場面'}」を削除しますか？`)) {
      return;
    }

    const nextScenes = scenes.filter(sc => sc.id !== sceneId);
    setScenes(nextScenes);

    if (currentSceneId === sceneId) {
      const nextScene = nextScenes[0];
      setCurrentSceneId(nextScene.id);
      setPlacedItems(nextScene.placedItems || []);
      setCurveObjects(nextScene.curveObjects || []);
      if (nextScene.snapSettings) {
        setSnapSettings(nextScene.snapSettings);
      }
      setSelectedIds([]);
      setSelectedCurveIds([]);
    }
  };

  const handleMoveScene = (sceneId: string, direction: 'up' | 'down') => {
    const idx = scenes.findIndex(sc => sc.id === sceneId);
    if (idx < 0) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === scenes.length - 1) return;

    const updated = scenes.map(sc =>
      sc.id === currentSceneId
        ? { ...sc, placedItems, curveObjects, snapSettings }
        : sc
    );
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    const tmp = updated[idx];
    updated[idx] = updated[targetIdx];
    updated[targetIdx] = tmp;

    setScenes(updated);
  };

  const [sceneExports, setSceneExports] = useState<SceneExportData[]>([]);
  const [isPreparingExport, setIsPreparingExport] = useState(false);

  // ─── Export Handlers ─────────────────────────────────────────────────────────

  const handleExportFinalPdf = async (fullPageImages: string | string[]) => {
    const tallies = computeTallies();
    try {
      const payload: any = {
        file_id: fileId,
        tallies,
        piano_lid: '',
      };
      if (Array.isArray(fullPageImages)) {
        payload.full_page_images = fullPageImages;
      } else {
        payload.full_page_image = fullPageImages;
      }

      const resp = await axios.post('/api/export-pdf/', payload);
      if (resp.data.download_url) {
        window.open(resp.data.download_url, '_blank');
      }
    } catch (err) {
      console.error(err);
      alert('PDF書き出しに失敗しました。');
    }
  };

  // ─── Preview Button Handler ──────────────────────────────────────────────────

  const handleGoToExport = async () => {
    if (!stageCanvasRef.current) return;
    setIsPreparingExport(true);

    try {
      // 1. Sync current working state into scenes list
      const allScenes = scenes.map(sc =>
        sc.id === currentSceneId
          ? { ...sc, placedItems, curveObjects, snapSettings }
          : sc
      );
      setScenes(allScenes);

      const exportList: SceneExportData[] = [];

      // Loop through each scene and render its stage screenshot
      for (let i = 0; i < allScenes.length; i++) {
        const sc = allScenes[i];
        
        flushSync(() => {
          setCurrentSceneId(sc.id);
          setPlacedItems(sc.placedItems || []);
          setCurveObjects(sc.curveObjects || []);
          if (sc.snapSettings) {
            setSnapSettings(sc.snapSettings);
          }
        });

        // Wait a tick for react-konva to paint
        await new Promise(r => requestAnimationFrame(r));
        await new Promise(r => setTimeout(r, 60));

        const urlWithCurves = stageCanvasRef.current?.exportStageImage({ hideCurveLines: false }) || '';
        const urlWithoutCurves = stageCanvasRef.current?.exportStageImage({ hideCurveLines: true }) || '';
        const scTallies = computeTallies(sc.placedItems || [], sc.curveObjects || []);

        const pianoItem = (sc.placedItems || []).find(it => it.templateType === 'piano' || it.iconId === 'tmpl_piano');
        const scPianoLid = pianoItem?.pianoLidState || '半開';

        let scAutoNodes: any[] = [];
        try {
          const resp = await axios.post('/api/preview-bg/', {
            file_id: fileId,
            tallies: scTallies,
            piano_lid: scPianoLid,
          });
          if (resp.data.auto_nodes) {
            scAutoNodes = resp.data.auto_nodes;
          }
        } catch (e) {
          console.error(`Failed to fetch preview bg for scene ${sc.id}`, e);
        }

        exportList.push({
          sceneId: sc.id,
          name: sc.name,
          stageImageUrl: urlWithCurves,
          stageImageUrlWithCurves: urlWithCurves,
          stageImageUrlWithoutCurves: urlWithoutCurves,
          tallies: scTallies,
          initialNodes: scAutoNodes,
        });
      }

      // Restore active scene
      const origScene = allScenes.find(s => s.id === currentSceneId) || allScenes[0];
      flushSync(() => {
        setCurrentSceneId(origScene.id);
        setPlacedItems(origScene.placedItems || []);
        setCurveObjects(origScene.curveObjects || []);
        if (origScene.snapSettings) {
          setSnapSettings(origScene.snapSettings);
        }
      });

      setSceneExports(exportList);
      setStageImageUrl(exportList[0]?.stageImageUrl || '');
      setIsExportModalOpen(true);
      onPhaseChange?.(4);
    } catch (err) {
      console.error('Failed to prepare export previews', err);
      alert('出力プレビューの生成に失敗しました。');
    } finally {
      setIsPreparingExport(false);
    }
  };


  // ─── Full Page Editor (Phase 4) ──────────────────────────────────────────────

  if (isExportModalOpen && (stageImageUrl || sceneExports.length > 0)) {
    const tallies = computeTallies();
    const effectiveCrop = backgroundCrop || initialBackup?.backgroundCrop || { x: 0, y: 0, width: 1684, height: 1191 };
    const effectivePageImg = pageImageUrl || initialBackup?.pageImageUrl || backgroundUrl || '';
    return (
      <FullPageEditor
        fileId={fileId!}
        pageImageUrl={effectivePageImg}
        stageImageUrl={stageImageUrl || sceneExports[0]?.stageImageUrl || ''}
        backgroundCrop={effectiveCrop}
        tallies={tallies}
        sceneExports={sceneExports}
        onBack={() => {
          setIsExportModalOpen(false);
          onPhaseChange?.(3);
        }}
        onExport={handleExportFinalPdf}
        onExportJson={handleExportJson}
      />
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className={`flex flex-col w-full h-full overflow-hidden font-sans relative transition-colors ${
      isDarkMode ? 'dark bg-slate-900 text-slate-100' : 'bg-slate-50 text-slate-800'
    }`}>
      {/* Backup Size Warning Banner */}
      {backupWarning && (
        <div className="bg-amber-50 border-b border-amber-300 text-amber-800 text-xs px-4 py-1.5 flex items-center justify-between gap-2 shrink-0">
          <span>⚠️ {backupWarning}</span>
          <button
            type="button"
            onClick={() => setBackupWarning(null)}
            className="text-amber-500 hover:text-amber-700 font-bold ml-2 shrink-0"
            title="閉じる"
          >✕</button>
        </div>
      )}
      {/* Header */}
      <header className={`h-14 border-b flex items-center justify-between px-4 shrink-0 shadow-sm z-10 transition-colors ${
        isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
      }`}>
        <div className="flex items-center gap-4">
          <div
            className="flex items-center gap-2 cursor-pointer hover:opacity-75 transition-opacity select-none group"
            onClick={handleBack}
            title="最初の画面（PDF読込・バックアップ一覧）に戻る"
          >
            <span className="text-2xl group-hover:scale-105 transition-transform">🪄</span>
            <h2 className={`font-bold text-lg hidden sm:block ${isDarkMode ? 'text-slate-100' : 'text-slate-800'}`}>セッティングくん</h2>
          </div>
          <div className={`h-6 w-px ${isDarkMode ? 'bg-slate-700' : 'bg-slate-300'}`} />
          <div className="flex items-center gap-1">
            <button
              onClick={handleUndo}
              disabled={!canUndo}
              className={`p-1.5 rounded transition-colors ${
                canUndo
                  ? (isDarkMode ? 'text-slate-200 hover:bg-slate-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')
                  : (isDarkMode ? 'text-slate-600 cursor-not-allowed' : 'text-slate-300 cursor-not-allowed')
              }`}
              title={`元に戻す (Ctrl+Z) ${historyRef.current.length > 0 ? `(${historyRef.current.length}件)` : ''}`}
            >↩️</button>
            <button
              onClick={handleRedo}
              disabled={!canRedo}
              className={`p-1.5 rounded transition-colors ${
                canRedo
                  ? (isDarkMode ? 'text-slate-200 hover:bg-slate-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')
                  : (isDarkMode ? 'text-slate-600 cursor-not-allowed' : 'text-slate-300 cursor-not-allowed')
              }`}
              title="やり直し (Ctrl+Y / Ctrl+Shift+Z)"
            >↪️</button>
            <div className={`h-4 w-px mx-1 ${isDarkMode ? 'bg-slate-700' : 'bg-slate-300'}`} />
            <button
              onClick={handleZoomOut}
              className={`p-1.5 rounded font-bold transition-colors ${isDarkMode ? 'text-slate-300 hover:bg-slate-700' : 'text-slate-500 hover:bg-slate-100'}`}
              title="ズームアウト"
            >➖</button>
            <span className={`text-xs font-semibold min-w-[3rem] text-center ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>{Math.round(zoomMultiplier * 100)}%</span>
            <button
              onClick={handleZoomIn}
              className={`p-1.5 rounded font-bold transition-colors ${isDarkMode ? 'text-slate-300 hover:bg-slate-700' : 'text-slate-500 hover:bg-slate-100'}`}
              title="ズームイン"
            >➕</button>
          </div>

        </div>
        
        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-2 py-1 rounded-full">1. ファイル</span>
            <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-2 py-1 rounded-full">2. 領域選択</span>
            <span className="text-xs font-bold text-blue-700 bg-blue-100 px-3 py-1 rounded-full ring-2 ring-blue-500 ring-offset-1">3. ステージ配置</span>
            <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-2 py-1 rounded-full">4. PDF出力</span>
          </div>
          <button
            type="button"
            onClick={handleExportJson}
            className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors flex items-center gap-1.5 cursor-pointer ${
              isDarkMode
                ? 'bg-slate-700 hover:bg-slate-600 text-slate-200 border-slate-600'
                : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300 shadow-2xs hover:shadow-xs'
            }`}
            title="現在の全場面・配置データをJSONファイルとしてダウンロード保存します"
          >
            <span>💾</span>
            <span>JSON保存</span>
          </button>
          <button
            onClick={handleGoToExport}
            disabled={isPreparingExport}
            className={`text-white text-sm font-bold px-5 py-2 rounded-lg shadow-sm hover:shadow transition-all flex items-center gap-2 ${
              isPreparingExport
                ? 'bg-blue-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isPreparingExport ? (
              <>
                <span className="animate-spin text-sm">⏳</span>
                <span>プレビュー生成中...</span>
              </>
            ) : (
              <>
                <span>次へ</span>
                <span>→</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Loading Overlay when generating multi-scene export */}
      {isPreparingExport && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex flex-col items-center justify-center gap-3">
          <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
          <p className="text-white text-sm font-bold shadow-xs">全場面の出力プレビューを一括生成しています...</p>
        </div>
      )}

      {/* Horizontal Palette */}
      <div className={`h-[102px] border-b flex items-center shrink-0 shadow-xs z-10 px-2 relative select-none transition-colors ${
        isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'
      }`}>
        {/* Active Bezier Floating Tag (アイテム欄の下にピロっと飛び出るタグ) */}
        {selectedCurveId && (
          <div
            className="absolute left-36 top-full z-30 flex items-center gap-1.5 px-3 py-0.5 bg-purple-600 text-white rounded-b-lg shadow-md text-[10px] font-bold border border-t-0 border-purple-500 select-none animate-in fade-in slide-in-from-top-1"
            title="選択中のベジェ曲線にアイテムを追加するモードです"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            <span>ベジェ上に追加中</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedCurveId(null);
              }}
              className="ml-1 bg-white/20 hover:bg-white/35 active:bg-white/40 text-white px-1.5 py-0.2 rounded text-[9px] font-semibold transition-colors flex items-center gap-0.5"
              title="通常配置モードに戻る"
            >
              <span>解除</span>
              <span>✕</span>
            </button>
          </div>
        )}

        {/* Tab Switcher */}
        <div className={`flex flex-col h-full border-r w-24 shrink-0 py-1.5 pr-1.5 ${isDarkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <button
            onClick={() => setPaletteTab('pdf')}
            className={`flex-1 text-xs font-bold rounded flex items-center justify-center gap-1 transition-colors ${
              paletteTab === 'pdf'
                ? (isDarkMode ? 'text-blue-300 bg-blue-900/50' : 'text-blue-700 bg-blue-50/80')
                : (isDarkMode ? 'text-slate-400 hover:bg-slate-700' : 'text-slate-500 hover:bg-slate-50')
            }`}
          >
            <span>🖼</span> PDF抽出
          </button>
          <button
            onClick={() => setPaletteTab('template')}
            className={`flex-1 text-xs font-bold rounded flex items-center justify-center gap-1 border-t transition-colors ${
              isDarkMode ? 'border-slate-700' : 'border-slate-100'
            } ${
              paletteTab === 'template'
                ? (isDarkMode ? 'text-blue-300 bg-blue-900/50' : 'text-blue-700 bg-blue-50/80')
                : (isDarkMode ? 'text-slate-400 hover:bg-slate-700' : 'text-slate-500 hover:bg-slate-50')
            }`}
          >
            <span>📐</span> テンプレ
          </button>
        </div>

        {/* Scroll Left Button */}
        <button
          type="button"
          onClick={() => scrollPalette('left')}
          className={`h-16 px-1.5 rounded flex items-center justify-center transition-colors shrink-0 ml-1 ${
            isDarkMode ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
          }`}
          title="左へスクロール"
        >
          ◀
        </button>

        {/* Scrollable Container */}
        <div
          ref={paletteScrollRef}
          onWheel={(e) => {
            if (e.deltaY !== 0) {
              e.currentTarget.scrollLeft += e.deltaY;
            }
          }}
          className={`flex-1 h-full overflow-x-auto overflow-y-hidden flex items-center gap-1.5 px-2 py-1.5 scroll-smooth transition-all rounded-lg ${
            selectedCurveId
              ? (isDarkMode ? 'bg-purple-950/40 ring-1 ring-inset ring-purple-600' : 'bg-purple-50/70 ring-1 ring-inset ring-purple-300')
              : ''
          }`}
        >
          {/* Bezier Curve Creator Button */}
          <div className={`flex items-center gap-1 border-r pr-2 mr-1 shrink-0 h-14 ${isDarkMode ? 'border-slate-700' : 'border-slate-200'}`}>
            <button
              type="button"
              onClick={() => handleAddEmptyCurve()}
              className={`w-14 h-[68px] py-1 px-1 rounded-lg border transition-all flex flex-col items-center justify-between shrink-0 group ${
                selectedCurveId
                  ? (isDarkMode ? 'bg-purple-900/80 border-purple-500 text-purple-200 shadow-xs' : 'bg-purple-100 border-purple-400 text-purple-800 shadow-xs')
                  : (isDarkMode ? 'bg-slate-700/80 hover:bg-purple-950/60 border-slate-600 text-slate-200 hover:border-purple-400' : 'bg-white hover:bg-purple-50/60 border-slate-200 text-slate-700 hover:border-purple-300 shadow-2xs')
              }`}
              title="新しいベジェ曲線（何も置かれていない空の曲線）を追加します"
            >
              <div className="w-8 h-8 flex items-center justify-center text-purple-600 group-hover:scale-110 transition-transform">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 18 C 7 6, 17 6, 20 18" />
                  <circle cx="4" cy="18" r="2.2" fill="#a855f7" />
                  <circle cx="20" cy="18" r="2.2" fill="#a855f7" />
                  <circle cx="12" cy="9" r="1.8" fill="#ef4444" stroke="#ef4444" />
                </svg>
              </div>
              <span className="text-[10px] font-bold text-center leading-tight whitespace-nowrap">
                ベジェ曲線
              </span>
            </button>
          </div>

          {paletteTab === 'template' ? (
            <>
              {TEMPLATE_SHAPES.map(tmpl => (
                <div
                  key={tmpl.id || tmpl.type}
                  draggable={!selectedCurveId}
                  onDragStart={e => {
                    e.dataTransfer.setData('iconId', tmpl.id || `tmpl_${tmpl.type}`);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => handlePaletteItemClick(tmpl.id || `tmpl_${tmpl.type}`)}
                  className={`flex flex-col items-center justify-between w-16 h-[72px] py-1 px-0.5 rounded-lg shrink-0 transition-all group relative cursor-pointer ${
                    selectedCurveId
                      ? (isDarkMode ? 'bg-purple-950/60 hover:bg-purple-900/80 border border-purple-500' : 'bg-purple-50/50 hover:bg-purple-100/80 border border-purple-200 hover:border-purple-400')
                      : (isDarkMode ? 'hover:bg-slate-700/80 border border-transparent hover:border-slate-600 cursor-grab active:cursor-grabbing' : 'hover:bg-blue-50/80 border border-transparent hover:border-blue-200 cursor-grab active:cursor-grabbing')
                  }`}
                  title={selectedCurveId ? `「${tmpl.label}」をベジェ曲線に追加` : tmpl.label}
                >
                  {selectedCurveId && (
                    <span className="absolute -top-1.5 right-0.5 bg-purple-600 text-white text-[8px] font-bold px-1 rounded-full shadow-2xs">
                      +追加
                    </span>
                  )}
                  <div className="w-8 h-8 flex items-center justify-center pointer-events-none mt-0.5">
                    <img src={getTemplateDataUrl(tmpl)} alt={tmpl.label} className="max-w-full max-h-full object-contain" />
                  </div>
                  <span className={`text-[10px] w-full text-center leading-tight line-clamp-2 px-0.5 ${
                    selectedCurveId
                      ? (isDarkMode ? 'text-purple-300 group-hover:font-bold' : 'text-purple-900 group-hover:font-bold')
                      : (isDarkMode ? 'text-slate-300 group-hover:text-blue-400' : 'text-slate-600 group-hover:text-blue-700')
                  }`}>
                    {tmpl.label}
                  </span>
                </div>
              ))}
            </>
          ) : (
            <>
              {extractedIcons.length === 0 ? (
                <p className="text-xs text-slate-400 w-full text-center">PDFから切り出されたアイコンがありません</p>
              ) : (
                extractedIcons.map((icon) => (
                  <div
                    key={icon.id}
                    draggable={!selectedCurveId}
                    onDragStart={e => { e.dataTransfer.setData('iconId', icon.id); e.dataTransfer.effectAllowed = 'copy'; }}
                    onClick={() => handlePaletteItemClick(icon.id)}
                    className={`flex flex-col items-center justify-between w-16 h-[72px] py-1 px-0.5 rounded-lg shrink-0 transition-all group shadow-2xs relative cursor-pointer ${
                      selectedCurveId
                        ? (isDarkMode ? 'bg-purple-950/60 hover:bg-purple-900/80 border border-purple-500' : 'bg-purple-50/60 hover:bg-purple-100/90 border border-purple-300 hover:border-purple-400')
                        : (isDarkMode ? 'bg-slate-700/80 hover:bg-slate-700 border border-slate-600 cursor-grab active:cursor-grabbing' : 'bg-white hover:bg-blue-50/80 border border-slate-200 cursor-grab active:cursor-grabbing')
                    }`}
                    title={selectedCurveId ? `「${iconLabels[icon.id] || icon.label || 'パーツ'}」をベジェ曲線に追加` : (iconLabels[icon.id] || icon.label || 'パーツ')}
                  >
                    {selectedCurveId && (
                      <span className="absolute -top-1.5 right-0.5 bg-purple-600 text-white text-[8px] font-bold px-1 rounded-full shadow-2xs">
                        +追加
                      </span>
                    )}
                    <div className="w-8 h-8 flex items-center justify-center pointer-events-none mt-0.5">
                      <img src={icon.url} alt={icon.id} className="max-w-full max-h-full object-contain" />
                    </div>
                    <span className={`text-[10px] w-full text-center leading-tight line-clamp-2 px-0.5 ${
                      selectedCurveId
                        ? (isDarkMode ? 'text-purple-300 group-hover:font-bold' : 'text-purple-900 group-hover:font-bold')
                        : (isDarkMode ? 'text-slate-300 group-hover:text-blue-400' : 'text-slate-600 group-hover:text-blue-700')
                    }`}>
                      {iconLabels[icon.id] || icon.label || 'パーツ'}
                    </span>
                  </div>
                ))
              )}
              <div className={`border-l pl-3 ml-2 shrink-0 h-12 flex items-center ${isDarkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                <button
                  onClick={() => setIsAdjusting(true)}
                  className={`text-[11px] font-semibold px-3 py-2 rounded-lg border transition-colors whitespace-nowrap ${
                    isDarkMode ? 'text-slate-300 bg-slate-700 hover:bg-slate-600 border-slate-600' : 'text-slate-600 bg-slate-100 hover:bg-slate-200 border-slate-300'
                  }`}
                >
                  ⚙️ 枠調整
                </button>
              </div>
            </>
          )}
        </div>

        {/* Scroll Right Button */}
        <button
          type="button"
          onClick={() => scrollPalette('right')}
          className={`h-16 px-1.5 rounded flex items-center justify-center transition-colors shrink-0 mr-1 ${
            isDarkMode ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
          }`}
          title="右へスクロール"
        >
          ▶
        </button>
      </div>

      {isAdjusting && iconsRegionUrl && (
        <IconAdjustModal
          iconsRegionUrl={iconsRegionUrl}
          extractedIcons={extractedIcons}
          fileId={fileId!}
          iconLabels={iconLabels}
          onClose={() => setIsAdjusting(false)}
          onSave={(newIcons, newLabels) => {
            if (newLabels) {
              setIconLabels(prev => {
                const next = { ...prev, ...newLabels };
                iconLabelsRef.current = next;
                saveBackup({ ...buildSnapshot(), iconLabels: next });
                return next;
              });
            }
            onIconsUpdated(newIcons, newLabels);
            setIsAdjusting(false);
          }}
        />
      )}

      {/* Workspace Body */}
      <div className="flex-1 flex min-h-0 relative overflow-hidden">
        {/* Dimmed Overlay when a drawer submenu is open */}
        <div 
          onClick={() => setDrawerSubmenu(null)}
          className={`absolute inset-0 bg-slate-950/40 backdrop-blur-[1px] z-20 transition-opacity duration-300 ${
            drawerSubmenu !== null ? 'opacity-100 pointer-events-auto cursor-pointer' : 'opacity-0 pointer-events-none'
          }`}
        />

        {/* Left Navigation Container */}
        <aside className="relative z-30 flex h-full shrink-0">
          {/* Fixed-width Icon Bar (w-14, does NOT expand) */}
          <div className="w-14 h-full bg-slate-800 text-slate-300 flex flex-col items-center shrink-0 shadow-xl border-r border-slate-700 select-none py-2">
            {/* House Icon: Scenes Management Item */}
            <button
              type="button"
              onClick={() => setDrawerSubmenu(prev => (prev === 'scenes' ? null : 'scenes'))}
              className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all my-1 ${
                drawerSubmenu === 'scenes'
                  ? 'bg-blue-600 text-white ring-2 ring-blue-400 shadow-md scale-105'
                  : 'hover:bg-slate-700/70 hover:text-white text-slate-300'
              }`}
              title="場面一覧 (シーン切替)"
            >
              🏠
            </button>

            {/* Display & Snap Settings Item */}
            <button
              type="button"
              onClick={() => setDrawerSubmenu(prev => (prev === 'settings' ? null : 'settings'))}
              className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all my-1 ${
                drawerSubmenu === 'settings'
                  ? 'bg-slate-700 text-blue-400 ring-1 ring-blue-500/50 shadow-inner'
                  : 'hover:bg-slate-700/70 hover:text-white text-slate-300'
              }`}
              title="表示・スナップ設定"
            >
              ⚙️
            </button>

            {/* Dark Mode Item (Bottom) */}
            <button
              type="button"
              onClick={toggleDarkMode}
              className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-colors mt-auto my-1 ${
                isDarkMode
                  ? 'bg-amber-500/25 text-amber-300 hover:bg-amber-500/35 ring-1 ring-amber-400/40 shadow-inner'
                  : 'hover:bg-slate-700/70 hover:text-white text-slate-300'
              }`}
              title={isDarkMode ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
            >
              {isDarkMode ? '☀️' : '🌙'}
            </button>
          </div>

          {/* 1. Scenes List Sub-Panel: Opens from House Icon 🏠 */}
          {drawerSubmenu === 'scenes' && (
            <div className={`w-80 h-full backdrop-blur-md border-r shadow-2xl flex flex-col p-4 animate-in fade-in slide-in-from-left-2 duration-200 shrink-0 ${
              isDarkMode ? 'bg-slate-800/95 border-slate-700 text-slate-100' : 'bg-white/95 border-slate-200 text-slate-800'
            }`}>
              <div className={`flex items-center justify-between pb-3 border-b mb-3 ${isDarkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                <h3 className={`font-bold text-sm flex items-center gap-1.5 ${isDarkMode ? 'text-slate-100' : 'text-slate-800'}`}>
                  <span>📑</span> 場面一覧 (シーン切替)
                </h3>
                <button
                  type="button"
                  onClick={() => setDrawerSubmenu(null)}
                  className={`rounded-md p-1 transition-colors text-xs font-bold ${
                    isDarkMode ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                  }`}
                  title="閉じる"
                >
                  ✕
                </button>
              </div>

              <p className={`text-[11px] mb-3 leading-snug ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                曲や演出ごとに配置を分けて保存できます。クリックで場面が切り替わります。
              </p>

              {/* Scene Items List */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {scenes.map((scene, idx) => {
                  const isActive = scene.id === currentSceneId;
                  // Count total items placed in this scene
                  const totalCount = isActive
                    ? placedItems.length + curveObjects.reduce((s, c) => s + (c.items?.length || c.itemCount || 0), 0)
                    : (scene.placedItems?.length || 0) + (scene.curveObjects?.reduce((s, c) => s + (c.items?.length || c.itemCount || 0), 0) || 0);

                  return (
                    <div
                      key={scene.id}
                      onClick={() => handleSwitchScene(scene.id)}
                      className={`group relative p-2.5 rounded-xl border transition-all cursor-pointer ${
                        isActive
                          ? (isDarkMode ? 'bg-blue-950/80 border-blue-500 shadow-xs ring-1 ring-blue-400' : 'bg-blue-50/90 border-blue-400 shadow-xs ring-1 ring-blue-300')
                          : (isDarkMode ? 'bg-slate-700/60 hover:bg-slate-700 border-slate-600 hover:border-slate-500 shadow-2xs' : 'bg-white hover:bg-slate-50 border-slate-200 hover:border-slate-300 shadow-2xs')
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span className={`text-xs shrink-0 ${isActive ? 'text-blue-500 font-bold' : (isDarkMode ? 'text-slate-500' : 'text-slate-400')}`}>
                            {isActive ? '●' : '○'}
                          </span>
                          <input
                            type="text"
                            value={scene.name}
                            onChange={(e) => handleRenameScene(scene.id, e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            className={`flex-1 text-xs font-bold px-1.5 py-0.5 rounded border focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors ${
                              isActive
                                ? (isDarkMode ? 'bg-slate-800 border-blue-400 text-blue-200 font-bold' : 'bg-white border-blue-200 text-blue-950 font-bold')
                                : (isDarkMode ? 'bg-transparent border-transparent hover:border-slate-600 text-slate-200' : 'bg-transparent border-transparent hover:border-slate-200 text-slate-800')
                            }`}
                            placeholder="場面名を入力..."
                          />
                        </div>

                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${
                          isDarkMode ? 'text-slate-300 bg-slate-800' : 'text-slate-400 bg-slate-100'
                        }`}>
                          {totalCount}個
                        </span>
                      </div>

                      {/* Action buttons bar */}
                      <div className={`flex items-center justify-end gap-1 mt-2 pt-1.5 border-t text-[11px] ${
                        isDarkMode ? 'border-slate-700 text-slate-400' : 'border-slate-100 text-slate-500'
                      }`}>
                        {/* Move Up */}
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveScene(scene.id, 'up');
                          }}
                          className={`px-1.5 py-0.5 rounded disabled:opacity-30 disabled:hover:bg-transparent ${
                            isDarkMode ? 'hover:bg-slate-600' : 'hover:bg-slate-100'
                          }`}
                          title="上に移動"
                        >
                          ↑
                        </button>

                        {/* Move Down */}
                        <button
                          type="button"
                          disabled={idx === scenes.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveScene(scene.id, 'down');
                          }}
                          className={`px-1.5 py-0.5 rounded disabled:opacity-30 disabled:hover:bg-transparent ${
                            isDarkMode ? 'hover:bg-slate-600' : 'hover:bg-slate-100'
                          }`}
                          title="下に移動"
                        >
                          ↓
                        </button>

                        {/* Duplicate */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDuplicateScene(scene.id);
                          }}
                          className={`px-1.5 py-0.5 rounded ${
                            isDarkMode ? 'hover:bg-slate-600 hover:text-slate-200' : 'hover:bg-slate-100 hover:text-slate-700'
                          }`}
                          title="この場面を複製"
                        >
                          📋 複製
                        </button>

                        {/* Delete */}
                        <button
                          type="button"
                          disabled={scenes.length <= 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteScene(scene.id);
                          }}
                          className={`px-1.5 py-0.5 rounded disabled:opacity-30 disabled:hover:bg-transparent ${
                            isDarkMode ? 'hover:bg-red-950/50 hover:text-red-400 text-red-400' : 'hover:bg-red-50 hover:text-red-600 text-red-500'
                          }`}
                          title={scenes.length <= 1 ? '最後のシートは削除できません' : 'この場面を削除'}
                        >
                          🗑 削除
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Add New Scene Button */}
              <div className={`pt-3 mt-auto border-t ${isDarkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                <button
                  type="button"
                  onClick={handleAddScene}
                  className="w-full py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs hover:shadow-sm transition-all flex items-center justify-center gap-1.5"
                >
                  <span>＋</span>
                  <span>新しい場面を追加</span>
                </button>
              </div>
            </div>
          )}

          {/* 2. Snap & Display Settings Sub-Panel: Extends seamlessly from the left drawer menu */}
          {drawerSubmenu === 'settings' && (
            <div
              className={`w-80 h-full backdrop-blur-md border-r shadow-2xl flex flex-col p-4 animate-in fade-in slide-in-from-left-2 duration-200 shrink-0 ${
                isDarkMode ? 'bg-slate-800/95 border-slate-700 text-slate-100' : 'bg-white/95 border-slate-200 text-slate-800'
              }`}
            >
              <div className={`flex items-center justify-between pb-3 border-b mb-4 ${isDarkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                <h3 className={`font-bold text-sm flex items-center gap-1.5 ${isDarkMode ? 'text-slate-100' : 'text-slate-800'}`}>
                  <span>⚙️</span> 表示・スナップ設定
                </h3>
                <button
                  type="button"
                  onClick={() => setDrawerSubmenu(null)}
                  className={`rounded-md p-1 transition-colors text-xs font-bold ${
                    isDarkMode ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                  }`}
                  title="閉じる"
                >
                  ✕
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                {/* Grid Settings */}
                <div className="space-y-2">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">グリッド表示</span>
                  <label className={`flex items-center justify-between p-2 rounded-lg border cursor-pointer transition-colors ${
                    isDarkMode ? 'hover:bg-slate-700/60 border-slate-600 bg-slate-800' : 'hover:bg-slate-50 border-slate-200 bg-white'
                  }`}>
                    <span className={`text-xs font-semibold ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>グリッド (方眼) 表示</span>
                    <input
                      type="checkbox"
                      checked={snapSettings.showGrid}
                      onChange={(e) => setSnapSettings(prev => ({ ...prev, showGrid: e.target.checked }))}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 cursor-pointer"
                    />
                  </label>

                  <div className={`p-2.5 rounded-lg border space-y-2.5 ${
                    isDarkMode ? 'bg-slate-700/50 border-slate-600' : 'bg-slate-50 border-slate-200'
                  }`}>
                    <div className="flex items-center justify-between text-xs">
                      <span className={`font-medium ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>1マスサイズ (1m定義)</span>
                      <span className={`font-bold px-2 py-0.5 rounded border ${
                        isDarkMode ? 'text-slate-100 bg-slate-800 border-slate-600' : 'text-slate-800 bg-white border-slate-200'
                      }`}>{snapSettings.gridSize} px</span>
                    </div>
                    <input
                      type="range"
                      min="20"
                      max="300"
                      step="5"
                      value={snapSettings.gridSize}
                      onChange={(e) => setSnapSettings(prev => ({ ...prev, gridSize: parseInt(e.target.value, 10) }))}
                      className="w-full h-1.5 bg-slate-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer accent-blue-600"
                    />

                    {/* Measure Scale Button (2 points distance defining meters) */}
                    <button
                      type="button"
                      onClick={() => {
                        setIsMeasuringScale(true);
                        setDrawerSubmenu(null);
                      }}
                      className={`w-full py-1.5 px-2.5 rounded-lg border text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer ${
                        isDarkMode
                          ? 'bg-indigo-950/60 hover:bg-indigo-900/60 text-indigo-300 border-indigo-500/50'
                          : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                      }`}
                      title="キャンバス上の2点をクリックして、その長さを何メートルにするか定義します"
                    >
                      <span>📏</span>
                      <span>2点間クリックで1mを定義</span>
                    </button>
                  </div>
                </div>

                {/* Center Marker Settings */}
                <div className={`space-y-2 pt-2 border-t ${isDarkMode ? 'border-slate-700' : 'border-slate-100'}`}>
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">基準点 (ピンク)</span>
                  <label className={`flex items-center justify-between p-2 rounded-lg border cursor-pointer transition-colors ${
                    isDarkMode ? 'hover:bg-slate-700/60 border-slate-600 bg-slate-800' : 'hover:bg-slate-50 border-slate-200 bg-white'
                  }`}>
                    <span className={`text-xs font-semibold flex items-center gap-1.5 ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>
                      <span className="w-2.5 h-2.5 rounded-full bg-[#ff00ff]" />
                      基準点マーカー表示
                    </span>
                    <input
                      type="checkbox"
                      checked={snapSettings.showCenterMarker}
                      onChange={(e) => setSnapSettings(prev => ({ ...prev, showCenterMarker: e.target.checked }))}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 cursor-pointer"
                    />
                  </label>

                  <div className={`p-2.5 rounded-lg border space-y-2.5 ${
                    isDarkMode ? 'bg-slate-700/50 border-slate-600' : 'bg-slate-50 border-slate-200'
                  }`}>
                    <div className="flex items-center justify-between text-xs">
                      <span className={`font-medium ${isDarkMode ? 'text-slate-300' : 'text-slate-500'}`}>基準点マーカー位置</span>
                      <span className={`font-mono font-bold px-2 py-0.5 rounded border ${
                        isDarkMode ? 'text-slate-200 bg-slate-800 border-slate-600' : 'text-slate-700 bg-white border-slate-200'
                      }`}>
                        X: {snapSettings.centerOffset.x}, Y: {snapSettings.centerOffset.y}
                      </span>
                    </div>

                    {/* Move Center Mode Toggle Button */}
                    <button
                      type="button"
                      onClick={() => {
                        setIsMovingCenter(prev => {
                          const next = !prev;
                          if (!next) {
                            setSnapSettings(s => ({ ...s, showCenterMarker: false }));
                          }
                          return next;
                        });
                      }}
                      className={`w-full text-xs font-semibold py-2 px-3 rounded-lg border transition-all flex items-center justify-center gap-2 ${
                        isMovingCenter
                          ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600 shadow-md ring-2 ring-blue-300'
                          : (isDarkMode ? 'bg-slate-700 hover:bg-slate-600 text-slate-200 border-slate-600' : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300 shadow-2xs')
                      }`}
                    >
                      {isMovingCenter ? (
                        <>
                          <span className="w-2 h-2 rounded-full bg-white animate-ping" />
                          ✓ 基準点の移動を完了
                        </>
                      ) : (
                        <>
                          <span>📍</span>
                          基準点を移動
                        </>
                      )}
                    </button>

                    <p className={`text-[10px] leading-tight ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                      {isMovingCenter
                        ? '※移動モード中：画面上のピンクのマーカーをドラッグして動かせます。完了したらボタンを押してください。'
                        : '※通常時は誤操作防止のため固定されています。位置を変更したい場合は上のボタンを押してください。'}
                    </p>

                    <button
                      type="button"
                      onClick={() => {
                        setSnapSettings(prev => ({ ...prev, centerOffset: { x: 0, y: 0 } }));
                      }}
                      className={`w-full text-xs font-semibold py-1.5 rounded transition-colors border shadow-2xs ${
                        isDarkMode ? 'bg-slate-700 hover:bg-slate-600 text-slate-200 border-slate-600' : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                      }`}
                    >
                      🎯 基準点を画像中央 (0, 0) に戻す
                    </button>
                  </div>
                </div>

                {/* Snapping Options */}
                <div className={`space-y-2 pt-2 border-t ${isDarkMode ? 'border-slate-700' : 'border-slate-100'}`}>
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">スナップ (吸着) 設定</span>
                  
                  <label className={`flex items-center justify-between p-2 rounded-lg border cursor-pointer transition-colors ${
                    isDarkMode ? 'hover:bg-slate-700/60 border-slate-600 bg-slate-800' : 'hover:bg-slate-50 border-slate-200 bg-white'
                  }`}>
                    <div className="flex flex-col">
                      <span className={`text-xs font-semibold ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>基準点・中心軸スナップ</span>
                      <span className={`text-[10px] ${isDarkMode ? 'text-slate-400' : 'text-slate-400'}`}>中央揃えのガイド線が吸着表示</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={snapSettings.snapToCenter}
                      onChange={(e) => setSnapSettings(prev => ({ ...prev, snapToCenter: e.target.checked }))}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 cursor-pointer"
                    />
                  </label>

                  <label className={`flex items-center justify-between p-2 rounded-lg border cursor-pointer transition-colors ${
                    isDarkMode ? 'hover:bg-slate-700/60 border-slate-600 bg-slate-800' : 'hover:bg-slate-50 border-slate-200 bg-white'
                  }`}>
                    <div className="flex flex-col pr-2">
                      <span className={`text-xs font-semibold ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>グリッドスナップ</span>
                      <span className={`text-[10px] leading-tight ${isDarkMode ? 'text-slate-400' : 'text-slate-400'}`}>
                        方眼の目盛りに合わせて吸着（CtrlまたはCommandキーを押しながらドラッグでも有効）
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={snapSettings.snapToGrid}
                      onChange={(e) => setSnapSettings(prev => ({ ...prev, snapToGrid: e.target.checked }))}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 cursor-pointer shrink-0"
                    />
                  </label>

                  <label className={`flex items-center justify-between p-2 rounded-lg border cursor-pointer transition-colors ${
                    isDarkMode ? 'hover:bg-slate-700/60 border-slate-600 bg-slate-800' : 'hover:bg-slate-50 border-slate-200 bg-white'
                  }`}>
                    <div className="flex flex-col">
                      <span className={`text-xs font-semibold ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>回転角度スナップ</span>
                      <span className={`text-[10px] ${isDarkMode ? 'text-slate-400' : 'text-slate-400'}`}>45°/90°刻みで自動スナップ</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={snapSettings.snapAngle}
                      onChange={(e) => setSnapSettings(prev => ({ ...prev, snapAngle: e.target.checked }))}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 cursor-pointer"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* Center Stage Canvas */}
        <StageCanvas
          ref={stageCanvasRef}
          backgroundUrl={backgroundUrl}
          extractedIcons={extractedIcons}
          placedItems={placedItems}
          curveObjects={curveObjects}
          selectedId={selectedId}
          selectedCurveId={selectedCurveId}
          selectedIds={selectedIds}
          selectedCurveIds={selectedCurveIds}
          selectedCurveItemId={selectedCurveItemId}
          onSelectCurveItem={(curveId, itemId) => {
            setSelectedCurveId(curveId);
            setSelectedId(null);
            setSelectedCurveItemId(itemId);
          }}
          snapSettings={snapSettings}
          zoomMultiplier={zoomMultiplier}
          onZoomChange={setZoomMultiplier}
          onSelectItem={id => { setSelectedId(id); if (id) { setSelectedCurveId(null); setSelectedCurveItemId(null); } }}
          onSelectCurve={id => { setSelectedCurveId(id); if (id) setSelectedId(null); if (!id) setSelectedCurveItemId(null); }}
          onSelectItems={setSelectedIds}
          onSelectCurves={setSelectedCurveIds}
          onUpdateItem={handleUpdateItem}
          onUpdateItems={handleUpdateItems}
          onUpdateCurve={handleUpdateCurve}
          onAddItem={handleAddItem}
          onDeleteItem={handleDeleteItem}
          onDeleteSelected={handleDeleteSelected}
          onDuplicateItem={handleDuplicateItem}
          onDuplicateSelected={handleDuplicateSelected}
          onCopySelected={handleCopySelected}
          onPaste={handlePaste}
          onUpdateCenterOffset={handleUpdateCenterOffset}
          isMovingCenter={isMovingCenter}
          onOpenContextMenu={setContextMenu}
          isMeasuringScale={isMeasuringScale}
          onMeasureComplete={(dist) => {
            setIsMeasuringScale(false);
            setMeasuredDistance(dist);
            setMeasureMetersInput('1');
          }}
          onCancelMeasure={() => {
            setIsMeasuringScale(false);
          }}
        />
        
        {/* Right Panel: Tally / Inspector */}
        {(selectedIds.length + selectedCurveIds.length) > 0 ? (
          <ItemInspector
            key={(selectedIds.length + selectedCurveIds.length) > 1
              ? `multi-inspect-${selectedIds.length + selectedCurveIds.length}`
              : (selectedId ? `item-${selectedId}` : (selectedCurveId ? `curve-${selectedCurveId}` : 'single'))}
            selectedItem={placedItems.find(i => i.id === selectedId) || null}
            selectedCurve={curveObjects.find(c => c.id === selectedCurveId) || null}
            selectedCurveItemId={selectedCurveItemId}
            onSelectCurveItem={setSelectedCurveItemId}
            selectedCount={selectedIds.length + selectedCurveIds.length}
            centerPos={stageCanvasRef.current?.getStageCenter()}
            onUpdateItem={handleUpdateItem}
            onUpdateCurve={handleUpdateCurve}
            onDuplicateItem={handleDuplicateItem}
            onDuplicateCurve={handleDuplicateCurve}
            onDuplicateSelected={handleDuplicateSelected}
            onDeleteItem={handleDeleteItem}
            onDeleteCurve={handleDeleteCurve}
            onDeleteSelected={handleDeleteSelected}
            onUpdateAllOfType={handleUpdateAllOfType}
          />
        ) : (
          <div
            key="tally-table-panel"
            className={`w-64 shrink-0 h-full border-l overflow-hidden flex flex-col transition-colors ${
              isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-white'
            }`}
          >
            <TallyTable
              extractedIcons={extractedIcons}
              placedItems={placedItems}
              curveObjects={curveObjects}
              iconLabels={iconLabels}
              onUpdateLabel={handleUpdateLabel}
              onAddIcon={handleAddItem}
            />
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          position={{ x: contextMenu.x, y: contextMenu.y }}
          canvasPos={{ x: contextMenu.canvasX, y: contextMenu.canvasY }}
          targetItemId={contextMenu.targetItemId}
          selectedCount={selectedIds.length + selectedCurveIds.length}
          extractedIcons={extractedIcons}
          iconLabels={iconLabels}
          onAddTemplate={(tmplId, x, y) => {
            handleAddItem(tmplId, x, y);
          }}
          onAddPdfIcon={(iconId, x, y) => {
            handleAddItem(iconId, x, y);
          }}
          onAddCurve={(x, y) => {
            handleAddEmptyCurve(x, y);
          }}
          onMoveCenterTo={(x, y) => {
            handleMoveCenterTo(x, y);
          }}
          onCopy={
            selectedIds.length > 0 || selectedCurveIds.length > 0 || contextMenu.targetItemId
              ? handleCopySelected
              : undefined
          }
          onPaste={handlePaste}
          canPaste={hasStageObjectsInClipboard()}
          onDuplicate={
            selectedIds.length > 0 || selectedCurveIds.length > 0
              ? handleDuplicateSelected
              : contextMenu.targetItemId
              ? () => handleDuplicateItem(contextMenu.targetItemId!)
              : undefined
          }
          onDelete={
            selectedIds.length > 0 || selectedCurveIds.length > 0
              ? handleDeleteSelected
              : contextMenu.targetItemId
              ? () => handleDeleteItem(contextMenu.targetItemId!)
              : undefined
          }
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* 2-Points Distance Scale Definition Modal (ported from prototype) */}
      {measuredDistance !== null && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 max-w-sm w-full space-y-4 animate-in fade-in zoom-in-95 duration-150 text-slate-800">
            <div className="flex items-center gap-2">
              <span className="text-2xl">📏</span>
              <h3 className="font-bold text-base text-slate-800">1マス (1m) の長さを定義</h3>
            </div>
            
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-1.5">
              <div className="flex justify-between text-slate-600">
                <span>計測されたピクセル距離:</span>
                <span className="font-mono font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                  {measuredDistance.toFixed(1)} px
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                この距離が何メートル (m) にあたるか入力してください:
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.1"
                  min="0.01"
                  max="100"
                  value={measureMetersInput}
                  onChange={e => setMeasureMetersInput(e.target.value)}
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-xl text-sm font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="1"
                  autoFocus
                />
                <span className="font-bold text-xs text-slate-600 shrink-0">メートル (m)</span>
              </div>
              {parseFloat(measureMetersInput) > 0 && (
                <div className="mt-2 p-2 bg-blue-50 border border-blue-100 rounded-lg text-[11px] text-blue-800 flex items-center justify-between font-medium">
                  <span>➡️ 1マス (1m定義):</span>
                  <span className="font-bold text-blue-900 text-xs">
                    {Math.max(10, Math.round(measuredDistance / parseFloat(measureMetersInput)))} px
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setMeasuredDistance(null)}
                className="flex-1 py-2 px-3 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => {
                  const m = parseFloat(measureMetersInput);
                  if (m > 0) {
                    const newGridSize = Math.max(10, Math.round(measuredDistance / m));
                    setSnapSettings(prev => ({
                      ...prev,
                      gridSize: newGridSize,
                      showGrid: true,
                    }));
                    setMeasuredDistance(null);
                  }
                }}
                disabled={!(parseFloat(measureMetersInput) > 0)}
                className="flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-sm transition-colors cursor-pointer"
              >
                確定して適用
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StageBuilder;
