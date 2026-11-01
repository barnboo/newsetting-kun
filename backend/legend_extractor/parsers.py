from __future__ import annotations
import re
from typing import List, Dict, Any, Tuple, Optional, Set
import fitz
import numpy as np
from scipy.optimize import linear_sum_assignment

from .models import Box, SymbolType, ExtractedLegendItem
from .primitives import PrimitivesCollection, CharPrimitive, VectorClusterPrimitive, RasterPrimitive
from .roi_filter import StageRoiInfo, is_instruction_or_caution_text, is_dummy_aggregation_or_selection_table
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

    # 1. Detect physical horizontal and vertical lines from page drawings
    drawings = page.get_drawings()
    h_lines: List[Tuple[float, float, float]] = []  # (y, x0, x1)
    v_lines: List[Tuple[float, float, float]] = []  # (x, y0, y1)

    for d in drawings:
        d_rect = fitz.Rect(d["rect"])
        # Exclude drawings strictly inside stage ROI
        if stage_info.is_inside_stage(d_rect):
            continue
        for it in d.get("items", []):
            cmd = it[0]
            if cmd == "l":
                p1, p2 = it[1], it[2]
                if abs(p1.y - p2.y) < 1.0 and abs(p1.x - p2.x) >= 25.0:
                    h_lines.append(((p1.y + p2.y) / 2.0, min(p1.x, p2.x), max(p1.x, p2.x)))
                elif abs(p1.x - p2.x) < 1.0 and abs(p1.y - p2.y) >= 20.0:
                    v_lines.append(((p1.x + p2.x) / 2.0, min(p1.y, p2.y), max(p1.y, p2.y)))
            elif cmd == "re":
                r = fitz.Rect(it[1])
                # Border line rectangles
                if r.width >= 25.0 and r.height <= 2.0:
                    h_lines.append(((r.y0 + r.y1) / 2.0, r.x0, r.x1))
                elif r.height >= 20.0 and r.width <= 2.0:
                    v_lines.append(((r.x0 + r.x1) / 2.0, r.y0, r.y1))

    # A physical grid table requires at least 3 horizontal lines and at least 3 vertical lines
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

    # Get distinct sorted Y levels and X levels
    y_levels = sorted([sum(l[0] for l in group)/len(group) for group in h_clusters.values()])
    x_levels = sorted([sum(l[0] for l in group)/len(group) for group in v_clusters.values()])

    # Find contiguous grid regions
    grid_y_spans: List[List[float]] = []
    curr_y_span = [y_levels[0]]
    for i in range(1, len(y_levels)):
        gap = y_levels[i] - y_levels[i-1]
        if 10.0 <= gap <= 55.0:  # reasonable row height
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
        # Find V lines covering this Y span
        v_in_span = []
        for x in x_levels:
            # Check if there is a vertical line spanning table_top to table_bottom
            matching_v = any(abs(l[0] - x) < 3.0 and l[1] <= table_top + 5.0 and l[2] >= table_bottom - 5.0 for l in v_lines)
            if matching_v:
                v_in_span.append(x)

        if len(v_in_span) < 3:
            continue

        table_rect = fitz.Rect(v_in_span[0] - 2.0, table_top - 2.0, v_in_span[-1] + 2.0, table_bottom + 2.0)

        # Collect text and primitives inside this physical grid table
        raw = page.get_text("rawdict", clip=table_rect)
        table_texts: List[str] = []
        for b in raw.get("blocks", []):
            if b.get("type") == 0:
                for l in b.get("lines", []):
                    lt = "".join(get_span_text(s) for s in l.get("spans", [])).strip()
                    if lt:
                        table_texts.append(lt)

        # REJECT if dummy aggregation or selection table
        if is_dummy_aggregation_or_selection_table(table_texts):
            continue

        # WHITELIST REQUIREMENT: The table MUST contain at least 2 distinct equipment keywords
        matched_equip_count = sum(1 for kw in cfg.equipment_keywords if any(kw in t for t in table_texts))
        if matched_equip_count < 2:
            continue

        # Construct cells from grid intersections
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

                # Assign chars
                for ch in prims.chars:
                    if c_rect.contains(fitz.Point((ch.rect.x0 + ch.rect.x1)/2.0, (ch.rect.y0 + ch.rect.y1)/2.0)):
                        cell.chars.append(ch)
                        cell.text += ch.norm_char

                # Assign vectors (excluding table borders)
                for v in prims.vectors:
                    if c_rect.contains(fitz.Point((v.rect.x0 + v.rect.x1)/2.0, (v.rect.y0 + v.rect.y1)/2.0)):
                        # Ensure v is not the cell border
                        if v.rect.width < (cx1 - cx0 - 2.0) and v.rect.height < (cy1 - cy0 - 2.0):
                            cell.vectors.append(v)

                # Assign rasters
                for img in prims.rasters:
                    if c_rect.contains(fitz.Point((img.rect.x0 + img.rect.x1)/2.0, (img.rect.y0 + img.rect.y1)/2.0)):
                        cell.rasters.append(img)

                row_cells.append(cell)
            grid_cells.append(row_cells)

        # Score columns for Hungarian role assignment
        ROLES = ['no', 'name', 'symbol', 'quantity']
        score_matrix = np.zeros((len(ROLES), num_cols), dtype=float)

        for c_idx in range(num_cols):
            col_cells = [grid_cells[r][c_idx] for r in range(num_rows)]
            col_texts = [cell.text.strip() for cell in col_cells if cell.text.strip()]
            header_text = col_texts[0].lower() if col_texts else ""
            data_texts = col_texts[1:] if len(col_texts) > 1 else col_texts

            # No score
            s_no = 0.0
            for hint in cfg.column_header_hints.get("no", []):
                if hint in header_text:
                    s_no += 15.0
            int_count = sum(1 for t in data_texts if t.isdigit())
            if int_count >= max(1, len(data_texts) * 0.6):
                s_no += 10.0
            score_matrix[0, c_idx] = s_no

            # Name score
            s_name = 0.0
            for hint in cfg.column_header_hints.get("name", []):
                if hint in header_text:
                    s_name += 15.0
            kw_hits = sum(1 for t in data_texts if any(kw in t for kw in cfg.equipment_keywords))
            s_name += kw_hits * 6.0
            score_matrix[1, c_idx] = s_name

            # Symbol score
            s_sym = 0.0
            for hint in cfg.column_header_hints.get("symbol", []):
                if hint in header_text:
                    s_sym += 15.0
            vec_count = sum(len(c.vectors) + len(c.rasters) for c in col_cells[1:])
            s_sym += vec_count * 6.0
            sym_char_count = sum(1 for t in data_texts if any(ch in cfg.standard_symbols for ch in t))
            s_sym += sym_char_count * 5.0
            if int_count >= max(2, len(data_texts) * 0.7) and vec_count == 0:
                s_sym -= 30.0  # strictly penalize numbers
            score_matrix[2, c_idx] = s_sym

            # Quantity score
            s_qty = 0.0
            for hint in cfg.column_header_hints.get("quantity", []):
                if hint in header_text:
                    s_qty += 15.0
            score_matrix[3, c_idx] = s_qty

        # Hungarian assignment
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
            for r_idx in range(1, num_rows):
                name_cell = grid_cells[r_idx][name_c]
                sym_cell = grid_cells[r_idx][sym_c]

                raw_name = name_cell.text.strip()
                # STRICT WHITELIST CHECK: must match an equipment keyword
                matched_kw = next((kw for kw in cfg.equipment_keywords if kw in raw_name), None)
                if not matched_kw:
                    continue

                # Find symbol box
                sym_box: Optional[Box] = None
                sym_type = SymbolType.VECTOR_DRAWING.value
                raw_sym = sym_cell.text.strip()

                if sym_cell.vectors:
                    u_v = fitz.Rect(sym_cell.vectors[0].rect)
                    for v in sym_cell.vectors[1:]:
                        u_v |= v.rect
                    sym_box = Box.from_fitz_rect(u_v)
                    sym_type = SymbolType.VECTOR_DRAWING.value
                elif sym_cell.rasters:
                    u_r = fitz.Rect(sym_cell.rasters[0].rect)
                    for img in sym_cell.rasters[1:]:
                        u_r |= img.rect
                    sym_box = Box.from_fitz_rect(u_r)
                    sym_type = SymbolType.RASTER_IMAGE.value
                elif sym_cell.chars:
                    chosen_ch = next((ch for ch in sym_cell.chars if ch.is_symbol), sym_cell.chars[0])
                    sym_box = Box.from_fitz_rect(chosen_ch.rect)
                    sym_type = SymbolType.TEXT_GLYPH.value
                    raw_sym = chosen_ch.norm_char
                elif sym_cell.rect.width > 0:
                    # Inner cell region with inset to exclude cell borders
                    inner_rect = fitz.Rect(sym_cell.rect.x0 + 2.0, sym_cell.rect.y0 + 2.0, sym_cell.rect.x1 - 2.0, sym_cell.rect.y1 - 2.0)
                    sym_box = Box.from_fitz_rect(inner_rect)
                    sym_type = SymbolType.VECTOR_DRAWING.value

                if sym_box is not None:
                    items.append(ExtractedLegendItem(
                        name=raw_name,
                        symbol_box=sym_box,
                        label_box=Box.from_fitz_rect(name_cell.rect),
                        symbol_type=sym_type,
                        confidence=0.98,
                        source_mode="table",
                        raw_symbol_text=raw_sym,
                        priority=3
                    ))

    return items


