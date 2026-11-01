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

# ==============================================================================
# Mode A: Table Parser with Hungarian Role Assignment
# ==============================================================================

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

class TableCandidate:
    def __init__(self, rows: List[List[TableCell]]):
        self.rows = rows  # rows[r][c]

def parse_mode_a_tables(page: fitz.Page, prims: PrimitivesCollection, stage_info: StageRoiInfo) -> List[ExtractedLegendItem]:
    items: List[ExtractedLegendItem] = []
    
    # 1. Collect text lines outside the stage ROI
    # Group rawdict characters into lines and words
    raw = page.get_text("rawdict")
    raw_lines: List[Dict[str, Any]] = []
    for block in raw.get("blocks", []):
        if block.get("type") == 0:
            for l in block.get("lines", []):
                line_rect = fitz.Rect(l["bbox"])
                # Exclude lines strictly inside stage ROI
                if stage_info.is_inside_stage(line_rect):
                    continue
                line_text = "".join(get_span_text(s) for s in l.get("spans", [])).strip()
                if not line_text:
                    continue
                if is_instruction_or_caution_text(line_text):
                    continue
                raw_lines.append({
                    "rect": line_rect,
                    "text": line_text,
                    "spans": l.get("spans", [])
                })

    if not raw_lines:
        return items

    # Check for dummy aggregation tables (e.g. ひな壇, 1列目〜6列目, 要不要)
    all_table_text = [l["text"] for l in raw_lines]
    if is_dummy_aggregation_or_selection_table(all_table_text):
        # Filter out lines belonging to aggregation tables
        filtered_lines = []
        for l in raw_lines:
            t = l["text"]
            if any(h in t for h in cfg.exclude_table_headers):
                continue
            filtered_lines.append(l)
        raw_lines = filtered_lines

    # 2. Extract drawing lines / rects that define grid tables outside stage ROI
    drawings = page.get_drawings()
    h_lines: List[Tuple[float, float, float]] = []  # (y, x0, x1)
    v_lines: List[Tuple[float, float, float]] = []  # (x, y0, y1)
    table_rects: List[fitz.Rect] = []

    for d in drawings:
        d_rect = fitz.Rect(d["rect"])
        if stage_info.is_inside_stage(d_rect):
            continue
        for it in d.get("items", []):
            cmd = it[0]
            if cmd == "l":
                p1, p2 = it[1], it[2]
                if abs(p1.y - p2.y) < 1.0 and abs(p1.x - p2.x) >= 20.0:
                    h_lines.append(((p1.y + p2.y) / 2.0, min(p1.x, p2.x), max(p1.x, p2.x)))
                elif abs(p1.x - p2.x) < 1.0 and abs(p1.y - p2.y) >= 20.0:
                    v_lines.append(((p1.x + p2.x) / 2.0, min(p1.y, p2.y), max(p1.y, p2.y)))
            elif cmd == "re":
                r = fitz.Rect(it[1])
                if r.width >= 40.0 and r.height >= 30.0 and r.width * r.height < page.rect.width * page.rect.height * 0.4:
                    table_rects.append(r)

    # 3. Form Table Candidate Blocks (from explicit borders or whitespace alignment)
    # Group lines by Y clusters (rows)
    # Sort lines by Y0
    raw_lines.sort(key=lambda l: (round(l["rect"].y0 / 4.0), l["rect"].x0))

    # Cluster lines that are vertically aligned or spatially proximate
    line_clusters: List[List[Dict[str, Any]]] = []
    current_cluster: List[Dict[str, Any]] = []

    for l in raw_lines:
        if not current_cluster:
            current_cluster.append(l)
        else:
            prev_y1 = max(item["rect"].y1 for item in current_cluster)
            curr_y0 = l["rect"].y0
            if (curr_y0 - prev_y1) < 25.0:  # reasonable row gap
                current_cluster.append(l)
            else:
                if len(current_cluster) >= 2:
                    line_clusters.append(current_cluster)
                current_cluster = [l]
    if len(current_cluster) >= 2:
        line_clusters.append(current_cluster)

    for cluster in line_clusters:
        # Check Multi-column separation via repeating headers or empty channel gap
        tokens_in_cluster = []
        for l in cluster:
            for sp in l.get("spans", []):
                stext = get_span_text(sp).strip()
                if stext:
                    tokens_in_cluster.append({"text": stext, "rect": fitz.Rect(sp.get("bbox"))})

        if not tokens_in_cluster:
            continue

        header_keywords = ["備品名", "品名", "名称", "備品", "楽器名", "no", "no.", "№", "番号", "記号"]
        keyword_positions: Dict[str, List[float]] = {}
        for t in tokens_in_cluster:
            tl = t["text"].lower()
            for hk in header_keywords:
                if hk in tl:
                    keyword_positions.setdefault(hk, []).append(t["rect"].x0)
                    break

        cuts = []
        # A multi-column table has repeating header columns (e.g. 備品名 appears 2+ times, or 記号 appears 2+ times)
        for hk, pos_list in keyword_positions.items():
            pos_list.sort()
            for i in range(len(pos_list) - 1):
                if pos_list[i+1] - pos_list[i] > 70.0:
                    left_x1 = max([t["rect"].x1 for t in tokens_in_cluster if t["rect"].x1 <= pos_list[i+1]], default=pos_list[i])
                    cuts.append((left_x1 + pos_list[i+1]) / 2.0)

        valid_cuts = []
        for c in cuts:
            left_cols = set(round(t["rect"].x0 / 12.0) for t in tokens_in_cluster if t["rect"].x0 < c)
            right_cols = set(round(t["rect"].x0 / 12.0) for t in tokens_in_cluster if t["rect"].x0 >= c)
            if len(left_cols) >= 2 and len(right_cols) >= 2:
                valid_cuts.append(c)

        sub_clusters = []
        if valid_cuts:
            x_cuts = [-1.0] + sorted(list(set(valid_cuts))) + [999999.0]
            for c_idx in range(len(x_cuts) - 1):
                x_lo, x_hi = x_cuts[c_idx], x_cuts[c_idx + 1]
                sub = [l for l in cluster if x_lo <= (l["rect"].x0 + l["rect"].x1)/2.0 < x_hi]
                if len(sub) >= 2:
                    sub_clusters.append(sub)
        else:
            sub_clusters.append(cluster)

        for sub in sub_clusters:
            parsed = parse_single_table_block(sub, prims, stage_info)
            items.extend(parsed)

    return items

