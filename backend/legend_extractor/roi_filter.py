from __future__ import annotations
import re
from typing import List, Set, Optional, Dict, Any, Tuple
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
        # Conservative fallback ROI leaving >= 18% margins on sides and 16% on top, 30% on bottom
        best_roi = fitz.Rect(p_w * 0.18, p_h * 0.16, p_w * 0.80, p_h * 0.70)

    layout_symbol_set: Set[str] = set()
    for ch in prims.chars:
        if (best_roi.x0 + 5.0) <= ch.rect.x0 and ch.rect.x1 <= (best_roi.x1 - 5.0) and \
           (best_roi.y0 + 5.0) <= ch.rect.y0 and ch.rect.y1 <= (best_roi.y1 - 5.0):
            if ch.is_symbol or (len(ch.norm_char) == 1 and not ch.norm_char.isalnum()):
                layout_symbol_set.add(ch.norm_char)

    return StageRoiInfo(best_roi, layout_symbol_set)

def is_circulation_or_stage_structure(text: str) -> bool:
    """Requirement 7.2: Exclude circulation and stage structure keywords."""
    for kw in cfg.circulation_keywords:
        if kw in text:
            return True
    return False

def get_circling_instruction_mask_spans(text: str) -> List[Tuple[int, int]]:
    """
    Requirement 1.2: Locally mask circling instructions like:
    赤○で囲んで, ○で囲む, ○印で囲む, ○をつける, （・を○で囲む）, (部は○で囲む), 下を〇で囲む
    Returns list of (start_idx, end_idx) in text whose characters must NOT be used as symbol glyphs.
    """
    spans: List[Tuple[int, int]] = []
    patterns = [
        r'赤[○◯〇O0]\s*(?:で|を)?\s*囲[むんで]',
        r'[（\(][^）\)]*?[○◯〇O0・]\s*(?:で|を)\s*囲[むんで][^）\)]*?[）\)]',
        r'(?:[○◯〇O0]|・)\s*印?\s*(?:で|を)\s*囲[むんで]',
        r'(?:[○◯〇O0]|・)\s*を\s*つけ[るた]',
        r'下を[○◯〇O0]\s*(?:で|を)\s*囲[むんで]',
        r'部は[○◯〇O0]\s*(?:で|を)\s*囲[むんで]',
    ]
    for pat in patterns:
        for m in re.finditer(pat, text):
            spans.append((m.start(), m.end()))
    return spans

def is_pure_quantity_aggregation(text: str) -> bool:
    """
    Requirement 2.1: Detect ONLY pure blank quantity entry fields lacking a symbol definition.
    e.g. 椅子 (   ) 個, 【譜面台】[    ] 本, ○椅子（  ）脚 (where ○ is preceding noise)
    Does NOT match '・譜面台  T  ____台' or '×…譜面台（最大70本）'.
    """
    t = text.strip()
    # (   ) followed by unit
    if re.search(r'[\(（]\s*[\)）]\s*(個|脚|本|台|枚|人)', t):
        return True
    if re.search(r'[\(（][^\)）]*(持参|借用)[^\)）]*(脚|本|台|個)[\)）]', t):
        return True
    if re.search(r'[\(（]\s*(脚|本|台|個)\s*[\)）]', t):
        return True
    # ○椅子（  ）脚
    if re.search(r'^[○◯〇O0]?\s*[\u4e00-\u9fa5]+\s*[\(（]\s*[\)）]\s*(個|脚|本|台|枚|人|名)', t):
        return True
    return False

def is_dummy_aggregation_or_selection_table(texts: List[str]) -> bool:
    """
    Requirement 1.1: Exclude tables containing selection keywords or tiered headers,
    UNLESS the table has a symbol column header (記号, 記 号, マーク, 印, 凡例).
    """
    all_text = " ".join(texts)
    for sym_hint in ["記号", "記 号", "マーク", "図記号", "シンボル"]:
        if sym_hint in all_text:
            return False

    for kw in cfg.selection_table_keywords:
        if kw in all_text:
            return True
    for hdr in cfg.exclude_table_headers:
        if hdr in all_text:
            return True
    return False