# ==============================================================================
# Mode B: Space-Transparent Chunking & Local Pair Parser
# ==============================================================================

class CharSpanGroup:
    def __init__(self, chars: List[CharPrimitive]):
        self.chars = chars
        self.rect = fitz.Rect(chars[0].rect)
        for c in chars[1:]:
            self.rect |= c.rect

def parse_mode_b_inlines_and_margins(
    page: fitz.Page,
    prims: PrimitivesCollection,
    stage_info: StageRoiInfo
) -> List[ExtractedLegendItem]:
    items: List[ExtractedLegendItem] = []

    # Detect vertical drawing lines for chunk boundary splitting
    drawings = page.get_drawings()
    v_line_segments: List[Tuple[float, float, float]] = []  # (x, y0, y1)
    for d in drawings:
        for it in d.get("items", []):
            if it[0] == "l":
                p1, p2 = it[1], it[2]
                if abs(p1.x - p2.x) < 1.0 and abs(p1.y - p2.y) >= 12.0:
                    v_line_segments.append(((p1.x + p2.x)/2.0, min(p1.y, p2.y), max(p1.y, p2.y)))

    # Step 1: Group chars into lines by vertical alignment
    all_chars = sorted(prims.chars, key=lambda c: (c.rect.y0, c.rect.x0))
    raw_lines: List[List[CharPrimitive]] = []

    for c in all_chars:
        # Exclude whitespace
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
    chunks: List[List[CharPrimitive]] = []
    max_chunk_gap = float(cfg.thresholds.get("max_line_chunk_gap_pt", 80.0))

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

                if gap > max_chunk_gap or crosses_vline:
                    if curr_chunk:
                        chunks.append(curr_chunk)
                    curr_chunk = [c]
                else:
                    curr_chunk.append(c)

        if curr_chunk:
            chunks.append(curr_chunk)

    # Step 3 & 4 & 5: Parse each local chunk
    for chunk in chunks:
        chunk_items = parse_single_chunk(chunk, prims, stage_info)
        items.extend(chunk_items)

    # Margin standalone vector miniatures (outside stage ROI)
    margin_items = parse_margin_miniatures(page, prims, stage_info)
    items.extend(margin_items)

    return items

