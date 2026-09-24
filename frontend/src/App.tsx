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
  const [savedSession, setSavedSession] = useState<SavedSession | null>(null);

  // Check for saved session in IndexedDB on load
  useEffect(() => {
    (async () => {
      try {
        const session = await loadSessionFromIndexedDB();
        if (session && session.extractedData) {
          setSavedSession(session);
        }
      } catch (e) {
        console.warn('Could not load session from IndexedDB:', e);
      }
    })();
  }, []);

  const handleRestoreSavedSession = () => {
    if (!savedSession) return;
    setFileData(savedSession.fileData);
    setExtractedData(savedSession.extractedData);
    setIconLabels(savedSession.iconLabels || {});
    setSelectedRegions(savedSession.selectedRegions || []);
    setCurrentPhase((savedSession.currentPhase as 1 | 2 | 3 | 4) || 3);
  };

  const handleDiscardSavedSession = async () => {
    if (window.confirm("保存されている前回のセッションデータを消去しますか？")) {
      await clearSessionFromIndexedDB(savedSession?.fileData?.file_id);
      setSavedSession(null);
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
          setSavedSession(newSession);
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


  const handleReset = async () => {
    if (window.confirm("作業内容を破棄して、新しくPDFを読み込み直しますか？")) {
      if (fileData?.file_id) {
        await clearSessionFromIndexedDB(fileData.file_id);
      }
      setSavedSession(null);
      setFileData(null);
      setExtractedData(null);
      setSelectedRegions([]);
      setCurrentPhase(1);
    }
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
                className="text-xs text-slate-600 hover:text-red-600 hover:bg-red-50 border border-slate-200 hover:border-red-200 px-3 py-1.5 rounded-lg transition-colors font-medium flex items-center gap-1.5"
                title="別のPDFを読み込む"
              >
                <span>🔄</span>
                <span>新規読込</span>
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
          ) : !fileData ? (
            <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center">
              {/* Previous session recovery card */}
              {savedSession && (
                <div className="w-full max-w-2xl mb-5 p-4.5 bg-blue-50 border border-blue-200 rounded-2xl flex items-center justify-between shadow-xs">
                  <div className="text-left">
                    <p className="text-sm font-bold text-blue-900 flex items-center gap-1.5">
                      <span>💾</span> 前回のセッションデータが保存されています
                    </p>
                    <p className="text-xs text-blue-700 mt-0.5">
                      保存日時: {new Date(savedSession.updatedAt).toLocaleString('ja-JP')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleRestoreSavedSession}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>↩️</span>
                      <span>続きから再開</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDiscardSavedSession}
                      className="px-3 py-2 text-slate-500 hover:text-red-600 text-xs font-medium hover:bg-red-50 rounded-xl transition-colors cursor-pointer"
                    >
                      破棄
                    </button>
                  </div>
                </div>
              )}

              <div className="w-full max-w-2xl bg-white rounded-2xl border border-slate-200 shadow-md p-8 text-center">
                <div className="w-14 h-14 mx-auto mb-4 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center text-2xl shadow-inner">
                  📄
                </div>
                <h2 className="text-xl font-bold text-slate-800 mb-2">
                  舞台セッティング表のPDFをアップロード
                </h2>
                <p className="text-sm text-slate-500 max-w-lg mx-auto mb-6 leading-relaxed">
                  指定のセッティング用紙PDFを読み込むと、ステージ図面と椅子・譜面台・机などのパーツを自動で切り出し、ドラッグ配置・個数集計・自動丸つけを行えます。
                </p>
                <PdfUploader onUploadSuccess={handleUploadSuccess} />
              </div>
            </div>
          ) : !extractedData ? (
            <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center justify-center">
              <RegionSelector imageUrl={fileData.image_url} onComplete={handleRegionsComplete} />
            </div>
          ) : (
            <>
              <StageBuilder 
                backgroundUrl={extractedData.backgroundUrl} 
                iconsRegionUrl={extractedData.iconsRegionUrl}
                extractedIcons={extractedData.extractedIcons} 
                backgroundCrop={backgroundCrop}
                fileId={fileData.file_id}
                pageImageUrl={fileData.image_url}
                initialIconLabels={iconLabels}
                onIconsUpdated={(icons) => setExtractedData(prev => prev ? { ...prev, extractedIcons: icons } : null)}
                onBack={() => {
                  setExtractedData(null);
                  setCurrentPhase(2);
                }}
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