def parse_single_table_block(
    lines: List[Dict[str, Any]],
    prims: PrimitivesCollection,
    stage_info: StageRoiInfo
) -> List[ExtractedLegendItem]:
    items: List[ExtractedLegendItem] = []

    # Decompose lines into tokens (cells) by spans or char gaps
    row_groups: Dict[int, List[Dict[str, Any]]] = {}
    for l in lines:
        ry = round(l["rect"].y0 / 6.0)
        row_groups.setdefault(ry, []).append(l)

    # Sort row keys
    sorted_ry = sorted(row_groups.keys())
    if len(sorted_ry) < 2:
        return items

    # Analyze column positions across all rows
    all_token_rects: List[fitz.Rect] = []
    rows_data: List[List[Dict[str, Any]]] = []

    for ry in sorted_ry:
        r_lines = row_groups[ry]
        # Split tokens inside each line if spans or spaces separate them
        tokens_in_row = []
        for l in r_lines:
            for sp in l.get("spans", []):
                stext = get_span_text(sp).strip()
                if not stext:
                    continue
                srect = fitz.Rect(sp.get("bbox"))
                tokens_in_row.append({"text": stext, "rect": srect})
                all_token_rects.append(srect)
        if tokens_in_row:
            tokens_in_row.sort(key=lambda t: t["rect"].x0)
            rows_data.append(tokens_in_row)

    if len(rows_data) < 2:
        return items

    # Group tokens into column intervals by X0 (left-alignment clustering)
    col_x_centers: List[float] = []
    for r in rows_data:
        for t in r:
            x0 = t["rect"].x0
            # Match to existing col left-edge
            matched = False
            for i, cc in enumerate(col_x_centers):
                if abs(x0 - cc) < 22.0:
                    col_x_centers[i] = (cc + x0) / 2.0
                    matched = True
                    break
            if not matched:
                col_x_centers.append(x0)

    col_x_centers.sort()
    num_cols = len(col_x_centers)
    if num_cols < 2:
        return items

    # Construct grid matrix of cells: grid[row_idx][col_idx]
    grid_cells: List[List[TableCell]] = []
    for r_tokens in rows_data:
        row_cells = [TableCell(fitz.Rect(0, 0, 0, 0), "") for _ in range(num_cols)]
        for t in r_tokens:
            x0 = t["rect"].x0
            # assign to nearest col
            best_col = min(range(num_cols), key=lambda c: abs(x0 - col_x_centers[c]))
            cell = row_cells[best_col]
            if not cell.text:
                cell.text = t["text"]
                cell.rect = fitz.Rect(t["rect"])
            else:
                cell.text += " " + t["text"]
                cell.rect |= fitz.Rect(t["rect"])
        grid_cells.append(row_cells)

    # Attach vectors and rasters to cells
    for r_idx, row in enumerate(grid_cells):
        row_cells_with_rect = [c for c in row if c.rect.height > 0]
        ry0 = min((c.rect.y0 for c in row_cells_with_rect), default=0.0)
        ry1 = max((c.rect.y1 for c in row_cells_with_rect), default=0.0)

        for c_idx, cell in enumerate(row):
            if cell.rect.width > 0:
                exp_rect = fitz.Rect(cell.rect.x0 - 4.0, cell.rect.y0 - 2.0, cell.rect.x1 + 4.0, cell.rect.y1 + 2.0)
            elif row_cells_with_rect:
                cx = col_x_centers[c_idx]
                prev_cx = col_x_centers[c_idx - 1] if c_idx > 0 else (cx - 40.0)
                next_cx = col_x_centers[c_idx + 1] if c_idx < num_cols - 1 else (cx + 40.0)
                col_x0 = (prev_cx + cx) / 2.0
                col_x1 = (cx + next_cx) / 2.0
                exp_rect = fitz.Rect(col_x0, ry0 - 4.0, col_x1, ry1 + 4.0)
            else:
                continue

            for v in prims.vectors:
                if exp_rect.intersects(v.rect):
                    cell.vectors.append(v)
                    if cell.rect.width <= 0:
                        cell.rect = fitz.Rect(v.rect)
                    else:
                        cell.rect |= v.rect

            for img in prims.rasters:
                if exp_rect.intersects(img.rect):
                    cell.rasters.append(img)
                    if cell.rect.width <= 0:
                        cell.rect = fitz.Rect(img.rect)
                    else:
                        cell.rect |= img.rect

            for ch in prims.chars:
                if exp_rect.intersects(ch.rect):
                    cell.chars.append(ch)

    # 4. Hungarian Algorithm Role Assignment
    # Roles: 0: 'no', 1: 'name', 2: 'symbol', 3: 'quantity'
    ROLES = ['no', 'name', 'symbol', 'quantity']
    num_roles = len(ROLES)

    # Compute scores for each column
    score_matrix = np.zeros((num_roles, num_cols), dtype=float)

    for c_idx in range(num_cols):
        col_cells = [grid_cells[r_idx][c_idx] for r_idx in range(len(grid_cells))]
        col_texts = [cell.text.strip() for cell in col_cells if cell.text.strip()]
        header_text = col_texts[0].lower() if col_texts else ""
        data_texts = col_texts[1:] if len(col_texts) > 1 else col_texts

        # --- Role 'no' scoring ---
        s_no = 0.0
        for hint in cfg.column_header_hints.get("no", []):
            if hint in header_text:
                s_no += 12.0
                break
        # Check if data cells are integers (1, 2, 3...)
        int_count = sum(1 for t in data_texts if t.isdigit())
        if int_count >= max(1, len(data_texts) * 0.6):
            s_no += 10.0
            # Check sequential increase
            nums = [int(t) for t in data_texts if t.isdigit()]
            if len(nums) >= 2 and all(nums[i] <= nums[i+1] for i in range(len(nums)-1)):
                s_no += 8.0
        score_matrix[0, c_idx] = s_no

        # --- Role 'name' scoring ---
        s_name = 0.0
        for hint in cfg.column_header_hints.get("name", []):
            if hint in header_text:
                s_name += 12.0
                break
        kw_count = sum(1 for t in data_texts if any(kw in t for kw in cfg.equipment_keywords))
        s_name += kw_count * 5.0
        # Japanese noun length >= 2
        jp_count = sum(1 for t in data_texts if len(re.findall(r'[\u3040-\u30ff\u4e00-\u9faf]', t)) >= 2)
        s_name += jp_count * 2.0
        score_matrix[1, c_idx] = s_name

        # --- Role 'symbol' scoring ---
        s_sym = 0.0
        for hint in cfg.column_header_hints.get("symbol", []):
            if hint in header_text:
                s_sym += 12.0
                break
        # Vector / Raster elements present
        vector_count = sum(len(cell.vectors) + len(cell.rasters) for cell in col_cells[1:])
        s_sym += vector_count * 5.0
        # Character symbols
        sym_char_count = 0
        for t in data_texts:
            if any(ch in cfg.standard_symbols for ch in t):
                sym_char_count += 1
            elif any(ch in stage_info.layout_symbol_set for ch in t):
                sym_char_count += 1
        s_sym += sym_char_count * 4.0

        # PENALTY: strictly penalize pure digit numbers from being symbol column!
        if int_count >= max(2, len(data_texts) * 0.7) and vector_count == 0:
            s_sym -= 25.0

        score_matrix[2, c_idx] = s_sym

        # --- Role 'quantity' scoring ---
        s_qty = 0.0
        for hint in cfg.column_header_hints.get("quantity", []):
            if hint in header_text:
                s_qty += 12.0
                break
        qty_unit_count = sum(1 for t in data_texts if any(u in t for u in ["脚", "台", "本", "個", "式", "要", "不要"]))
        s_qty += qty_unit_count * 4.0
        score_matrix[3, c_idx] = s_qty

    # Hungarian assignment: we want to maximize total score -> minimize negative score
    # Create square cost matrix of size max(num_roles, num_cols)
    dim = max(num_roles, num_cols)
    cost = np.zeros((dim, dim), dtype=float)
    # Fill actual scores
    for r in range(num_roles):
        for c in range(num_cols):
            cost[r, c] = -score_matrix[r, c]

    row_ind, col_ind = linear_sum_assignment(cost)
    role_to_col: Dict[str, int] = {}
    for r_idx, c_idx in zip(row_ind, col_ind):
        if r_idx < num_roles and c_idx < num_cols:
            role_to_col[ROLES[r_idx]] = c_idx

    name_col = role_to_col.get('name')
    sym_col = role_to_col.get('symbol')

    if name_col is None or sym_col is None or name_col == sym_col:
        return items

    # Ensure symbol column actually has positive score
    if score_matrix[2, sym_col] <= 0.0 and score_matrix[1, name_col] <= 0.0:
        return items

    # Determine whether row 0 is header
    start_row = 0
    header_check = grid_cells[0][name_col].text.lower()
    if any(h in header_check for h in cfg.column_header_hints.get("name", [])) or \
       any(h in grid_cells[0][sym_col].text.lower() for h in cfg.column_header_hints.get("symbol", [])) or \
       "no" in grid_cells[0][role_to_col.get("no", sym_col)].text.lower():
        start_row = 1

    for r_idx in range(start_row, len(grid_cells)):
        name_cell = grid_cells[r_idx][name_col]
        sym_cell = grid_cells[r_idx][sym_col]

        raw_name = name_cell.text.strip()
        if not raw_name:
            continue

        # Clean name
        clean_name = re.sub(r'[\r\n\t]+', ' ', raw_name).strip()
        if not clean_name or clean_name.isdigit():
            continue

        # Determine symbol box & type
        sym_box: Optional[Box] = None
        sym_type = SymbolType.VECTOR_DRAWING.value
        raw_sym = sym_cell.text.strip()

        # Check vectors
        if sym_cell.vectors:
            u_vec = fitz.Rect(sym_cell.vectors[0].rect)
            for v in sym_cell.vectors[1:]:
                u_vec |= v.rect
            sym_box = Box.from_fitz_rect(u_vec)
            sym_type = SymbolType.VECTOR_DRAWING.value
        elif sym_cell.rasters:
            u_ras = fitz.Rect(sym_cell.rasters[0].rect)
            for r in sym_cell.rasters[1:]:
                u_ras |= r.rect
            sym_box = Box.from_fitz_rect(u_ras)
            sym_type = SymbolType.RASTER_IMAGE.value
        elif sym_cell.chars:
            # Look for standard symbol chars
            chosen_ch = next((ch for ch in sym_cell.chars if ch.is_symbol), None)
            if not chosen_ch:
                chosen_ch = next((ch for ch in sym_cell.chars if ch.norm_char in stage_info.layout_symbol_set), None)
            if not chosen_ch:
                chosen_ch = sym_cell.chars[0]

            sym_box = Box.from_fitz_rect(chosen_ch.rect)
            sym_type = SymbolType.TEXT_GLYPH.value
            raw_sym = chosen_ch.norm_char
        elif sym_cell.rect.width > 0:
            sym_box = Box.from_fitz_rect(sym_cell.rect)
            sym_type = SymbolType.TEXT_GLYPH.value

        if sym_box is not None:
            # Label box
            label_box = Box.from_fitz_rect(name_cell.rect) if name_cell.rect.width > 0 else sym_box
            items.append(ExtractedLegendItem(
                name=clean_name,
                symbol_box=sym_box,
                label_box=label_box,
                symbol_type=sym_type,
                confidence=0.95,
                source_mode="table",
                raw_symbol_text=raw_sym
            ))

    return items