def parse_single_chunk(
    chunk_chars: List[CharPrimitive],
    prims: PrimitivesCollection,
    stage_info: StageRoiInfo
) -> List[ExtractedLegendItem]:
    items: List[ExtractedLegendItem] = []
    if not chunk_chars:
        return items

    raw_text = "".join(c.norm_char for c in chunk_chars)

    # Filter out caution / instruction / quantity-entry lines
    if is_instruction_or_caution_text(raw_text):
        return items

    # Filter out dummy aggregation headers (1段目, 2段目, 有無, 借持, etc.)
    for hdr in cfg.exclude_table_headers:
        if hdr in raw_text:
            return items

    # Build space-transparent representation with char_idx_map
    # Characters separated by <= 55pt are concatenated into space_stripped_text
    space_stripped_text = ""
    char_idx_map: List[int] = []  # index in chunk_chars

    max_justified_gap = float(cfg.thresholds.get("max_char_gap_for_justified_pt", 55.0))

    for i, c in enumerate(chunk_chars):
        if not space_stripped_text:
            space_stripped_text += c.norm_char
            char_idx_map.append(i)
        else:
            prev_idx = char_idx_map[-1]
            prev_c = chunk_chars[prev_idx]
            gap = c.rect.x0 - prev_c.rect.x1
            if gap <= max_justified_gap:
                space_stripped_text += c.norm_char
                char_idx_map.append(i)
            else:
                # Large gap: insert a separator space in text
                space_stripped_text += " " + c.norm_char
                char_idx_map.append(-1)  # sentinel for space
                char_idx_map.append(i)

    # Match equipment keywords against space_stripped_text
    matched_spans: List[Tuple[int, int, str]] = []  # (start_idx, end_idx, kw) in space_stripped_text
    for kw in cfg.equipment_keywords:
        pos = 0
        while True:
            idx = space_stripped_text.find(kw, pos)
            if idx == -1:
                break
            matched_spans.append((idx, idx + len(kw), kw))
            pos = idx + 1

    if not matched_spans:
        return items

    # Expand compound nouns (e.g. ピアノ + 椅子 -> ピアノ椅子, 合奏用 + 椅子 -> 合奏用椅子)
    expanded_spans: List[Tuple[int, int, str]] = []
    for s, e, kw in matched_spans:
        exp_s = s
        while exp_s > 0:
            prev_ch = space_stripped_text[exp_s - 1]
            if prev_ch not in " 　→⇒➡＝=…‥.:・()（）[]［］" and prev_ch not in cfg.standard_symbols:
                exp_s -= 1
            else:
                break

        exp_e = e
        while exp_e < len(space_stripped_text):
            next_ch = space_stripped_text[exp_e]
            if next_ch not in " 　→⇒➡＝=…‥.:・()（）[]［］" and next_ch not in cfg.standard_symbols:
                exp_e += 1
            else:
                break

        full_kw = space_stripped_text[exp_s:exp_e].strip()
        # Ensure not an excluded phrase
        if not is_instruction_or_caution_text(full_kw):
            expanded_spans.append((exp_s, exp_e, full_kw))

    # Longest Match NMS
    expanded_spans.sort(key=lambda t: (t[1] - t[0]), reverse=True)
    kept_nouns: List[Tuple[int, int, str]] = []
    for s, e, text in expanded_spans:
        overlap = any(max(s, ks) < min(e, ke) for ks, ke, _ in kept_nouns)
        if not overlap:
            kept_nouns.append((s, e, text))

    kept_nouns.sort(key=lambda t: t[0])
    if not kept_nouns:
        return items

    # For each equipment noun, search for its paired symbol
    for i, (n_s, n_e, noun) in enumerate(kept_nouns):
        # Resolve character range for noun
        noun_char_indices = [char_idx_map[k] for k in range(n_s, n_e) if k < len(char_idx_map) and char_idx_map[k] != -1]
        if not noun_char_indices:
            continue

        label_chars = [chunk_chars[idx] for idx in noun_char_indices]
        lbl_rect = fitz.Rect(label_chars[0].rect)
        for lc in label_chars[1:]:
            lbl_rect |= lc.rect

        kw_x0 = lbl_rect.x0
        kw_x1 = lbl_rect.x1

        # Determine right search boundary: next keyword's start, or chunk end
        if i + 1 < len(kept_nouns):
            next_indices = [char_idx_map[k] for k in range(kept_nouns[i+1][0], kept_nouns[i+1][1]) if k < len(char_idx_map) and char_idx_map[k] != -1]
            next_kw_x0 = chunk_chars[next_indices[0]].rect.x0 if next_indices else (kw_x1 + 130.0)
            max_search_x = next_kw_x0 - 1.0
        else:
            chunk_x1 = max(c.rect.x1 for c in chunk_chars)
            max_search_x = min(chunk_x1 + 1.0, kw_x1 + 130.0)

        # Characters strictly in the right search window
        right_chars = [c for c in chunk_chars if kw_x1 <= c.rect.x0 <= max_search_x]
        right_text = "".join(c.norm_char for c in right_chars)

        pair_item: Optional[ExtractedLegendItem] = None

        # ----------------------------------------------------------------------
        # Priority 1: Bracket Pattern 名称(記号)
        # ----------------------------------------------------------------------
        m_br = re.search(r'[\(（]([^\)）]+)[\)）]', right_text)
        if m_br and not pair_item:
            inside_str = m_br.group(1).strip()
            # Must NOT be a quantity unit or blank
            if not any(u in inside_str for u in ["個", "脚", "本", "台", "枚", "人", "持参", "借用"]):
                # Case 1a: Exactly 1 symbol character
                sym_cand = inside_str[0] if inside_str else ""
                # Map X/x/O/o to ×/○
                if sym_cand in ("X", "x"):
                    sym_cand = "×"
                elif sym_cand in ("O", "o"):
                    sym_cand = "○"

                if sym_cand in cfg.standard_symbols:
                    # Locate the char primitive inside the brackets
                    # Find opening bracket char index
                    open_br_idx = right_text.find(m_br.group(0))
                    # Char index inside
                    inside_char_idx = open_br_idx + 1 + m_br.group(0)[1:].find(inside_str[0])
                    if inside_char_idx < len(right_chars):
                        target_c = right_chars[inside_char_idx]
                        pair_item = ExtractedLegendItem(
                            name=noun,
                            symbol_box=Box.from_fitz_rect(target_c.rect),
                            label_box=Box.from_fitz_rect(lbl_rect),
                            symbol_type=SymbolType.TEXT_GLYPH.value,
                            confidence=0.96,
                            source_mode="inline",
                            raw_symbol_text=sym_cand,
                            target_char_rect=target_c.rect,
                            priority=2
                        )

                # Case 1b: Small vector inside the bracket (e.g. ピアノ椅子(■))
                if not pair_item:
                    # Look for small vector rect inside bracket bounds
                    br_x0 = right_chars[0].rect.x0 if right_chars else kw_x1
                    for v in prims.vectors:
                        if (kw_x1 <= v.rect.x0 <= max_search_x) and (lbl_rect.y0 - 5.0 <= v.rect.y0 <= lbl_rect.y1 + 5.0):
                            if 3.0 <= v.rect.width <= 30.0 and 3.0 <= v.rect.height <= 30.0:
                                pair_item = ExtractedLegendItem(
                                    name=noun,
                                    symbol_box=Box.from_fitz_rect(v.rect),
                                    label_box=Box.from_fitz_rect(lbl_rect),
                                    symbol_type=SymbolType.VECTOR_DRAWING.value,
                                    confidence=0.95,
                                    source_mode="inline",
                                    priority=2
                                )
                                break

        # ----------------------------------------------------------------------
        # Priority 2: Explicit Delimiter Pattern 名称 [区切り] 記号
        # (→, ⇒, ➡, ＝, =, …, ‥, multiple ・, :, ：)
        # ----------------------------------------------------------------------
        if not pair_item:
            delim_pattern = r'^\s*([→⇒➡＝=…‥:：]|・{2,})'
            m_delim = re.search(delim_pattern, right_text)
            if m_delim:
                delim_len = len(m_delim.group(0))
                # Search strictly to the right of delimiter
                post_delim_chars = right_chars[delim_len:]
                post_delim_text = "".join(c.norm_char for c in post_delim_chars)

                # Look for symbol glyph (with optional 印)
                m_sym = re.search(r'^\s*([○●×□■△▲☆★◎◇◆①-⑩XxOo])(印)?', post_delim_text)
                if m_sym:
                    raw_s = m_sym.group(1)
                    if raw_s in ("X", "x"):
                        raw_s = "×"
                    elif raw_s in ("O", "o"):
                        raw_s = "○"

                    # Find char primitive of the symbol (exclude '印')
                    char_offset = post_delim_text.find(m_sym.group(1))
                    if char_offset < len(post_delim_chars):
                        target_c = post_delim_chars[char_offset]
                        pair_item = ExtractedLegendItem(
                            name=noun,
                            symbol_box=Box.from_fitz_rect(target_c.rect),
                            label_box=Box.from_fitz_rect(lbl_rect),
                            symbol_type=SymbolType.TEXT_GLYPH.value,
                            confidence=0.98,
                            source_mode="inline",
                            raw_symbol_text=raw_s,
                            target_char_rect=target_c.rect,
                            priority=3
                        )

                # Look for small vector/raster drawing right after delimiter
                if not pair_item:
                    for v in prims.vectors:
                        if (kw_x1 <= v.rect.x0 <= max_search_x) and (lbl_rect.y0 - 5.0 <= v.rect.y0 <= lbl_rect.y1 + 5.0):
                            if 3.0 <= v.rect.width <= 35.0 and 3.0 <= v.rect.height <= 35.0:
                                pair_item = ExtractedLegendItem(
                                    name=noun,
                                    symbol_box=Box.from_fitz_rect(v.rect),
                                    label_box=Box.from_fitz_rect(lbl_rect),
                                    symbol_type=SymbolType.VECTOR_DRAWING.value,
                                    confidence=0.96,
                                    source_mode="inline",
                                    priority=3
                                )
                                break

        # ----------------------------------------------------------------------
        # Priority 3: Space-Delimited & 〜印 Pattern 名称   記号[印]
        # ----------------------------------------------------------------------
        if not pair_item:
            m_space_sym = re.search(r'^\s*([○●×□■△▲☆★◎◇◆①-⑩XxOo])(印)?', right_text)
            if m_space_sym:
                raw_s = m_space_sym.group(1)
                if raw_s in ("X", "x"):
                    raw_s = "×"
                elif raw_s in ("O", "o"):
                    raw_s = "○"

                has_in = bool(m_space_sym.group(2))
                char_offset = right_text.find(m_space_sym.group(1))
                if char_offset < len(right_chars):
                    target_c = right_chars[char_offset]
                    pair_item = ExtractedLegendItem(
                        name=noun,
                        symbol_box=Box.from_fitz_rect(target_c.rect),
                        label_box=Box.from_fitz_rect(lbl_rect),
                        symbol_type=SymbolType.TEXT_GLYPH.value,
                        confidence=0.92,
                        source_mode="inline",
                        raw_symbol_text=raw_s,
                        target_char_rect=target_c.rect,
                        priority=2 if has_in else 1
                    )

            # Check vector in space gap
            if not pair_item:
                for v in prims.vectors:
                    if (kw_x1 <= v.rect.x0 <= max_search_x) and (lbl_rect.y0 - 5.0 <= v.rect.y0 <= lbl_rect.y1 + 5.0):
                        if 3.0 <= v.rect.width <= 35.0 and 3.0 <= v.rect.height <= 35.0:
                            pair_item = ExtractedLegendItem(
                                name=noun,
                                symbol_box=Box.from_fitz_rect(v.rect),
                                label_box=Box.from_fitz_rect(lbl_rect),
                                symbol_type=SymbolType.VECTOR_DRAWING.value,
                                confidence=0.90,
                                source_mode="inline",
                                priority=1
                            )
                            break

        # ----------------------------------------------------------------------
        # Priority 4: Left-Symbol Pattern 記号 [区切り] 名称
        # (Only if 1~3 failed, and strictly within 40pt left)
        # ----------------------------------------------------------------------
        if not pair_item:
            # Check characters to the left
            prev_kw_x1 = kept_nouns[i-1][1] if i > 0 else (kw_x0 - 45.0)
            left_chars = [c for c in chunk_chars if max(prev_kw_x1, kw_x0 - 45.0) <= c.rect.x1 <= kw_x0]
            left_text = "".join(c.norm_char for c in left_chars)
            m_left = re.search(r'([○●×□■△▲☆★◎◇◆①-⑩])\s*([＝=…‥:：・]|\s+)?$', left_text)
            if m_left:
                sym_char = m_left.group(1)
                char_offset = left_text.rfind(sym_char)
                if char_offset < len(left_chars):
                    target_c = left_chars[char_offset]
                    pair_item = ExtractedLegendItem(
                        name=noun,
                        symbol_box=Box.from_fitz_rect(target_c.rect),
                        label_box=Box.from_fitz_rect(lbl_rect),
                        symbol_type=SymbolType.TEXT_GLYPH.value,
                        confidence=0.88,
                        source_mode="inline",
                        raw_symbol_text=sym_char,
                        target_char_rect=target_c.rect,
                        priority=1
                    )

        if pair_item is not None:
            items.append(pair_item)

    return items

