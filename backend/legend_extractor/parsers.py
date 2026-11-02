from __future__ import annotations
import re
from typing import List, Dict, Any, Tuple, Optional, Set
import fitz
import cv2
import numpy as np
from scipy.optimize import linear_sum_assignment

from .models import Box, SymbolType, ExtractedLegendItem
from .primitives import PrimitivesCollection, CharPrimitive, VectorClusterPrimitive, RasterPrimitive
from .roi_filter import (
    StageRoiInfo,
    is_dummy_aggregation_or_selection_table,
    is_circulation_or_stage_structure,
    get_circling_instruction_mask_spans,
    is_pure_quantity_aggregation,
    normalize_equipment_name_for_dedup
)
from .config import cfg

def get_span_text(sp: Dict[str, Any]) -> str:
    if "text" in sp and sp["text"]:
        return sp["text"]
    return "".join(c.get("c", "") for c in sp.get("chars", []))

class TableCell:
    def __init__(self, rect: fitz.Rect, text: str = ""):
        self.rect = rect
        self.text = text
        self.vectors: List[VectorClusterPrimitive] = []
        self.rasters: List[RasterPrimitive] = []
        self.chars: List[CharPrimitive] = []

# ==============================================================================
# Mode A: Strictly Limited to Physical Solid Line Grid Tables
# ==============================================================================

