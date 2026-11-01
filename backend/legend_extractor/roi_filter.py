from __future__ import annotations
from typing import List, Set, Optional, Dict, Any
import fitz
from .models import Box
from .primitives import PrimitivesCollection
from .config import cfg

class StageRoiInfo:
    def __init__(self, rect: fitz.Rect, layout_symbol_set: Set[str]):
        self.rect = rect
        self.box = Box.from_fitz_rect(rect)
        self.layout_symbol_set = layout_symbol_set

    def contains_point(self, x: float, y: float) -> bool:
        # A point with margin to avoid clipping edge boundaries
        return (self.rect.x0 + 8.0) <= x <= (self.rect.x1 - 8.0) and \
               (self.rect.y0 + 8.0) <= y <= (self.rect.y1 - 8.0)

    def is_inside_stage(self, r: fitz.Rect) -> bool:
        cx = (r.x0 + r.x1) / 2.0
        cy = (r.y0 + r.y1) / 2.0
        return self.contains_point(cx, cy)

def estimate_stage_roi_and_symbols(page: fitz.Page, prims: PrimitivesCollection) -> StageRoiInfo:
    page_rect = fitz.Rect(page.rect)
    p_w, p_h = page_rect.width, page_rect.height
    p_area = p_w * p_h

    # Scan drawings for large bounding boxes (stage outline, acoustic shell, layout grid)
    candidate_rects: List[fitz.Rect] = []
    drawings = page.get_drawings()
    for d in drawings:
        r = fitz.Rect(d["rect"])
        # If width > 35% of page and height > 20% of page, and area < 85% (not entire page boundary)
        if (r.width >= p_w * 0.35 and r.height >= p_h * 0.20) and (r.width * r.height < p_area * 0.90):
            candidate_rects.append(r)

    best_roi: Optional[fitz.Rect] = None
    if candidate_rects:
        # Sort by area descending
        candidate_rects.sort(key=lambda r: r.width * r.height, reverse=True)
        best_roi = candidate_rects[0]
    else:
        # Fallback heuristic: typical stage location is upper/middle 70% of sheet
        best_roi = fitz.Rect(p_w * 0.08, p_h * 0.12, p_w * 0.92, p_h * 0.80)

    # Collect symbols and text inside stage ROI for cross-validation
    layout_symbol_set: Set[str] = set()
    for ch in prims.chars:
        if (best_roi.x0 + 5.0) <= ch.rect.x0 and ch.rect.x1 <= (best_roi.x1 - 5.0) and \
           (best_roi.y0 + 5.0) <= ch.rect.y0 and ch.rect.y1 <= (best_roi.y1 - 5.0):
            if ch.is_symbol or (len(ch.norm_char) == 1 and not ch.norm_char.isalnum()):
                layout_symbol_set.add(ch.norm_char)

    return StageRoiInfo(best_roi, layout_symbol_set)

def is_instruction_or_caution_text(text: str) -> bool:
    s = text.strip()
    if not s:
        return False

    # Check prefixes
    for prefix in cfg.exclude_instruction_prefixes:
        if s.startswith(prefix):
            return True

    # Check instruction keywords
    for kw in cfg.exclude_instruction_keywords:
        if kw in s:
            return True

    return False

def is_dummy_aggregation_or_selection_table(texts: List[str]) -> bool:
    all_text = " ".join(texts)
    # Check aggregation headers (e.g. ひな壇, 1列目, 2列目, etc.)
    for hdr in cfg.exclude_table_headers:
        if hdr in all_text:
            return True
    return False
