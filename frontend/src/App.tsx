import { useState, useEffect, useRef, Component, type ErrorInfo, type ReactNode } from 'react';
import axios from 'axios';
import { 
  Home, 
  Clock, 
  Upload, 
  FolderOpen, 
  Layers, 
  Download, 
  Trash2, 
  Database,
  Edit3
} from 'lucide-react';
import { PdfUploader } from './components/PdfUploader';
import { RegionSelector } from './components/RegionSelector';
import StageBuilder from './components/StageBuilder';
import TemplateMatchModal, { type MatchingDecision } from './components/TemplateMatchModal';
import IconAdjustModal from './components/IconAdjustModal';
import { inferTemplateReplacements } from './utils/templateShapes';
import {
  loadSessionFromIndexedDB,
  saveSessionToIndexedDB,
  clearSessionFromIndexedDB,
  getAllSessionsFromIndexedDB,
  urlToDataUrl,
  cropIconFromImage,
  type SavedSession,
} from './utils/indexedDb';

export interface ExtractedIcon {
  id: string;
  url: string;
  rect: { x: number; y: number; width: number; height: number };
  label?: string;
}

export interface ExtractResponse {
  background_url: string;
  icons_region_url: string;
  extracted_icons: ExtractedIcon[];
  icon_labels?: Record<string, string>;
}