def parse_margin_miniatures(
    page: fitz.Page,
    prims: PrimitivesCollection,
    stage_info: StageRoiInfo
) -> List[ExtractedLegendItem]:
    items: List[ExtractedLegendItem] = []

    # Standalone vectors in margins (strictly outside stage ROI)
    margin_vectors = [v for v in prims.vectors if not stage_info.is_inside_stage(v.rect)]

    # Collect text blocks outside stage ROI
    text_blocks = page.get_text("blocks")
    outside_blocks = []
    for b in text_blocks:
        r = fitz.Rect(b[:4])
        t = b[4].strip()
        if not stage_info.is_inside_stage(r) and not is_instruction_or_caution_text(t):
            outside_blocks.append((r, t))

    for vec in margin_vectors:
        vr = vec.rect
        best_label: Optional[str] = None
        best_dist = 999999.0
        best_label_box: Optional[Box] = None

        for br, bt in outside_blocks:
            # STRICT WHITELIST: must match equipment keyword
            matched_kw = next((kw for kw in cfg.equipment_keywords if kw in bt), None)
            if not matched_kw:
                continue

            # Calculate distance: directly above or below
            if (vr.x0 - 15.0) <= br.x1 and vr.x1 >= (br.x0 - 15.0):
                if 0 <= (br.y0 - vr.y1) < 25.0:  # directly below
                    dist = br.y0 - vr.y1
                    if dist < best_dist:
                        best_dist = dist
                        best_label = matched_kw
                        best_label_box = Box.from_fitz_rect(br)
                elif 0 <= (vr.y0 - br.y1) < 25.0:  # directly above
                    dist = vr.y0 - br.y1
                    if dist < best_dist:
                        best_dist = dist
                        best_label = matched_kw
                        best_label_box = Box.from_fitz_rect(br)

        if best_label and best_label_box:
            items.append(ExtractedLegendItem(
                name=best_label,
                symbol_box=vec.box,
                label_box=best_label_box,
                symbol_type=SymbolType.VECTOR_DRAWING.value,
                confidence=0.88,
                source_mode="margin_miniature",
                priority=1
            ))

    return items
