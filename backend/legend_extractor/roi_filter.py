from __future__ import annotations
import re
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
        return (self.rect.x0 + 15.0) <= x <= (self.rect.x1 - 15.0) and \
               (self.rect.y0 + 15.0) <= y <= (self.rect.y1 - 15.0)

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
        # If width > 40% of page and height > 25% of page, and area < 85%
        if (r.width >= p_w * 0.40 and r.height >= p_h * 0.25) and (r.width * r.height < p_area * 0.85):
            candidate_rects.append(r)

    best_roi: Optional[fitz.Rect] = None
    if candidate_rects:
        candidate_rects.sort(key=lambda r: r.width * r.height, reverse=True)
        best_roi = candidate_rects[0]
    else:
        best_roi = fitz.Rect(p_w * 0.12, p_h * 0.15, p_w * 0.88, p_h * 0.75)

    layout_symbol_set: Set[str] = set()
    for ch in prims.chars:
        if (best_roi.x0 + 5.0) <= ch.rect.x0 and ch.rect.x1 <= (best_roi.x1 - 5.0) and \
           (best_roi.y0 + 5.0) <= ch.rect.y0 and ch.rect.y1 <= (best_roi.y1 - 5.0):
            if ch.is_symbol or (len(ch.norm_char) == 1 and not ch.norm_char.isalnum()):
                layout_symbol_set.add(ch.norm_char)

    return StageRoiInfo(best_roi, layout_symbol_set)

def is_quantity_entry_pattern(text: str) -> bool:
    """Detect blank quantity entry fields like: (   ) 個, (  )脚, （   ）本, (   )台, （持参・借用 脚）"""
    t = text.strip()
    # (   ) followed by unit
    if re.search(r'[\(（]\s*[\)）]\s*(個|脚|本|台|枚|人)', t):
        return True
    if re.search(r'[\(（][^\)）]*(持参|借用)[^\)）]*(脚|本|台|個)[\)）]', t):
        return True
    if re.search(r'[\(（]\s*(脚|本|台|個)\s*[\)）]', t):
        return True
    return False

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

    # Circle instruction: ○/〇 followed by を/で
    if re.search(r'[○◯〇O0]\s*(を|で|に)', s):
        return True

    # Check quantity entry pattern
    if is_quantity_entry_pattern(s):
        return True

    return False

def is_dummy_aggregation_or_selection_table(texts: List[str]) -> bool:
    all_text = " ".join(texts)
    for hdr in cfg.exclude_table_headers:
        if hdr in all_text:
            return True
    return False