def parse_mode_a_tables(page: fitz.Page, prims: PrimitivesCollection, stage_info: StageRoiInfo) -> List[ExtractedLegendItem]:
    """
    Mode A ONLY operates on tables with explicit physical grid lines (horizontal and vertical lines
    forming closed/bounded grid cells). All borderless or whitespace aligned text is left for Mode B.
    """
    items: List[ExtractedLegendItem] = []
    page_rect = fitz.Rect(page.rect)

    drawings = page.get_drawings()
    h_lines: List[Tuple[float, float, float]] = []  # (y, x0, x1)
    v_lines: List[Tuple[float, float, float]] = []  # (x, y0, y1)

    for d in drawings:
        d_rect = fitz.Rect(d["rect"])
        if stage_info.is_inside_stage(d_rect):
            continue
        for it in d.get("items", []):
            cmd = it[0]
            if cmd == "l":
                p1, p2 = it[1], it[2]
                if abs(p1.y - p2.y) < 1.0 and abs(p1.x - p2.x) >= 35.0:
                    h_lines.append(((p1.y + p2.y) / 2.0, min(p1.x, p2.x), max(p1.x, p2.x)))
                elif abs(p1.x - p2.x) < 1.0 and abs(p1.y - p2.y) >= 20.0:
                    v_lines.append(((p1.x + p2.x) / 2.0, min(p1.y, p2.y), max(p1.y, p2.y)))
            elif cmd == "re":
                r = fitz.Rect(it[1])
                if r.width >= 35.0 and r.height <= 2.0:
                    h_lines.append(((r.y0 + r.y1) / 2.0, r.x0, r.x1))
                elif r.height >= 20.0 and r.width <= 2.0:
                    v_lines.append(((r.x0 + r.x1) / 2.0, r.y0, r.y1))
                elif r.width >= 35.0 and r.height >= 20.0:
                    h_lines.append((r.y0, r.x0, r.x1))
                    h_lines.append((r.y1, r.x0, r.x1))
                    v_lines.append((r.x0, r.y0, r.y1))
                    v_lines.append((r.x1, r.y0, r.y1))

    if len(h_lines) < 3 or len(v_lines) < 3:
        return []

    # Cluster H lines by Y (within 2pt)
    h_clusters: Dict[int, List[Tuple[float, float, float]]] = {}
    for y, x0, x1 in h_lines:
        ky = round(y / 2.0)
        h_clusters.setdefault(ky, []).append((y, x0, x1))

    # Cluster V lines by X (within 2pt)
    v_clusters: Dict[int, List[Tuple[float, float, float]]] = {}
    for x, y0, y1 in v_lines:
        kx = round(x / 2.0)
        v_clusters.setdefault(kx, []).append((x, y0, y1))

    if len(h_clusters) < 3 or len(v_clusters) < 3:
        return []

    y_levels = sorted([sum(l[0] for l in group)/len(group) for group in h_clusters.values()])
    x_levels = sorted([sum(l[0] for l in group)/len(group) for group in v_clusters.values()])

    grid_y_spans: List[List[float]] = []
    curr_y_span = [y_levels[0]]
    for i in range(1, len(y_levels)):
        gap = y_levels[i] - y_levels[i-1]
        if 10.0 <= gap <= 55.0:
            curr_y_span.append(y_levels[i])
        else:
            if len(curr_y_span) >= 3:
                grid_y_spans.append(curr_y_span)
            curr_y_span = [y_levels[i]]
    if len(curr_y_span) >= 3:
        grid_y_spans.append(curr_y_span)

    if not grid_y_spans:
        return []

    for y_span in grid_y_spans:
        table_top, table_bottom = y_span[0], y_span[-1]
        v_in_span = []
        for x in x_levels:
            matching_v = any(abs(l[0] - x) < 3.0 and l[1] <= table_top + 5.0 and l[2] >= table_bottom - 5.0 for l in v_lines)
            if matching_v:
                v_in_span.append(x)

        if len(v_in_span) < 3:
            continue

        table_rect = fitz.Rect(v_in_span[0] - 2.0, table_top - 2.0, v_in_span[-1] + 2.0, table_bottom + 2.0)

        raw = page.get_text("rawdict", clip=table_rect)
        table_texts: List[str] = []
        for b in raw.get("blocks", []):
            if b.get("type") == 0:
                for l in b.get("lines", []):
                    lt = "".join(get_span_text(s) for s in l.get("spans", [])).strip()
                    if lt:
                        table_texts.append(lt)

        # REJECT if selection table (山梨 piano table) or tiered header table
        if is_dummy_aggregation_or_selection_table(table_texts):
            continue

        matched_equip_count = sum(1 for kw in cfg.equipment_keywords if any(kw in t for t in table_texts))
        if matched_equip_count < 2:
            continue

        num_rows = len(y_span) - 1
        num_cols = len(v_in_span) - 1
        grid_cells: List[List[TableCell]] = []

        for r_idx in range(num_rows):
            row_cells: List[TableCell] = []
            cy0, cy1 = y_span[r_idx], y_span[r_idx + 1]
            for c_idx in range(num_cols):
                cx0, cx1 = v_in_span[c_idx], v_in_span[c_idx + 1]
                c_rect = fitz.Rect(cx0, cy0, cx1, cy1)
                cell = TableCell(c_rect, "")

                for ch in prims.chars:
                    if c_rect.contains(fitz.Point((ch.rect.x0 + ch.rect.x1)/2.0, (ch.rect.y0 + ch.rect.y1)/2.0)):
                        cell.chars.append(ch)
                        cell.text += ch.norm_char

                for v in prims.vectors:
                    if c_rect.contains(fitz.Point((v.rect.x0 + v.rect.x1)/2.0, (v.rect.y0 + v.rect.y1)/2.0)):
                        # Requirement 7.1: Exclude vectors that touch or replicate cell borders
                        if v.rect.width < (cx1 - cx0 - 4.0) and v.rect.height < (cy1 - cy0 - 4.0):
                            cell.vectors.append(v)

                for img in prims.rasters:
                    if c_rect.contains(fitz.Point((img.rect.x0 + img.rect.x1)/2.0, (img.rect.y0 + img.rect.y1)/2.0)):
                        cell.rasters.append(img)

                row_cells.append(cell)
            grid_cells.append(row_cells)

        ROLES = ['no', 'name', 'symbol', 'quantity']
        score_matrix = np.zeros((len(ROLES), num_cols), dtype=float)

        for c_idx in range(num_cols):
            col_cells = [grid_cells[r][c_idx] for r in range(num_rows)]
            col_texts = [cell.text.strip() for cell in col_cells if cell.text.strip()]
            header_text = col_texts[0].lower() if col_texts else ""
            data_texts = col_texts[1:] if len(col_texts) > 1 else col_texts

            s_no = 0.0
            for hint in cfg.column_header_hints.get("no", []):
                if hint in header_text:
                    s_no += 15.0
            int_count = sum(1 for t in data_texts if t.isdigit())
            if int_count >= max(1, len(data_texts) * 0.6):
                s_no += 10.0
            score_matrix[0, c_idx] = s_no

            s_name = 0.0
            for hint in cfg.column_header_hints.get("name", []):
                if hint in header_text:
                    s_name += 15.0
            kw_hits = sum(1 for t in col_texts if any(kw in t for kw in cfg.equipment_keywords))
            s_name += kw_hits * 10.0
            score_matrix[1, c_idx] = s_name

            s_sym = 0.0
            for hint in cfg.column_header_hints.get("symbol", []):
                if hint in header_text:
                    s_sym += 15.0
            vec_count = sum(len(c.vectors) + len(c.rasters) for c in col_cells)
            s_sym += vec_count * 10.0
            sym_char_count = sum(1 for t in col_texts if any(ch in cfg.standard_symbols for ch in t))
            s_sym += sym_char_count * 8.0
            if c_idx > 0 and any("記号" in grid_cells[r][c_idx - 1].text for r in range(num_rows)):
                s_sym += 25.0
            if int_count >= max(2, len(data_texts) * 0.7) and vec_count == 0:
                s_sym -= 30.0
            score_matrix[2, c_idx] = s_sym

            s_qty = 0.0
            for hint in cfg.column_header_hints.get("quantity", []):
                if hint in header_text:
                    s_qty += 15.0
            score_matrix[3, c_idx] = s_qty

        dim = max(len(ROLES), num_cols)
        cost = np.zeros((dim, dim), dtype=float)
        for r in range(len(ROLES)):
            for c in range(num_cols):
                cost[r, c] = -score_matrix[r, c]

        row_ind, col_ind = linear_sum_assignment(cost)
        role_map = {}
        for r_idx, c_idx in zip(row_ind, col_ind):
            if r_idx < len(ROLES) and c_idx < num_cols:
                role_map[ROLES[r_idx]] = c_idx

        name_c = role_map.get('name')
        sym_c = role_map.get('symbol')

        if name_c is not None and sym_c is not None and name_c != sym_c:
            start_row = 0 if any(kw in grid_cells[0][name_c].text for kw in cfg.equipment_keywords) else 1
            for r_idx in range(start_row, num_rows):
                name_cell = grid_cells[r_idx][name_c]
                sym_cell = grid_cells[r_idx][sym_c]

                raw_name = name_cell.text.strip()
                matched_kw = next((kw for kw in cfg.equipment_keywords if kw in raw_name), None)
                if not matched_kw:
                    continue

                clean_name = clean_equipment_label(raw_name)
                lbl_box = Box.from_fitz_rect(name_cell.rect)
                if name_cell.chars:
                    r_txt = fitz.Rect(name_cell.chars[0].rect)
                    for ch in name_cell.chars[1:]:
                        r_txt |= ch.rect
                    lbl_box = Box.from_fitz_rect(r_txt)

                sym_box: Optional[Box] = None
                sym_type = SymbolType.VECTOR_DRAWING.value
                raw_sym_text: Optional[str] = None
                tgt_char_rect: Optional[fitz.Rect] = None

                if sym_cell.vectors:
                    v = sym_cell.vectors[0]
                    sym_box = v.box
                    sym_type = SymbolType.VECTOR_DRAWING.value
                elif sym_cell.rasters:
                    r = sym_cell.rasters[0]
                    sym_box = r.box
                    sym_type = SymbolType.RASTER_IMAGE.value
                elif sym_cell.chars:
                    sym_ch = next((c for c in sym_cell.chars if c.norm_char in cfg.standard_symbols), sym_cell.chars[0])
                    sym_box = Box.from_fitz_rect(sym_ch.rect)
                    sym_type = SymbolType.TEXT_GLYPH.value
                    raw_sym_text = sym_ch.norm_char
                    tgt_char_rect = sym_ch.rect

                if sym_box is not None:
                    items.append(ExtractedLegendItem(
                        name=clean_name,
                        symbol_box=sym_box,
                        label_box=lbl_box,
                        symbol_type=sym_type,
                        confidence=0.98,
                        source_mode="table",
                        raw_symbol_text=raw_sym_text,
                        target_char_rect=tgt_char_rect,
                        priority=3
                    ))

    return items

# ==============================================================================
# Helpers for Label Cleaning and 300DPI Fallback
# ==============================================================================

def clean_equipment_label(text: str) -> str:
    """
    Requirement 3.3: Clean prefix/suffix noise from label name.
    e.g. <例> イス -> イス, 【例】譜面台 -> 譜面台, 電源使用 -> 電源, 譜面台（最大70本） -> 譜面台
    """
    s = text.strip()
    # Strip prefixes: <例>, ＜例＞, 【例】, (例), （例）, 記入例, 凡例, 記号, ・, ※
    s = re.sub(r'^(?:[<＜【(（]例[>＞】)）]|記入例|凡例|記号|・|※|＊|\*|注)+\s*', '', s)
    # Strip quantity notes: （最大70本）, (最大...本), （70本）, etc. (Requirement 2.3)
    s = re.sub(r'[（\(]\s*(?:最大)?\s*\d+\s*(?:本|脚|台|個|人|枚)\s*[）\)]', '', s)
    # Strip leading/trailing punctuation/whitespace
    s = s.strip(" \t:：・―ー-＝=")
    # Strip trailing 電源使用 -> 電源, 電源100V -> 電源
    if s.startswith("電源使用") or s in ("電源100V", "電源 100V"):
        s = "電源"
    return s

