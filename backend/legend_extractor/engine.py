from __future__ import annotations
from typing import List, Optional, Dict
import fitz

from .models import ExtractedLegendItem, Box
from .primitives import extract_primitives
from .roi_filter import estimate_stage_roi_and_symbols
from .parsers import parse_mode_a_tables, parse_mode_b_inlines_and_margins
from .cropper import refine_tight_symbol_crop
from .config import cfg

class LegendExtractor:
    def __init__(self):
        pass

    def extract(self, page: fitz.Page) -> List[ExtractedLegendItem]:
        # Step 1: Atomic primitives extraction
        prims = extract_primitives(page)

        # Step 2: Stage ROI estimation & symbol set collection
        stage_info = estimate_stage_roi_and_symbols(page, prims)

        # Step 3: Dual-Mode parsing
        candidates: List[ExtractedLegendItem] = []

        # Mode A: Physical Grid Tables ONLY
        items_a = parse_mode_a_tables(page, prims, stage_info)
        candidates.extend(items_a)

        # Mode B: Space-transparent Chunks & Local Pairs
        items_b = parse_mode_b_inlines_and_margins(page, prims, stage_info)
        candidates.extend(items_b)

        # Deduplication by Normalized Equipment Name with Priority (Section 2.D)
        # Priority 3 (＝ / → / …) > Priority 2 (〜印 / 括弧) > Priority 1 (空白区切り)
        name_groups: Dict[str, List[ExtractedLegendItem]] = {}
        for it in candidates:
            # Normalize name by stripping spaces
            norm_name = it.name.replace(" ", "").replace("　", "")
            name_groups.setdefault(norm_name, []).append(it)

        prioritized_items: List[ExtractedLegendItem] = []
        for norm_name, group in name_groups.items():
            # Sort group by priority descending, then confidence descending
            group.sort(key=lambda x: (x.priority, x.confidence), reverse=True)
            # Pick highest priority item
            best = group[0]
            prioritized_items.append(best)

        # Step 4: OpenCV Penetrating Line Removal and Tight Cropping
        refined_items: List[ExtractedLegendItem] = []
        for it in prioritized_items:
            tight_sym_box = refine_tight_symbol_crop(
                page,
                it.symbol_box,
                target_char_rect=it.target_char_rect,
                all_page_chars=prims.chars
            )
            it.symbol_box = tight_sym_box
            refined_items.append(it)

        # Step 5: Spatial IoU Deduplication
        iou_thresh = float(cfg.thresholds.get("iou_dedup_threshold", 0.40))
        unique_items: List[ExtractedLegendItem] = []

        # Sort candidates by confidence descending
        refined_items.sort(key=lambda it: (it.priority, it.confidence), reverse=True)

        for it in refined_items:
            is_dup = False
            for kept in unique_items:
                sym_iou = it.symbol_box.iou(kept.symbol_box)
                lbl_iou = it.label_box.iou(kept.label_box)
                if sym_iou > iou_thresh or (lbl_iou > 0.6 and it.name == kept.name):
                    is_dup = True
                    break
            if not is_dup:
                unique_items.append(it)

        # Sort by natural reading order: row bands (Y) then column (X)
        unique_items.sort(key=lambda it: (round(it.symbol_box.y / 14.0), it.symbol_box.x))

        return unique_items

def extract_legends(doc: fitz.Document, page_num: int = 0) -> List[ExtractedLegendItem]:
    page = doc[page_num]
    if page.rotation != 0:
        page.remove_rotation()
    extractor = LegendExtractor()
    return extractor.extract(page)
