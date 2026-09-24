import { useState, useEffect, Component, type ErrorInfo, type ReactNode } from 'react';
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
  const [backupProjects, setBackupProjects] = useState<BackupProjectMeta[]>([]);
  const [storageUsage, setStorageUsage] = useState({ mb: '0.00', percent: 0 });

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

    let backgroundUrl = sess?.extractedData?.backgroundUrl || '';
    let iconsRegionUrl = sess?.extractedData?.iconsRegionUrl || '';
    let extractedIcons = sess?.extractedData?.extractedIcons || [];
    let pageImageUrl = sess?.fileData?.image_url || '';
    let selectedRegions = sess?.selectedRegions || [];
    let iconLabels = sess?.iconLabels || {};

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
      image_url: pageImageUrl,
      width: sess?.fileData?.width || 1200,
      height: sess?.fileData?.height || 800,
    });
    setExtractedData({
      backgroundUrl,
      iconsRegionUrl,
      extractedIcons,
    });
    setIconLabels(iconLabels);
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

  const handleExportProjectJson = (meta: BackupProjectMeta, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const raw = localStorage.getItem(`settingkun_backup_${meta.id}`);
      const data = raw ? JSON.parse(raw) : { projectId: meta.id };
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


  const handleUploadSuccess = (data: { file_id: string; image_url: string; width: number; height: number }) => {
    setFileData(data);
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
      data.extracted_icons.forEach((ic) => {
        if (ic.label && !detectedLabels[ic.id]) {
          detectedLabels[ic.id] = ic.label;
        }
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
          const newSession: SavedSession = {
            fileData: fileData,
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
    // Apply icon labels from template decisions while preserving auto-detected labels
    const newLabels: Record<string, string> = { ...iconLabels };
    for (const d of decisions) {
      if (d.matchedTemplate && d.useTemplate) {
        newLabels[d.iconId] = d.matchedTemplate.label;
      }
    }
    setIconLabels(newLabels);
    setShowTemplateModal(false);
    setCurrentPhase(3);
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
        {/* Unified App Header */}
        {currentPhase < 3 && (
        <header className="h-13 bg-white border-b border-slate-200 px-5 flex items-center justify-between shrink-0 z-30 shadow-xs">
          {/* Logo & App Title */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-xs select-none">
              🎼
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-900 leading-none">
                舞台セッティング図 作成ツール
              </h1>
              <p className="text-[10px] text-slate-400 font-medium leading-none mt-1">
                熊本県吹奏楽祭 自動集計＆エクスポート
              </p>
            </div>
          </div>

          {/* Stepper Progress */}
          <div className="hidden sm:flex items-center gap-1 bg-slate-100 p-1 rounded-full border border-slate-200">
            {steps.map((step, idx) => {
              const isCurrent = activeStep === step.num;
              const isCompleted = activeStep > step.num;
              return (
                <div key={step.num} className="flex items-center">
                  <div
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                      isCurrent
                        ? 'bg-white text-blue-700 shadow-xs'
                        : isCompleted
                        ? 'text-slate-600 hover:text-slate-900'
                        : 'text-slate-400'
                    }`}
                  >
                    <span
                      className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold ${
                        isCurrent
                          ? 'bg-blue-600 text-white'
                          : isCompleted
                          ? 'bg-emerald-500 text-white'
                          : 'bg-slate-300 text-slate-600'
                      }`}
                    >
                      {isCompleted ? '✓' : step.num}
                    </span>
                    <span>{step.label}</span>
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
                className="text-xs text-slate-600 hover:text-red-600 hover:bg-red-50 border border-slate-200 hover:border-red-200 px-3 py-1.5 rounded-lg transition-colors font-medium flex items-center gap-1.5 cursor-pointer"
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
              <div className="w-full max-w-2xl bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-8 text-center transition-colors">
                <div className="w-14 h-14 mx-auto mb-4 bg-blue-50 dark:bg-slate-700 text-blue-600 dark:text-blue-400 rounded-2xl flex items-center justify-center text-2xl shadow-inner">
                  📄
                </div>
                <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">
                  舞台セッティング表のPDFをアップロード
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 max-w-lg mx-auto mb-6 leading-relaxed">
                  指定のセッティング用紙PDFを読み込むと、ステージ図面と椅子・譜面台・机などのパーツを自動で切り出し、ドラッグ配置・個数集計・自動丸つけを行えます。
                </p>
                <PdfUploader onUploadSuccess={handleUploadSuccess} />
              </div>

              {/* ===== Backup / Saved Projects Section (Ported from Prototype) ===== */}
              <div className="w-full max-w-2xl mt-5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-xs transition-colors">
                {/* Header */}
                <div className="flex items-center justify-between mb-3 px-0.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
                    <span className="text-sm">🕒</span>
                    <span>自動バックアップ一覧</span>
                  </div>
                  {backupProjects.length > 0 && (
                    <span className="text-[11px] text-slate-400 font-medium">
                      {backupProjects.length} 件保存中
                    </span>
                  )}
                </div>

                {/* Project List */}
                <div className="max-h-52 overflow-y-auto flex flex-col gap-2 pr-1">
                  {backupProjects.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-6 text-slate-400 dark:text-slate-500 text-xs">
                      <span className="text-2xl opacity-60">📁</span>
                      <span>バックアップされたデータはありません</span>
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
                          className="group flex items-center justify-between bg-slate-50 hover:bg-blue-50/70 dark:bg-slate-700/50 dark:hover:bg-slate-700 border border-slate-200/80 hover:border-blue-300 dark:border-slate-600 dark:hover:border-blue-400 rounded-xl px-3.5 py-2.5 transition-all cursor-pointer shadow-2xs hover:shadow-xs"
                        >
                          {/* Info */}
                          <div className="flex-1 min-w-0 flex flex-col gap-0.5 text-left">
                            <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 truncate">
                              {proj.name}
                            </span>
                            <div className="text-[11px] text-slate-400 dark:text-slate-400 flex items-center gap-2">
                              <span>📑 {proj.sceneCount}場面</span>
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
                              className="w-7 h-7 rounded-lg bg-white dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-slate-600 dark:text-slate-300 hover:text-emerald-600 border border-slate-200 dark:border-slate-600 hover:border-emerald-300 flex items-center justify-center text-xs transition-colors cursor-pointer"
                            >
                              📥
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteProject(proj.id, e)}
                              title="削除"
                              className="w-7 h-7 rounded-lg bg-white dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-600 dark:text-slate-300 hover:text-rose-600 border border-slate-200 dark:border-slate-600 hover:border-rose-300 flex items-center justify-center text-xs transition-colors cursor-pointer"
                            >
                              🗑
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Storage Usage Container */}
                <div className="mt-3.5 pt-3 border-t border-slate-200/80 dark:border-slate-700/80">
                  <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                    <span className="flex items-center gap-1">
                      <span>💾</span> ストレージ使用量
                    </span>
                    <span className="font-mono">
                      {storageUsage.mb} MB / 5.00 MB ({storageUsage.percent}%)
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        storageUsage.percent >= 80
                          ? 'bg-linear-to-r from-rose-500 to-red-600'
                          : storageUsage.percent >= 50
                          ? 'bg-linear-to-r from-amber-500 to-orange-500'
                          : 'bg-linear-to-r from-blue-600 to-indigo-500'
                      }`}
                      style={{ width: `${Math.min(100, storageUsage.percent)}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 text-right mt-1.5">
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
                onIconsUpdated={(icons) => setExtractedData(prev => prev ? { ...prev, extractedIcons: icons } : null)}
                onBack={handleBackToHome}
                onPhaseChange={(p) => setCurrentPhase(p)}
              />
              {/* Template replacement modal (shown right after extraction) */}
              {showTemplateModal && extractedData && (
                <TemplateMatchModal
                  extractedIcons={extractedData.extractedIcons}
                  iconLabels={iconLabels}
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