def check_300dpi_pixel_fallback(page: fitz.Page, slot_rect: fitz.Rect) -> Optional[fitz.Rect]:
    """
    Requirement 4.3: 300DPI image fallback.
    If delim found but no primitive found in [delim.x1 + 1pt, delim.x1 + 38pt],
    render 300DPI image, Otsu binarize, connectedComponentsWithStats.
    If a black pixel blob of size 3pt~26pt exists, return its bounding box.
    """
    if slot_rect.width < 2.0 or slot_rect.height < 2.0:
        return None
    scale = 300.0 / 72.0
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat, clip=slot_rect, colorspace=fitz.csGRAY)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape((pix.height, pix.width))
    _, binary = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(binary, connectivity=8)

    min_px = int(3.0 * scale)
    max_px = int(26.0 * scale)

    cand_rects = []
    for lbl in range(1, num_labels):
        x, y, w, h, area = stats[lbl]
        if min_px <= w <= max_px and min_px <= h <= max_px:
            cand_rects.append((x, y, w, h))

    if cand_rects:
        cand_rects.sort(key=lambda b: b[0])
        x, y, w, h = cand_rects[0]
        pdf_x0 = slot_rect.x0 + (x / scale)
        pdf_y0 = slot_rect.y0 + (y / scale)
        pdf_w = w / scale
        pdf_h = h / scale
        return fitz.Rect(pdf_x0, pdf_y0, pdf_x0 + pdf_w, pdf_y0 + pdf_h)
    return None

# ==============================================================================
# Mode B: Space-transparent Chunks & Local Pairs
# ==============================================================================

def parse_mode_b_inlines_and_margins(
    page: fitz.Page,
    prims: PrimitivesCollection,
    stage_info: StageRoiInfo
) -> List[ExtractedLegendItem]:
    items: List[ExtractedLegendItem] = []

    # Requirement 3.1: Detect vertical lines ("l" line segments AND "re" rectangles' left/right borders)
    drawings = page.get_drawings()
    v_line_segments: List[Tuple[float, float, float]] = []  # (x, y0, y1)
    for d in drawings:
        for it in d.get("items", []):
            if it[0] == "l":
                p1, p2 = it[1], it[2]
                if abs(p1.x - p2.x) < 1.0 and abs(p1.y - p2.y) >= 10.0:
                    v_line_segments.append(((p1.x + p2.x)/2.0, min(p1.y, p2.y), max(p1.y, p2.y)))
            elif it[0] == "re":
                r = fitz.Rect(it[1])
                if r.height >= 10.0:
                    v_line_segments.append((r.x0, r.y0, r.y1))
                    v_line_segments.append((r.x1, r.y0, r.y1))

    # Step 1: Group chars into lines by vertical alignment
    all_chars = sorted(prims.chars, key=lambda c: (c.rect.y0, c.rect.x0))
    raw_lines: List[List[CharPrimitive]] = []

    for c in all_chars:
        if not c.norm_char or c.norm_char.isspace():
            continue

        cy = (c.rect.y0 + c.rect.y1) / 2.0
        ch_h = max(2.0, c.rect.height)

        matched_line: Optional[List[CharPrimitive]] = None
        for l in raw_lines:
            line_y = sum((ch.rect.y0 + ch.rect.y1)/2.0 for ch in l) / len(l)
            line_h = sum(ch.rect.height for ch in l) / len(l)
            if abs(cy - line_y) <= 0.60 * line_h:
                matched_line = l
                break

        if matched_line is not None:
            matched_line.append(c)
        else:
            raw_lines.append([c])

    # Step 2: Split lines into Local Chunks
    # Requirement 3.1: Threshold 42.0pt and vertical border crossings
    chunks: List[List[CharPrimitive]] = []
    max_chunk_gap = float(cfg.thresholds.get("max_line_chunk_gap_pt", 42.0))

    for l in raw_lines:
        l.sort(key=lambda c: c.rect.x0)
        curr_chunk: List[CharPrimitive] = []

        for c in l:
            if not curr_chunk:
                curr_chunk.append(c)
            else:
                prev_c = curr_chunk[-1]
                gap = c.rect.x0 - prev_c.rect.x1

                # Check if a vertical line segment crosses between prev_c and c
                crosses_vline = False
                for vx, vy0, vy1 in v_line_segments:
                    if prev_c.rect.x1 < vx < c.rect.x0:
                        y_mid = (c.rect.y0 + c.rect.y1) / 2.0
                        if vy0 - 2.0 <= y_mid <= vy1 + 2.0:
                            crosses_vline = True
                            break

                # After an explicit delimiter, allow gap up to 100pt for wide-spaced symbol alignment
                is_delim = prev_c.norm_char in cfg.delimiters or prev_c.norm_char in "→⇒➡＝=…‥:：ー―－-"
                gap_limit = 100.0 if is_delim else max_chunk_gap

                if gap > gap_limit or crosses_vline:
                    if curr_chunk:
                        chunks.append(curr_chunk)
                    curr_chunk = [c]
                else:
                    curr_chunk.append(c)

        if curr_chunk:
            chunks.append(curr_chunk)

    # Step 3 & 4: Parse each local chunk
    for chunk in chunks:
        chunk_items = parse_single_chunk(chunk, prims, stage_info, page)
        items.extend(chunk_items)

    # Margin standalone vector miniatures (outside stage ROI)
    # Pass already claimed items to prevent duplicate stealing
    margin_items = parse_margin_miniatures(
        page, prims, stage_info,
        claimed_items=items
    )
    items.extend(margin_items)

    return items