# ==============================================================================
# Mode B: Inline Notation & Margin Miniature Vector Figures
# ==============================================================================

def parse_mode_b_inlines_and_margins(
    page: fitz.Page,
    prims: PrimitivesCollection,
    stage_info: StageRoiInfo
) -> List[ExtractedLegendItem]:
    items: List[ExtractedLegendItem] = []

    # 1. Parse Inline notation
    raw = page.get_text("rawdict")
    for block in raw.get("blocks", []):
        if block.get("type") == 0:
            for l in block.get("lines", []):
                line_rect = fitz.Rect(l["bbox"])
                if stage_info.is_inside_stage(line_rect):
                    continue
                line_text = "".join(get_span_text(s) for s in l.get("spans", [])).strip()
                if not line_text or is_instruction_or_caution_text(line_text):
                    continue

                # Check if this line has inline legend candidates
                parsed_inlines = parse_single_inline_line(l, prims, stage_info)
                items.extend(parsed_inlines)

    # 2. Parse Margin Miniature Vector Drawings
    # Standalone vectors in margins with nearby labels
    parsed_margins = parse_margin_miniatures(page, prims, stage_info)
    items.extend(parsed_margins)

    return items

def parse_single_inline_line(
    line_dict: Dict[str, Any],
    prims: PrimitivesCollection,
    stage_info: StageRoiInfo
) -> List[ExtractedLegendItem]:
    items: List[ExtractedLegendItem] = []
    spans = line_dict.get("spans", [])
    if not spans:
        return items

    # Collect chars in line with normalized representation
    line_chars: List[CharPrimitive] = []
    for sp in spans:
        for c in sp.get("chars", []):
            ch = c.get("c", "")
            if not ch:
                continue
            r = fitz.Rect(c.get("bbox"))
            line_chars.append(CharPrimitive(ch, cfg.normalization_map.get(ch, ch), r))

    full_text = "".join(ch.norm_char for ch in line_chars)
    if not full_text:
        return items

    # Check for equipment keywords in line
    matched_kws: List[Tuple[int, int, str]] = []  # (start_idx, end_idx, kw)
    for kw in cfg.equipment_keywords:
        idx = 0
        while True:
            pos = full_text.find(kw, idx)
            if pos == -1:
                break
            matched_kws.append((pos, pos + len(kw), kw))
            idx = pos + 1

    if not matched_kws:
        return items

    # Expand compound nouns (e.g. ピアノ + 椅子 -> ピアノ椅子, 合奏用 + 椅子 -> 合奏用椅子)
    expanded_kws: List[Tuple[int, int, str]] = []
    for start, end, kw in matched_kws:
        # expand backwards (kanji / katakana / alphanum)
        exp_start = start
        while exp_start > 0:
            prev_ch = full_text[exp_start - 1]
            if re.match(r'[\u4e00-\u9faf\u30a0-\u30ffA-Za-z0-9]', prev_ch) and prev_ch not in cfg.standard_symbols:
                exp_start -= 1
            else:
                break
        # expand forwards
        exp_end = end
        while exp_end < len(full_text):
            next_ch = full_text[exp_end]
            if re.match(r'[\u4e00-\u9faf\u30a0-\u30ffA-Za-z0-9]', next_ch) and next_ch not in cfg.standard_symbols:
                exp_end += 1
            else:
                break
        expanded_kws.append((exp_start, exp_end, full_text[exp_start:exp_end]))

    # Longest Match NMS
    expanded_kws.sort(key=lambda t: (t[1] - t[0]), reverse=True)
    kept_nouns: List[Tuple[int, int, str]] = []
    for s, e, text in expanded_kws:
        overlap = False
        for ks, ke, _ in kept_nouns:
            if max(s, ks) < min(e, ke):
                overlap = True
                break
        if not overlap:
            kept_nouns.append((s, e, text))

    kept_nouns.sort(key=lambda t: t[0])

    # Now look for paired symbols (either left or right of each noun)
    # Search for delimiter: … ‥ : = ( )
    delims_pattern = r'[…‥\.:=＝・\(\)（）\-\s]+'

    for n_start, n_end, noun in kept_nouns:
        name_rect = fitz.Rect(line_chars[n_start].rect)
        for c in line_chars[n_start+1:n_end]:
            name_rect |= c.rect

        # Try Right Pairing: [Noun] [Delim] [Symbol]
        right_sub = full_text[n_end:]
        m_right = re.match(r'^' + delims_pattern + r'([○●×□■△▲☆★◎◇◆①-⑩A-Za-z0-9])', right_sub)
        if m_right:
            sym_char = m_right.group(1)
            # Find char pos
            sym_idx = n_end + m_right.start(1)
            if sym_idx < len(line_chars):
                sym_r = line_chars[sym_idx].rect
                items.append(ExtractedLegendItem(
                    name=noun,
                    symbol_box=Box.from_fitz_rect(sym_r),
                    label_box=Box.from_fitz_rect(name_rect),
                    symbol_type=SymbolType.TEXT_GLYPH.value,
                    confidence=0.92,
                    source_mode="inline",
                    raw_symbol_text=sym_char
                ))
                continue

        # Try Left Pairing: [Symbol] [Delim] [Noun]
        left_sub = full_text[:n_start]
        m_left = re.search(r'([○●×□■△▲☆★◎◇◆①-⑩A-Za-z0-9])' + delims_pattern + r'$', left_sub)
        if m_left:
            sym_char = m_left.group(1)
            sym_idx = m_left.start(1)
            if sym_idx < len(line_chars):
                sym_r = line_chars[sym_idx].rect
                items.append(ExtractedLegendItem(
                    name=noun,
                    symbol_box=Box.from_fitz_rect(sym_r),
                    label_box=Box.from_fitz_rect(name_rect),
                    symbol_type=SymbolType.TEXT_GLYPH.value,
                    confidence=0.92,
                    source_mode="inline",
                    raw_symbol_text=sym_char
                ))
                continue

    return items

def parse_margin_miniatures(
    page: fitz.Page,
    prims: PrimitivesCollection,
    stage_info: StageRoiInfo
) -> List[ExtractedLegendItem]:
    items: List[ExtractedLegendItem] = []

    # Find standalone vector clusters in margins (outside stage ROI)
    margin_vectors = [v for v in prims.vectors if not stage_info.is_inside_stage(v.rect)]

    # Collect word blocks outside stage ROI
    text_blocks = page.get_text("blocks")
    outside_blocks = []
    for b in text_blocks:
        r = fitz.Rect(b[:4])
        t = b[4].strip()
        if not stage_info.is_inside_stage(r) and not is_instruction_or_caution_text(t):
            outside_blocks.append((r, t))

    for vec in margin_vectors:
        # Look for adjacent label text block (within 15pt above, below, or to the right)
        vr = vec.rect
        best_label: Optional[str] = None
        best_dist = 999999.0
        best_label_box: Optional[Box] = None

        for br, bt in outside_blocks:
            # Check if block contains equipment keyword
            matched_kw = next((kw for kw in cfg.equipment_keywords if kw in bt), None)
            if not matched_kw:
                continue

            # Calculate distance
            # Check below:
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
                source_mode="margin_miniature"
            ))

    return items
