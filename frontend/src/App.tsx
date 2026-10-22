import { useState, useEffect, useRef, Component, type ErrorInfo, type ReactNode } from 'react';
import axios from 'axios';
import { PdfUploader } from './components/PdfUploader';
import { RegionSelector } from './components/RegionSelector';
import StageBuilder from './components/StageBuilder';
import TemplateMatchModal, { type MatchingDecision } from './components/TemplateMatchModal';
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
          <div className="text-4xl">⚠️</div>
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
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [iconLabels, setIconLabels] = useState<Record<string, string>>({});
  const [templateReplacements, setTemplateReplacements] = useState<Record<string, string>>({});
  const [backupProjects, setBackupProjects] = useState<BackupProjectMeta[]>([]);
  const [storageUsage, setStorageUsage] = useState({ mb: '0.00', percent: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

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

      // 2. Fetch all IndexedDB sessions
      const sessions = await getAllSessionsFromIndexedDB();
      const metas: BackupProjectMeta[] = [];

      sessions.forEach(sess => {
        if (!sess.fileData?.file_id) return;
        const fid = sess.fileData.file_id;
        let sceneCount = 1;
        try {
          const raw = localStorage.getItem(`settingkun_backup_${fid}`);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed.scenes)) sceneCount = parsed.scenes.length;
          }
        } catch { }

        metas.push({
          id: fid,
          name: `セッティング図 (${fid.slice(0, 8)})`,
          savedAt: sess.updatedAt || Date.now(),
          sceneCount,
          session: sess,
        });
      });

      // Also check any localStorage-only backups
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || '';
        if (k.startsWith('settingkun_backup_') && !k.endsWith('_ts')) {
          const fid = k.replace('settingkun_backup_', '');
          if (!metas.some(m => m.id === fid)) {
            try {
              const raw = localStorage.getItem(k);
              if (raw) {
                const parsed = JSON.parse(raw);
                const ts = parseInt(localStorage.getItem(k + '_ts') || '0', 10) || parsed.savedAt || Date.now();
                metas.push({
                  id: fid,
                  name: `セッティング図 (${fid.slice(0, 8)})`,
                  savedAt: ts,
                  sceneCount: Array.isArray(parsed.scenes) ? parsed.scenes.length : 1,
                });
              }
            } catch { }
          }
        }
      }

      metas.sort((a, b) => b.savedAt - a.savedAt);
      setBackupProjects(metas);
    } catch (e) {
      console.warn('Error refreshing backups:', e);
    }
  };

  useEffect(() => {
    refreshBackups();
  }, [currentPhase]);

  const handleResumeProject = async (meta: BackupProjectMeta) => {
    let sess: SavedSession | null | undefined = meta.session;
    if (!sess) {
      sess = await loadSessionFromIndexedDB(meta.id);
    }

    // Check localStorage snapshot for this fileId
    let localBackup: any = null;
    try {
      const raw = localStorage.getItem(`settingkun_backup_${meta.id}`);
      if (raw) localBackup = JSON.parse(raw);
    } catch { }

    let backgroundUrl = sess?.extractedData?.backgroundUrl || localBackup?.backgroundUrl || '';
    let iconsRegionUrl = sess?.extractedData?.iconsRegionUrl || localBackup?.iconsRegionUrl || '';
    let extractedIcons = sess?.extractedData?.extractedIcons || localBackup?.extractedIcons || [];
    let pageImageUrl = sess?.fileData?.image_url || localBackup?.pageImageUrl || '';
    let selectedRegions = sess?.selectedRegions || [];
    let iconLabels = sess?.iconLabels || localBackup?.iconLabels || {};

    // Auto-heal extractedIcons if their URLs are missing or point to ephemeral /static/ paths
    if (iconsRegionUrl && extractedIcons.length > 0) {
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
      if (!iconLabels[ic.id]) {
        iconLabels[ic.id] = ic.label || `パーツ ${idx + 1}`;
      }
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
    setTemplateReplacements(sess?.templateReplacements || localBackup?.templateReplacements || {});
    setSelectedRegions(selectedRegions);
    setCurrentPhase(3);
  };

  const handleDeleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('このプロジェクトをブラウザから削除しますか？（操作は元に戻せません）')) return;
    await clearSessionFromIndexedDB(id);
    localStorage.removeItem(`settingkun_backup_${id}`);
    localStorage.removeItem(`settingkun_backup_${id}_ts`);
    await refreshBackups();
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
      data.version = data.version || '2.0';
      data.name = data.name || meta.name;
      data.exportedAt = Date.now();

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${meta.name}.json`;
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
        templateReplacements: data.templateReplacements || {},
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


  const handleUploadSuccess = async (data: { file_id: string; image_url: string; width: number; height: number }) => {
    let permanentImageUrl = data.image_url;
    try {
      permanentImageUrl = await urlToDataUrl(data.image_url);
    } catch (e) {
      console.warn('Failed to convert page image to data URL:', e);
    }
    setFileData({
      ...data,
      image_url: permanentImageUrl,
    });
    setCurrentPhase(2);
  };

  const handleRegionsComplete = async (regions: any[]) => {
    if (!fileData) return;
    setSelectedRegions(regions);
    
    setIsExtracting(true);
    try {
      const response = await axios.post('/api/extract/', {
        file_id: fileData.file_id,
        regions: regions
      });
      
      const data = response.data as ExtractResponse;
      
      setExtractedData({
        backgroundUrl: data.background_url,
        iconsRegionUrl: data.icons_region_url,
        extractedIcons: data.extracted_icons
      });

      // Populate auto-detected iconLabels from backend
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
      setIconLabels(prev => ({ ...detectedLabels, ...prev }));

      // Check if there are any matching templates — modal will auto-skip if none
      setShowTemplateModal(true);
      setCurrentPhase(3);

      // Asynchronously cache session in IndexedDB with standalone DataURLs
      (async () => {
        try {
          const bgDataUrl = await urlToDataUrl(data.background_url);
          const iconsRegionDataUrl = await urlToDataUrl(data.icons_region_url);
          const iconsWithDataUrls = await Promise.all(
            data.extracted_icons.map(async (ic) => ({
              ...ic,
              url: await urlToDataUrl(ic.url),
            }))
          );
          setExtractedData({
            backgroundUrl: bgDataUrl,
            iconsRegionUrl: iconsRegionDataUrl,
            extractedIcons: iconsWithDataUrls,
          });
          const pageImageDataUrl = await urlToDataUrl(fileData.image_url);
          const newSession: SavedSession = {
            fileData: {
              ...fileData,
              image_url: pageImageDataUrl,
            },
            extractedData: {
              backgroundUrl: bgDataUrl,
              iconsRegionUrl: iconsRegionDataUrl,
              extractedIcons: iconsWithDataUrls,
            },
            iconLabels: detectedLabels,
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


  const handleReset = () => {
    if (window.confirm("作業を中断して、最初の画面（PDF読込・バックアップ一覧）に戻りますか？")) {
      setFileData(null);
      setExtractedData(null);
      setSelectedRegions([]);
      setTemplateReplacements({});
      setCurrentPhase(1);
    }
  };

  const handleBackToHome = () => {
    setFileData(null);
    setExtractedData(null);
    setSelectedRegions([]);
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
      <div className="h-screen w-screen flex flex-col bg-slate-100 overflow-hidden font-sans text-slate-800 antialiased">
        {/* Digital Agency Design System (DADS) Service Header */}
        {currentPhase < 3 && (
          <header className="h-15 bg-white border-b border-slate-300 px-5 flex items-center justify-between shrink-0 z-30 select-none shadow-2xs">
            {/* Brand & Service Title */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-md bg-[#0055c0] text-white flex items-center justify-center font-bold text-sm shadow-2xs select-none">
                🎼
              </div>
              <div className="flex flex-col">
                <h1 className="text-sm font-bold text-slate-900 leading-tight">
                  ステージレイアウトプランナー
                </h1>
                <p className="text-[11px] text-[#0055c0] font-bold leading-tight mt-0.5">
                  StaJet
                </p>
              </div>
            </div>

            {/* DADS Stepper Progress */}
            <div className="hidden sm:flex items-center gap-1.5 bg-slate-100 px-3 py-1 rounded-md border border-slate-300 text-xs">
              {steps.map((step, idx) => {
                const isCurrent = activeStep === step.num;
                const isCompleted = activeStep > step.num;
                return (
                  <div key={step.num} className="flex items-center">
                    <div
                      className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold transition-all ${
                        isCurrent
                          ? 'bg-white text-[#0055c0] shadow-2xs border border-blue-300 font-bold'
                          : isCompleted
                          ? 'text-slate-600'
                          : 'text-slate-400'
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold ${
                          isCurrent
                            ? 'bg-[#0055c0] text-white'
                            : isCompleted
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-300 text-slate-600'
                        }`}
                      >
                        {isCompleted ? '✓' : step.num}
                      </span>
                      <span>{step.label}</span>
                      {isCurrent && <span className="text-[10px] font-normal text-slate-400 ml-0.5">(現在地)</span>}
                    </div>
                    {idx < steps.length - 1 && (
                      <span className="text-slate-300 text-[10px] px-1">›</span>
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
                  className="text-xs text-slate-800 hover:text-red-700 bg-white hover:bg-red-50 border border-slate-300 hover:border-red-300 px-3 py-1.5 rounded-md transition-colors font-medium flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  title="最初の画面（PDF読込・バックアップ一覧）に戻る"
                >
                  <span>🏠</span>
                  <span>トップに戻る</span>
                </button>
              )}
            </div>
          </header>
        )}

        {/* Full-bleed Content Workspace */}
        <main className="flex-1 flex flex-col overflow-hidden relative">
          {isExtracting ? (
            <div className="flex-1 flex flex-col items-center justify-center bg-slate-50">
              <div className="bg-white p-8 rounded-2xl shadow-lg border border-slate-200 flex flex-col items-center max-w-sm text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-3 border-blue-600 border-t-transparent mb-4"></div>
                <h3 className="text-base font-bold text-slate-800 mb-1">PDF解析・パーツ自動抽出中</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  譜面台や椅子などのアイコンと図面を分離しています。数秒お待ちください...
                </p>
              </div>
            </div>
          ) : currentPhase === 1 || !fileData ? (
            <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-start">
              {/* PDF Upload Card */}
              <div className="w-full max-w-2xl bg-white dark:bg-slate-800 rounded-lg border border-slate-300 dark:border-slate-700 shadow-2xs p-8 text-center transition-colors">
                <div className="w-12 h-12 mx-auto mb-3 bg-blue-50 dark:bg-slate-700 text-[#0055c0] dark:text-blue-300 rounded-md flex items-center justify-center text-2xl border border-blue-200 dark:border-blue-800 shadow-2xs">
                  📄
                </div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">
                  舞台セッティング表のPDFをアップロード
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 max-w-lg mx-auto mb-6 leading-relaxed">
                  指定のセッティング用紙PDFを読み込むと、ステージ図面と椅子・譜面台・机などのパーツを自動で切り出し、ドラッグ配置・個数集計・自動丸つけを行えます。
                </p>
                <PdfUploader onUploadSuccess={handleUploadSuccess} />
              </div>

              {/* ===== Backup / Saved Projects Section (Ported from Prototype) ===== */}
              <div className="w-full max-w-2xl mt-5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-5 shadow-2xs transition-colors">
                {/* Header */}
                <div className="flex items-center justify-between mb-3 px-0.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-slate-100">
                    <span className="text-sm">🕒</span>
                    <span>自動バックアップ一覧</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs bg-white hover:bg-slate-50 text-[#0055c0] dark:bg-slate-800 dark:text-blue-300 border border-[#0055c0] dark:border-blue-400 px-3 py-1 rounded-md transition-colors font-bold flex items-center gap-1.5 cursor-pointer shadow-2xs"
                      title="パソコンに保存したJSONファイルからプロジェクトを読み込みます"
                    >
                      <span>📂</span>
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
                      <span className="text-[11px] text-slate-500 font-medium">
                        {backupProjects.length} 件保存中
                      </span>
                    )}
                  </div>
                </div>

                {/* Project List */}
                <div className="max-h-56 overflow-y-auto flex flex-col gap-1.5 pr-1">
                  {backupProjects.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-6 text-slate-500 dark:text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-700 rounded-md">
                      <span className="text-2xl opacity-60">📁</span>
                      <span>バックアップされたデータはありません</span>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs text-[#0055c0] hover:underline flex items-center gap-1 cursor-pointer font-semibold mt-1"
                      >
                        <span>📂</span>
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
                          className="group flex items-center justify-between bg-white hover:bg-blue-50/60 dark:bg-slate-750 dark:hover:bg-slate-700 border border-slate-300 hover:border-[#0055c0] dark:border-slate-600 dark:hover:border-blue-400 rounded-md px-3.5 py-2.5 transition-all cursor-pointer shadow-2xs"
                        >
                          {/* Info */}
                          <div className="flex-1 min-w-0 flex flex-col gap-0.5 text-left">
                            <span className="text-xs font-bold text-slate-900 dark:text-slate-100 group-hover:text-[#0055c0] dark:group-hover:text-blue-400 truncate">
                              {proj.name}
                            </span>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
                              <span className="font-semibold text-slate-700 dark:text-slate-300">📑 {proj.sceneCount}場面</span>
                              <span>•</span>
                              <span>🕒 {dateStr}</span>
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1.5 ml-3 shrink-0">
                            <button
                              type="button"
                              onClick={(e) => handleExportProjectJson(proj, e)}
                              title="JSON書き出し"
                              className="px-2 py-1 rounded-md bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 flex items-center gap-1 text-xs transition-colors cursor-pointer shadow-2xs"
                            >
                              <span>📥</span>
                              <span className="hidden sm:inline">JSON</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteProject(proj.id, e)}
                              title="削除"
                              className="px-2 py-1 rounded-md bg-white dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400 hover:text-red-700 border border-slate-300 hover:border-red-300 dark:border-slate-600 flex items-center gap-1 text-xs transition-colors cursor-pointer shadow-2xs"
                            >
                              <span>🗑</span>
                              <span className="hidden sm:inline">削除</span>
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Storage Usage Container */}
                <div className="mt-3.5 pt-3 border-t border-slate-200 dark:border-slate-700">
                  <div className="flex items-center justify-between text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                    <span className="flex items-center gap-1">
                      <span>💾</span> ストレージ使用量
                    </span>
                    <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                      {storageUsage.mb} MB / 5.00 MB ({storageUsage.percent}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        storageUsage.percent >= 80
                          ? 'bg-[#c9171e]'
                          : storageUsage.percent >= 50
                          ? 'bg-[#b25e00]'
                          : 'bg-[#0055c0]'
                      }`}
                      style={{ width: `${Math.min(100, storageUsage.percent)}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 text-right mt-1.5">
                    ※上限(5MB)に達すると自動保存が停止します
                  </div>
                </div>
              </div>
            </div>
          ) : currentPhase === 2 || !extractedData ? (
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col items-center justify-start">
              <RegionSelector imageUrl={fileData.image_url} onComplete={handleRegionsComplete} />
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
                initialIconLabels={iconLabels}
                onIconsUpdated={async (icons, newLabels) => {
                  setExtractedData(prev => prev ? { ...prev, extractedIcons: icons } : null);
                  if (newLabels) {
                    setIconLabels(prev => ({ ...prev, ...newLabels }));
                  }
                  if (fileData?.file_id) {
                    try {
                      const sess = await loadSessionFromIndexedDB(fileData.file_id);
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
                          iconLabels: newLabels ? { ...sess.iconLabels, ...newLabels } : sess.iconLabels,
                          templateReplacements,
                          updatedAt: Date.now(),
                        });
                      }
                    } catch (e) {
                      console.warn('Failed to update session in IndexedDB:', e);
                    }
                  }
                }}
                templateReplacements={templateReplacements}
                onOpenTemplateModal={() => setShowTemplateModal(true)}
                onBack={handleBackToHome}
                onPhaseChange={(p) => setCurrentPhase(p)}
              />
              {/* Template replacement modal (shown right after extraction or on request) */}
              {showTemplateModal && extractedData && (
                <TemplateMatchModal
                  extractedIcons={extractedData.extractedIcons}
                  iconLabels={iconLabels}
                  currentReplacements={templateReplacements}
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