def parse_single_chunk(
    chunk_chars: List[CharPrimitive],
    prims: PrimitivesCollection,
    stage_info: StageRoiInfo,
    page: fitz.Page
) -> List[ExtractedLegendItem]:
    items: List[ExtractedLegendItem] = []
    if not chunk_chars:
        return items

    raw_text = "".join(c.norm_char for c in chunk_chars)

    # Requirement 7.2: Exclude stage circulation & structure text (入場, 退場, 花道, 搬入, 搬出, etc.)
    if is_circulation_or_stage_structure(raw_text):
        return items

    # Requirement 2.1: Exclude ONLY pure quantity aggregations without symbol definitions
    if is_pure_quantity_aggregation(raw_text):
        return items

    # Requirement 1.2: Locally mask circling instructions (赤○で囲む, ○で囲む, （・を○で囲む）, etc.)
    mask_spans = get_circling_instruction_mask_spans(raw_text)
    masked_char_indices = set()
    for ms, me in mask_spans:
        for k in range(ms, me):
            masked_char_indices.add(k)

    # Non-symbol characters: bullet, instruction prefixes, note prefixes
    FORBIDDEN_SYMBOL_CHARS = set("※＊*注・:：;；、。")

    # Step A: 1-to-1 exact index mapping from raw_text to chunk_chars (Requirement 3.2)
    # Eliminates drift when norm_char has multiple characters (e.g. '…' -> '...')
    raw_text = ""
    char_idx_map: List[int] = []
    for c_idx, c in enumerate(chunk_chars):
        for ch in c.norm_char:
            raw_text += ch
            char_idx_map.append(c_idx)

    matched_spans: List[Tuple[int, int, str]] = []  # (start_raw_idx, end_raw_idx, kw)

    # 1. Direct dictionary keyword search
    for kw in cfg.equipment_keywords:
        pos = 0
        while True:
            idx = raw_text.find(kw, pos)
            if idx == -1:
                break
            # Boundary check for Katakana keywords (e.g. イス should not match inside ハイスタッフホール)
            is_katakana_kw = all("\u30a0" <= ch <= "\u30ff" for ch in kw)
            if is_katakana_kw:
                if idx > 0 and "\u30a0" <= raw_text[idx - 1] <= "\u30ff":
                    pre_slice = raw_text[:idx]
                    if not any(pre_slice.endswith(p) for p in ("ピアノ", "オルガン", "チェロ")):
                        pos = idx + 1
                        continue
                if idx + len(kw) < len(raw_text) and "\u30a0" <= raw_text[idx + len(kw)] <= "\u30ff":
                    pos = idx + 1
                    continue
            matched_spans.append((idx, idx + len(kw), kw))
            pos = idx + 1

    # 2. Justified spacing search for 2~4 char keywords (e.g. 椅  子, 譜 面 台, 電  源)
    # Requirement 3.1: Only when gap <= 55pt
    for kw in ["椅子", "イス", "譜面台", "電源", "長机", "指揮台", "ピアノ"]:
        kw_chars = list(kw)
        pat = r"\s*".join(re.escape(ch) for ch in kw_chars)
        for m in re.finditer(pat, raw_text):
            s_idx, e_idx = m.start(), m.end()
            # Boundary check for Katakana keywords (e.g. イス should not match inside ハイスタッフホール)
            is_katakana_kw = all("\u30a0" <= ch <= "\u30ff" for ch in kw)
            if is_katakana_kw:
                if s_idx > 0 and "\u30a0" <= raw_text[s_idx - 1] <= "\u30ff":
                    pre_slice = raw_text[:s_idx]
                    if not any(pre_slice.endswith(p) for p in ("ピアノ", "オルガン", "チェロ")):
                        continue
                if e_idx < len(raw_text) and "\u30a0" <= raw_text[e_idx] <= "\u30ff":
                    continue
            c_s = char_idx_map[s_idx]
            c_e = char_idx_map[e_idx - 1] + 1
            valid_justified = True
            for k in range(c_s, c_e - 1):
                gap = chunk_chars[k + 1].rect.x0 - chunk_chars[k].rect.x1
                if gap > 55.0:
                    valid_justified = False
                    break
            if valid_justified:
                matched_spans.append((s_idx, e_idx, kw))

    if not matched_spans:
        return items

    def is_valid_noun_expand_char(ch: str) -> bool:
        if len(ch) != 1:
            return False
        # Do not expand across delimiters or sound marks
        if ch in ("ー", "―", "－", "-", "～", "〜", "・", ":", "：", " ", "　"):
            return False
        if "\u4e00" <= ch <= "\u9fff":
            return ch not in ("は", "が", "を", "に", "へ", "で", "と", "印", "例", "注")
        if "\u30a0" <= ch <= "\u30ff":
            return True
        if ch in ("の", "用", "型", "式", "製", "持", "ち", "込", "み", "通", "常", "借"):
            return True
        return False

    # Requirement 3.3: Expand compound nouns (e.g. ピアノ + 用 + 椅子 -> ピアノ用椅子, 会館の通常 + 椅子 -> 会館の通常椅子, 電源 + 使用 -> 電源使用)
    expanded_spans: List[Tuple[int, int, str]] = []
    for s, e, kw in matched_spans:
        exp_s = s
        while exp_s > 0:
            c_curr_idx = char_idx_map[exp_s]
            c_prev_idx = char_idx_map[exp_s - 1]
            if c_curr_idx != c_prev_idx:
                gap = chunk_chars[c_curr_idx].rect.x0 - chunk_chars[c_prev_idx].rect.x1
                if gap > 2.5:
                    break
            prev_ch = raw_text[exp_s - 1]
            if is_valid_noun_expand_char(prev_ch):
                exp_s -= 1
            else:
                break
        exp_e = e
        while exp_e < len(raw_text):
            c_curr_idx = char_idx_map[exp_e - 1]
            c_next_idx = char_idx_map[exp_e]
            if c_curr_idx != c_next_idx:
                gap = chunk_chars[c_next_idx].rect.x0 - chunk_chars[c_curr_idx].rect.x1
                if gap > 2.5:
                    break
            next_ch = raw_text[exp_e]
            if is_valid_noun_expand_char(next_ch) or next_ch in ("使", "用"):
                exp_e += 1
            else:
                break
        full_noun = raw_text[exp_s:exp_e]
        expanded_spans.append((exp_s, exp_e, full_noun))

    # Longest Match Non-overlapping NMS (Requirement 3.2)
    expanded_spans.sort(key=lambda t: (t[1] - t[0]), reverse=True)
    kept_nouns: List[Tuple[int, int, str]] = []
    for s, e, text in expanded_spans:
        overlap = any(max(s, ks) < min(e, ke) for ks, ke, _ in kept_nouns)
        if not overlap:
            kept_nouns.append((s, e, text))

    kept_nouns.sort(key=lambda t: t[0])
    if not kept_nouns:
        return items

    # For each equipment noun in chunk, search for its paired symbol
    for i, (n_s, n_e, kw_name) in enumerate(kept_nouns):
        start_c_idx = char_idx_map[n_s]
        end_c_idx = char_idx_map[n_e - 1] + 1

        noun_chars = chunk_chars[start_c_idx:end_c_idx]
        raw_noun_text = "".join(c.norm_char for c in noun_chars)
        clean_noun = clean_equipment_label(raw_noun_text)

        # Clamping label_box strictly to the cleaned noun characters
        clean_s = raw_noun_text.find(clean_noun)
        if clean_s != -1:
            lbl_c_s = start_c_idx + clean_s
            lbl_c_e = min(len(chunk_chars), lbl_c_s + len(clean_noun))
            target_lbl_chars = chunk_chars[lbl_c_s:lbl_c_e] if lbl_c_s < lbl_c_e else noun_chars
        else:
            target_lbl_chars = noun_chars

        lbl_rect = fitz.Rect(target_lbl_chars[0].rect)
        for lc in target_lbl_chars[1:]:
            lbl_rect |= lc.rect

        kw_x0 = lbl_rect.x0
        kw_x1 = lbl_rect.x1

        # Search window boundaries: right boundary is next keyword or chunk end
        if i + 1 < len(kept_nouns):
            next_kw_s = kept_nouns[i + 1][0]
            next_kw_c_idx = char_idx_map[next_kw_s]
            max_search_x = chunk_chars[next_kw_c_idx].rect.x0 - 1.0
        else:
            # Allow vector search window to extend beyond the last text character (colon)
            max_search_x = kw_x1 + 140.0

        right_chars = [c for c in chunk_chars[end_c_idx:] if kw_x1 <= c.rect.x0 <= max_search_x]
        right_text = "".join(c.norm_char for c in right_chars)

        pair_item: Optional[ExtractedLegendItem] = None

        # ----------------------------------------------------------------------
        # Priority 1: Bracket Pattern 名称(記号) (Requirement 5)
        # ----------------------------------------------------------------------
        m_br = re.search(r'([\(（])([^\)）]+)([\)）])', right_text)
        if m_br and not pair_item:
            inside_str = m_br.group(2).strip()
            # Must NOT be a quantity unit or blank
            if not any(u in inside_str for u in ["個", "脚", "本", "台", "枚", "人", "持参", "借用"]):
                # Identify open bracket and close bracket char primitives
                open_br_pos = right_text.find(m_br.group(0))
                open_char = right_chars[open_br_pos]
                close_char_pos = open_br_pos + len(m_br.group(0)) - 1
                close_char = right_chars[close_char_pos] if close_char_pos < len(right_chars) else open_char

                inner_clamp_rect = fitz.Rect(
                    open_char.rect.x1 + 0.3,
                    min(open_char.rect.y0, close_char.rect.y0),
                    close_char.rect.x0 - 0.3,
                    max(open_char.rect.y1, close_char.rect.y1)
                )

                # 1a: Character glyph inside bracket:
                # Accept standard symbol OR single uppercase letter (A-Z) (Requirement 4.2)
                inside_c_idx = open_br_pos + 1
                if inside_c_idx < len(right_chars):
                    target_c = right_chars[inside_c_idx]
                    target_sym = target_c.norm_char
                    if target_sym in ("X", "x"):
                        target_sym = "×"
                    elif target_sym in ("O", "o"):
                        target_sym = "○"

                    is_valid_sym = (target_sym in cfg.standard_symbols) or (len(target_sym) == 1 and target_sym.isupper() and target_sym.isascii())
                    if is_valid_sym and target_sym not in FORBIDDEN_SYMBOL_CHARS:
                        pair_item = ExtractedLegendItem(
                            name=clean_noun,
                            symbol_box=Box.from_fitz_rect(target_c.rect),
                            label_box=Box.from_fitz_rect(lbl_rect),
                            symbol_type=SymbolType.TEXT_GLYPH.value,
                            confidence=0.98,
                            source_mode="inline",
                            raw_symbol_text=target_sym,
                            target_char_rect=target_c.rect,
                            inner_clamp_rect=inner_clamp_rect,
                            bracket_rects=[open_char.rect, close_char.rect],
                            priority=3
                        )

                # 1b: Small vector inside the bracket (e.g. ピアノ椅子 (■) or (||))
                if not pair_item:
                    for v in prims.vectors:
                        if (inner_clamp_rect.x0 - 1.0 <= v.rect.x0 and v.rect.x1 <= inner_clamp_rect.x1 + 1.0) and \
                           (lbl_rect.y0 - 5.0 <= v.rect.y0 <= lbl_rect.y1 + 5.0):
                            if 2.0 <= v.rect.width <= 32.0 and 2.0 <= v.rect.height <= 32.0:
                                pair_item = ExtractedLegendItem(
                                    name=clean_noun,
                                    symbol_box=Box.from_fitz_rect(v.rect),
                                    label_box=Box.from_fitz_rect(lbl_rect),
                                    symbol_type=SymbolType.VECTOR_DRAWING.value,
                                    confidence=0.97,
                                    source_mode="inline",
                                    inner_clamp_rect=inner_clamp_rect,
                                    bracket_rects=[open_char.rect, close_char.rect],
                                    priority=3
                                )
                                break

        # ----------------------------------------------------------------------
        # Priority 2: In-Sentence "〜は[記号]" Pattern (Requirement 1.3)
        # e.g. 会館の通常椅子は○印, 会館のピアノ椅子は (P), 持ち込み椅子は●, 借用ピアノ椅子は [hベクター] と記入
        # ----------------------------------------------------------------------
        if not pair_item:
            m_wa = re.search(r'^\s*は\s*', right_text)
            if m_wa:
                wa_end = m_wa.end()
                wa_char_idx = n_e + len(m_wa.group(0)) - 1
                wa_c_rect = chunk_chars[wa_char_idx].rect if wa_char_idx < len(chunk_chars) else lbl_rect

                post_wa_chars = right_chars[wa_end:]
                post_wa_text = "".join(c.norm_char for c in post_wa_chars)

                # 2a: Bracketed glyph right after は (e.g. 会館のピアノ椅子は (P))
                m_wa_br = re.search(r'^\s*([\(（])([^\)）]+)([\)）])', post_wa_text)
                if m_wa_br:
                    br_sym_str = m_wa_br.group(2).strip()
                    open_br_pos = post_wa_text.find(m_wa_br.group(0))
                    open_char = post_wa_chars[open_br_pos]
                    close_char_pos = open_br_pos + len(m_wa_br.group(0)) - 1
                    close_char = post_wa_chars[close_char_pos] if close_char_pos < len(post_wa_chars) else open_char
                    inner_clamp_rect = fitz.Rect(
                        open_char.rect.x1 + 0.3,
                        min(open_char.rect.y0, close_char.rect.y0),
                        close_char.rect.x0 - 0.3,
                        max(open_char.rect.y1, close_char.rect.y1)
                    )
                    inside_c_idx = open_br_pos + 1
                    if inside_c_idx < len(post_wa_chars):
                        target_c = post_wa_chars[inside_c_idx]
                        pair_item = ExtractedLegendItem(
                            name=clean_noun,
                            symbol_box=Box.from_fitz_rect(target_c.rect),
                            label_box=Box.from_fitz_rect(lbl_rect),
                            symbol_type=SymbolType.TEXT_GLYPH.value,
                            confidence=0.98,
                            source_mode="inline",
                            raw_symbol_text=target_c.norm_char,
                            target_char_rect=target_c.rect,
                            inner_clamp_rect=inner_clamp_rect,
                            bracket_rects=[open_char.rect, close_char.rect],
                            priority=3
                        )

                # 2b: Text glyph following は (e.g. ○印, ●, ✖印)
                if not pair_item:
                    m_wa_sym = re.search(r'^\s*([○●×□■△▲☆★◎◇◆①-⑩XxOoP-Z]|[^\s　]{1,2})(?:印|と記入|で記入|、|。|$)', post_wa_text)
                    if m_wa_sym:
                        sym_cand = m_wa_sym.group(1).strip()
                        if sym_cand in ("X", "x"):
                            sym_cand = "×"
                        elif sym_cand in ("O", "o"):
                            sym_cand = "○"

                        is_valid = (sym_cand in cfg.standard_symbols) or (len(sym_cand) == 1 and sym_cand.isupper() and sym_cand.isascii())
                        if is_valid and sym_cand not in FORBIDDEN_SYMBOL_CHARS:
                            offset = post_wa_text.find(m_wa_sym.group(1))
                            if offset < len(post_wa_chars):
                                target_c = post_wa_chars[offset]
                                pair_item = ExtractedLegendItem(
                                    name=clean_noun,
                                    symbol_box=Box.from_fitz_rect(target_c.rect),
                                    label_box=Box.from_fitz_rect(lbl_rect),
                                    symbol_type=SymbolType.TEXT_GLYPH.value,
                                    confidence=0.97,
                                    source_mode="inline",
                                    raw_symbol_text=sym_cand,
                                    target_char_rect=target_c.rect,
                                    priority=3
                                )

                # 2c: Inline vector drawing between は and と記入/で記入/、
                if not pair_item:
                    search_slot_x0 = wa_c_rect.x1
                    search_slot_x1 = search_slot_x0 + 40.0
                    if post_wa_chars:
                        search_slot_x1 = min(search_slot_x1, post_wa_chars[0].rect.x0)

                    for v in prims.vectors:
                        if (search_slot_x0 - 2.0 <= v.rect.x0 <= search_slot_x1 + 2.0) and \
                           (lbl_rect.y0 - 8.0 <= v.rect.y0 <= lbl_rect.y1 + 8.0):
                            if 3.0 <= v.rect.width <= 35.0 and 3.0 <= v.rect.height <= 35.0:
                                pair_item = ExtractedLegendItem(
                                    name=clean_noun,
                                    symbol_box=Box.from_fitz_rect(v.rect),
                                    label_box=Box.from_fitz_rect(lbl_rect),
                                    symbol_type=SymbolType.VECTOR_DRAWING.value,
                                    confidence=0.96,
                                    source_mode="inline",
                                    priority=3
                                )
                                break

        # ----------------------------------------------------------------------
        # Priority 3: Explicit Delimiter Pattern 名称 [区切り] 記号 (Requirement 4.1)
        # Delimiters: →, ⇒, ➡, ＝, =, …, ‥, ・連続, :, ：, ー, ―, －, -
        # ----------------------------------------------------------------------
        if not pair_item:
            delim_pat = r'^\s*(?:[→⇒➡＝=…‥:：ー―－\-]|・{2,}|\.{2,}|…+)\s*'
            m_delim = re.search(delim_pat, right_text)
            if m_delim:
                right_char_indices: List[int] = []
                for idx, c in enumerate(right_chars):
                    for _ in c.norm_char:
                        right_char_indices.append(idx)

                delim_end_pos = m_delim.end()
                if delim_end_pos > 0 and right_char_indices:
                    delim_c_idx = right_char_indices[min(delim_end_pos - 1, len(right_char_indices) - 1)]
                    delim_chars = right_chars[:delim_c_idx + 1]
                    delim_x1 = delim_chars[-1].rect.x1 if delim_chars else kw_x1

                    post_delim_chars = right_chars[delim_c_idx + 1:]
                    post_delim_text = "".join(c.norm_char for c in post_delim_chars)

                    post_delim_char_indices: List[int] = []
                    for idx, c in enumerate(post_delim_chars):
                        for _ in c.norm_char:
                            post_delim_char_indices.append(idx)

                    # 3a: Symbol glyph right after delimiter (including A-Z single uppercase letters)
                    m_sym = re.search(r'^\s*([○●×□■△▲☆★◎◇◆①-⑩XxOoA-Z])(印)?', post_delim_text)
                    if m_sym:
                        raw_s = m_sym.group(1)
                        if raw_s in ("X", "x"):
                            raw_s = "×"
                        elif raw_s in ("O", "o"):
                            raw_s = "○"

                        if raw_s not in FORBIDDEN_SYMBOL_CHARS:
                            char_offset = post_delim_text.find(m_sym.group(1))
                            if char_offset < len(post_delim_char_indices):
                                target_c = post_delim_chars[post_delim_char_indices[char_offset]]
                                # Verify not instruction-masked
                                orig_chunk_idx = chunk_chars.index(target_c)
                                if orig_chunk_idx not in masked_char_indices:
                                    pair_item = ExtractedLegendItem(
                                        name=clean_noun,
                                        symbol_box=Box.from_fitz_rect(target_c.rect),
                                        label_box=Box.from_fitz_rect(lbl_rect),
                                        symbol_type=SymbolType.TEXT_GLYPH.value,
                                        confidence=0.98,
                                        source_mode="inline",
                                        raw_symbol_text=raw_s,
                                        target_char_rect=target_c.rect,
                                        priority=3
                                    )

                # 3b: Small vector / raster drawing right after delimiter
                if not pair_item:
                    for v in prims.vectors:
                        if (delim_x1 - 3.0 <= v.rect.x0 <= max_search_x) and (lbl_rect.y0 - 8.0 <= v.rect.y0 <= lbl_rect.y1 + 8.0):
                            if 2.0 <= v.rect.width <= 35.0 and 2.0 <= v.rect.height <= 35.0:
                                pair_item = ExtractedLegendItem(
                                    name=clean_noun,
                                    symbol_box=Box.from_fitz_rect(v.rect),
                                    label_box=Box.from_fitz_rect(lbl_rect),
                                    symbol_type=SymbolType.VECTOR_DRAWING.value,
                                    confidence=0.96,
                                    source_mode="inline",
                                    priority=3
                                )
                                break

                # 3c: 300DPI pixel fallback (Requirement 4.3)
                if not pair_item:
                    slot_w = min(38.0, max_search_x - delim_x1)
                    if slot_w >= 3.0:
                        slot_rect = fitz.Rect(delim_x1 + 1.0, lbl_rect.y0 - 4.0, delim_x1 + slot_w, lbl_rect.y1 + 4.0)
                        fb_rect = check_300dpi_pixel_fallback(page, slot_rect)
                        if fb_rect is not None:
                            pair_item = ExtractedLegendItem(
                                name=clean_noun,
                                symbol_box=Box.from_fitz_rect(fb_rect),
                                label_box=Box.from_fitz_rect(lbl_rect),
                                symbol_type=SymbolType.VECTOR_DRAWING.value,
                                confidence=0.93,
                                source_mode="inline",
                                priority=3
                            )

        # ----------------------------------------------------------------------
        # Priority 4: Table/Row Pattern with 記号 Header (Requirement 2.4, Saga format)
        # e.g. 譜面台 | 台 | 記号 [┬], 椅子 | 脚 | 記号 ○
        # ----------------------------------------------------------------------
        if not pair_item:
            m_kigou = re.search(r'記号\s*([○●×□■△▲☆★◎◇◆①-⑩XxOoA-Z])?', right_text)
            if m_kigou:
                k_end = m_kigou.end()
                k_chars = right_chars[k_end:]
                # Text glyph after 記号
                if m_kigou.group(1):
                    raw_s = m_kigou.group(1)
                    if raw_s in ("X", "x"):
                        raw_s = "×"
                    elif raw_s in ("O", "o"):
                        raw_s = "○"
                    char_offset = right_text.find(m_kigou.group(1))
                    if char_offset < len(right_chars):
                        target_c = right_chars[char_offset]
                        pair_item = ExtractedLegendItem(
                            name=clean_noun,
                            symbol_box=Box.from_fitz_rect(target_c.rect),
                            label_box=Box.from_fitz_rect(lbl_rect),
                            symbol_type=SymbolType.TEXT_GLYPH.value,
                            confidence=0.95,
                            source_mode="inline",
                            raw_symbol_text=raw_s,
                            target_char_rect=target_c.rect,
                            priority=2
                        )
                # Vector after 記号
                if not pair_item:
                    k_x0 = right_chars[right_text.find("記号")].rect.x1
                    for v in prims.vectors:
                        if (k_x0 <= v.rect.x0 <= max_search_x) and (lbl_rect.y0 - 5.0 <= v.rect.y0 <= lbl_rect.y1 + 5.0):
                            if 2.0 <= v.rect.width <= 35.0 and 2.0 <= v.rect.height <= 35.0:
                                pair_item = ExtractedLegendItem(
                                    name=clean_noun,
                                    symbol_box=Box.from_fitz_rect(v.rect),
                                    label_box=Box.from_fitz_rect(lbl_rect),
                                    symbol_type=SymbolType.VECTOR_DRAWING.value,
                                    confidence=0.95,
                                    source_mode="inline",
                                    priority=2
                                )
                                break

        # ----------------------------------------------------------------------
        # Priority 5: Space-Delimited & Underline Blank Pattern (Requirement 2.2, Fukuoka format)
        # e.g. ・譜面台  T  ____台   ・椅子  ○  ____脚
        # ----------------------------------------------------------------------
        if not pair_item:
            m_space_sym = re.search(r'^\s*([○●×□■△▲☆★◎◇◆①-⑩XxOoA-Z])(印)?', right_text)
            if m_space_sym:
                raw_s = m_space_sym.group(1)
                if raw_s in ("X", "x"):
                    raw_s = "×"
                elif raw_s in ("O", "o"):
                    raw_s = "○"

                has_in = bool(m_space_sym.group(2))
                is_valid = (raw_s in cfg.standard_symbols) or (len(raw_s) == 1 and raw_s.isupper() and raw_s.isascii())
                if is_valid and raw_s not in FORBIDDEN_SYMBOL_CHARS:
                    char_offset = right_text.find(m_space_sym.group(1))
                    if char_offset < len(right_chars):
                        target_c = right_chars[char_offset]
                        orig_chunk_idx = chunk_chars.index(target_c)
                        if orig_chunk_idx not in masked_char_indices:
                            pair_item = ExtractedLegendItem(
                                name=clean_noun,
                                symbol_box=Box.from_fitz_rect(target_c.rect),
                                label_box=Box.from_fitz_rect(lbl_rect),
                                symbol_type=SymbolType.TEXT_GLYPH.value,
                                confidence=0.93,
                                source_mode="inline",
                                raw_symbol_text=raw_s,
                                target_char_rect=target_c.rect,
                                priority=2 if has_in else 1
                            )

            # Check vector in space gap
            if not pair_item:
                for v in prims.vectors:
                    if (kw_x1 <= v.rect.x0 <= max_search_x) and (lbl_rect.y0 - 5.0 <= v.rect.y0 <= lbl_rect.y1 + 5.0):
                        if 2.0 <= v.rect.width <= 35.0 and 2.0 <= v.rect.height <= 35.0:
                            pair_item = ExtractedLegendItem(
                                name=clean_noun,
                                symbol_box=Box.from_fitz_rect(v.rect),
                                label_box=Box.from_fitz_rect(lbl_rect),
                                symbol_type=SymbolType.VECTOR_DRAWING.value,
                                confidence=0.90,
                                source_mode="inline",
                                priority=1
                            )
                            break

        # ----------------------------------------------------------------------
        # Priority 6: Left-Symbol Pattern 記号 [区切り] 名称 (Requirement 4.2, Tokushima & Saga format)
        # e.g. ○…椅子, ×…譜面台（最大70本）, ※A……電源100V
        # ----------------------------------------------------------------------
        if not pair_item:
            if i > 0:
                prev_e_idx = char_idx_map[kept_nouns[i - 1][1] - 1]
                prev_kw_x1 = chunk_chars[prev_e_idx].rect.x1
            else:
                prev_kw_x1 = kw_x0 - 75.0
            left_chars = [c for c in chunk_chars[:start_c_idx] if max(prev_kw_x1, kw_x0 - 75.0) <= c.rect.x1 <= kw_x0]
            left_text = "".join(c.norm_char for c in left_chars)

            # Map from character index in left_text to left_chars index
            left_char_indices: List[int] = []
            for idx, c in enumerate(left_chars):
                for _ in c.norm_char:
                    left_char_indices.append(idx)

            delim_pat_left = r'([○●×□■△▲☆★◎◇◆①-⑩A-Za-z])\s*([→⇒➡＝=…‥:：ー―－\-・]{1,3}|\.{2,}|…+)\s*$'
            m_left = re.search(delim_pat_left, left_text)
            if m_left:
                sym_cand = m_left.group(1)
                if sym_cand in ("X", "x"):
                    sym_cand = "×"
                elif sym_cand in ("O", "o"):
                    sym_cand = "○"
                if sym_cand not in FORBIDDEN_SYMBOL_CHARS:
                    char_offset = left_text.rfind(m_left.group(1))
                    if char_offset < len(left_char_indices):
                        target_c = left_chars[left_char_indices[char_offset]]
                        orig_chunk_idx = chunk_chars.index(target_c)
                        if orig_chunk_idx not in masked_char_indices:
                            pair_item = ExtractedLegendItem(
                                name=clean_noun,
                                symbol_box=Box.from_fitz_rect(target_c.rect),
                                label_box=Box.from_fitz_rect(lbl_rect),
                                symbol_type=SymbolType.TEXT_GLYPH.value,
                                confidence=0.94,
                                source_mode="inline",
                                raw_symbol_text=sym_cand,
                                target_char_rect=target_c.rect,
                                priority=2
                            )

        if pair_item is not None:
            items.append(pair_item)

    return items