DIMENSION_PATTERN = re.compile(r'^[（\(]?\s*\d+(?:\.\d+)?\s*(?:m|cm|mm|間|尺)\s*[）\)]?$', re.IGNORECASE)

def is_dimension_text(text: str) -> bool:
    """Requirement 3.1: Check if text is a dimension like 18m, 9m, 1500cm, (6m)."""
    return bool(DIMENSION_PATTERN.match(text.strip()))

def has_dimension_text_near_box(box: fitz.Rect, page_words: List[Any], margin: float = 3.0) -> bool:
    """Checks if inside or within margin pt around box there is a dimension text."""
    check_rect = fitz.Rect(box.x0 - margin, box.y0 - margin, box.x1 + margin, box.y1 + margin)
    for w in page_words:
        r = fitz.Rect(w[:4])
        if r.intersects(check_rect):
            txt = w[4].strip()
            if is_dimension_text(txt):
                return True
    return False

def is_explanatory_note_sentence(text: str) -> bool:
    """Requirement 2.2: Pure explanatory sentence exclusion."""
    for kw in cfg.explanatory_note_keywords:
        if kw in text:
            return True
    return False

def contains_circulation_character_pairs(chars: List[Any]) -> bool:
    """
    Requirement 3.4: Rotated/angled circulation text in vector clusters.
    Character pair detection for 退場, 入場, 花道, 客席, 搬入, 搬出.
    """
    if not chars:
        return False
    s = "".join(getattr(c, "norm_char", getattr(c, "raw_char", "")) for c in chars)
    pairs = [("退", "場"), ("入", "場"), ("花", "道"), ("客", "席"), ("搬", "入"), ("搬", "出")]
    for c1, c2 in pairs:
        if c1 in s and c2 in s:
            return True
    return False

def matches_equipment_keyword_or_suffix(text: str) -> Optional[str]:
    """
    Requirement 1.4: Direct dictionary match OR suffix match for 2~8 char noun phrases ending in:
    椅子, イス, いす, チェアー, 譜面台, 指揮台, 長机, 机, テーブル.
    """
    clean = text.strip()
    for kw in cfg.equipment_keywords:
        if kw in clean:
            return kw
    for suf in cfg.equipment_suffixes:
        if clean.endswith(suf) and 2 <= len(clean) <= 8:
            return clean
    return None

def normalize_equipment_name_for_dedup(name: str) -> str:
    """
    Requirement 6 & 3.4: Normalize name for page-wide deduplication and synonym grouping.
    Strips tiered/location prefixes: ベタ, 1〜4段目, 1段目, 上段/中段/下段, <例>, etc.
    Groups synonyms: イス==いす==椅子, ピアノ用椅子==ピアノ椅子, 指揮者譜面台==指揮者用譜面台
    """
    s = name.strip()
    s = re.sub(
        r'^(?:ベタ|[1-6一二三四五六]段目|[1-6]〜[1-6]段目|[1-6]~[1-6]段目|[1-6]-[1-6]段目|上段|中段|下段|前列|後列|床面|[<＜【(（]例[>＞】)）]|凡例|記号)\s*',
        '',
        s
    )
    if s.startswith("電源使用") or s in ("電源100V", "電源 100V", "電源１００Ｖ"):
        s = "電源"
    s = s.replace(" ", "").replace("　", "")
    # Synonym normalization (Requirement 3.4)
    if s in ("イス", "いす"):
        s = "椅子"
    elif s in ("ピアノ用椅子", "ピアノイス", "ピアノ用いす"):
        s = "ピアノ椅子"
    elif s in ("指揮者譜面台", "合奏譜面台"):
        s = "合奏用譜面台" if s == "合奏譜面台" else "指揮者用譜面台"
    elif s == "合奏椅子":
        s = "合奏用椅子"
    return s