export interface BackupProjectMeta {
  id: string;
  name: string;
  savedAt: number;
  sceneCount: number;
  session?: SavedSession;
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    // ブラウザの翻訳拡張機能やDOM不整合による一時的な removeChild エラーの場合は自動復帰を試みる
    if (error?.message?.includes('removeChild') || error?.message?.includes('not a child of this node')) {
      setTimeout(() => {
        this.setState({ hasError: false, error: null });
      }, 50);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 max-w-xl mx-auto mt-12 bg-white border border-red-200 rounded-xl shadow-lg text-center space-y-4">
          <div className="text-4xl text-rose-500 font-bold">!</div>
          <h2 className="text-lg font-bold text-gray-800">画面の表示中にエラーが発生しました</h2>
          <p className="text-xs text-red-600 bg-red-50 p-3 rounded font-mono break-all text-left">
            {this.state.error?.message}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="bg-blue-600 text-white px-4 py-2 rounded-md font-semibold text-sm hover:bg-blue-700 transition-colors"
          >
            画面を再試行する
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [fileData, setFileData] = useState<{ file_id: string; image_url: string; width: number; height: number } | null>(null);
  const [extractedData, setExtractedData] = useState<{ backgroundUrl: string; iconsRegionUrl: string; extractedIcons: ExtractedIcon[] } | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [selectedRegions, setSelectedRegions] = useState<any[]>([]);
  const [currentPhase, setCurrentPhase] = useState<1 | 2 | 3 | 4>(1);
  const [showIconAdjustModal, setShowIconAdjustModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [iconLabels, setIconLabels] = useState<Record<string, string>>({});
  const [templateReplacements, setTemplateReplacements] = useState<Record<string, string>>({});
  const [backupProjects, setBackupProjects] = useState<BackupProjectMeta[]>([]);
  const [storageUsage, setStorageUsage] = useState({ mb: '0.00', percent: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const preloadedBackupRef = useRef<any>(null);
  const hasUserAdjustedIconsRef = useRef<boolean>(false);

  // Refresh and load all project backups and storage usage
  const refreshBackups = async () => {
    try {
      // 1. Calculate storage usage from localStorage
      let totalBytes = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || '';
        const v = localStorage.getItem(k) || '';
        totalBytes += (k.length + v.length) * 2;
      }
      const maxBytes = 5 * 1024 * 1024;
      const mb = (totalBytes / (1024 * 1024)).toFixed(2);
      const percent = Math.min(100, Math.round((totalBytes / maxBytes) * 100));
      setStorageUsage({ mb, percent });

      const metas: BackupProjectMeta[] = [];

      // 2. localStorage のバックアップを先に同期的に一覧化して即表示する
      //    （軽量な _meta キャッシュを優先利用し、毎回8MBのJSON.parseが走るのを防ぐ）
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || '';
        if (k.startsWith('settingkun_backup_') && !k.endsWith('_ts') && !k.endsWith('_meta')) {
          const fid = k.replace('settingkun_backup_', '');
          if (!fid || metas.some(m => m.id === fid)) continue;
          let sceneCount = 1;
          let projectName = `セッティング図 (${fid.slice(0, 8)})`;
          let savedAt = 0;
          const metaRaw = localStorage.getItem(k + '_meta');
          if (metaRaw) {
            try {
              const m = JSON.parse(metaRaw);
              if (m.sceneCount) sceneCount = m.sceneCount;
              if (m.projectName) projectName = m.projectName;
              if (m.savedAt) savedAt = m.savedAt;
            } catch { }
          } else {
            try {
              const parsed = JSON.parse(localStorage.getItem(k) || '{}');
              if (Array.isArray(parsed.scenes)) sceneCount = parsed.scenes.length;
              if (parsed.projectName || parsed.name) projectName = parsed.projectName || parsed.name;
              if (parsed.savedAt) savedAt = parsed.savedAt;
              try {
                localStorage.setItem(k + '_meta', JSON.stringify({ projectName, sceneCount, savedAt }));
              } catch { }
            } catch { }
          }
          const ts = parseInt(localStorage.getItem(k + '_ts') || '0', 10);
          if (ts) savedAt = ts;
          metas.push({ id: fid, name: projectName, savedAt: savedAt || Date.now(), sceneCount });
        }
      }
      metas.sort((a, b) => b.savedAt - a.savedAt);
      setBackupProjects([...metas]);

      // 3. IndexedDB セッションを短時間タイムアウト付きで取得してマージ
      try {
        const sessions = await Promise.race<SavedSession[]>([
          getAllSessionsFromIndexedDB(),
          new Promise<SavedSession[]>(resolve => setTimeout(() => resolve([]), 400)),
        ]);
        let addedAny = false;
        sessions.forEach(sess => {
          const fid = sess.fileData?.file_id;
          if (!fid) return;
          const existing = metas.find(m => m.id === fid);
          if (existing) {
            existing.session = sess;
            return;
          }
          addedAny = true;
          metas.push({
            id: fid,
            name: `セッティング図 (${fid.slice(0, 8)})`,
            savedAt: sess.updatedAt || Date.now(),
            sceneCount: 1,
            session: sess,
          });
        });
        if (addedAny) {
          metas.sort((a, b) => b.savedAt - a.savedAt);
          setBackupProjects([...metas]);
        }
      } catch (idbErr) {
        console.warn('IndexedDB fetch error in refreshBackups:', idbErr);
      }
    } catch (e) {
      console.warn('Error refreshing backups:', e);
    }
  };

  useEffect(() => {
    if (currentPhase === 1) {
      refreshBackups();
    }
  }, [currentPhase]);

  const handleResumeProject = async (meta: BackupProjectMeta) => {
    // Check localStorage snapshot for this fileId
    let localBackup: any = null;
    try {
      const raw = localStorage.getItem(`settingkun_backup_${meta.id}`);
      if (raw) localBackup = JSON.parse(raw);
    } catch { }

    let sess: SavedSession | null | undefined = meta.session;
    // localStorage に図面画像とパーツ画像が揃っている場合は IndexedDB の応答を待たずに即座に開く
    const hasCompleteLocalImages = Boolean(localBackup?.backgroundUrl && Array.isArray(localBackup?.extractedIcons) && localBackup.extractedIcons.length > 0);
    if (!sess && !hasCompleteLocalImages) {
      sess = await Promise.race<SavedSession | null>([
        loadSessionFromIndexedDB(meta.id).catch(() => null),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 400)),
      ]);
    }

    let backgroundUrl = sess?.extractedData?.backgroundUrl || localBackup?.backgroundUrl || '';
    let iconsRegionUrl = sess?.extractedData?.iconsRegionUrl || localBackup?.iconsRegionUrl || '';
    let extractedIcons = sess?.extractedData?.extractedIcons || localBackup?.extractedIcons || [];
    let pageImageUrl = sess?.fileData?.image_url || localBackup?.pageImageUrl || '';
    let selectedRegions = sess?.selectedRegions || [];
    let rawIconLabels = localBackup?.iconLabels || sess?.iconLabels || {};
    let iconLabels: Record<string, string> = {};

    // Auto-heal extractedIcons ONLY if any URL is missing or points to ephemeral /static/ paths
    const needsHealing = iconsRegionUrl && extractedIcons.some((ic: ExtractedIcon) => !ic.url || ic.url.startsWith('/static/'));
    if (needsHealing) {
      try {
        const healedIcons = await Promise.all(
          extractedIcons.map(async (ic: ExtractedIcon) => {
            if (!ic.url || ic.url.startsWith('/static/')) {
              try {
                const healedUrl = await cropIconFromImage(iconsRegionUrl, ic.rect);
                return { ...ic, url: healedUrl };
              } catch (err) {
                console.warn('Failed to auto-heal icon from iconsRegionUrl:', ic.id, err);
                return ic;
              }
            }
            return ic;
          })
        );
        extractedIcons = healedIcons;

        // Persist healed icons back into local backup so they never revert to /static/
        if (localBackup) {
          localBackup.iconsRegionUrl = iconsRegionUrl;
          localBackup.extractedIcons = extractedIcons;
          try {
            localStorage.setItem(`settingkun_backup_${meta.id}`, JSON.stringify(localBackup));
          } catch {}
        }
      } catch (err) {
        console.warn('Error during auto-healing extracted icons:', err);
      }
    }

    extractedIcons.forEach((ic: ExtractedIcon, idx: number) => {
      iconLabels[ic.id] = rawIconLabels[ic.id] || ic.label || `パーツ ${idx + 1}`;
      ic.label = iconLabels[ic.id];
    });

    // If selectedRegions is empty but localBackup has backgroundCrop, reconstruct background region
    if (selectedRegions.length === 0 && localBackup?.backgroundCrop) {
      selectedRegions = [{ type: 'background', crop: localBackup.backgroundCrop }];
    }

    // Fallback: If pageImageUrl is missing, fallback to backgroundUrl
    if (!pageImageUrl && backgroundUrl) {
      pageImageUrl = backgroundUrl;
    }

    // If backgroundUrl is missing, attempt to probe backend static files
    if (!backgroundUrl) {
      try {
        const testBgUrl = `/static/${meta.id}_bg.png`;
        const testRes = await fetch(testBgUrl, { method: 'HEAD' });
        if (testRes.ok) {
          backgroundUrl = testBgUrl;
          const testPageUrl = `/static/${meta.id}_page1.png`;
          const testPageRes = await fetch(testPageUrl, { method: 'HEAD' });
          if (testPageRes.ok) pageImageUrl = testPageUrl;
        }
      } catch (err) {
        console.warn('Backend probe error:', err);
      }
    }

    if (!backgroundUrl) {
      alert(`プロジェクト「${meta.name}」の図面画像データ（IndexedDB/サーバー）が見つかりませんでした。\n（古いデータまたは一時キャッシュが削除された可能性があります）`);
      return;
    }

    preloadedBackupRef.current = localBackup;
    setFileData({
      file_id: meta.id,
      image_url: pageImageUrl || backgroundUrl,
      width: sess?.fileData?.width || 1200,
      height: sess?.fileData?.height || 800,
    });
    setExtractedData({
      backgroundUrl,
      iconsRegionUrl,
      extractedIcons,
    });
    setIconLabels(iconLabels);
    const effectiveReplacements =
      (sess?.templateReplacements && Object.keys(sess.templateReplacements).length > 0)
        ? sess.templateReplacements
        : (localBackup?.templateReplacements && Object.keys(localBackup.templateReplacements).length > 0)
        ? localBackup.templateReplacements
        : inferTemplateReplacements(extractedIcons, localBackup?.placedItems || [], localBackup?.scenes || []);
    setTemplateReplacements(effectiveReplacements);
    setSelectedRegions(selectedRegions);
    setCurrentPhase(3);
  };