def parse_margin_miniatures(
    page: fitz.Page,
    prims: PrimitivesCollection,
    stage_info: StageRoiInfo,
    claimed_items: Optional[List[ExtractedLegendItem]] = None,
    claimed_symbol_boxes: Optional[List[Box]] = None
) -> List[ExtractedLegendItem]:
    """
    Requirement 7.3: Margin standalone vector miniatures & English percussion abbreviations.
    Matches Timp, Timpani, B.D, BD, S.D, SD, Dr.Set, Drums, Chime, Gong, Xylo, Glocken, Marimba, Marinba, Vib, Cym.
    """
    items: List[ExtractedLegendItem] = []
    claimed_boxes = list(claimed_symbol_boxes or [])
    claimed_names: Set[str] = set()
    if claimed_items:
        for it in claimed_items:
            claimed_boxes.append(it.symbol_box)
            claimed_names.add(normalize_equipment_name_for_dedup(it.name))

    # Standalone vectors in margins (strictly outside stage ROI and not already claimed)
    margin_vectors: List[VectorClusterPrimitive] = []
    for v in prims.vectors:
        if stage_info.is_inside_stage(v.rect):
            continue
        # Miniatures must be reasonably sized (10pt to 75pt width, 6pt to 75pt height)
        if not (10.0 <= v.rect.width <= 75.0 and 6.0 <= v.rect.height <= 75.0):
            continue
        # Check if already claimed by an inline legend
        if any(v.box.iou(cb) > 0.25 for cb in claimed_boxes):
            continue
        margin_vectors.append(v)

    # Use words instead of blocks for precise word-level bounding boxes
    words = page.get_text("words")
    outside_words = []
    for w in words:
        r = fitz.Rect(w[:4])
        t = w[4].strip()
        if not stage_info.is_inside_stage(r) and not is_circulation_or_stage_structure(t):
            outside_words.append((r, t))

    # Supported English percussion keywords (case-insensitive)
    PERCUSSION_KW = [
        "timp", "timpani", "b.d", "bd", "s.d", "sd", "dr.set", "drumset", "drums",
        "chime", "gong", "xylo", "glocken", "glock", "marimba", "marinba", "vib", "cym"
    ]

    for vec in margin_vectors:
        vr = vec.rect
        best_label: Optional[str] = None
        best_dist = 999999.0
        best_label_box: Optional[Box] = None

        for wr, wt in outside_words:
            wt_clean = wt.strip(" .\t\r\n")
            matched_kw: Optional[str] = None

            # 1. Match equipment keywords
            for kw in cfg.equipment_keywords:
                if kw in wt_clean:
                    if all("\u30a0" <= ch <= "\u30ff" for ch in kw):
                        idx = wt_clean.find(kw)
                        if idx > 0 and "\u30a0" <= wt_clean[idx - 1] <= "\u30ff":
                            continue
                        if idx + len(kw) < len(wt_clean) and "\u30a0" <= wt_clean[idx + len(kw)] <= "\u30ff":
                            continue
                    matched_kw = kw
                    break

            # 2. Match English percussion abbreviation (Requirement 7.3)
            if not matched_kw:
                wt_lower = wt_clean.lower()
                for p_kw in PERCUSSION_KW:
                    if re.search(r'\b' + re.escape(p_kw) + r'\b', wt_lower) or wt_lower.startswith(p_kw):
                        matched_kw = wt_clean
                        break

            if not matched_kw:
                continue

            # Vertical adjacency: vector directly above or below label
            mid_v_x = (vr.x0 + vr.x1) / 2.0
            mid_w_x = (wr.x0 + wr.x1) / 2.0
            dx = abs(mid_v_x - mid_w_x)
            if dx <= max(35.0, (vr.width + wr.width) / 2.0 + 8.0):
                dy: Optional[float] = None
                if 0 <= (wr.y0 - vr.y1) < 35.0:  # word directly below vector
                    dy = wr.y0 - vr.y1
                elif 0 <= (vr.y0 - wr.y1) < 35.0:  # word directly above vector
                    dy = vr.y0 - wr.y1

                if dy is not None:
                    # 2D Euclidean distance to find the closest matching label
                    dist_2d = (dx * dx + dy * dy * 2.25) ** 0.5
                    if dist_2d < best_dist:
                        best_dist = dist_2d
                        best_label = clean_equipment_label(matched_kw)
                        best_label_box = Box.from_fitz_rect(wr)

        if best_label and best_label_box:
            norm_lbl = normalize_equipment_name_for_dedup(best_label)
            if norm_lbl in claimed_names:
                continue
            items.append(ExtractedLegendItem(
                name=best_label,
                symbol_box=vec.box,
                label_box=best_label_box,
                symbol_type=SymbolType.VECTOR_DRAWING.value,
                confidence=0.92,
                source_mode="margin_miniature",
                priority=2
            ))

    return items
