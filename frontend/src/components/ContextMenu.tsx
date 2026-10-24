import React, { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { 
  FileText, 
  Shapes, 
  Spline, 
  Crosshair, 
  Copy, 
  ClipboardPaste, 
  CopyPlus, 
  Trash2 
} from 'lucide-react';
import { TEMPLATE_SHAPES, getTemplateDataUrl } from '../utils/templateShapes';
import type { ExtractedIcon } from '../App';

export interface ContextMenuProps {
  position: { x: number; y: number };
  canvasPos: { x: number; y: number };
  targetItemId?: string | null;
  selectedCount: number;
  extractedIcons: ExtractedIcon[];
  iconLabels: Record<string, string>;
  templateReplacements?: Record<string, string>;
  onAddTemplate: (tmplId: string, x: number, y: number) => void;
  onAddPdfIcon: (iconId: string, x: number, y: number) => void;
  onAddCurve: (x: number, y: number) => void;
  onMoveCenterTo: (x: number, y: number) => void;
  onDuplicate?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  canPaste?: boolean;
  onDelete?: () => void;
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  position,
  canvasPos,
  targetItemId,
  selectedCount,
  extractedIcons,
  iconLabels,
  templateReplacements,
  onAddTemplate,
  onAddPdfIcon,
  onAddCurve,
  onMoveCenterTo,
  onDuplicate,
  onCopy,
  onPaste,
  canPaste,
  onDelete,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState({ x: position.x, y: position.y });
  const [activeSubmenu, setActiveSubmenu] = useState<'template' | 'pdf' | null>(null);
  const submenuTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep menu within screen boundaries
  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    let x = position.x;
    let y = position.y;
    if (x + rect.width > window.innerWidth - 8) {
      x = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (y + rect.height > window.innerHeight - 8) {
      y = Math.max(8, window.innerHeight - rect.height - 8);
    }
    setAdjustedPos({ x, y });
  }, [position]);

  // Close on outside click or Escape key
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const handleSubmenuEnter = (type: 'template' | 'pdf') => {
    if (submenuTimeoutRef.current) clearTimeout(submenuTimeoutRef.current);
    setActiveSubmenu(type);
  };

  const handleSubmenuLeave = () => {
    submenuTimeoutRef.current = setTimeout(() => {
      setActiveSubmenu(null);
    }, 250);
  };

  // テンプレ置換されたID一覧
  const replacedTmplIdSet = React.useMemo(() => {
    return new Set(Object.values(templateReplacements || {}));
  }, [templateReplacements]);

  // Main categories of templates (置換済みテンプレは非表示)
  const coreTemplates = TEMPLATE_SHAPES.filter(
    t => !replacedTmplIdSet.has(t.id) && !replacedTmplIdSet.has(`tmpl_${t.type}`)
  );

  return (
    <div
      ref={menuRef}
      className="fixed z-50 liquid-context-menu rounded-2xl p-1.5 min-w-[220px] text-xs select-none animate-in fade-in zoom-in-95 duration-100"
      style={{ left: adjustedPos.x, top: adjustedPos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* ── PDF抽出パーツから追加 ── */}
      <div
        className="relative group px-3 py-2 rounded-xl hover:bg-[#007AFF]/12 text-slate-700 dark:text-slate-200 hover:text-[#007AFF] dark:hover:text-blue-400 flex items-center justify-between cursor-pointer transition-colors"
        onMouseEnter={() => handleSubmenuEnter('pdf')}
        onMouseLeave={handleSubmenuLeave}
      >
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#007AFF]" />
          <span className="font-medium">PDFパーツから追加</span>
        </div>
        <span className="text-[10px] text-slate-400">›</span>

        {/* PDF Submenu */}
        {activeSubmenu === 'pdf' && (
          <div
            className="absolute left-full top-0 ml-1.5 liquid-context-menu rounded-2xl p-1.5 min-w-[210px] max-h-[65vh] overflow-y-auto z-50"
            onMouseEnter={() => {
              if (submenuTimeoutRef.current) clearTimeout(submenuTimeoutRef.current);
            }}
            onMouseLeave={handleSubmenuLeave}
          >
            <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-200/50 dark:border-white/10 mb-1">
              PDF抽出パーツ
            </div>
            {extractedIcons.length === 0 ? (
              <div className="px-3 py-2 text-slate-400 text-[11px] italic">
                抽出パーツがありません
              </div>
            ) : (
              extractedIcons.map((icon, idx) => {
                const tmplId = templateReplacements?.[icon.id];
                const matchedTmpl = tmplId
                  ? TEMPLATE_SHAPES.find(t => t.id === tmplId || t.type === tmplId.replace(/^tmpl_/, ''))
                  : null;

                if (matchedTmpl) {
                  const effectiveTmplId = matchedTmpl.id || `tmpl_${matchedTmpl.type}`;
                  return (
                    <div
                      key={icon.id}
                      onClick={() => {
                        onAddTemplate(effectiveTmplId, canvasPos.x, canvasPos.y);
                        onClose();
                      }}
                      className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl hover:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 hover:text-emerald-950 cursor-pointer transition-colors"
                      title={`[テンプレ置換済] ${matchedTmpl.label}`}
                    >
                      <div className="w-5 h-5 flex items-center justify-center shrink-0">
                        <img src={getTemplateDataUrl(matchedTmpl)} alt="" className="max-w-full max-h-full object-contain" />
                      </div>
                      <span className="truncate flex-1 font-medium">{matchedTmpl.label}</span>
                      <span className="text-[9px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded-full font-semibold">テンプレ</span>
                    </div>
                  );
                }

                return (
                  <div
                    key={icon.id}
                    onClick={() => {
                      onAddPdfIcon(icon.id, canvasPos.x, canvasPos.y);
                      onClose();
                    }}
                    className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl hover:bg-[#007AFF]/12 text-slate-700 dark:text-slate-200 hover:text-[#007AFF] cursor-pointer transition-colors"
                  >
                    <div className="w-5 h-5 flex items-center justify-center shrink-0">
                      <img src={icon.url} alt="" className="max-w-full max-h-full object-contain" />
                    </div>
                    <span className="truncate">{iconLabels[icon.id] ?? `パーツ ${idx + 1}`}</span>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* ── テンプレートから追加 ── */}
      <div
        className="relative group px-3 py-2 rounded-xl hover:bg-[#007AFF]/12 text-slate-700 dark:text-slate-200 hover:text-[#007AFF] dark:hover:text-blue-400 flex items-center justify-between cursor-pointer transition-colors"
        onMouseEnter={() => handleSubmenuEnter('template')}
        onMouseLeave={handleSubmenuLeave}
      >
        <div className="flex items-center gap-2">
          <Shapes className="w-4 h-4 text-indigo-500" />
          <span className="font-medium">テンプレートから追加</span>
        </div>
        <span className="text-[10px] text-slate-400">›</span>

        {/* Template Submenu */}
        {activeSubmenu === 'template' && (
          <div
            className="absolute left-full top-0 ml-1.5 liquid-context-menu rounded-2xl p-1.5 min-w-[200px] max-h-[65vh] overflow-y-auto z-50"
            onMouseEnter={() => {
              if (submenuTimeoutRef.current) clearTimeout(submenuTimeoutRef.current);
            }}
            onMouseLeave={handleSubmenuLeave}
          >
            <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-200/50 dark:border-white/10 mb-1">
              標準テンプレート
            </div>
            {coreTemplates.map(tmpl => (
              <div
                key={tmpl.id || tmpl.type}
                onClick={() => {
                  onAddTemplate(tmpl.id || `tmpl_${tmpl.type}`, canvasPos.x, canvasPos.y);
                  onClose();
                }}
                className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl hover:bg-[#007AFF]/12 text-slate-700 dark:text-slate-200 hover:text-[#007AFF] cursor-pointer transition-colors"
              >
                <div className="w-5 h-5 flex items-center justify-center shrink-0">
                  <img src={getTemplateDataUrl(tmpl)} alt="" className="max-w-full max-h-full object-contain" />
                </div>
                <span className="truncate">{tmpl.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── ベジェ曲線を追加 ── */}
      <div
        onClick={() => {
          onAddCurve(canvasPos.x, canvasPos.y);
          onClose();
        }}
        className="px-3 py-2 rounded-xl hover:bg-[#007AFF]/12 text-slate-700 dark:text-slate-200 hover:text-[#007AFF] flex items-center gap-2 cursor-pointer transition-colors"
      >
        <Spline className="w-4 h-4 text-purple-500" />
        <span className="font-medium">ベジェ曲線（曲がる線）を追加</span>
      </div>

      <div className="h-px bg-slate-200/60 dark:bg-white/10 my-1 mx-2" />

      {/* ── 基準点をカーソル位置に移動 ── */}
      <div
        onClick={() => {
          onMoveCenterTo(canvasPos.x, canvasPos.y);
          onClose();
        }}
        className="px-3 py-2 rounded-xl hover:bg-rose-500/12 text-slate-700 dark:text-slate-200 hover:text-rose-600 flex items-center gap-2 cursor-pointer transition-colors"
      >
        <Crosshair className="w-4 h-4 text-[#ff2d55]" />
        <span className="font-medium">基準点をこの位置に移動</span>
      </div>

      {/* ── コピー / 貼り付け / 複製 / 削除 ── */}
      {(targetItemId || selectedCount > 0 || canPaste) && (
        <div className="h-px bg-slate-200/60 dark:bg-white/10 my-1 mx-2" />
      )}

      {(targetItemId || selectedCount > 0) && onCopy && (
        <div
          onClick={() => {
            onCopy();
            onClose();
          }}
          className="px-3 py-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200 flex items-center justify-between cursor-pointer transition-colors"
        >
          <div className="flex items-center gap-2">
            <Copy className="w-3.5 h-3.5" />
            <span>コピー</span>
          </div>
          <span className="text-[10px] text-slate-400 font-mono">Ctrl+C</span>
        </div>
      )}

      {canPaste && onPaste && (
        <div
          onClick={() => {
            onPaste();
            onClose();
          }}
          className="px-3 py-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200 flex items-center justify-between cursor-pointer transition-colors"
        >
          <div className="flex items-center gap-2">
            <ClipboardPaste className="w-3.5 h-3.5" />
            <span>貼り付け</span>
          </div>
          <span className="text-[10px] text-slate-400 font-mono">Ctrl+V</span>
        </div>
      )}

      {(targetItemId || selectedCount > 0) && onDuplicate && (
        <div
          onClick={() => {
            onDuplicate();
            onClose();
          }}
          className="px-3 py-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200 flex items-center justify-between cursor-pointer transition-colors"
        >
          <div className="flex items-center gap-2">
            <CopyPlus className="w-3.5 h-3.5" />
            <span>複製</span>
          </div>
          <span className="text-[10px] text-slate-400 font-mono">Ctrl+D</span>
        </div>
      )}

      {(targetItemId || selectedCount > 0) && onDelete && (
        <div
          onClick={() => {
            onDelete();
            onClose();
          }}
          className="px-3 py-1.5 rounded-xl hover:bg-rose-500/12 text-rose-600 dark:text-rose-400 flex items-center justify-between cursor-pointer transition-colors"
        >
          <div className="flex items-center gap-2">
            <Trash2 className="w-3.5 h-3.5" />
            <span>{selectedCount > 1 ? `選択した${selectedCount}個を削除` : '削除'}</span>
          </div>
          <span className="text-[10px] text-rose-400 font-mono">Delete</span>
        </div>
      )}
    </div>
  );
};