  const handleDeleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('このプロジェクトをブラウザから削除しますか？（操作は元に戻せません）')) return;
    await clearSessionFromIndexedDB(id);
    localStorage.removeItem(`settingkun_backup_${id}`);
    localStorage.removeItem(`settingkun_backup_${id}_ts`);
    localStorage.removeItem(`settingkun_backup_${id}_meta`);
    await refreshBackups();
  };

  const handleRenameProject = async (id: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = window.prompt('プロジェクトの名前を入力してください:', currentName);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed) return;

    try {
      const raw = localStorage.getItem(`settingkun_backup_${id}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        parsed.projectName = trimmed;
        parsed.name = trimmed;
        localStorage.setItem(`settingkun_backup_${id}`, JSON.stringify(parsed));
        const sceneCount = Array.isArray(parsed.scenes) ? parsed.scenes.length : 1;
        localStorage.setItem(`settingkun_backup_${id}_meta`, JSON.stringify({ projectName: trimmed, sceneCount }));
      }
      await refreshBackups();
    } catch (err) {
      console.warn('Failed to rename project:', err);
    }
  };

  const handleExportProjectJson = async (meta: BackupProjectMeta, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      let sess = meta.session || (await loadSessionFromIndexedDB(meta.id));
      const raw = localStorage.getItem(`settingkun_backup_${meta.id}`);
      const data = raw ? JSON.parse(raw) : { projectId: meta.id };

      if (!data.backgroundUrl && sess?.extractedData?.backgroundUrl) {
        data.backgroundUrl = sess.extractedData.backgroundUrl;
      }
      if (!data.iconsRegionUrl && sess?.extractedData?.iconsRegionUrl) {
        data.iconsRegionUrl = sess.extractedData.iconsRegionUrl;
      }
      if (!data.extractedIcons && sess?.extractedData?.extractedIcons) {
        data.extractedIcons = sess.extractedData.extractedIcons;
      }
      if (!data.pageImageUrl && sess?.fileData?.image_url) {
        data.pageImageUrl = sess.fileData.image_url;
      }
      if (!data.iconLabels && sess?.iconLabels) {
        data.iconLabels = sess.iconLabels;
      }
      if (!data.templateReplacements && sess?.templateReplacements) {
        data.templateReplacements = sess.templateReplacements;
      }
      data.version = data.version || '2.0';
      data.name = data.name || meta.name;
      data.projectName = data.projectName || meta.name;
      data.exportedAt = Date.now();

      const safeName = (meta.name || 'project').replace(/[\\/:*?"<>|]/g, '_').trim();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert('書き出しに失敗しました');
    }
  };

  const handleImportProjectJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.scenes && !data.placedItems && !data.curveObjects) {
        alert('StaJetのプロジェクトデータ形式と一致しませんでした。');
        return;
      }

      const projId = data.projectId || `proj_${Date.now()}`;
      const projName = data.name || file.name.replace(/\.json$/i, '');

      // Auto-heal icons if needed
      let iconsRegionUrl = data.iconsRegionUrl || '';
      let extractedIcons = data.extractedIcons || [];
      if (iconsRegionUrl && extractedIcons.length > 0) {
        try {
          const healedIcons = await Promise.all(
            extractedIcons.map(async (ic: ExtractedIcon) => {
              if (!ic.url || ic.url.startsWith('/static/')) {
                try {
                  const healedUrl = await cropIconFromImage(iconsRegionUrl, ic.rect);
                  return { ...ic, url: healedUrl };
                } catch {
                  return ic;
                }
              }
              return ic;
            })
          );
          extractedIcons = healedIcons;
          data.extractedIcons = extractedIcons;
        } catch {}
      }

      // Ensure templateReplacements is preserved or inferred from placed items
      const importedReplacements = (data.templateReplacements && Object.keys(data.templateReplacements).length > 0)
        ? data.templateReplacements
        : inferTemplateReplacements(extractedIcons, data.placedItems || [], data.scenes || []);
      data.templateReplacements = importedReplacements;

      // Save to localStorage
      try {
        localStorage.setItem(`settingkun_backup_${projId}`, JSON.stringify(data));
        localStorage.setItem(`settingkun_backup_${projId}_ts`, (data.savedAt || data.exportedAt || Date.now()).toString());
      } catch (err) {
        console.warn('localStorage save warning:', err);
      }

      // Save to IndexedDB
      const newSession: SavedSession = {
        fileData: {
          file_id: projId,
          image_url: data.pageImageUrl || data.backgroundUrl || '',
          width: 1200,
          height: 800,
        },
        extractedData: {
          backgroundUrl: data.backgroundUrl || '',
          iconsRegionUrl: data.iconsRegionUrl || '',
          extractedIcons: extractedIcons,
        },
        iconLabels: data.iconLabels || {},
        templateReplacements: importedReplacements,
        selectedRegions: data.backgroundCrop ? [{ type: 'background', crop: data.backgroundCrop }] : [],
        currentPhase: 3,
        updatedAt: Date.now(),
      };
      await saveSessionToIndexedDB(newSession);
      await refreshBackups();

      // Immediately resume the imported project
      await handleResumeProject({
        id: projId,
        name: projName,
        savedAt: data.savedAt || data.exportedAt || Date.now(),
        sceneCount: data.scenes?.length || 1,
        session: newSession,
      });
    } catch (err) {
      console.error('Failed to import JSON file:', err);
      alert('JSONファイルの読み込みに失敗しました。正しいJSONファイルかご確認ください。');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };


  const handleUploadSuccess = async (data: {
    file_id: string;
    image_url: string;
    width: number;
    height: number;
    auto_stage_region?: { x: number; y: number; width: number; height: number };
  }) => {
    let permanentImageUrl = data.image_url;
    try {
      permanentImageUrl = await urlToDataUrl(data.image_url);
    } catch (e) {
      console.warn('Failed to convert page image to data URL:', e);
    }
    // 新しいPDFを読み込んだ際は前回のセッション状態（ラベルやテンプレ置換設定）を完全にリセット
    preloadedBackupRef.current = null;
    hasUserAdjustedIconsRef.current = false;
    setExtractedData(null);
    setSelectedRegions([]);
    setIconLabels({});
    setTemplateReplacements({});
    setShowTemplateModal(false);
    const activeFileData = {
      ...data,
      image_url: permanentImageUrl,
    };
    setFileData(activeFileData);

    // アルゴリズムによりステージ領域が自動検出された場合は、領域選択ステップ（Phase 2）をスキップして即座に抽出を開始
    if (data.auto_stage_region && data.auto_stage_region.width > 20 && data.auto_stage_region.height > 20) {
      const autoCrop = data.auto_stage_region;
      const autoRegions = [
        {
          type: 'background',
          crop: autoCrop,
          percentCrop: {
            x: (autoCrop.x / data.width) * 100,
            y: (autoCrop.y / data.height) * 100,
            width: (autoCrop.width / data.width) * 100,
            height: (autoCrop.height / data.height) * 100,
          },
        },
      ];
      setSelectedRegions(autoRegions);
      void handleRegionsComplete(autoRegions, activeFileData);
    } else {
      setCurrentPhase(2);
    }
  };

  const handleRegionsComplete = async (
    regions: any[],
    targetFileData?: { file_id: string; image_url: string; width: number; height: number }
  ) => {
    const activeFile = targetFileData || fileData;
    if (!activeFile) return;
    setSelectedRegions(regions);
    
    setIsExtracting(true);
    try {
      const response = await axios.post('/api/extract/', {
        file_id: activeFile.file_id,
        regions: regions
      });
      
      const data = response.data as ExtractResponse;
      
      const keepCustomIcons = Boolean(
        hasUserAdjustedIconsRef.current &&
        extractedData?.extractedIcons &&
        extractedData.extractedIcons.length > 0
      );
      const nextIconsRegionUrl = keepCustomIcons
        ? (extractedData?.iconsRegionUrl || data.icons_region_url)
        : data.icons_region_url;
      const nextExtractedIcons = keepCustomIcons
        ? (extractedData?.extractedIcons || data.extracted_icons)
        : data.extracted_icons;

      setExtractedData({
        backgroundUrl: data.background_url,
        iconsRegionUrl: nextIconsRegionUrl,
        extractedIcons: nextExtractedIcons,
      });

      let effectiveLabels = iconLabels;
      if (!keepCustomIcons) {
        const detectedLabels: Record<string, string> = {};
        if (data.icon_labels) {
          Object.assign(detectedLabels, data.icon_labels);
        }
        data.extracted_icons.forEach((ic, idx) => {
          if (!detectedLabels[ic.id]) {
            detectedLabels[ic.id] = ic.label || `パーツ ${idx + 1}`;
          }
          ic.label = detectedLabels[ic.id];
        });
        setIconLabels(detectedLabels);
        setTemplateReplacements({});
        effectiveLabels = detectedLabels;
      }

      // 各モーダル（テンプレ置換・パーツ枠調整・図面枠調整）は勝手に連鎖表示させず、直接ステージ配置へ進む
      setShowIconAdjustModal(false);
      setShowTemplateModal(false);
      setCurrentPhase(3);

      // Asynchronously cache session in IndexedDB with standalone DataURLs
      (async () => {
        try {
          const bgDataUrl = await urlToDataUrl(data.background_url);
          const iconsRegionDataUrl = nextIconsRegionUrl.startsWith('data:')
            ? nextIconsRegionUrl
            : await urlToDataUrl(nextIconsRegionUrl);
          const iconsWithDataUrls = await Promise.all(
            nextExtractedIcons.map(async (ic) => ({
              ...ic,
              url: ic.url.startsWith('data:') ? ic.url : await urlToDataUrl(ic.url),
            }))
          );
          setExtractedData({
            backgroundUrl: bgDataUrl,
            iconsRegionUrl: iconsRegionDataUrl,
            extractedIcons: iconsWithDataUrls,
          });
          const pageImageDataUrl = activeFile.image_url.startsWith('data:')
            ? activeFile.image_url
            : await urlToDataUrl(activeFile.image_url);
          const newSession: SavedSession = {
            fileData: {
              ...activeFile,
              image_url: pageImageDataUrl,
            },
            extractedData: {
              backgroundUrl: bgDataUrl,
              iconsRegionUrl: iconsRegionDataUrl,
              extractedIcons: iconsWithDataUrls,
            },
            iconLabels: effectiveLabels,
            selectedRegions: regions,
            currentPhase: 3,
            updatedAt: Date.now(),
          };
          await saveSessionToIndexedDB(newSession);
        } catch (e) {
          console.warn('Failed to cache session in IndexedDB:', e);
        }
      })();
    } catch (err) {
      console.error("Extraction failed", err);
      alert("PDFからのパーツ抽出に失敗しました。");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleIconsUpdated = async (icons: ExtractedIcon[], newLabels?: Record<string, string>) => {
    hasUserAdjustedIconsRef.current = true;
    // 新しいアイコン配列に対応するクリーンなラベルマップを構築（古いキーの残留を防止）
    const cleanLabels: Record<string, string> = {};
    icons.forEach((ic, idx) => {
      cleanLabels[ic.id] = newLabels?.[ic.id] || ic.label || `パーツ ${idx + 1}`;
    });
    // 枠の追加・削除等でIDとラベルの対応が変わった場合、ズレた古いテンプレ置換設定を除去
    const cleanReplacements: Record<string, string> = {};
    icons.forEach((ic) => {
      const prevLbl = iconLabels[ic.id];
      const nextLbl = cleanLabels[ic.id];
      if (templateReplacements[ic.id] && prevLbl && prevLbl === nextLbl) {
        cleanReplacements[ic.id] = templateReplacements[ic.id];
      }
    });

    setExtractedData(prev => prev ? { ...prev, extractedIcons: icons } : null);
    setIconLabels(cleanLabels);
    setTemplateReplacements(cleanReplacements);

    if (fileData?.file_id) {
      const fid = fileData.file_id;
      void (async () => {
        try {
          const sess = await loadSessionFromIndexedDB(fid);
          if (sess) {
            const iconsWithDataUrls = await Promise.all(
              icons.map(async (ic) => ({
                ...ic,
                url: ic.url.startsWith('data:') ? ic.url : await urlToDataUrl(ic.url),
              }))
            );
            await saveSessionToIndexedDB({
              ...sess,
              extractedData: {
                backgroundUrl: sess.extractedData?.backgroundUrl || '',
                iconsRegionUrl: sess.extractedData?.iconsRegionUrl || '',
                extractedIcons: iconsWithDataUrls,
              },
              iconLabels: cleanLabels,
              templateReplacements: cleanReplacements,
              updatedAt: Date.now(),
            });
          }
        } catch (e) {
          console.warn('Failed to update session in IndexedDB:', e);
        }
      })();
    }
  };

  const handleTemplateModalConfirm = (decisions: MatchingDecision[]) => {
    // Apply icon labels from template decisions while preserving auto-detected PDF labels
    const newReplacements: Record<string, string> = { ...templateReplacements };
    const newLabels: Record<string, string> = { ...iconLabels };
    for (const d of decisions) {
      if (d.matchedTemplate && d.useTemplate) {
        newReplacements[d.iconId] = d.matchedTemplate.id || `tmpl_${d.matchedTemplate.type}`;
        const existingLbl = (newLabels[d.iconId] || d.iconLabel || '').trim();
        const isGeneric = !existingLbl || /^(パーツ|アイテム|icon)[_\s]*\d*$/i.test(existingLbl);
        if (isGeneric) {
          newLabels[d.iconId] = d.matchedTemplate.label;
        }
      } else {
        delete newReplacements[d.iconId];
      }
    }
    setTemplateReplacements(newReplacements);
    setIconLabels(newLabels);
    setShowTemplateModal(false);
    setCurrentPhase(3);

    // Persist to IndexedDB
    if (fileData?.file_id) {
      (async () => {
        try {
          const sess = await loadSessionFromIndexedDB(fileData.file_id);
          if (sess) {
            await saveSessionToIndexedDB({
              ...sess,
              iconLabels: newLabels,
              templateReplacements: newReplacements,
              updatedAt: Date.now(),
            });
          }
        } catch (e) {
          console.warn('Failed to persist templateReplacements to IndexedDB:', e);
        }
      })();
    }
  };

  const handleTemplateModalSkip = () => {
    setShowTemplateModal(false);
    setCurrentPhase(3);
  };

  const handleIconAdjustBack = () => {
    setShowIconAdjustModal(false);
  };

  const handleTemplateModalBack = () => {
    setShowTemplateModal(false);
  };


  const handleReset = () => {
    if (window.confirm("作業を中断して、最初の画面（PDF読込・バックアップ一覧）に戻りますか？")) {
      setFileData(null);
      setExtractedData(null);
      setSelectedRegions([]);
      setIconLabels({});
      setTemplateReplacements({});
      setShowIconAdjustModal(false);
      setShowTemplateModal(false);
      setCurrentPhase(1);
    }
  };

  const handleBackToHome = () => {
    setFileData(null);
    setExtractedData(null);
    setSelectedRegions([]);
    setIconLabels({});
    setTemplateReplacements({});
    setShowIconAdjustModal(false);
    setShowTemplateModal(false);
    setCurrentPhase(1);
  };

  const backgroundCrop = selectedRegions.find(r => r.type === 'background')?.crop || null;

  const activeStep = !fileData ? 1 : !extractedData ? 2 : currentPhase;

  const steps = [
    { num: 1, label: 'PDF読込' },
    { num: 2, label: '領域設定' },
    { num: 3, label: 'ステージ配置' },
    { num: 4, label: 'プレビュー・出力' },
  ];

  return (
    <ErrorBoundary>
      <div className="h-screen w-screen flex flex-col liquid-bg overflow-hidden font-sans text-slate-800 dark:text-slate-100 antialiased">
        {/* Apple Liquid Glass Service Header */}
        {currentPhase < 3 && (
          <header className="h-16 liquid-glass border-b px-6 flex items-center justify-between shrink-0 z-30 select-none">
            {/* Brand & Service Title */}
            <div className="flex items-center gap-3.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-400 via-blue-500 to-indigo-600 text-white flex items-center justify-center font-bold text-base shadow-[0_4px_12px_rgba(0,122,255,0.35),inset_0_1px_1px_rgba(255,255,255,0.6)] select-none">
                ♪
              </div>
              <div className="flex flex-col">
                <h1 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight leading-tight">
                  ステージレイアウトプランナー
                </h1>
                <p className="text-[11px] bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-sky-400 dark:to-indigo-400 bg-clip-text text-transparent font-extrabold leading-tight mt-0.5">
                  StaJet
                </p>
              </div>
            </div>

            {/* Liquid Glass Pill Stepper Progress */}
            <div className="hidden sm:flex items-center gap-1 liquid-segment-track px-2 py-1 rounded-full text-xs">
              {steps.map((step, idx) => {
                const isCurrent = activeStep === step.num;
                const isCompleted = activeStep > step.num;
                return (
                  <div key={step.num} className="flex items-center">
                    <div
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all duration-200 ${
                        isCurrent
                          ? 'bg-white/95 dark:bg-slate-800/95 text-[#007AFF] dark:text-sky-400 shadow-[0_2px_8px_rgba(15,23,42,0.08),inset_0_1px_0.5px_rgba(255,255,255,0.9)] font-bold'
                          : isCompleted
                          ? 'text-slate-600 dark:text-slate-300'
                          : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold shadow-2xs ${
                          isCurrent
                            ? 'bg-gradient-to-b from-sky-400 to-blue-600 text-white'
                            : 'bg-slate-300/80 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {step.num}
                      </span>
                      <span>{step.label}</span>
                    </div>
                    {idx < steps.length - 1 && (
                      <span className="text-slate-300 dark:text-slate-600 text-[10px] px-1">›</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Header Actions */}
            <div className="flex items-center gap-2">
              {fileData && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-xs text-slate-700 hover:text-rose-600 liquid-btn px-3.5 py-1.5 rounded-full font-semibold flex items-center gap-1.5 cursor-pointer"
                  title="最初の画面（PDF読込・バックアップ一覧）に戻る"
                >
                  <Home className="w-3.5 h-3.5" />
                  <span>トップに戻る</span>
                </button>
              )}
            </div>
          </header>
        )}

        {/* Full-bleed Content Workspace */}
        <main className="flex-1 flex flex-col overflow-hidden relative">
          {isExtracting ? (
            <div className="flex-1 flex flex-col items-center justify-center">
              <div className="liquid-glass-heavy p-9 rounded-3xl flex flex-col items-center max-w-sm text-center">
                <div className="relative mb-5">
                  <div className="w-14 h-14 rounded-full border-3 border-blue-500/20" />
                  <div className="absolute inset-0 animate-spin rounded-full h-14 w-14 border-3 border-[#007AFF] border-t-transparent" />
                </div>
                <h3 className="text-base font-bold text-slate-800 dark:text-white mb-1.5 tracking-tight">PDF解析・パーツ自動抽出中</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  譜面台や椅子などのアイコンと図面を分離しています。数秒お待ちください...
                </p>
              </div>
            </div>
          ) : currentPhase === 1 || !fileData ? (
            <div className="flex-1 overflow-y-auto p-6 sm:p-8 flex flex-col items-center justify-start">
              {/* PDF Upload Card (Liquid Glass) */}
              <div className="w-full max-w-2xl liquid-glass rounded-3xl p-8 text-center transition-all">
                <div className="w-14 h-14 mx-auto mb-4 bg-gradient-to-br from-sky-400/20 via-blue-500/15 to-indigo-500/20 text-[#007AFF] dark:text-sky-300 rounded-2xl flex items-center justify-center text-xl font-bold border border-white/80 dark:border-white/15 shadow-[0_8px_20px_-4px_rgba(0,122,255,0.18),inset_0_1px_1px_rgba(255,255,255,0.9)]">
                  PDF
                </div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2 tracking-tight">
                  舞台セッティング表のPDFをアップロード
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-300 max-w-lg mx-auto mb-5 leading-relaxed">
                  指定のセッティング用紙PDFを読み込むと、ステージ図面と椅子・譜面台・机などのパーツを自動で切り出し、ドラッグ配置・個数集計・自動丸つけを行えます。
                </p>
                <PdfUploader onUploadSuccess={handleUploadSuccess} />
              </div>

              {/* ===== Backup / Saved Projects Section (Liquid Glass) ===== */}
              <div className="w-full max-w-2xl mt-6 liquid-glass rounded-3xl p-6 transition-all">
                {/* Header */}
                <div className="flex items-center justify-between mb-3.5 px-1">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
                    <span className="w-6 h-6 rounded-lg bg-blue-500/10 text-[#007AFF] flex items-center justify-center">
                      <Clock className="w-3.5 h-3.5" />
                    </span>
                    <span>自動バックアップ一覧</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs liquid-btn text-[#007AFF] dark:text-sky-300 px-3.5 py-1.5 rounded-full font-bold flex items-center gap-1.5 cursor-pointer"
                      title="パソコンに保存したJSONファイルからプロジェクトを読み込みます"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>JSONから復元</span>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={handleImportProjectJson}
                    />
                    {backupProjects.length > 0 && (
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold bg-white/60 dark:bg-slate-800/60 px-2.5 py-0.5 rounded-full border border-white/60 dark:border-white/10">
                        {backupProjects.length} 件保存中
                      </span>
                    )}
                  </div>
                </div>

                {/* Project List */}
                <div className="max-h-56 overflow-y-auto flex flex-col gap-2 pr-1">
                  {backupProjects.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-7 text-slate-500 dark:text-slate-400 text-xs border border-dashed border-slate-300/70 dark:border-slate-700 rounded-2xl bg-white/30 dark:bg-slate-800/30">
                      <FolderOpen className="w-8 h-8 opacity-40 text-slate-400" />
                      <span>バックアップされたデータはありません</span>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs text-[#007AFF] hover:underline flex items-center gap-1.5 cursor-pointer font-semibold mt-1"
                      >
                        <Upload className="w-3 h-3" />
                        <span>保存したJSONファイルを開く</span>
                      </button>
                    </div>
                  ) : (
                    backupProjects.map((proj) => {
                      const d = new Date(proj.savedAt);
                      const dateStr = proj.savedAt
                        ? `${d.toLocaleDateString('ja-JP')} ${d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`
                        : '不明';

                      return (
                        <div
                          key={proj.id}
                          onClick={() => handleResumeProject(proj)}
                          className="group flex items-center justify-between liquid-card hover:bg-white/90 dark:hover:bg-slate-700/80 hover:border-blue-400/70 rounded-2xl px-4 py-3 transition-all duration-200 cursor-pointer hover:shadow-md hover:-translate-y-0.5"
                        >
                          {/* Info */}
                          <div className="flex-1 min-w-0 flex flex-col gap-0.5 text-left">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-slate-900 dark:text-slate-100 group-hover:text-[#007AFF] dark:group-hover:text-sky-400 truncate transition-colors">
                                {proj.name}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => handleRenameProject(proj.id, proj.name, e)}
                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-slate-200/60 dark:hover:bg-slate-700 rounded transition-all text-slate-400 hover:text-[#007AFF]"
                                title="名前を変更"
                              >
                                <Edit3 className="w-3 h-3" />
                              </button>
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
                              <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                <Layers className="w-3 h-3 text-[#007AFF]" />
                                <span>{proj.sceneCount}場面</span>
                              </span>
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3 text-slate-400" />
                                <span>{dateStr}</span>
                              </span>
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1.5 ml-3 shrink-0">
                            <button
                              type="button"
                              onClick={(e) => handleRenameProject(proj.id, proj.name, e)}
                              title="名前変更"
                              className="px-2.5 py-1 rounded-full liquid-btn text-slate-700 dark:text-slate-200 hover:text-[#007AFF] flex items-center gap-1 text-xs cursor-pointer font-medium"
                            >
                              <Edit3 className="w-3 h-3" />
                              <span className="hidden sm:inline">名前変更</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleExportProjectJson(proj, e)}
                              title="JSON書き出し"
                              className="px-2.5 py-1 rounded-full liquid-btn text-slate-700 dark:text-slate-200 flex items-center gap-1 text-xs cursor-pointer font-medium"
                            >
                              <Download className="w-3 h-3" />
                              <span className="hidden sm:inline">JSON</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteProject(proj.id, e)}
                              title="削除"
                              className="px-2.5 py-1 rounded-full liquid-btn hover:!bg-rose-50 dark:hover:!bg-rose-950/50 text-rose-600 dark:text-rose-400 hover:!border-rose-300 flex items-center gap-1 text-xs cursor-pointer font-medium"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span className="hidden sm:inline">削除</span>
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Storage Usage Container */}
                <div className="mt-4 pt-3.5 border-t border-white/60 dark:border-slate-700/60">
                  <div className="flex items-center justify-between text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                    <span className="flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-[#007AFF]" />
                      <span>ストレージ使用量</span>
                    </span>
                    <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                      {storageUsage.mb} MB / 5.00 MB ({storageUsage.percent}%)
                    </span>
                  </div>
                  <div className="w-full h-2 liquid-segment-track rounded-full overflow-hidden p-0.5">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        storageUsage.percent >= 80
                          ? 'bg-gradient-to-r from-rose-500 to-red-600'
                          : storageUsage.percent >= 50
                          ? 'bg-gradient-to-r from-amber-400 to-orange-500'
                          : 'bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-600'
                      }`}
                      style={{ width: `${Math.min(100, storageUsage.percent)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 mt-1.5">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => refreshBackups()}
                        className="underline hover:text-[#007AFF] cursor-pointer"
                      >
                        一覧を再読み込み
                      </button>
                      <span>•</span>
                      <button
                        type="button"
                        onClick={() => {
                          const activeIds = new Set(backupProjects.map(p => p.id));
                          let removed = 0;
                          for (let i = localStorage.length - 1; i >= 0; i--) {
                            const k = localStorage.key(i) || '';
                            if (k.startsWith('stajet_preview_settings_')) {
                              const fid = k.replace('stajet_preview_settings_', '');
                              if (!activeIds.has(fid)) {
                                localStorage.removeItem(k);
                                removed++;
                              }
                            }
                          }
                          refreshBackups();
                          if (removed > 0) {
                            alert(`不要なプレビューキャッシュ (${removed}件) を整理しました。`);
                          } else {
                            alert('不要な孤立キャッシュはありませんでした。');
                          }
                        }}
                        className="underline hover:text-[#007AFF] cursor-pointer"
                      >
                        不要キャッシュを整理
                      </button>
                      <span>•</span>
                      <button
                        type="button"
                        onClick={() => {
                          // localStorage のキー一覧とサイズ内訳をダイアログ表示
                          const items: { key: string; sizeKb: number }[] = [];
                          for (let i = 0; i < localStorage.length; i++) {
                            const k = localStorage.key(i) || '';
                            const v = localStorage.getItem(k) || '';
                            const bytes = (k.length + v.length) * 2;
                            items.push({ key: k, sizeKb: Math.round(bytes / 1024) });
                          }
                          items.sort((a, b) => b.sizeKb - a.sizeKb);
                          const report = items.slice(0, 10).map(it => `・${it.key}: ${it.sizeKb} KB`).join('\n');
                          alert(`【ストレージ内訳 (上位10件)】\n${report || 'データなし'}\n\n※このデータからバックアップを復旧するか、不要なキーをクリアできます。`);
                        }}
                        className="underline hover:text-[#007AFF] cursor-pointer"
                      >
                        内訳を確認
                      </button>
                    </div>
                    <span>※上限(5MB)に達すると自動保存が停止します</span>
                  </div>
                </div>
              </div>
            </div>
          ) : currentPhase === 2 || !extractedData ? (
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col items-center justify-start">
              <RegionSelector
                imageUrl={fileData.image_url}
                initialRegions={selectedRegions}
                onComplete={handleRegionsComplete}
                onCancel={extractedData ? () => setCurrentPhase(3) : undefined}
              />
            </div>
          ) : (
            <>
              <StageBuilder 
                key={fileData.file_id}
                backgroundUrl={extractedData.backgroundUrl} 
                iconsRegionUrl={extractedData.iconsRegionUrl}
                extractedIcons={extractedData.extractedIcons} 
                backgroundCrop={backgroundCrop}
                fileId={fileData.file_id}
                pageImageUrl={fileData.image_url}
                preloadedBackup={preloadedBackupRef.current}
                initialIconLabels={iconLabels}
                onIconLabelsChange={(nextLabels) => {
                  setIconLabels(nextLabels);
                }}
                onIconsUpdated={handleIconsUpdated}
                templateReplacements={templateReplacements}
                onOpenTemplateModal={() => {
                  setShowTemplateModal(true);
                }}
                onOpenIconAdjustModal={() => {
                  setShowIconAdjustModal(true);
                }}
                onReAdjustBackground={() => {
                  setCurrentPhase(2);
                }}
                onBack={handleBackToHome}
                onPhaseChange={(p) => setCurrentPhase(p)}
              />
              {/* Icon adjustment modal (opened independently from toolbar) */}
              {showIconAdjustModal && extractedData && fileData && (
                <IconAdjustModal
                  iconsRegionUrl={extractedData.iconsRegionUrl}
                  extractedIcons={extractedData.extractedIcons}
                  fileId={fileData.file_id}
                  iconLabels={iconLabels}
                  onBack={handleIconAdjustBack}
                  onClose={() => {
                    setShowIconAdjustModal(false);
                  }}
                  onSave={async (newIcons, newLabels) => {
                    await handleIconsUpdated(newIcons, newLabels);
                    setShowIconAdjustModal(false);
                  }}
                />
              )}
              {/* Template replacement modal (opened independently from toolbar) */}
              {showTemplateModal && extractedData && (
                <TemplateMatchModal
                  extractedIcons={extractedData.extractedIcons}
                  iconLabels={iconLabels}
                  currentReplacements={templateReplacements}
                  onBack={handleTemplateModalBack}
                  onConfirm={handleTemplateModalConfirm}
                  onSkip={handleTemplateModalSkip}
                />
              )}
            </>
          )}
        </main>
      </div>
    </ErrorBoundary>
  );
}

export default App;

