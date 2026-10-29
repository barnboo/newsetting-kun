import React, { useState, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import axios from 'axios';
import { 
  Home, 
  Settings, 
  Sliders, 
  Sun, 
  Moon, 
  ChevronLeft, 
  ChevronRight, 
  FileText, 
  Shapes, 
  Sparkles, 
  Copy, 
  Trash2, 
  X, 
  Ruler, 
  Layers, 
  ArrowUp, 
  ArrowDown,
  ClipboardList,
  Edit3,
  Crop
} from 'lucide-react';
import type { ExtractedIcon } from '../App';
import IconAdjustModal from './IconAdjustModal';
import StageCanvas, { type PlacedItem, type StageCanvasRef, type SnapSettings } from './StageCanvas';
import TallyTable from './TallyTable';
import { ItemInspector } from './ItemInspector';
import { FullPageEditor, type SceneExportData, type PreviewSettings } from './FullPageEditor';
import { TEMPLATE_SHAPES, getTemplateDataUrl, getPercussionInfo, inferTemplateReplacements } from '../utils/templateShapes';
import { createDefaultCurveObject, distributeAlongCurve, distributeItemsAlongCurve, type CurveObject, type CurveItem } from '../utils/bezierUtils';
import { ContextMenu } from './ContextMenu';
import { copyStageObjects, pasteStageObjects, duplicateStageObjects, hasStageObjectsInClipboard } from '../utils/clipboard';
import { updateSessionTimestampInIndexedDB } from '../utils/indexedDb';
import { FloatingObjectControlPanel } from './FloatingObjectControlPanel';
import { PercussionLabelModal, type ItemLabelModalTarget, type ItemLabelSettings } from './PercussionLabelModal';

export interface Scene {
  id: string;
  name: string;
  placedItems: PlacedItem[];
  curveObjects: CurveObject[];
  snapSettings?: SnapSettings;
}


export interface StageSnapshot {
  projectName?: string;
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
  templateReplacements?: Record<string, string>;
  previewSettings?: PreviewSettings;
}

interface Props {
  backgroundUrl: string | null;
  iconsRegionUrl: string | null;
  extractedIcons: ExtractedIcon[];
  backgroundCrop: { x: number; y: number; width: number; height: number } | null;
  fileId: string | null;
  pageImageUrl: string;
  preloadedBackup?: StageSnapshot | null;
  initialIconLabels?: Record<string, string>;
  templateReplacements?: Record<string, string>;
  onIconLabelsChange?: (labels: Record<string, string>) => void;
  onIconsUpdated: (icons: ExtractedIcon[], newLabels?: Record<string, string>) => void;
  onOpenTemplateModal?: () => void;
  onOpenIconAdjustModal?: () => void;
  onReAdjustBackground?: () => void;
  onBack: () => void;
  onPhaseChange?: (phase: 3 | 4) => void;
}

type PaletteTab = 'template' | 'pdf';

function stripRedundantCurveUrls(curves?: CurveObject[]): CurveObject[] {
  if (!Array.isArray(curves)) return [];
  return curves.map(c => {
    if (!Array.isArray(c.items)) return c;
    let changed = false;
    const nextItems = c.items.map(it => {
      if (it.isCustom && it.iconId && it.url) {
        changed = true;
        const { url: _u, ...rest } = it;
        return rest;
      }
      return it;
    });
    return changed ? { ...c, items: nextItems } : c;
  });
}

const StageBuilder: React.FC<Props> = ({
  backgroundUrl,
  iconsRegionUrl,
  extractedIcons,
  backgroundCrop,
  fileId,
  pageImageUrl,
  preloadedBackup,
  initialIconLabels,
  templateReplacements,
  onIconLabelsChange,
  onIconsUpdated,
  onOpenTemplateModal,
  onOpenIconAdjustModal,
  onReAdjustBackground,
  onBack,
  onPhaseChange,
}) => {
  const BACKUP_KEY = `settingkun_backup_${fileId || 'default'}`;

  // Load initial backup from preloaded prop or localStorage if available, and strip bloated base64 URLs on curve items
  const [initialBackup] = useState<StageSnapshot | null>(() => {
    try {
      let parsed: StageSnapshot | null = preloadedBackup || null;
      if (!parsed) {
        const saved = localStorage.getItem(BACKUP_KEY);
        if (saved) {
          parsed = JSON.parse(saved) as StageSnapshot;
        }
      }
      if (parsed) {
        if (Array.isArray(parsed.curveObjects)) {
          parsed.curveObjects = stripRedundantCurveUrls(parsed.curveObjects);
        }
        if (Array.isArray(parsed.scenes)) {
          parsed.scenes = parsed.scenes.map(sc => ({
            ...sc,
            curveObjects: stripRedundantCurveUrls(sc.curveObjects),
          }));
        }
        return parsed;
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

  // Preview Settings State (Phase 4 editable text/shapes, Bezier line toggle)
  const [previewSettings, setPreviewSettings] = useState<PreviewSettings | null>(() => {
    if (initialBackup?.previewSettings) {
      return initialBackup.previewSettings;
    }
    if (fileId) {
      try {
        const saved = localStorage.getItem(`stajet_preview_settings_${fileId}`);
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return null;
  });
  const previewSettingsRef = useRef<PreviewSettings | null>(previewSettings);
  previewSettingsRef.current = previewSettings;

  const handleUpdatePreviewSettings = useCallback((settings: PreviewSettings) => {
    setPreviewSettings(settings);
    previewSettingsRef.current = settings;
    if (fileId) {
      try {
        localStorage.setItem(`stajet_preview_settings_${fileId}`, JSON.stringify(settings));
      } catch (e) {
        console.warn('Failed to save preview settings cache', e);
      }
    }
    try {
      saveBackup('latest');
    } catch (e) {
      console.warn('Failed to save snapshot with previewSettings', e);
    }
  }, [fileId]);

  // Project Name State
  const [projectName, setProjectName] = useState<string>(() => {
    if (initialBackup?.projectName) return initialBackup.projectName;
    if ((initialBackup as any)?.name) return (initialBackup as any).name;
    return fileId ? `セッティング図 (${fileId.substring(0, 6)})` : '新規セッティング図';
  });
  const projectNameRef = useRef(projectName);
  projectNameRef.current = projectName;
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const projectNameInputRef = useRef<HTMLInputElement>(null);

  const handleCommitProjectName = useCallback((newName?: string) => {
    const raw = (newName !== undefined ? newName : projectNameRef.current).trim();
    const finalName = raw || `セッティング図 (${fileId ? fileId.substring(0, 6) : '無題'})`;
    setProjectName(finalName);
    projectNameRef.current = finalName;
    setIsEditingProjectName(false);
    try {
      saveBackup('latest');
    } catch (e) {
      console.warn('Failed to save snapshot after project name change', e);
    }
  }, [fileId]);

  useEffect(() => {
    if (!selectedCurveId) {
      setSelectedCurveItemId(null);
    }
  }, [selectedCurveId]);

  const [paletteTab, setPaletteTab] = useState<PaletteTab>('pdf');

  // Template replacements state: merge props, backup, and auto-inference from placed objects
  const [effectiveTemplateReplacements, setEffectiveTemplateReplacements] = useState<Record<string, string>>(() => {
    const fromProps = templateReplacements && Object.keys(templateReplacements).length > 0 ? templateReplacements : null;
    const fromBackup = initialBackup?.templateReplacements && Object.keys(initialBackup.templateReplacements).length > 0 ? initialBackup.templateReplacements : null;
    if (fromProps || fromBackup) {
      return { ...(fromBackup || {}), ...(fromProps || {}) };
    }
    return inferTemplateReplacements(
      extractedIcons || initialBackup?.extractedIcons || [],
      initialPlacedItems,
      initialScenes
    );
  });
  const templateReplacementsRef = useRef(effectiveTemplateReplacements);
  templateReplacementsRef.current = effectiveTemplateReplacements;

  useEffect(() => {
    if (templateReplacements && Object.keys(templateReplacements).length > 0) {
      setEffectiveTemplateReplacements(prev => ({ ...prev, ...templateReplacements }));
    }
  }, [templateReplacements]);

  // テンプレ置換されたID一覧と、テンプレタブに表示する残りのテンプレ一覧
  const replacedTmplIdSet = React.useMemo(() => {
    return new Set(Object.values(effectiveTemplateReplacements || {}));
  }, [effectiveTemplateReplacements]);

  const visibleTemplates = React.useMemo(() => {
    return TEMPLATE_SHAPES.filter(tmpl => {
      const id1 = tmpl.id;
      const id2 = `tmpl_${tmpl.type}`;
      return !replacedTmplIdSet.has(id1) && !replacedTmplIdSet.has(id2);
    });
  }, [replacedTmplIdSet]);

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

  // Keep iconLabels in sync when parent initialIconLabels updates
  useEffect(() => {
    if (initialIconLabels && Object.keys(initialIconLabels).length > 0) {
      setIconLabels(prev => {
        const next = { ...prev, ...initialIconLabels };
        iconLabelsRef.current = next;
        return next;
      });
    }
  }, [initialIconLabels]);

  useEffect(() => {
    setIconLabels(prev => {
      const next: Record<string, string> = {};
      let changed = false;
      extractedIcons.forEach((ic, idx) => {
        const val = prev[ic.id] || ic.label || `パーツ ${idx + 1}`;
        next[ic.id] = val;
        if (prev[ic.id] !== val) {
          changed = true;
        }
      });
      if (Object.keys(prev).length !== Object.keys(next).length) {
        changed = true;
      }
      if (changed) {
        iconLabelsRef.current = next;
        return next;
      }
      return prev;
    });
  }, [extractedIcons]);

  // Clean up redundant base64 data URLs stored on custom curve items (CurveItemRenderer resolves URL from extractedIcons by iconId)
  useEffect(() => {
    if (extractedIcons && extractedIcons.length > 0) {
      setCurveObjects(prev => {
        let changed = false;
        const next = prev.map(c => {
          if (!Array.isArray(c.items)) return c;
          const nextItems = c.items.map(it => {
            if (it.isCustom && it.iconId && it.url) {
              changed = true;
              const { url: _u, ...rest } = it;
              return rest;
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

  // 打楽器・記号名の表示位置・回転・サイズ・縦書き設定モーダル用 state
  const [percLabelModalTarget, setPercLabelModalTarget] = useState<ItemLabelModalTarget | null>(null);

  const handleSavePercussionLabel = (settings: ItemLabelSettings) => {
    if (!percLabelModalTarget) return;
    const updatePayload: Partial<PlacedItem> = {
      labelOffsetX: settings.labelOffsetX,
      labelOffsetY: settings.labelOffsetY,
      labelRotation: settings.labelRotation,
      labelFontSize: settings.labelFontSize,
      labelLetterSpacing: settings.labelLetterSpacing,
      isVerticalName: settings.isVerticalName,
      ...(settings.showPercussionName !== undefined ? { showPercussionName: settings.showPercussionName } : {}),
    };
    if (percLabelModalTarget.targetType === 'symbol' && settings.text !== undefined) {
      updatePayload.symbolText = settings.text;
      if (settings.labelFontSize) {
        updatePayload.symbolFontSize = settings.labelFontSize;
      }
    }

    if (percLabelModalTarget.type === 'placedItem') {
      handleUpdateItem(percLabelModalTarget.itemId, updatePayload);
    } else if (percLabelModalTarget.type === 'curveItem' && percLabelModalTarget.curveId) {
      const curve = curveObjects.find(c => c.id === percLabelModalTarget.curveId);
      if (curve && Array.isArray(curve.items)) {
        const nextItems = curve.items.map(it => {
          if (it.id === percLabelModalTarget.itemId) {
            return { ...it, ...updatePayload };
          }
          return it;
        });
        handleUpdateCurve(curve.id, { items: nextItems });
      }
    }
  };

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

  // Floating Object Control Panel visibility state
  const [showFloatingPanel, setShowFloatingPanel] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('settingkun_show_floating_panel');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('settingkun_show_floating_panel', String(showFloatingPanel));
    } catch {}
  }, [showFloatingPanel]);

  // Curve control point snap state (turns green #10b981 on canvas and panel)
  const [isCtrlPointSnapped, setIsCtrlPointSnapped] = useState(false);
  const [isCurveMoving, setIsCurveMoving] = useState(false);

  // Mobile right panel toggle & add toast for touch devices
  const [showMobileRightPanel, setShowMobileRightPanel] = useState(false);
  const [addToast, setAddToast] = useState<string | null>(null);
  const addToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerAddToast = (label: string) => {
    try {
      if ('vibrate' in navigator) navigator.vibrate(20);
    } catch (_) {}
    setAddToast(`「${label}」を配置しました`);
    if (addToastTimerRef.current) clearTimeout(addToastTimerRef.current);
    addToastTimerRef.current = setTimeout(() => {
      setAddToast(null);
    }, 1400);
  };

  // Zoom state
  const [zoomMultiplier, setZoomMultiplier] = useState(1.0);
  const handleZoomIn = () => setZoomMultiplier(prev => Math.min(Number((prev + 0.15).toFixed(2)), 2.5));
  const handleZoomOut = () => setZoomMultiplier(prev => Math.max(Number((prev - 0.15).toFixed(2)), 0.5));

  // Global mouse wheel zoom for phase 3
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      // モーダル表示中（枠調整、エクスポート、スケール設定）は背面ステージのズームを行わない
      if (isExportModalOpen || isAdjusting || isMeasuringScale) return;
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
  }, [isExportModalOpen, isAdjusting, isMeasuringScale]);

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

  // 'latest' は「保存時点の最新状態からスナップショットを作る」ことを表す（変更のたびの複製を避ける）
  const pendingBackupRef = useRef<StageSnapshot | 'latest' | null>(null);
  const backupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastIdbTouchRef = useRef(0);

  // 静的な巨大画像データ（約1.1MBのBase64文字列群）は初回と変更時のみ1回だけJSON文字列化しておく
  const staticImagesJsonFragment = React.useMemo(() => {
    const staticPart: Record<string, any> = {};
    const pUrl = pageImageUrl || initialBackup?.pageImageUrl;
    const bUrl = backgroundUrl || initialBackup?.backgroundUrl;
    const iUrl = iconsRegionUrl || initialBackup?.iconsRegionUrl;
    const eIcons = extractedIcons || initialBackup?.extractedIcons;
    if (pUrl) staticPart.pageImageUrl = pUrl;
    if (bUrl) staticPart.backgroundUrl = bUrl;
    if (iUrl) staticPart.iconsRegionUrl = iUrl;
    if (eIcons) staticPart.extractedIcons = eIcons;
    const str = JSON.stringify(staticPart);
    return str.length > 2 ? str.slice(1, -1) : '';
  }, [pageImageUrl, backgroundUrl, iconsRegionUrl, extractedIcons, initialBackup]);

  const staticImagesSlimJsonFragment = React.useMemo(() => {
    const staticPart: Record<string, any> = {};
    const bUrl = backgroundUrl || initialBackup?.backgroundUrl;
    const iUrl = iconsRegionUrl || initialBackup?.iconsRegionUrl;
    const eIcons = extractedIcons || initialBackup?.extractedIcons;
    if (bUrl) staticPart.backgroundUrl = bUrl;
    if (iUrl) staticPart.iconsRegionUrl = iUrl;
    if (eIcons) staticPart.extractedIcons = eIcons;
    const str = JSON.stringify(staticPart);
    return str.length > 2 ? str.slice(1, -1) : '';
  }, [backgroundUrl, iconsRegionUrl, extractedIcons, initialBackup]);

  const writeBackupNow = (snapshot: StageSnapshot) => {
    try {
      // 動的な配置データ（数KB）のみを JSON.stringify し、事前シリアライズ済みの画像JSON断片を高速結合する
      const {
        pageImageUrl: _p,
        backgroundUrl: _b,
        iconsRegionUrl: _i,
        extractedIcons: _e,
        ...dynamicPart
      } = snapshot;
      const dynJson = JSON.stringify(dynamicPart);
      const fullJson = staticImagesJsonFragment
        ? `${dynJson.slice(0, -1)},${staticImagesJsonFragment}}`
        : dynJson;

      const now = Date.now();
      try {
        localStorage.setItem(BACKUP_KEY, fullJson);
        setBackupWarning(null);
      } catch {
        // 容量上限に達した場合は重複しやすい pageImageUrl を省いたスリム版で再試行
        const slimJson = staticImagesSlimJsonFragment
          ? `${dynJson.slice(0, -1)},${staticImagesSlimJsonFragment}}`
          : dynJson;
        localStorage.setItem(BACKUP_KEY, slimJson);
        setBackupWarning(null);
      }
      localStorage.setItem(BACKUP_KEY + '_ts', now.toString());
      localStorage.setItem(
        BACKUP_KEY + '_meta',
        JSON.stringify({
          projectName: snapshot.projectName || projectNameRef.current,
          sceneCount: Array.isArray(snapshot.scenes) ? snapshot.scenes.length : 1,
          savedAt: now,
        })
      );
      // IndexedDB のタイムスタンプ更新はセッション全体（数MB）の読み書きになるため、30秒に1回までに間引く
      if (fileId && now - lastIdbTouchRef.current > 30000) {
        lastIdbTouchRef.current = now;
        updateSessionTimestampInIndexedDB(fileId);
      }
    } catch {
      setBackupWarning('バックアップの保存に失敗しました（ストレージ容量不足の可能性）。');
    }
  };

  const flushBackup = () => {
    if (backupTimerRef.current) {
      clearTimeout(backupTimerRef.current);
      backupTimerRef.current = null;
    }
    if (pendingBackupRef.current) {
      const pending = pendingBackupRef.current;
      pendingBackupRef.current = null;
      writeBackupNow(pending === 'latest' ? buildSnapshot(false) : pending);
    }
  };

  // 操作のたびに JSON 書き込みが走らないよう、操作停止後のアイドル時間にまとめて保存する
  const saveBackup = (snapshot: StageSnapshot | 'latest', immediate = false) => {
    pendingBackupRef.current = snapshot;
    if (immediate) {
      flushBackup();
      return;
    }
    if (backupTimerRef.current) clearTimeout(backupTimerRef.current);
    backupTimerRef.current = setTimeout(() => {
      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        (window as any).requestIdleCallback(() => flushBackup(), { timeout: 1000 });
      } else {
        flushBackup();
      }
    }, 1200);
  };

  // ページ離脱・アンマウント時は未保存分を確実に書き込む
  useEffect(() => {
    const onUnload = () => flushBackup();
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      flushBackup();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build a snapshot of the current working state without JSON.stringify/parse overhead.
  // structuredClone (or shallow clone fallback) is 10x+ faster and never blocks the main thread on large strings.
  const cloneEditable = <T,>(val: T): T => {
    try {
      if (typeof structuredClone === 'function') {
        return structuredClone(val);
      }
    } catch { }
    return JSON.parse(JSON.stringify(val));
  };

  const buildSnapshot = (includeStaticImages = false): StageSnapshot => ({
    projectName: projectNameRef.current,
    placedItems: cloneEditable(placedItemsRef.current),
    curveObjects: cloneEditable(curveObjectsRef.current),
    // Merge current working state into scenes list before saving
    scenes: scenesRef.current.map(sc =>
      sc.id === currentSceneIdRef.current
        ? { ...sc, placedItems: cloneEditable(placedItemsRef.current), curveObjects: cloneEditable(curveObjectsRef.current), snapSettings: cloneEditable(snapSettingsRef.current) }
        : cloneEditable(sc)
    ),
    currentSceneId: currentSceneIdRef.current,
    snapSettings: cloneEditable(snapSettingsRef.current),
    backgroundCrop: backgroundCrop || initialBackup?.backgroundCrop,
    iconLabels: { ...iconLabelsRef.current },
    templateReplacements: { ...templateReplacementsRef.current },
    previewSettings: previewSettingsRef.current || undefined,
    ...(includeStaticImages
      ? {
          pageImageUrl: pageImageUrl || initialBackup?.pageImageUrl,
          backgroundUrl: backgroundUrl || initialBackup?.backgroundUrl,
          iconsRegionUrl: iconsRegionUrl || initialBackup?.iconsRegionUrl,
          extractedIcons: extractedIcons || initialBackup?.extractedIcons,
        }
      : {}),
  });

  const handleBack = () => {
    saveBackup('latest', true);
    onBack();
  };

  const handleExportJson = () => {
    try {
      const snap = buildSnapshot(true);
      saveBackup(snap, true);

      const d = new Date();
      const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
      const safeName = (projectNameRef.current || 'stajet').replace(/[\\/:*?"<>|]/g, '_').trim();
      const fileName = `${safeName}_${dateStr}.json`;

      const exportPayload = {
        version: '2.0',
        projectId: fileId || 'default',
        name: projectNameRef.current,
        projectName: projectNameRef.current,
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

  // ─── Drag Action Snapshot Management (One history step per complete drag action) ───
  const dragStartSnapshotRef = useRef<StageSnapshot | null>(null);

  const handleDragStartAction = () => {
    if (!dragStartSnapshotRef.current && !isRestoringRef.current) {
      dragStartSnapshotRef.current = buildSnapshot();
    }
  };

  const handleDragEndAction = () => {
    if (dragStartSnapshotRef.current) {
      const startSnap = dragStartSnapshotRef.current;
      dragStartSnapshotRef.current = null;
      const currentSnap = buildSnapshot();
      const hasItemChanged =
        startSnap.placedItems.length !== currentSnap.placedItems.length ||
        startSnap.placedItems.some((it, i) => {
          const cur = currentSnap.placedItems[i];
          return !cur || it.id !== cur.id || it.x !== cur.x || it.y !== cur.y || it.rotation !== cur.rotation || it.scaleX !== cur.scaleX || it.scaleY !== cur.scaleY || it.width !== cur.width || it.height !== cur.height;
        });
      const hasCurveChanged =
        startSnap.curveObjects.length !== currentSnap.curveObjects.length ||
        startSnap.curveObjects.some((c, i) => {
          const cur = currentSnap.curveObjects[i];
          return !cur || c.id !== cur.id || c.x !== cur.x || c.y !== cur.y || c.rotation !== cur.rotation || c.points.some((p, pi) => p !== cur.points[pi]);
        });
      if (hasItemChanged || hasCurveChanged) {
        historyRef.current = [...historyRef.current.slice(-HISTORY_MAX + 1), startSnap];
        redoStackRef.current = [];
        setCanUndo(true);
        setCanRedo(false);
        saveBackup('latest');
      }
    }
  };

  // ─── Arrow Keys Nudging Grouping (Debounced into a single undo step) ───
  const nudgeSnapshotRef = useRef<StageSnapshot | null>(null);
  const nudgeTimerRef = useRef<any>(null);

  const handleNudgeItems = (updates: { id: string; attrs: Partial<PlacedItem> }[]) => {
    if (!nudgeSnapshotRef.current && !isRestoringRef.current) {
      nudgeSnapshotRef.current = buildSnapshot();
    }
    setPlacedItems(prev => prev.map(item => {
      const u = updates.find(x => x.id === item.id);
      return u ? { ...item, ...u.attrs } : item;
    }));

    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    nudgeTimerRef.current = setTimeout(() => {
      if (nudgeSnapshotRef.current) {
        historyRef.current = [...historyRef.current.slice(-HISTORY_MAX + 1), nudgeSnapshotRef.current];
        redoStackRef.current = [];
        setCanUndo(true);
        setCanRedo(false);
        saveBackup('latest');
        nudgeSnapshotRef.current = null;
      }
    }, 400);
  };

  const handleNudgeCurves = (curveUpdates: { id: string; attrs: Partial<CurveObject> }[]) => {
    if (!nudgeSnapshotRef.current && !isRestoringRef.current) {
      nudgeSnapshotRef.current = buildSnapshot();
    }
    setCurveObjects(prev => prev.map(c => {
      const u = curveUpdates.find(x => x.id === c.id);
      return u ? { ...c, ...u.attrs } : c;
    }));

    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    nudgeTimerRef.current = setTimeout(() => {
      if (nudgeSnapshotRef.current) {
        historyRef.current = [...historyRef.current.slice(-HISTORY_MAX + 1), nudgeSnapshotRef.current];
        redoStackRef.current = [];
        setCanUndo(true);
        setCanRedo(false);
        saveBackup('latest');
        nudgeSnapshotRef.current = null;
      }
    }, 400);
  };

  // ─── Floating Object Control Panel Actions ───
  const remoteDragInitialPosRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const handleRemoteDragStart = () => {
    handleDragStartAction();
    remoteDragInitialPosRef.current.clear();

    const activeIds = selectedIds.length > 0 ? selectedIds : (selectedId ? [selectedId] : []);
    const activeCurves = selectedCurveIds.length > 0 ? selectedCurveIds : (selectedCurveId ? [selectedCurveId] : []);

    activeIds.forEach(id => {
      const it = placedItems.find(item => item.id === id);
      if (it && !it.isPinned) {
        remoteDragInitialPosRef.current.set(`item_${id}`, { x: it.x, y: it.y });
      }
    });

    activeCurves.forEach(id => {
      const c = curveObjects.find(curve => curve.id === id);
      if (c && !c.isPinned) {
        remoteDragInitialPosRef.current.set(`curve_${id}`, { x: c.x, y: c.y });
      }
    });

    if (activeCurves.length > 0) {
      setIsCurveMoving(true);
    }
  };

  const handleRemoteDragMove = (totalDx: number, totalDy: number, isCtrl = false, isShift = false) => {
    if (remoteDragInitialPosRef.current.size === 0) return;

    // Pick first entry as anchor object for calculating snapping
    const firstEntry = remoteDragInitialPosRef.current.entries().next().value;
    if (!firstEntry) return;

    const [, primaryInitPos] = firstEntry;
    const rawX = primaryInitPos.x + totalDx;
    const rawY = primaryInitPos.y + totalDy;

    let actualDx = totalDx;
    let actualDy = totalDy;

    if (stageCanvasRef.current?.calculateSnapping) {
      const snap = stageCanvasRef.current.calculateSnapping(rawX, rawY, isCtrl, isShift);
      actualDx = snap.x - primaryInitPos.x;
      actualDy = snap.y - primaryInitPos.y;
      stageCanvasRef.current.setSnapGuides(
        snap.snappedX ? snap.x : null,
        snap.snappedY ? snap.y : null
      );
    }

    setPlacedItems(prev => prev.map(item => {
      const init = remoteDragInitialPosRef.current.get(`item_${item.id}`);
      if (!init) return item;
      return {
        ...item,
        x: Math.round(init.x + actualDx),
        y: Math.round(init.y + actualDy),
      };
    }));

    setCurveObjects(prev => prev.map(curve => {
      const init = remoteDragInitialPosRef.current.get(`curve_${curve.id}`);
      if (!init) return curve;
      return {
        ...curve,
        x: Math.round(init.x + actualDx),
        y: Math.round(init.y + actualDy),
      };
    }));
  };

  const handleRemoteDragEnd = () => {
    setIsCurveMoving(false);
    remoteDragInitialPosRef.current.clear();
    stageCanvasRef.current?.setSnapGuides(null, null);
    handleDragEndAction();
  };

  // Remote control points drag handlers for floating panel
  const curveInitialPointsRef = useRef<[number, number, number, number, number, number] | null>(null);
  const targetCurveIdRef = useRef<string | null>(null);

  const handleControlPointDragStart = () => {
    handleDragStartAction();
    setIsCurveMoving(true);
    const targetId = selectedCurveId || selectedCurveIds[0] || null;
    targetCurveIdRef.current = targetId;
    const activeCurve = targetId ? curveObjects.find(c => c.id === targetId) : null;
    if (activeCurve && !activeCurve.isPinned) {
      curveInitialPointsRef.current = [...activeCurve.points];
    } else {
      curveInitialPointsRef.current = null;
    }
  };

  const handleControlPointDragMove = (
    type: 'red' | 'blue',
    deltaX: number,
    deltaY: number,
    _isCtrl = false,
    isShift = false
  ) => {
    if (!curveInitialPointsRef.current || !targetCurveIdRef.current) return;
    const targetCurveId = targetCurveIdRef.current;
    const targetCurve = curveObjects.find(c => c.id === targetCurveId);
    if (!targetCurve || targetCurve.isPinned) return;

    const initPts = curveInitialPointsRef.current;
    let newPts: [number, number, number, number, number, number];

    if (type === 'red') {
      let mx = Math.round(initPts[2] + deltaX);
      let my = Math.round(initPts[3] + deltaY);
      let snapped = false;

      if (!isShift) {
        const x0 = initPts[0], y0 = initPts[1];
        const x2 = initPts[4], y2 = initPts[5];
        const snapThreshold = 15;
        let snappedToLine = false;

        // 1. 直線へのスナップ (両端点を結ぶ直線へのスナップ)
        const L2 = (x2 - x0) ** 2 + (y2 - y0) ** 2;
        if (L2 > 0) {
          const dot = (mx - x0) * (x2 - x0) + (my - y0) * (y2 - y0);
          const t = Math.max(0, Math.min(1, dot / L2));
          const px = Math.round(x0 + t * (x2 - x0));
          const py = Math.round(y0 + t * (y2 - y0));
          if (Math.hypot(mx - px, my - py) < snapThreshold) {
            mx = px;
            my = py;
            snappedToLine = true;
            snapped = true;
          }
        }

        // 2. 中点へのスナップ（両端点の中点、および中心軸 X=0）
        const midX = Math.round((x0 + x2) / 2);
        const midY = Math.round((y0 + y2) / 2);

        if (Math.hypot(mx - midX, my - midY) < snapThreshold * 1.3) {
          mx = midX;
          my = midY;
          snapped = true;
        } else if (Math.abs(mx - midX) < snapThreshold) {
          mx = midX;
          if (snappedToLine) my = midY;
          snapped = true;
        } else if (Math.abs(mx) < snapThreshold) {
          mx = 0;
          snapped = true;
        }
      }

      setIsCtrlPointSnapped(prev => (prev === snapped ? prev : snapped));
      newPts = [initPts[0], initPts[1], mx, my, initPts[4], initPts[5]];
    } else {
      // Blue handle controls ends spread / height [pts[0], pts[1]] & [pts[4], pts[5]] (mirrored)
      const initHalfW = Math.abs(initPts[0]);
      let halfW = Math.max(10, Math.round(initHalfW + deltaX));
      let y = Math.round(initPts[1] + deltaY);

      if (!isShift) {
        const snapThreshold = 12;
        // 水平スナップ（y=0）
        if (Math.abs(y) < snapThreshold) {
          y = 0;
        }
      }

      setIsCtrlPointSnapped(prev => (prev === false ? prev : false));
      newPts = [-halfW, y, initPts[2], initPts[3], halfW, y];
    }

    setCurveObjects(prev => prev.map(c => {
      if (c.id !== targetCurveId || c.isPinned) return c;
      return { ...c, points: newPts };
    }));
  };

  const handleControlPointDragEnd = () => {
    setIsCurveMoving(false);
    curveInitialPointsRef.current = null;
    targetCurveIdRef.current = null;
    setIsCtrlPointSnapped(false);
    handleDragEndAction();
  };

  const handleNudgeDirection = (dx: number, dy: number) => {
    const activeIds = selectedIds.length > 0 ? selectedIds : (selectedId ? [selectedId] : []);
    const activeCurves = selectedCurveIds.length > 0 ? selectedCurveIds : (selectedCurveId ? [selectedCurveId] : []);

    if (activeIds.length > 0) {
      const updates = activeIds.map(id => {
        const it = placedItems.find(item => item.id === id);
        if (!it || it.isPinned) return null;
        return { id, attrs: { x: it.x + dx, y: it.y + dy } };
      }).filter(Boolean) as { id: string; attrs: Partial<PlacedItem> }[];
      if (updates.length > 0) {
        handleNudgeItems(updates);
      }
    }

    if (activeCurves.length > 0) {
      const updates = activeCurves.map(id => {
        const c = curveObjects.find(curve => curve.id === id);
        if (!c || c.isPinned) return null;
        return { id, attrs: { x: c.x + dx, y: c.y + dy } };
      }).filter(Boolean) as { id: string; attrs: Partial<CurveObject> }[];
      if (updates.length > 0) {
        handleNudgeCurves(updates);
      }
    }
  };

  const handleRotateSelected = (deltaDeg: number) => {
    const activeIds = selectedIds.length > 0 ? selectedIds : (selectedId ? [selectedId] : []);
    const activeCurves = selectedCurveIds.length > 0 ? selectedCurveIds : (selectedCurveId ? [selectedCurveId] : []);
    if (activeIds.length === 0 && activeCurves.length === 0) return;

    pushHistory();

    if (activeIds.length > 0) {
      setPlacedItems(prev => prev.map(item => {
        if (!activeIds.includes(item.id) || item.isPinned) return item;
        let nextRot = Math.round(((item.rotation || 0) + deltaDeg) % 360);
        if (nextRot < 0) nextRot += 360;
        return { ...item, rotation: nextRot };
      }));
    }

    if (activeCurves.length > 0) {
      const rad = (deltaDeg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      setCurveObjects(prev => prev.map(c => {
        if (!activeCurves.includes(c.id) || c.isPinned) return c;
        const [x0, y0, cx, cy, x1, y1] = c.points;
        const midX = (x0 + x1) / 2;
        const midY = (y0 + y1) / 2;
        const rotPoint = (px: number, py: number) => {
          const dx = px - midX;
          const dy = py - midY;
          return [midX + dx * cos - dy * sin, midY + dx * sin + dy * cos] as [number, number];
        };
        const [rx0, ry0] = rotPoint(x0, y0);
        const [rcx, rcy] = rotPoint(cx, cy);
        const [rx1, ry1] = rotPoint(x1, y1);
        return { ...c, points: [rx0, ry0, rcx, rcy, rx1, ry1] };
      }));
    }
  };

  const handleResizeSelected = (factor: number) => {
    const activeIds = selectedIds.length > 0 ? selectedIds : (selectedId ? [selectedId] : []);
    const activeCurves = selectedCurveIds.length > 0 ? selectedCurveIds : (selectedCurveId ? [selectedCurveId] : []);
    if (activeIds.length === 0 && activeCurves.length === 0) return;

    pushHistory();

    if (activeIds.length > 0) {
      setPlacedItems(prev => prev.map(item => {
        if (!activeIds.includes(item.id) || item.isPinned) return item;
        const curW = item.width || 40;
        const curH = item.height || 40;
        const newW = Math.max(10, Math.round(curW * factor));
        const newH = Math.max(10, Math.round(curH * factor));
        return {
          ...item,
          width: newW,
          height: newH,
        };
      }));
    }

    if (activeCurves.length > 0) {
      setCurveObjects(prev => prev.map(c => {
        if (!activeCurves.includes(c.id) || c.isPinned) return c;
        const curSize = c.itemSize || 30;
        const newSize = Math.max(10, Math.round(curSize * factor));
        return { ...c, itemSize: newSize };
      }));
    }
  };

  // Restore a snapshot to the React state
  const restoreSnapshot = (snap: StageSnapshot) => {
    isRestoringRef.current = true;
    setScenes(cloneEditable(snap.scenes));
    setCurrentSceneId(snap.currentSceneId);
    setPlacedItems(cloneEditable(snap.placedItems));
    setCurveObjects(cloneEditable(snap.curveObjects));
    if (snap.iconLabels) {
      setIconLabels(prev => ({ ...prev, ...snap.iconLabels }));
      iconLabelsRef.current = { ...iconLabelsRef.current, ...snap.iconLabels };
    }
    setSnapSettings(prev => ({
      ...prev,
      ...cloneEditable(snap.snapSettings),
      showCenterMarker: prev.showCenterMarker,
    }));
    setSelectedIds([]);
    setSelectedCurveIds([]);
    saveBackup('latest');
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

  // Auto-save post-action state to localStorage backup whenever stage state changes
  useEffect(() => {
    if (isRestoringRef.current) return;
    saveBackup('latest');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placedItems, curveObjects, scenes, currentSceneId, snapSettings, iconLabels]);

  // Keyboard shortcuts for Undo / Redo / Select All / Pin / Deselect (Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      if (isExportModalOpen || isAdjusting || isMeasuringScale) return;

      if (e.key === 'Escape') {
        if (selectedIds.length > 0 || selectedCurveIds.length > 0) {
          e.preventDefault();
          handleDeselectAll();
        }
        return;
      }

      // Reorder Curve Item: '[' or Alt+ArrowLeft for left, ']' or Alt+ArrowRight for right
      if (selectedCurveId && selectedCurveItemId) {
        if (e.key === '[' || (e.altKey && e.key === 'ArrowLeft')) {
          e.preventDefault();
          handleMoveCurveItemOrder(selectedCurveId, selectedCurveItemId, 'left');
          return;
        }
        if (e.key === ']' || (e.altKey && e.key === 'ArrowRight')) {
          e.preventDefault();
          handleMoveCurveItemOrder(selectedCurveId, selectedCurveItemId, 'right');
          return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          handleDeleteCurveItem(selectedCurveId, selectedCurveItemId);
          return;
        }
      }

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
      // Select All: Ctrl/Cmd + A
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        handleSelectAll();
        return;
      }
      // Toggle Pin Selected: Ctrl/Cmd + F
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        handleTogglePinSelected();
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExportModalOpen, isAdjusting, isMeasuringScale, canUndo, canRedo, placedItems, curveObjects, scenes, currentSceneId, snapSettings, selectedIds, selectedCurveIds, selectedCurveId, selectedCurveItemId]);

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

    const isSymbol = templateType === 'symbol';

    const newItem: PlacedItem = {
      id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      iconId,
      templateType,
      percussionType,
      showPercussionName: true,
      symbolShape: isSymbol ? 'circle' : undefined,
      symbolFilled: isSymbol ? false : undefined,
      symbolText: isSymbol ? '' : undefined,
      symbolFontSize: isSymbol ? 16 : undefined,
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
    setSelectedIds([newItem.id]);
    setSelectedCurveIds([]);
    setSelectedCurveItemId(null);
    const itemLabel = isTemplate ? (tmpl?.label || 'テンプレ') : (iconLabels[iconId] || iconDef?.label || 'パーツ');
    triggerAddToast(itemLabel);
  };

  const handleUpdateItem = (id: string, newAttrs: Partial<PlacedItem>) => {
    const currentItem = placedItemsRef.current.find(i => i.id === id);
    if (currentItem) {
      const isChanged = Object.keys(newAttrs).some(
        key => (newAttrs as any)[key] !== (currentItem as any)[key]
      );
      if (!isChanged) return;
    }
    // ドラッグ操作中の場合は handleDragEndAction でまとめて履歴に積むため、個別 push はスキップ
    if (!dragStartSnapshotRef.current) {
      pushHistory();
    }
    setPlacedItems(prev => prev.map(item => item.id === id ? { ...item, ...newAttrs } : item));
  };

  const handleDeleteItem = (id: string) => {
    pushHistory();
    setPlacedItems(prev => prev.filter(item => item.id !== id));
    setSelectedIds(prev => prev.filter(i => i !== id));
  };

  const handleDeleteCurveItem = (curveId: string, itemId: string) => {
    const curve = curveObjects.find(c => c.id === curveId);
    if (!curve || !Array.isArray(curve.items)) return;

    pushHistory();
    const nextItems = curve.items.filter(it => it.id !== itemId);
    setCurveObjects(prev => prev.map(c => {
      if (c.id !== curveId) return c;
      return {
        ...c,
        items: nextItems,
        itemCount: nextItems.length,
      };
    }));
    setSelectedCurveItemId(null);
  };

  const handleDeleteSelected = () => {
    // ベジェ曲線上の特定オブジェクトが選択されている場合は、そのオブジェクトのみを削除
    if (selectedCurveId && selectedCurveItemId) {
      handleDeleteCurveItem(selectedCurveId, selectedCurveItemId);
      return;
    }

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

    // ドラッグ操作中の場合は handleDragEndAction でまとめて履歴に積むため、個別 push はスキップ
    if (!dragStartSnapshotRef.current) {
      pushHistory();
    }
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

  // ─── Object Manipulation Handlers (Ported from Prototype & DADS) ─────────

  const handleSelectAll = () => {
    setSelectedIds(placedItems.map(i => i.id));
    setSelectedCurveIds(curveObjects.map(c => c.id));
    setSelectedCurveItemId(null);
  };

  const handleDeselectAll = () => {
    setSelectedIds([]);
    setSelectedCurveIds([]);
    setSelectedCurveItemId(null);
  };

  const handleTogglePinSelected = () => {
    const { items, curves } = getSelectedObjects();
    if (items.length === 0 && curves.length === 0) return;
    pushHistory();
    const allPinned = [...items, ...curves].every(o => Boolean(o.isPinned));
    const nextPinned = !allPinned;

    if (items.length > 0) {
      const itemIds = new Set(items.map(i => i.id));
      setPlacedItems(prev => prev.map(it => itemIds.has(it.id) ? { ...it, isPinned: nextPinned } : it));
    }
    if (curves.length > 0) {
      const curveIds = new Set(curves.map(c => c.id));
      setCurveObjects(prev => prev.map(cv => curveIds.has(cv.id) ? { ...cv, isPinned: nextPinned } : cv));
    }
  };

  const handleMoveOrder = (direction: 'front' | 'back' | 'forward' | 'backward') => {
    const { items, curves } = getSelectedObjects();
    if (items.length === 0 && curves.length === 0) return;
    pushHistory();

    if (items.length > 0) {
      const selSet = new Set(items.map(i => i.id));
      setPlacedItems(prev => {
        const arr = [...prev];
        if (direction === 'front') {
          const nonSel = arr.filter(i => !selSet.has(i.id));
          const sel = arr.filter(i => selSet.has(i.id));
          return [...nonSel, ...sel];
        } else if (direction === 'back') {
          const nonSel = arr.filter(i => !selSet.has(i.id));
          const sel = arr.filter(i => selSet.has(i.id));
          return [...sel, ...nonSel];
        } else if (direction === 'forward') {
          for (let i = arr.length - 2; i >= 0; i--) {
            if (selSet.has(arr[i].id) && !selSet.has(arr[i + 1].id)) {
              const temp = arr[i];
              arr[i] = arr[i + 1];
              arr[i + 1] = temp;
            }
          }
          return arr;
        } else if (direction === 'backward') {
          for (let i = 1; i < arr.length; i++) {
            if (selSet.has(arr[i].id) && !selSet.has(arr[i - 1].id)) {
              const temp = arr[i];
              arr[i] = arr[i - 1];
              arr[i - 1] = temp;
            }
          }
          return arr;
        }
        return arr;
      });
    }

    if (curves.length > 0) {
      const selCurveSet = new Set(curves.map(c => c.id));
      setCurveObjects(prev => {
        const arr = [...prev];
        if (direction === 'front') {
          const nonSel = arr.filter(c => !selCurveSet.has(c.id));
          const sel = arr.filter(c => selCurveSet.has(c.id));
          return [...nonSel, ...sel];
        } else if (direction === 'back') {
          const nonSel = arr.filter(c => !selCurveSet.has(c.id));
          const sel = arr.filter(c => selCurveSet.has(c.id));
          return [...sel, ...nonSel];
        } else if (direction === 'forward') {
          for (let i = arr.length - 2; i >= 0; i--) {
            if (selCurveSet.has(arr[i].id) && !selCurveSet.has(arr[i + 1].id)) {
              const temp = arr[i];
              arr[i] = arr[i + 1];
              arr[i + 1] = temp;
            }
          }
          return arr;
        } else if (direction === 'backward') {
          for (let i = 1; i < arr.length; i++) {
            if (selCurveSet.has(arr[i].id) && !selCurveSet.has(arr[i - 1].id)) {
              const temp = arr[i];
              arr[i] = arr[i - 1];
              arr[i - 1] = temp;
            }
          }
          return arr;
        }
        return arr;
      });
    }
  };

  const handleAlign = (type: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom' | 'distributeH' | 'distributeV') => {
    const { items, curves } = getSelectedObjects();
    const totalSelected = items.length + curves.length;
    if (totalSelected === 0) return;
    if (totalSelected === 1 && (type === 'distributeH' || type === 'distributeV')) return;

    pushHistory();

    type ObjMeta = {
      id: string;
      isCurve: boolean;
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
      cx: number;
      cy: number;
      width: number;
      height: number;
      ref: any;
    };
    const metas: ObjMeta[] = [];

    for (const it of items) {
      const w = it.width ?? 40;
      const h = it.height ?? 40;
      metas.push({
        id: it.id,
        isCurve: false,
        minX: it.x,
        maxX: it.x + w,
        minY: it.y,
        maxY: it.y + h,
        cx: it.x + w / 2,
        cy: it.y + h / 2,
        width: w,
        height: h,
        ref: it,
      });
    }

    for (const c of curves) {
      const [x0, y0, cx, cy, x1, y1] = c.points;
      const allX = [c.x + x0, c.x + cx, c.x + x1];
      const allY = [c.y + y0, c.y + cy, c.y + y1];
      const minX = Math.min(...allX);
      const maxX = Math.max(...allX);
      const minY = Math.min(...allY);
      const maxY = Math.max(...allY);
      metas.push({
        id: c.id,
        isCurve: true,
        minX,
        maxX,
        minY,
        maxY,
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
        width: maxX - minX,
        height: maxY - minY,
        ref: c,
      });
    }

    const overallMinX = Math.min(...metas.map(m => m.minX));
    const overallMaxX = Math.max(...metas.map(m => m.maxX));
    const overallMinY = Math.min(...metas.map(m => m.minY));
    const overallMaxY = Math.max(...metas.map(m => m.maxY));
    const overallCx = (overallMinX + overallMaxX) / 2;
    const overallCy = (overallMinY + overallMaxY) / 2;

    const itemUpdates = new Map<string, Partial<PlacedItem>>();
    const curveUpdates = new Map<string, Partial<CurveObject>>();

    if (type === 'left') {
      for (const m of metas) {
        const deltaX = overallMinX - m.minX;
        if (m.isCurve) {
          curveUpdates.set(m.id, { x: m.ref.x + deltaX });
        } else {
          itemUpdates.set(m.id, { x: overallMinX });
        }
      }
    } else if (type === 'centerH') {
      for (const m of metas) {
        const deltaX = overallCx - m.cx;
        if (m.isCurve) {
          curveUpdates.set(m.id, { x: m.ref.x + deltaX });
        } else {
          itemUpdates.set(m.id, { x: overallCx - m.width / 2 });
        }
      }
    } else if (type === 'right') {
      for (const m of metas) {
        const deltaX = overallMaxX - m.maxX;
        if (m.isCurve) {
          curveUpdates.set(m.id, { x: m.ref.x + deltaX });
        } else {
          itemUpdates.set(m.id, { x: overallMaxX - m.width });
        }
      }
    } else if (type === 'top') {
      for (const m of metas) {
        const deltaY = overallMinY - m.minY;
        if (m.isCurve) {
          curveUpdates.set(m.id, { y: m.ref.y + deltaY });
        } else {
          itemUpdates.set(m.id, { y: overallMinY });
        }
      }
    } else if (type === 'centerV') {
      for (const m of metas) {
        const deltaY = overallCy - m.cy;
        if (m.isCurve) {
          curveUpdates.set(m.id, { y: m.ref.y + deltaY });
        } else {
          itemUpdates.set(m.id, { y: overallCy - m.height / 2 });
        }
      }
    } else if (type === 'bottom') {
      for (const m of metas) {
        const deltaY = overallMaxY - m.maxY;
        if (m.isCurve) {
          curveUpdates.set(m.id, { y: m.ref.y + deltaY });
        } else {
          itemUpdates.set(m.id, { y: overallMaxY - m.height });
        }
      }
    } else if (type === 'distributeH' && metas.length >= 3) {
      const sorted = [...metas].sort((a, b) => a.cx - b.cx);
      const firstCx = sorted[0].cx;
      const lastCx = sorted[sorted.length - 1].cx;
      const step = (lastCx - firstCx) / (sorted.length - 1);
      sorted.forEach((m, idx) => {
        const targetCx = firstCx + step * idx;
        const deltaX = targetCx - m.cx;
        if (m.isCurve) {
          curveUpdates.set(m.id, { x: m.ref.x + deltaX });
        } else {
          itemUpdates.set(m.id, { x: m.ref.x + deltaX });
        }
      });
    } else if (type === 'distributeV' && metas.length >= 3) {
      const sorted = [...metas].sort((a, b) => a.cy - b.cy);
      const firstCy = sorted[0].cy;
      const lastCy = sorted[sorted.length - 1].cy;
      const step = (lastCy - firstCy) / (sorted.length - 1);
      sorted.forEach((m, idx) => {
        const targetCy = firstCy + step * idx;
        const deltaY = targetCy - m.cy;
        if (m.isCurve) {
          curveUpdates.set(m.id, { y: m.ref.y + deltaY });
        } else {
          itemUpdates.set(m.id, { y: m.ref.y + deltaY });
        }
      });
    }

    if (itemUpdates.size > 0) {
      setPlacedItems(prev => prev.map(it => itemUpdates.has(it.id) ? { ...it, ...itemUpdates.get(it.id) } : it));
    }
    if (curveUpdates.size > 0) {
      setCurveObjects(prev => prev.map(c => curveUpdates.has(c.id) ? { ...c, ...curveUpdates.get(c.id) } : c));
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
    setSelectedIds([]);
    setSelectedCurveIds([curve.id]);
    setSelectedCurveItemId(null);
  };

  const handleMoveCenterTo = (canvasX: number, canvasY: number) => {
    const bgCenter = stageCanvasRef.current?.getStageCenter();
    const bgCenterX = bgCenter?.x ?? 600;
    const bgCenterY = bgCenter?.y ?? 400;
    pushHistory();
    setSnapSettings(prev => ({
      ...prev,
      centerOffset: {
        x: Math.round(canvasX - bgCenterX),
        y: Math.round(canvasY - bgCenterY),
      },
    }));
  };

  const handleUpdateCenterOffset = (offset: { x: number; y: number }) => {
    pushHistory();
    setSnapSettings(prev => ({ ...prev, centerOffset: offset }));
  };

  const handleMoveCurveItemOrder = (
    curveId: string,
    itemId: string,
    direction: 'left' | 'right'
  ) => {
    const curve = curveObjects.find(c => c.id === curveId);
    if (!curve || !Array.isArray(curve.items) || curve.items.length <= 1) return;

    const idx = curve.items.findIndex(it => it.id === itemId);
    if (idx === -1) return;

    const targetIdx = direction === 'left' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= curve.items.length) return;

    pushHistory();

    const nextItems = [...curve.items];
    const gapIdx = nextItems[idx].gap;
    const gapTarget = nextItems[targetIdx].gap;

    const itemA = { ...nextItems[idx] };
    const itemB = { ...nextItems[targetIdx] };

    if (gapTarget !== undefined) {
      itemA.gap = gapTarget;
    } else {
      delete itemA.gap;
    }

    if (gapIdx !== undefined) {
      itemB.gap = gapIdx;
    } else {
      delete itemB.gap;
    }

    nextItems[idx] = itemB;
    nextItems[targetIdx] = itemA;

    setCurveObjects(prev => prev.map(c => c.id === curveId ? { ...c, items: nextItems } : c));
    setSelectedCurveItemId(itemId);
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
      // custom icon URL is resolved dynamically from extractedIcons by iconId; avoid duplicating large data URLs on each CurveItem
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
    setSelectedIds([]);
    setSelectedCurveItemId(newItem.id);
    triggerAddToast(newItem.label || 'アイテム');
  };

  const handlePaletteItemClick = (iconId: string) => {
    if (selectedCurveId) {
      addItemToSelectedCurve(iconId);
    } else {
      handleAddItem(iconId);
    }
  };

  const handleUpdateCurve = (id: string, updates: Partial<CurveObject>, skipHistory = false) => {
    const currentCurve = curveObjectsRef.current.find(c => c.id === id);
    if (currentCurve) {
      const isChanged = Object.keys(updates).some(
        key => (updates as any)[key] !== (currentCurve as any)[key]
      );
      if (!isChanged) return;
    }
    // ドラッグ操作中（制御点ハンドルや曲線ドラッグ）または skipHistory 指定時は個別 push をスキップ
    if (!skipHistory && !dragStartSnapshotRef.current) {
      pushHistory();
    }
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

  const handleUpdateAllOfType = (type: 'stand' | 'pianoChair', style: 'default' | 'xMark' | 'doubleCircle' | 'circlePi') => {
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
      onIconLabelsChange?.(next);
      saveBackup({ ...buildSnapshot(), iconLabels: next });
      return next;
    });
  };

  // Compute tallies: merge placed items + curve items (including 1x PDF page positions for multi-tier riser breakdowns)
  const computeTallies = (items: PlacedItem[] = placedItems, curves: CurveObject[] = curveObjects) => {
    const counts: Record<string, number> = {};
    const positionsMap: Record<string, [number, number][]> = {};
    const effCrop = backgroundCrop || initialBackup?.backgroundCrop || { x: 0, y: 0, width: 1684, height: 1191 };

    const addPos = (key: string, stageX: number, stageY: number) => {
      if (!positionsMap[key]) positionsMap[key] = [];
      positionsMap[key].push([(effCrop.x + stageX) / 2.0, (effCrop.y + stageY) / 2.0]);
    };

    // Count normal placed items
    for (const item of items) {
      const cx = item.x + (item.width * (item.scaleX || 1)) / 2;
      const cy = item.y + (item.height * (item.scaleY || 1)) / 2;
      if (item.templateType === 'ensembleChairAndStand') {
        const isPiano = item.chairType === 'pianoChair' || item.chairType === 'pianoChairSvg' || item.chairType === 'pianoChairPi';
        const chairKey = isPiano ? 'tmpl_pianoChair' : 'tmpl_chorusChair';
        counts[chairKey] = (counts[chairKey] || 0) + 1;
        addPos(chairKey, cx, cy);
        counts['tmpl_ensembleStand'] = (counts['tmpl_ensembleStand'] || 0) + 1;
        addPos('tmpl_ensembleStand', cx, cy);
      } else {
        counts[item.iconId] = (counts[item.iconId] || 0) + 1;
        addPos(item.iconId, cx, cy);
      }
    }

    // Count items in curve objects
    for (const curve of curves) {
      const rotRad = ((curve.rotation || 0) * Math.PI) / 180;
      const cosR = Math.cos(rotRad);
      const sinR = Math.sin(rotRad);
      const toStagePt = (lx: number, ly: number): [number, number] => [
        curve.x + lx * cosR - ly * sinR,
        curve.y + lx * sinR + ly * cosR,
      ];

      if (Array.isArray(curve.items)) {
        const placedCurveItems = distributeItemsAlongCurve(
          curve.points,
          curve.items,
          curve.itemSize || 32,
          curve.itemGap ?? 10,
          curve.align || 'center'
        );
        for (let idx = 0; idx < curve.items.length; idx++) {
          const it: CurveItem = curve.items[idx];
          const p = placedCurveItems[idx];
          const [sx, sy] = p ? toStagePt(p.x, p.y) : [curve.x, curve.y];
          if (it.isCustom && it.iconId) {
            counts[it.iconId] = (counts[it.iconId] || 0) + 1;
            addPos(it.iconId, sx, sy);
          } else if (it.type === 'ensembleChairAndStand') {
            const effectiveChairType = it.chairType || curve.chairType;
            const isPiano = effectiveChairType === 'pianoChair' || effectiveChairType === 'pianoChairSvg' || effectiveChairType === 'pianoChairPi';
            const chairKey = isPiano ? 'tmpl_pianoChair' : 'tmpl_chorusChair';
            counts[chairKey] = (counts[chairKey] || 0) + 1;
            addPos(chairKey, sx, sy);
            counts['tmpl_ensembleStand'] = (counts['tmpl_ensembleStand'] || 0) + 1;
            addPos('tmpl_ensembleStand', sx, sy);
          } else {
            const key = it.type.startsWith('tmpl_') ? it.type : `tmpl_${it.type}`;
            counts[key] = (counts[key] || 0) + 1;
            addPos(key, sx, sy);
          }
        }
      } else {
        const tmplType = curve.itemType;
        const pts = distributeAlongCurve(
          curve.points,
          curve.itemCount,
          curve.itemSize || 32,
          curve.itemGap ?? 10,
          curve.align || 'center'
        );
        if (tmplType === 'ensembleChairAndStand') {
          const isPiano = curve.chairType === 'pianoChair' || curve.chairType === 'pianoChairSvg' || curve.chairType === 'pianoChairPi';
          const chairKey = isPiano ? 'tmpl_pianoChair' : 'tmpl_chorusChair';
          counts[chairKey] = (counts[chairKey] || 0) + curve.itemCount;
          counts['tmpl_ensembleStand'] = (counts['tmpl_ensembleStand'] || 0) + curve.itemCount;
          for (let idx = 0; idx < curve.itemCount; idx++) {
            const p = pts[idx];
            const [sx, sy] = p ? toStagePt(p.x, p.y) : [curve.x, curve.y];
            addPos(chairKey, sx, sy);
            addPos('tmpl_ensembleStand', sx, sy);
          }
        } else if (tmplType) {
          const key = `tmpl_${tmplType}`;
          counts[key] = (counts[key] || 0) + curve.itemCount;
          for (let idx = 0; idx < curve.itemCount; idx++) {
            const p = pts[idx];
            const [sx, sy] = p ? toStagePt(p.x, p.y) : [curve.x, curve.y];
            addPos(key, sx, sy);
          }
        }
      }
    }

    // Build tallies from extracted icons (including linked template counts so TallyTable and Export match 100%)
    const replacedTmplIdSet = new Set<string>();
    const iconTallies = extractedIcons.map((icon) => {
      const tmplId = effectiveTemplateReplacements?.[icon.id];
      const matchedTmpl = tmplId
        ? TEMPLATE_SHAPES.find(t => t.id === tmplId || t.type === tmplId.replace(/^tmpl_/, ''))
        : null;
      const effectiveTmplId = matchedTmpl ? (matchedTmpl.id || `tmpl_${matchedTmpl.type}`) : null;
      if (effectiveTmplId) {
        replacedTmplIdSet.add(effectiveTmplId);
      }

      const rawCount = counts[icon.id] || 0;
      const tmplCount = effectiveTmplId ? (counts[effectiveTmplId] || 0) : 0;
      const totalForIcon = rawCount + tmplCount;
      const combinedPositions = [
        ...(positionsMap[icon.id] || []),
        ...(effectiveTmplId ? (positionsMap[effectiveTmplId] || []) : []),
      ];

      return {
        icon_id: icon.id,
        label: iconLabels[icon.id] || icon.label || matchedTmpl?.label || 'パーツ',
        count: totalForIcon,
        positions: combinedPositions,
        source: 'pdf' as const,
      };
    });

    // Add standalone template-only tallies (templates not linked to any PDF icon)
    const templateKeys = Object.keys(counts).filter(k => k.startsWith('tmpl_'));
    const templateTallies = templateKeys
      .filter(k => !extractedIcons.some(ic => ic.id === k) && !replacedTmplIdSet.has(k))
      .map(k => {
        const tmplType = k.slice(5);
        const tmpl = TEMPLATE_SHAPES.find(t => t.type === tmplType);
        return {
          icon_id: k,
          label: tmpl?.label ?? tmplType,
          count: counts[k] || 0,
          positions: positionsMap[k] || [],
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
    pushHistory();
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

    pushHistory();
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
    pushHistory();
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

    pushHistory();
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

    pushHistory();
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
        const safeName = (projectNameRef.current || 'stage_layout').replace(/[\\/:*?"<>|]/g, '_').trim();
        const a = document.createElement('a');
        a.href = resp.data.download_url;
        a.download = `${safeName}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
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
      // プレビューに進む前に全ての選択状態（アイテム選択、複数選択、曲線選択、曲線アイテム選択）を確実に解除
      flushSync(() => {
        setSelectedIds([]);
        setSelectedCurveIds([]);
        setSelectedCurveItemId(null);
      });

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
          setSelectedIds([]);
          setSelectedCurveIds([]);
          setSelectedCurveItemId(null);
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
          savedNodes: previewSettingsRef.current?.sceneNodesMap?.[sc.id],
        });
      }

      // Restore active scene with clean selection state
      const origScene = allScenes.find(s => s.id === currentSceneId) || allScenes[0];
      flushSync(() => {
        setCurrentSceneId(origScene.id);
        setPlacedItems(origScene.placedItems || []);
        setCurveObjects(origScene.curveObjects || []);
        setSelectedIds([]);
        setSelectedCurveIds([]);
        setSelectedCurveItemId(null);
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
        initialPreviewSettings={previewSettings || undefined}
        onUpdatePreviewSettings={handleUpdatePreviewSettings}
        projectName={projectName}
        onUpdateProjectName={handleCommitProjectName}
        onBack={() => {
          setIsExportModalOpen(false);
          setSelectedIds([]);
          setSelectedCurveIds([]);
          setSelectedCurveItemId(null);
          onPhaseChange?.(3);
        }}
        onExport={handleExportFinalPdf}
        onExportJson={handleExportJson}
      />
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className={`flex flex-col w-full h-full overflow-hidden font-sans relative transition-colors liquid-bg ${
      isDarkMode ? 'dark text-slate-100' : 'text-slate-800'
    }`}>
      {/* Backup Size Warning Banner */}
      {backupWarning && (
        <div className="bg-amber-500/15 backdrop-blur-md border-b border-amber-400/40 text-amber-800 dark:text-amber-200 text-xs px-4 py-1.5 flex items-center justify-between gap-2 shrink-0">
          <span className="font-bold">! {backupWarning}</span>
          <button
            type="button"
            onClick={() => setBackupWarning(null)}
            className="text-amber-500 hover:text-amber-700 font-bold ml-2 shrink-0 cursor-pointer"
            title="閉じる"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {/* Apple Liquid Glass Global Service Header */}
      <header className="h-15 liquid-glass border-b flex items-center justify-between px-5 shrink-0 z-20 select-none transition-colors">
        {/* Brand / Service Title */}
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-2.5 cursor-pointer hover:opacity-85 transition-opacity group"
            onClick={handleBack}
            title="ホーム画面（PDF読込・バックアップ一覧）に戻る"
          >
            <div className="w-8.5 h-8.5 rounded-xl bg-gradient-to-br from-sky-400 via-blue-500 to-indigo-600 text-white flex items-center justify-center font-bold text-sm shadow-[0_4px_12px_rgba(0,122,255,0.35),inset_0_1px_1px_rgba(255,255,255,0.6)] select-none shrink-0">
              ♪
            </div>
            <div className="flex flex-col hidden sm:flex shrink-0">
              <span className={`font-bold text-sm tracking-tight leading-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                ステージレイアウトプランナー
              </span>
              <span className="text-[11px] font-extrabold leading-tight mt-0.5 bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-sky-400 dark:to-indigo-400 bg-clip-text text-transparent">
                StaJet
              </span>
            </div>
          </div>

          <div className={`h-5 w-px mx-1 hidden sm:block ${isDarkMode ? 'bg-white/15' : 'bg-slate-300/70'}`} />

          {/* Project Name Editable Header Field */}
          <div className="flex items-center">
            {isEditingProjectName ? (
              <input
                ref={projectNameInputRef}
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onBlur={() => handleCommitProjectName()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCommitProjectName();
                  if (e.key === 'Escape') setIsEditingProjectName(false);
                }}
                className="text-xs sm:text-sm font-bold bg-white dark:bg-slate-800 border-2 border-[#007AFF] rounded-xl px-2.5 py-1 outline-hidden shadow-xs text-slate-900 dark:text-slate-100 min-w-[140px] max-w-[240px]"
                autoFocus
                placeholder="プロジェクト名を入力"
              />
            ) : (
              <div
                onClick={() => {
                  setIsEditingProjectName(true);
                  setTimeout(() => projectNameInputRef.current?.select(), 50);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors group cursor-pointer border border-transparent hover:border-slate-300/70 dark:hover:border-white/20"
                title="クリックしてプロジェクト名を変更"
              >
                <span className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 max-w-[150px] sm:max-w-[220px] md:max-w-[300px] truncate">
                  {projectName}
                </span>
                <Edit3 className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#007AFF] transition-colors shrink-0" />
              </div>
            )}
          </div>

          <div className={`h-5 w-px mx-1.5 ${isDarkMode ? 'bg-white/15' : 'bg-slate-300/70'}`} />

          {/* Operational Tools: Undo / Redo & Zoom (Capsule Glass Controls) */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleUndo}
              disabled={!canUndo}
              className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 transition-all ${
                canUndo
                  ? 'liquid-btn text-slate-800 dark:text-slate-100 cursor-pointer'
                  : 'bg-slate-200/40 dark:bg-slate-800/40 text-slate-400 dark:text-slate-600 border border-white/30 dark:border-white/5 cursor-not-allowed'
              }`}
              title={`1手元に戻す (Ctrl+Z) ${historyRef.current.length > 0 ? `(${historyRef.current.length}件)` : ''}`}
            >
              <span>↺</span>
              <span className="hidden xl:inline">元に戻す</span>
            </button>
            <button
              onClick={handleRedo}
              disabled={!canRedo}
              className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 transition-all ${
                canRedo
                  ? 'liquid-btn text-slate-800 dark:text-slate-100 cursor-pointer'
                  : 'bg-slate-200/40 dark:bg-slate-800/40 text-slate-400 dark:text-slate-600 border border-white/30 dark:border-white/5 cursor-not-allowed'
              }`}
              title="やり直す (Ctrl+Y / Ctrl+Shift+Z)"
            >
              <span>↻</span>
              <span className="hidden xl:inline">やり直し</span>
            </button>

            <div className={`h-4 w-px mx-1 ${isDarkMode ? 'bg-white/15' : 'bg-slate-300/70'}`} />

            <div className="flex items-center liquid-btn rounded-full overflow-hidden p-0.5">
              <button
                onClick={handleZoomOut}
                className="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center transition-colors hover:bg-slate-200/60 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 cursor-pointer"
                title="縮小"
              >
                −
              </button>
              <span className="text-[11px] font-bold font-mono px-2 min-w-[3.2rem] text-center text-slate-800 dark:text-slate-100">
                {Math.round(zoomMultiplier * 100)}%
              </span>
              <button
                onClick={handleZoomIn}
                className="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center transition-colors hover:bg-slate-200/60 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 cursor-pointer"
                title="拡大"
              >
                ＋
              </button>
            </div>
          </div>
        </div>

        {/* Center: Liquid Glass Pill Stepper (Numbered circles matching design) */}
        <div className="hidden lg:flex items-center gap-1.5">
          <div className="flex items-center gap-1 px-2 py-1 liquid-segment-track rounded-full text-xs">
            {/* Step 1 */}
            <div className="flex items-center gap-1.5 px-2 py-0.5 text-slate-600 dark:text-slate-300 font-medium">
              <span className="w-4 h-4 rounded-full bg-slate-300/80 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-bold flex items-center justify-center">1</span>
              <span>PDF読込</span>
            </div>
            <span className="text-slate-300 dark:text-slate-600 mx-0.5">›</span>
            {/* Step 2 */}
            <div className="flex items-center gap-1.5 px-2 py-0.5 text-slate-600 dark:text-slate-300 font-medium">
              <span className="w-4 h-4 rounded-full bg-slate-300/80 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-bold flex items-center justify-center">2</span>
              <span>領域設定</span>
            </div>
            <span className="text-slate-300 dark:text-slate-600 mx-0.5">›</span>
            {/* Step 3 (Active) */}
            <div className="flex items-center gap-1.5 font-bold text-[#007AFF] dark:text-sky-300 bg-white/95 dark:bg-slate-800/95 px-3 py-1 rounded-full shadow-[0_2px_8px_rgba(15,23,42,0.08),inset_0_1px_0.5px_rgba(255,255,255,0.9)]">
              <span className="w-4 h-4 rounded-full bg-gradient-to-b from-sky-400 to-[#007AFF] text-white text-[10px] font-bold flex items-center justify-center shadow-2xs">3</span>
              <span>ステージ配置</span>
            </div>
            <span className="text-slate-300 dark:text-slate-600 mx-0.5">›</span>
            {/* Step 4 */}
            <div className="flex items-center gap-1.5 px-2 py-0.5 text-slate-400 dark:text-slate-500 font-medium">
              <span className="w-4 h-4 rounded-full bg-slate-300/80 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-bold flex items-center justify-center">4</span>
              <span>プレビュー・出力</span>
            </div>
          </div>
        </div>

        {/* Right Actions: Liquid Glass Capsule Buttons */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleExportJson}
            className="px-3.5 py-1.5 rounded-full text-xs font-bold liquid-btn text-slate-800 dark:text-slate-100 flex items-center gap-1.5 cursor-pointer"
            title="現在の全場面・配置データをJSONファイルとしてダウンロード保存します"
          >
            <span>↓</span>
            <span>JSON保存</span>
          </button>
          <button
            onClick={handleGoToExport}
            disabled={isPreparingExport}
            className={`text-white text-xs sm:text-sm font-bold px-5 py-2 rounded-full transition-all flex items-center gap-2 cursor-pointer ${
              isPreparingExport
                ? 'bg-blue-400/70 cursor-not-allowed'
                : 'liquid-btn-primary'
            }`}
          >
            {isPreparingExport ? (
              <>
                <span className="animate-spin text-sm">⏳</span>
                <span>プレビュー生成中...</span>
              </>
            ) : (
              <>
                <span>次へ進む (出力プレビュー)</span>
                <span>→</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Loading Overlay when generating multi-scene export */}
      {isPreparingExport && (
        <div className="fixed inset-0 bg-slate-950/45 backdrop-blur-md z-50 flex flex-col items-center justify-center gap-3">
          <div className="liquid-glass-heavy p-8 rounded-3xl flex flex-col items-center gap-3">
            <div className="w-12 h-12 border-3 border-[#007AFF]/20 border-t-[#007AFF] rounded-full animate-spin" />
            <p className="text-slate-800 dark:text-white text-sm font-bold">全場面の出力プレビューを一括生成しています...</p>
          </div>
        </div>
      )}

      {/* Horizontal Palette (Liquid Glass) */}
      <div className="h-[104px] liquid-glass border-b flex items-center shrink-0 z-10 px-3 relative select-none transition-colors">
        {/* Active Bezier Floating Tag */}
        {selectedCurveId && (
          <div
            className="absolute left-36 top-full z-30 flex items-center gap-2 px-3.5 py-1 bg-gradient-to-r from-indigo-500/90 via-purple-500/90 to-fuchsia-500/90 backdrop-blur-xl text-white rounded-b-2xl shadow-[0_8px_20px_rgba(168,85,247,0.35),inset_0_1px_0.5px_rgba(255,255,255,0.4)] text-[10px] font-bold border border-t-0 border-white/30 select-none animate-in fade-in slide-in-from-top-1"
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
              className="ml-1 bg-white/20 hover:bg-white/35 active:bg-white/40 text-white px-2 py-0.5 rounded-full text-[9px] font-semibold transition-colors flex items-center gap-0.5 cursor-pointer"
              title="通常配置モードに戻る"
            >
              <span>解除</span>
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Tab Switcher (Segmented Glass Track) */}
        <div className={`flex flex-col h-[82px] w-25 shrink-0 p-1 rounded-2xl liquid-segment-track gap-1 mr-2`}>
          <button
            onClick={() => setPaletteTab('pdf')}
            className={`flex-1 text-xs font-bold rounded-xl flex items-center justify-center gap-1 transition-all duration-200 cursor-pointer ${
              paletteTab === 'pdf'
                ? 'bg-white/95 dark:bg-slate-800/95 text-[#007AFF] dark:text-sky-400 shadow-[0_2px_8px_rgba(15,23,42,0.08),inset_0_1px_0.5px_rgba(255,255,255,0.9)]'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5 inline mr-0.5" /> PDF抽出
          </button>
          <button
            onClick={() => setPaletteTab('template')}
            className={`flex-1 text-xs font-bold rounded-xl flex items-center justify-center gap-1 transition-all duration-200 cursor-pointer ${
              paletteTab === 'template'
                ? 'bg-white/95 dark:bg-slate-800/95 text-[#007AFF] dark:text-sky-400 shadow-[0_2px_8px_rgba(15,23,42,0.08),inset_0_1px_0.5px_rgba(255,255,255,0.9)]'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Shapes className="w-3.5 h-3.5 inline mr-0.5" /> テンプレ
          </button>
        </div>

        {/* Scroll Left Button */}
        <button
          type="button"
          onClick={() => scrollPalette('left')}
          className="h-14 w-7 rounded-full liquid-btn flex items-center justify-center transition-all shrink-0 text-slate-500 dark:text-slate-300 hover:text-[#007AFF] cursor-pointer"
          title="左へスクロール"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* Scrollable Container */}
        <div
          ref={paletteScrollRef}
          onWheel={(e) => {
            if (e.deltaY !== 0) {
              e.currentTarget.scrollLeft += e.deltaY;
            }
          }}
          className={`flex-1 h-full overflow-x-auto overflow-y-hidden flex items-center gap-2 px-2.5 py-1.5 scroll-smooth transition-all rounded-2xl mx-1 ${
            selectedCurveId
              ? (isDarkMode ? 'bg-purple-950/35 ring-1 ring-inset ring-purple-500/60' : 'bg-purple-500/10 ring-1 ring-inset ring-purple-300/80')
              : ''
          }`}
        >
          {/* Bezier Curve Creator Button */}
          <div className={`flex items-center gap-1 border-r pr-2.5 mr-1 shrink-0 h-15 ${isDarkMode ? 'border-white/12' : 'border-slate-300/60'}`}>
            <button
              type="button"
              onClick={() => handleAddEmptyCurve()}
              className={`w-15 h-[72px] py-1.5 px-1 rounded-2xl transition-all duration-200 flex flex-col items-center justify-between shrink-0 group cursor-pointer ${
                selectedCurveId
                  ? (isDarkMode ? 'bg-purple-900/70 border border-purple-400 text-purple-200 shadow-md' : 'bg-purple-100/90 border border-purple-400 text-purple-900 shadow-md')
                  : 'liquid-card hover:bg-white/90 dark:hover:bg-slate-700/80 hover:border-purple-400/60 hover:-translate-y-0.5 text-slate-700 dark:text-slate-200'
              }`}
              title="新しいベジェ曲線（何も置かれていない空の曲線）を追加します"
            >
              <div className={`w-8.5 h-8.5 flex items-center justify-center rounded-xl transition-all group-hover:scale-105 ${
                isDarkMode ? 'bg-white text-purple-600 shadow-xs p-1' : 'text-purple-600 dark:text-purple-400'
              }`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
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
              {visibleTemplates.map(tmpl => (
                <div
                  key={tmpl.id || tmpl.type}
                  draggable={!selectedCurveId}
                  onDragStart={e => {
                    e.dataTransfer.setData('iconId', tmpl.id || `tmpl_${tmpl.type}`);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => handlePaletteItemClick(tmpl.id || `tmpl_${tmpl.type}`)}
                  className={`flex flex-col items-center justify-between w-16 h-[74px] py-1.5 px-1 rounded-2xl shrink-0 transition-all duration-200 group relative cursor-pointer active:scale-95 ${
                    selectedCurveId
                      ? (isDarkMode ? 'bg-purple-950/60 hover:bg-purple-900/80 border border-purple-500/70' : 'bg-purple-50/70 hover:bg-purple-100/90 border border-purple-300/80 hover:border-purple-400')
                      : 'liquid-card hover:bg-white/90 dark:hover:bg-slate-700/80 hover:border-blue-400/60 hover:-translate-y-0.5 cursor-grab active:cursor-grabbing'
                  }`}
                  title={selectedCurveId ? `「${tmpl.label}」をベジェ曲線に追加` : tmpl.label}
                >
                  {selectedCurveId && (
                    <span className="absolute -top-1.5 right-0.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-[8px] font-bold px-1.5 rounded-full shadow-xs">
                      +追加
                    </span>
                  )}
                  <div className={`w-8.5 h-8.5 flex items-center justify-center pointer-events-none mt-0.5 rounded-xl transition-all ${
                    isDarkMode ? 'bg-white shadow-xs p-1' : ''
                  }`}>
                    <img src={getTemplateDataUrl(tmpl)} alt={tmpl.label} className="max-w-full max-h-full object-contain" />
                  </div>
                  <span className={`text-[10px] w-full text-center leading-tight line-clamp-2 px-0.5 font-medium ${
                    selectedCurveId
                      ? (isDarkMode ? 'text-purple-300 group-hover:font-bold' : 'text-purple-900 group-hover:font-bold')
                      : (isDarkMode ? 'text-slate-200 group-hover:text-sky-400' : 'text-slate-700 group-hover:text-[#007AFF]')
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
                extractedIcons.map((icon) => {
                  const tmplId = effectiveTemplateReplacements?.[icon.id];
                  const matchedTmpl = tmplId
                    ? TEMPLATE_SHAPES.find(t => t.id === tmplId || t.type === tmplId.replace(/^tmpl_/, ''))
                    : null;

                  if (matchedTmpl) {
                    // テンプレに置き換えた場合: 元の抽出画像は非表示にし、代わりにテンプレをPDF抽出欄に表示
                    const effectiveTmplId = matchedTmpl.id || `tmpl_${matchedTmpl.type}`;
                    const label = matchedTmpl.label;
                    return (
                      <div
                        key={icon.id}
                        draggable={!selectedCurveId}
                        onDragStart={e => {
                          e.dataTransfer.setData('iconId', effectiveTmplId);
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => handlePaletteItemClick(effectiveTmplId)}
                        className={`flex flex-col items-center justify-between w-16 h-[74px] py-1.5 px-1 rounded-2xl shrink-0 transition-all duration-200 group relative cursor-pointer active:scale-95 ${
                          selectedCurveId
                            ? (isDarkMode ? 'bg-purple-950/60 hover:bg-purple-900/80 ring-1 ring-purple-500/50' : 'bg-purple-50/70 hover:bg-purple-100/90 ring-1 ring-purple-300/60')
                            : 'liquid-glass-card-accent cursor-grab active:cursor-grabbing'
                        }`}
                        title={selectedCurveId ? `「${label}」をベジェ曲線に追加` : `[テンプレ置換済] ${label}`}
                      >
                        {/* Top Badges: Merged Capsule when both Template & +Add exist, or Single Pill */}
                        {selectedCurveId ? (
                          <div className="absolute -top-2 left-1/2 -translate-x-1/2 flex items-center shadow-xs rounded-full overflow-hidden whitespace-nowrap z-10">
                            <span className="bg-gradient-to-r from-lime-500 to-lime-600 text-white text-[7.5px] font-bold px-1.5 py-0.5 leading-none">
                              テンプレ
                            </span>
                            <span className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-[7.5px] font-bold px-1.5 py-0.5 border-l border-white/40 leading-none">
                              +追加
                            </span>
                          </div>
                        ) : (
                          <span className="absolute -top-1.5 -left-1 bg-gradient-to-r from-lime-500 to-lime-600 text-white text-[7.5px] font-bold px-1.5 py-0.5 rounded-full shadow-xs z-10 leading-none">
                            テンプレ
                          </span>
                        )}
                        <div className={`w-8.5 h-8.5 flex items-center justify-center pointer-events-none mt-0.5 rounded-xl transition-all ${
                          isDarkMode ? 'bg-white shadow-xs p-1' : ''
                        }`}>
                          <img
                            src={getTemplateDataUrl(matchedTmpl)}
                            alt={label}
                            className="max-w-full max-h-full object-contain"
                          />
                        </div>
                        <span className={`text-[10px] w-full text-center leading-tight line-clamp-2 px-0.5 font-medium ${
                          selectedCurveId
                            ? (isDarkMode ? 'text-purple-300 group-hover:font-bold' : 'text-purple-900 group-hover:font-bold')
                            : (isDarkMode ? 'text-lime-300 group-hover:text-lime-200' : 'text-lime-900 group-hover:text-lime-950')
                        }`}>
                          {label}
                        </span>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={icon.id}
                      draggable={!selectedCurveId}
                      onDragStart={e => { e.dataTransfer.setData('iconId', icon.id); e.dataTransfer.effectAllowed = 'copy'; }}
                      onClick={() => handlePaletteItemClick(icon.id)}
                      className={`flex flex-col items-center justify-between w-16 h-[74px] py-1.5 px-1 rounded-2xl shrink-0 transition-all duration-200 group relative cursor-pointer active:scale-95 ${
                        selectedCurveId
                          ? (isDarkMode ? 'bg-purple-950/60 hover:bg-purple-900/80 border border-purple-500/70' : 'bg-purple-50/70 hover:bg-purple-100/90 border border-purple-300/80 hover:border-purple-400')
                          : 'liquid-card hover:bg-white/95 dark:hover:bg-slate-700/85 hover:border-blue-400/60 hover:-translate-y-0.5 cursor-grab active:cursor-grabbing'
                      }`}
                      title={selectedCurveId ? `「${iconLabels[icon.id] || icon.label || 'パーツ'}」をベジェ曲線に追加` : (iconLabels[icon.id] || icon.label || 'パーツ')}
                    >
                      {selectedCurveId && (
                        <span className="absolute -top-1.5 right-0.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-[8px] font-bold px-1.5 rounded-full shadow-xs">
                          +追加
                        </span>
                      )}
                      <div className={`w-8.5 h-8.5 flex items-center justify-center pointer-events-none mt-0.5 rounded-xl transition-all ${
                        isDarkMode ? 'bg-white shadow-xs p-1' : ''
                      }`}>
                        <img src={icon.url} alt={icon.id} className="max-w-full max-h-full object-contain" />
                      </div>
                      <span className={`text-[10px] w-full text-center leading-tight line-clamp-2 px-0.5 font-medium ${
                        selectedCurveId
                          ? (isDarkMode ? 'text-purple-300 group-hover:font-bold' : 'text-purple-900 group-hover:font-bold')
                          : (isDarkMode ? 'text-slate-200 group-hover:text-sky-400' : 'text-slate-700 group-hover:text-[#007AFF]')
                      }`}>
                        {iconLabels[icon.id] || icon.label || 'パーツ'}
                      </span>
                    </div>
                  );
                })
              )}
              <div className={`border-l pl-2.5 ml-1 shrink-0 h-12 flex items-center gap-2 ${isDarkMode ? 'border-white/12' : 'border-slate-300/60'}`}>
                {onOpenTemplateModal && (
                  <button
                    onClick={onOpenTemplateModal}
                    className="liquid-btn text-[11px] font-bold px-3 py-2 rounded-full transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer text-emerald-700 dark:text-emerald-300"
                    title="標準テンプレートへの置き換え設定を開きます"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> テンプレ置換
                  </button>
                )}
                <button
                  onClick={() => {
                    if (onOpenIconAdjustModal) {
                      onOpenIconAdjustModal();
                    } else {
                      setIsAdjusting(true);
                    }
                  }}
                  className="text-[11px] font-bold px-3 py-2 rounded-full liquid-btn text-slate-700 dark:text-slate-200 whitespace-nowrap flex items-center gap-1.5 cursor-pointer"
                  title="パーツアイコンの切り抜き枠を手動調整します"
                >
                  <Settings className="w-3.5 h-3.5" /> パーツ枠調整
                </button>
                {onReAdjustBackground && (
                  <button
                    type="button"
                    onClick={onReAdjustBackground}
                    className="text-[11px] font-bold px-3 py-2 rounded-full liquid-btn text-blue-600 dark:text-sky-300 whitespace-nowrap flex items-center gap-1.5 cursor-pointer"
                    title="ステージ図面の切り出し枠を再設定します"
                  >
                    <Crop className="w-3.5 h-3.5" /> 図面枠調整
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Scroll Right Button */}
        <button
          type="button"
          onClick={() => scrollPalette('right')}
          className="h-14 w-7 rounded-full liquid-btn flex items-center justify-center transition-all shrink-0 text-slate-500 dark:text-slate-300 hover:text-[#007AFF] cursor-pointer"
          title="右へスクロール"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {isAdjusting && iconsRegionUrl && (
        <IconAdjustModal
          iconsRegionUrl={iconsRegionUrl}
          extractedIcons={extractedIcons}
          fileId={fileId!}
          iconLabels={iconLabels}
          onBack={() => setIsAdjusting(false)}
          onClose={() => setIsAdjusting(false)}
          onSave={(newIcons, newLabels) => {
            const cleanLabels: Record<string, string> = {};
            newIcons.forEach((ic, idx) => {
              cleanLabels[ic.id] = newLabels?.[ic.id] || ic.label || `パーツ ${idx + 1}`;
            });
            setIconLabels(cleanLabels);
            iconLabelsRef.current = cleanLabels;
            saveBackup({ ...buildSnapshot(), extractedIcons: newIcons, iconLabels: cleanLabels });
            onIconsUpdated(newIcons, cleanLabels);
            setIsAdjusting(false);
          }}
        />
      )}

      {/* Workspace Body */}
      <div className="flex-1 flex min-h-0 relative overflow-hidden">
        {/* Dimmed Overlay when a drawer submenu is open */}
        <div 
          onClick={() => setDrawerSubmenu(null)}
          className={`absolute inset-0 bg-slate-950/25 backdrop-blur-[2px] z-20 transition-opacity duration-300 ${
            drawerSubmenu !== null ? 'opacity-100 pointer-events-auto cursor-pointer' : 'opacity-0 pointer-events-none'
          }`}
        />

        {/* Left Navigation Container (Liquid Glass Spatial Dock) */}
        <aside className="relative z-30 flex h-full shrink-0">
          {/* Fixed-width Liquid Glass Icon Dock (w-14) */}
          <div className="w-14 h-full liquid-glass border-r flex flex-col items-center shrink-0 select-none py-3 gap-1.5">
            {/* House Icon: Scenes Management Item */}
            <button
              type="button"
              onClick={() => setDrawerSubmenu(prev => (prev === 'scenes' ? null : 'scenes'))}
              className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all duration-200 cursor-pointer ${
                drawerSubmenu === 'scenes'
                  ? 'liquid-btn-primary scale-105'
                  : 'liquid-btn hover:scale-105'
              }`}
              title="場面一覧 (シーン切替)"
            >
              <Home className="w-5 h-5" />
            </button>

            {/* Display & Snap Settings Item */}
            <button
              type="button"
              onClick={() => setDrawerSubmenu(prev => (prev === 'settings' ? null : 'settings'))}
              className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all duration-200 cursor-pointer ${
                drawerSubmenu === 'settings'
                  ? 'liquid-btn-primary scale-105'
                  : 'liquid-btn hover:scale-105'
              }`}
              title="表示・スナップ設定"
            >
              <Settings className="w-5 h-5" />
            </button>

            {/* Floating Object Control Panel Toggle (Above Dark Mode) */}
            <button
              id="panel-toggle-btn"
              type="button"
              onClick={() => setShowFloatingPanel(prev => !prev)}
              className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all duration-200 mt-auto cursor-pointer ${
                showFloatingPanel
                  ? 'bg-gradient-to-br from-sky-400/25 to-blue-600/25 text-[#007AFF] dark:text-sky-300 border border-blue-400/50 shadow-[0_4px_12px_rgba(0,122,255,0.2),inset_0_1px_1px_rgba(255,255,255,0.7)] scale-105'
                  : 'liquid-btn opacity-65 hover:opacity-100 hover:scale-105'
              } active:scale-90`}
              title={showFloatingPanel ? '操作パネルを非表示' : '操作パネルを表示'}
            >
              <Sliders className="w-5 h-5" />
            </button>

            {/* Dark Mode Item (Bottom) */}
            <button
              type="button"
              onClick={toggleDarkMode}
              className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all duration-200 cursor-pointer ${
                isDarkMode
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-400/40 shadow-[0_4px_12px_rgba(245,158,11,0.2)] hover:scale-105'
                  : 'liquid-btn hover:scale-105'
              }`}
              title={isDarkMode ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
            >
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>

          {/* 1. Scenes List Sub-Panel: Opens from House Icon (Liquid Glass Flyout) */}
          {drawerSubmenu === 'scenes' && (
            <div className={`w-80 h-full border-r flex flex-col p-4 animate-in fade-in slide-in-from-left-2 duration-200 shrink-0 ${
              isDarkMode ? 'liquid-glass-heavy-dark text-slate-100' : 'liquid-glass-heavy text-slate-800'
            }`}>
              <div className={`flex items-center justify-between pb-3 border-b mb-3 ${isDarkMode ? 'border-white/12' : 'border-slate-300/60'}`}>
                <h3 className={`font-bold text-sm flex items-center gap-1.5 ${isDarkMode ? 'text-slate-100' : 'text-slate-800'}`}>
                  <Layers className="w-4 h-4 text-[#007AFF]" /> 場面一覧 (シーン切替)
                </h3>
                <button
                  type="button"
                  onClick={() => setDrawerSubmenu(null)}
                  className="rounded-full w-6 h-6 flex items-center justify-center liquid-btn text-xs font-bold text-slate-500 dark:text-slate-300 cursor-pointer"
                  title="閉じる"
                >
                  <X className="w-3.5 h-3.5" />
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
                      className={`group relative p-3 rounded-2xl border transition-all cursor-pointer ${
                        isActive
                          ? (isDarkMode ? 'bg-[#007AFF]/20 border-[#007AFF] shadow-sm ring-1 ring-[#007AFF]/50' : 'bg-[#007AFF]/10 border-[#007AFF]/50 shadow-sm ring-1 ring-[#007AFF]/30')
                          : 'liquid-card'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span className={`text-xs shrink-0 ${isActive ? 'text-[#007AFF] font-bold' : (isDarkMode ? 'text-slate-500' : 'text-slate-400')}`}>
                            {isActive ? '●' : '○'}
                          </span>
                          <input
                            type="text"
                            value={scene.name}
                            onChange={(e) => handleRenameScene(scene.id, e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            className={`flex-1 text-xs font-bold px-2 py-0.5 rounded-lg border focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 transition-colors ${
                              isActive
                                ? (isDarkMode ? 'bg-slate-800/80 border-[#007AFF]/50 text-blue-200 font-bold' : 'bg-white/90 border-[#007AFF]/30 text-[#007AFF] font-bold')
                                : (isDarkMode ? 'bg-transparent border-transparent hover:border-slate-600 text-slate-200' : 'bg-transparent border-transparent hover:border-slate-200 text-slate-800')
                            }`}
                            placeholder="場面名を入力..."
                          />
                        </div>

                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                          isDarkMode ? 'text-slate-300 bg-slate-800/80' : 'text-slate-500 bg-white/80 border border-white/60'
                        }`}>
                          {totalCount}個
                        </span>
                      </div>

                      {/* Action buttons bar */}
                      <div className={`flex items-center justify-end gap-1 mt-2 pt-1.5 border-t text-[11px] ${
                        isDarkMode ? 'border-white/10 text-slate-400' : 'border-slate-200/60 text-slate-500'
                      }`}>
                        {/* Move Up */}
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveScene(scene.id, 'up');
                          }}
                          className={`p-1 rounded-lg disabled:opacity-30 disabled:hover:bg-transparent ${
                            isDarkMode ? 'hover:bg-white/10' : 'hover:bg-white/80'
                          }`}
                          title="上に移動"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>

                        {/* Move Down */}
                        <button
                          type="button"
                          disabled={idx === scenes.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveScene(scene.id, 'down');
                          }}
                          className={`p-1 rounded-lg disabled:opacity-30 disabled:hover:bg-transparent ${
                            isDarkMode ? 'hover:bg-white/10' : 'hover:bg-white/80'
                          }`}
                          title="下に移動"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>

                        {/* Duplicate */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDuplicateScene(scene.id);
                          }}
                          className={`px-2 py-0.5 rounded-lg flex items-center gap-1 ${
                            isDarkMode ? 'hover:bg-white/10 hover:text-slate-200' : 'hover:bg-white/80 hover:text-slate-700'
                          }`}
                          title="この場面を複製"
                        >
                          <Copy className="w-3 h-3" /> 複製
                        </button>

                        {/* Delete */}
                        <button
                          type="button"
                          disabled={scenes.length <= 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteScene(scene.id);
                          }}
                          className={`px-2 py-0.5 rounded-lg flex items-center gap-1 disabled:opacity-30 disabled:hover:bg-transparent ${
                            isDarkMode ? 'hover:bg-rose-950/50 hover:text-rose-400 text-rose-400' : 'hover:bg-rose-50 hover:text-rose-600 text-rose-500'
                          }`}
                          title={scenes.length <= 1 ? '最後のシートは削除できません' : 'この場面を削除'}
                        >
                          <Trash2 className="w-3 h-3" /> 削除
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Add New Scene Button */}
              <div className={`pt-3 mt-auto border-t ${isDarkMode ? 'border-white/10' : 'border-slate-200/60'}`}>
                <button
                  type="button"
                  onClick={handleAddScene}
                  className="liquid-btn-primary w-full py-2.5 px-3 rounded-full text-white font-bold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
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
              className={`w-80 h-full border-r flex flex-col p-4 animate-in fade-in slide-in-from-left-2 duration-200 shrink-0 ${
                isDarkMode ? 'liquid-glass-heavy-dark text-slate-100' : 'liquid-glass-heavy text-slate-800'
              }`}
            >
              <div className={`flex items-center justify-between pb-3 border-b mb-4 ${isDarkMode ? 'border-white/10' : 'border-slate-200/60'}`}>
                <h3 className={`font-bold text-sm flex items-center gap-1.5 tracking-tight ${isDarkMode ? 'text-slate-100' : 'text-slate-800'}`}>
                  <Settings className="w-4 h-4 text-[#007AFF]" /> 表示・スナップ設定
                </h3>
                <button
                  type="button"
                  onClick={() => setDrawerSubmenu(null)}
                  className={`rounded-full w-6 h-6 flex items-center justify-center transition-colors text-xs font-bold cursor-pointer ${
                    isDarkMode ? 'text-slate-400 hover:text-slate-200 hover:bg-white/10' : 'text-slate-400 hover:text-slate-600 hover:bg-black/5'
                  }`}
                  title="閉じる"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                {/* Grid Settings */}
                <div className="space-y-2">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">グリッド表示</span>
                  <label className="liquid-card flex items-center justify-between p-2.5 rounded-2xl cursor-pointer transition-colors">
                    <span className={`text-xs font-semibold ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>グリッド (方眼) 表示</span>
                    <input
                      type="checkbox"
                      checked={snapSettings.showGrid}
                      onChange={(e) => setSnapSettings(prev => ({ ...prev, showGrid: e.target.checked }))}
                      className="w-4 h-4 text-[#007AFF] rounded focus:ring-[#007AFF] cursor-pointer"
                    />
                  </label>

                  <div className="liquid-card p-3 rounded-2xl space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className={`font-medium ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>1マスサイズ (1m定義)</span>
                      <span className={`font-bold px-2.5 py-0.5 rounded-full border ${
                        isDarkMode ? 'text-slate-100 bg-slate-800/80 border-white/10' : 'text-slate-800 bg-white/80 border-slate-200/80'
                      }`}>{snapSettings.gridSize} px</span>
                    </div>
                    <input
                      type="range"
                      min="20"
                      max="300"
                      step="5"
                      value={snapSettings.gridSize}
                      onChange={(e) => setSnapSettings(prev => ({ ...prev, gridSize: parseInt(e.target.value, 10) }))}
                      className="w-full h-1.5 bg-slate-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer accent-[#007AFF]"
                    />

                    {/* Measure Scale Button (2 points distance defining meters) */}
                    <button
                      type="button"
                      onClick={() => {
                        setIsMeasuringScale(true);
                        setDrawerSubmenu(null);
                      }}
                      className={`w-full py-2 px-3 rounded-full border text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer ${
                        isDarkMode
                          ? 'bg-indigo-950/60 hover:bg-indigo-900/60 text-indigo-300 border-indigo-500/50'
                          : 'bg-indigo-50/80 hover:bg-indigo-100/90 text-indigo-700 border-indigo-200/80'
                      }`}
                      title="キャンバス上の2点をクリックして、その長さを何メートルにするか定義します"
                    >
                      <Ruler className="w-3.5 h-3.5" />
                      <span>2点間クリックで1mを定義</span>
                    </button>
                  </div>
                </div>

                {/* Center Marker Settings */}
                <div className={`space-y-2 pt-2 border-t ${isDarkMode ? 'border-white/10' : 'border-slate-200/50'}`}>
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">基準点 (ピンク)</span>
                  <label className="liquid-card flex items-center justify-between p-2.5 rounded-2xl cursor-pointer transition-colors">
                    <span className={`text-xs font-semibold flex items-center gap-1.5 ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>
                      <span className="w-2.5 h-2.5 rounded-full bg-[#ff2d55] shadow-xs" />
                      基準点マーカー表示
                    </span>
                    <input
                      type="checkbox"
                      checked={snapSettings.showCenterMarker}
                      onChange={(e) => setSnapSettings(prev => ({ ...prev, showCenterMarker: e.target.checked }))}
                      className="w-4 h-4 text-[#007AFF] rounded focus:ring-[#007AFF] cursor-pointer"
                    />
                  </label>

                  <div className="liquid-card p-3 rounded-2xl space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className={`font-medium ${isDarkMode ? 'text-slate-300' : 'text-slate-500'}`}>基準点マーカー位置</span>
                      <span className={`font-mono font-bold px-2.5 py-0.5 rounded-full border ${
                        isDarkMode ? 'text-slate-200 bg-slate-800/80 border-white/10' : 'text-slate-700 bg-white/80 border-slate-200/80'
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
                      className={`w-full text-xs font-semibold py-2 px-3 rounded-full transition-all flex items-center justify-center gap-2 cursor-pointer ${
                        isMovingCenter
                          ? 'liquid-btn-primary text-white ring-2 ring-[#007AFF]/30'
                          : 'liquid-btn text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      {isMovingCenter ? (
                        <>
                          <span className="w-2 h-2 rounded-full bg-white animate-ping" />
                          ✓ 基準点の移動を完了
                        </>
                      ) : (
                        <>
                          <span>◎</span>
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
                      className="liquid-btn w-full text-xs font-semibold py-1.5 rounded-full transition-colors text-slate-700 dark:text-slate-200 cursor-pointer"
                    >
                      ⊙ 基準点を画像中央 (0, 0) に戻す
                    </button>
                  </div>
                </div>

                {/* Snapping Options */}
                <div className={`space-y-2 pt-2 border-t ${isDarkMode ? 'border-white/10' : 'border-slate-200/50'}`}>
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">スナップ (吸着) 設定</span>
                  
                  <label className="liquid-card flex items-center justify-between p-2.5 rounded-2xl cursor-pointer transition-colors">
                    <div className="flex flex-col">
                      <span className={`text-xs font-semibold ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>基準点・中心軸スナップ</span>
                      <span className="text-[10px] text-slate-400">中央揃えのガイド線が吸着表示</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={snapSettings.snapToCenter}
                      onChange={(e) => setSnapSettings(prev => ({ ...prev, snapToCenter: e.target.checked }))}
                      className="w-4 h-4 text-[#007AFF] rounded focus:ring-[#007AFF] cursor-pointer"
                    />
                  </label>

                  <label className="liquid-card flex items-center justify-between p-2.5 rounded-2xl cursor-pointer transition-colors">
                    <div className="flex flex-col pr-2">
                      <span className={`text-xs font-semibold ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>グリッドスナップ</span>
                      <span className="text-[10px] leading-tight text-slate-400">
                        方眼の目盛りに合わせて吸着（CtrlまたはCommandキーを押しながらドラッグでも有効）
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={snapSettings.snapToGrid}
                      onChange={(e) => setSnapSettings(prev => ({ ...prev, snapToGrid: e.target.checked }))}
                      className="w-4 h-4 text-[#007AFF] rounded focus:ring-[#007AFF] cursor-pointer shrink-0"
                    />
                  </label>

                  <label className="liquid-card flex items-center justify-between p-2.5 rounded-2xl cursor-pointer transition-colors">
                    <div className="flex flex-col">
                      <span className={`text-xs font-semibold ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>回転角度スナップ</span>
                      <span className="text-[10px] text-slate-400">45°/90°刻みで自動スナップ</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={snapSettings.snapAngle}
                      onChange={(e) => setSnapSettings(prev => ({ ...prev, snapAngle: e.target.checked }))}
                      className="w-4 h-4 text-[#007AFF] rounded focus:ring-[#007AFF] cursor-pointer"
                    />
                  </label>
                </div>

                {/* Stage Background Crop Re-adjust */}
                {onReAdjustBackground && (
                  <div className={`pt-3 border-t ${isDarkMode ? 'border-white/10' : 'border-slate-200/50'}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setDrawerSubmenu(null);
                        onReAdjustBackground();
                      }}
                      className="liquid-btn w-full text-xs font-semibold py-2 px-3 rounded-full transition-all flex items-center justify-center gap-2 cursor-pointer text-blue-600 dark:text-sky-400"
                    >
                      <Crop className="w-4 h-4" />
                      <span>ステージ図面枠を手動で再調整</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>

        {/* Center Stage Canvas & Floating Object Control Panel */}
        <div className="flex-1 relative flex overflow-hidden">
          <StageCanvas
            ref={stageCanvasRef}
            backgroundUrl={backgroundUrl}
            extractedIcons={extractedIcons}
            templateReplacements={effectiveTemplateReplacements}
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
            onDragStartAction={handleDragStartAction}
            onDragEndAction={handleDragEndAction}
            onNudgeItems={handleNudgeItems}
            onNudgeCurves={handleNudgeCurves}
            onAddItem={handleAddItem}
            onDeleteItem={handleDeleteItem}
            onDeleteCurveItem={handleDeleteCurveItem}
            onDeleteSelected={handleDeleteSelected}
            onDuplicateItem={handleDuplicateItem}
            onDuplicateSelected={handleDuplicateSelected}
            onCopySelected={handleCopySelected}
            onPaste={handlePaste}
            onUpdateCenterOffset={handleUpdateCenterOffset}
            onMoveCurveItemOrder={handleMoveCurveItemOrder}
            isMovingCenter={isMovingCenter}
            onExitMoveCenter={() => {
              setIsMovingCenter(false);
              setSnapSettings(s => ({ ...s, showCenterMarker: false }));
            }}
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
            isCtrlPointSnapped={isCtrlPointSnapped}
            isCurveMoving={isCurveMoving}
            onOpenPercussionLabelModal={setPercLabelModalTarget}
          />

        </div>

        {/* Mobile Dimmed Backdrop for Right Panel */}
        {showMobileRightPanel && (
          <div
            onClick={() => setShowMobileRightPanel(false)}
            className="md:hidden fixed inset-0 bg-slate-950/40 backdrop-blur-[2px] z-40 animate-in fade-in duration-200"
          />
        )}
        
        {/* Right Panel: Tally / Inspector (Responsive Slide Drawer on Mobile, Fixed on Desktop) */}
        <aside
          className={`h-full shrink-0 z-40 transition-transform duration-200 ease-out md:translate-x-0 ${
            showMobileRightPanel
              ? 'fixed right-0 top-0 bottom-0 shadow-2xl translate-x-0 flex'
              : 'hidden md:flex'
          }`}
        >
          {(selectedIds.length + selectedCurveIds.length) > 0 ? (
            <ItemInspector
              key={(selectedIds.length + selectedCurveIds.length) > 1
                ? `multi-inspect-${selectedIds.length + selectedCurveIds.length}`
                : (selectedId ? `item-${selectedId}` : (selectedCurveId ? `curve-${selectedCurveId}` : 'single'))}
              selectedItem={placedItems.find(i => i.id === selectedId) || null}
              selectedCurve={curveObjects.find(c => c.id === selectedCurveId) || null}
              selectedCurveItemId={selectedCurveItemId}
              onSelectCurveItem={setSelectedCurveItemId}
              onMoveCurveItemOrder={handleMoveCurveItemOrder}
              onDeleteCurveItem={handleDeleteCurveItem}
              selectedCount={selectedIds.length + selectedCurveIds.length}
              centerPos={stageCanvasRef.current?.getEffectiveCenter()}
              onUpdateItem={handleUpdateItem}
              onUpdateCurve={handleUpdateCurve}
              onDuplicateItem={handleDuplicateItem}
              onDuplicateCurve={handleDuplicateCurve}
              onDuplicateSelected={handleDuplicateSelected}
              onDeleteItem={handleDeleteItem}
              onDeleteCurve={handleDeleteCurve}
              onDeleteSelected={handleDeleteSelected}
              onUpdateAllOfType={handleUpdateAllOfType}
              onTogglePin={handleTogglePinSelected}
              onMoveOrder={handleMoveOrder}
              onAlign={handleAlign}
              onOpenPercussionLabelModal={setPercLabelModalTarget}
              templateReplacements={effectiveTemplateReplacements}
            />
          ) : (
            <div
              key="tally-table-panel"
              className="w-64 shrink-0 h-full liquid-glass border-l overflow-hidden flex flex-col transition-colors"
            >
              <TallyTable
                extractedIcons={extractedIcons}
                placedItems={placedItems}
                curveObjects={curveObjects}
                iconLabels={iconLabels}
                templateReplacements={effectiveTemplateReplacements}
                onUpdateLabel={handleUpdateLabel}
                onAddIcon={handleAddItem}
              />
            </div>
          )}
        </aside>

        {/* Mobile Floating Toggle Button for Right Panel */}
        <button
          type="button"
          onClick={() => setShowMobileRightPanel(prev => !prev)}
          className="md:hidden fixed bottom-5 right-5 z-30 w-12 h-12 rounded-full liquid-btn-primary text-white shadow-xl flex items-center justify-center cursor-pointer active:scale-90 transition-transform"
          title="集計・詳細パネルを開閉"
        >
          {showMobileRightPanel ? <X className="w-5 h-5" /> : <ClipboardList className="w-5 h-5" />}
        </button>

        {/* Floating Object Control Panel - Topmost Layer floating over canvas & right inspector */}
        <FloatingObjectControlPanel
          isVisible={showFloatingPanel}
          hasSelection={(selectedIds.length + selectedCurveIds.length) > 0 || !!selectedId || !!selectedCurveId}
          hasCurveSelection={selectedCurveIds.length > 0 || !!selectedCurveId}
          selectedCount={(selectedIds.length + selectedCurveIds.length) || (selectedId || selectedCurveId ? 1 : 0)}
          onNudge={handleNudgeDirection}
          onRotate={handleRotateSelected}
          onResize={handleResizeSelected}
          onRemoteDragStart={handleRemoteDragStart}
          onRemoteDragMove={handleRemoteDragMove}
          onRemoteDragEnd={handleRemoteDragEnd}
          onControlPointDragStart={handleControlPointDragStart}
          onControlPointDragMove={handleControlPointDragMove}
          onControlPointDragEnd={handleControlPointDragEnd}
          isControlPointSnapped={isCtrlPointSnapped}
          zoomMultiplier={zoomMultiplier}
          isDarkMode={isDarkMode}
        />
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
          templateReplacements={effectiveTemplateReplacements}
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
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4">
          <div className="liquid-glass-heavy rounded-3xl p-6 max-w-sm w-full space-y-4 animate-in fade-in zoom-in-95 duration-150 text-slate-800 dark:text-slate-100">
            <div className="flex items-center gap-2.5">
              <Ruler className="w-5 h-5 text-[#007AFF]" />
              <h3 className="font-bold text-base tracking-tight">1マス (1m) の長さを定義</h3>
            </div>
            
            <div className="liquid-card rounded-2xl p-3 text-xs space-y-1.5">
              <div className="flex justify-between text-slate-600 dark:text-slate-300 items-center">
                <span>計測されたピクセル距離:</span>
                <span className="font-mono font-bold text-slate-900 dark:text-white bg-white/80 dark:bg-slate-800 px-2.5 py-0.5 rounded-full border border-slate-200/80 dark:border-slate-700">
                  {measuredDistance.toFixed(1)} px
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
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
                  className="flex-1 px-3 py-2 bg-white/80 dark:bg-slate-800 border border-slate-300/80 dark:border-slate-600 rounded-xl text-sm font-bold text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-[#007AFF] focus:outline-none"
                  placeholder="1"
                  autoFocus
                />
                <span className="font-bold text-xs text-slate-600 dark:text-slate-300 shrink-0">メートル (m)</span>
              </div>
              {parseFloat(measureMetersInput) > 0 && (
                <div className="mt-2 p-2.5 bg-[#007AFF]/10 border border-[#007AFF]/20 rounded-xl text-[11px] text-[#007AFF] dark:text-blue-300 flex items-center justify-between font-medium">
                  <span>→ 1マス (1m定義):</span>
                  <span className="font-bold text-xs">
                    {Math.max(10, Math.round(measuredDistance / parseFloat(measureMetersInput)))} px
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-2.5 pt-2 border-t border-slate-200/50 dark:border-white/10">
              <button
                type="button"
                onClick={() => setMeasuredDistance(null)}
                className="liquid-btn flex-1 py-2.5 px-3 rounded-full text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
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
                className="liquid-btn-primary flex-1 py-2.5 px-3 disabled:opacity-50 text-white rounded-full text-xs font-bold transition-colors cursor-pointer"
              >
                確定して適用
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tap-add Feedback Toast for Mobile & Touch */}
      {addToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 liquid-glass-heavy text-slate-800 dark:white px-4 py-2 rounded-full text-xs font-bold shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-150 pointer-events-none">
          <span className="w-2 h-2 rounded-full bg-[#007AFF] animate-ping" />
          <span>{addToast}</span>
        </div>
      )}

      {/* Percussion & Symbol Label Position, Rotation, Size & Vertical Mode Modal */}
      {percLabelModalTarget && (
        <PercussionLabelModal
          isOpen={Boolean(percLabelModalTarget)}
          onClose={() => setPercLabelModalTarget(null)}
          targetType={percLabelModalTarget.targetType || 'percussion'}
          itemTitle={percLabelModalTarget.canvasName}
          percussionType={percLabelModalTarget.percussionType}
          symbolShape={percLabelModalTarget.symbolShape}
          symbolFilled={percLabelModalTarget.symbolFilled}
          color={percLabelModalTarget.color}
          width={percLabelModalTarget.width}
          height={percLabelModalTarget.height}
          initialText={percLabelModalTarget.initialText}
          initialOffsetX={percLabelModalTarget.currentOffsetX}
          initialOffsetY={percLabelModalTarget.currentOffsetY}
          initialRotation={percLabelModalTarget.currentRotation}
          initialFontSize={percLabelModalTarget.currentFontSize}
          initialLetterSpacing={percLabelModalTarget.currentLetterSpacing}
          initialIsVertical={percLabelModalTarget.isVertical}
          initialShowPercussionName={percLabelModalTarget.showPercussionName !== false}
          onSave={handleSavePercussionLabel}
        />
      )}
    </div>
  );
};

export default StageBuilder;
