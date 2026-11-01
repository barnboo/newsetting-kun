from __future__ import annotations
from typing import List, Optional
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
        # Mode A: Tables (bordered, borderless, multi-column)
        items_a = parse_mode_a_tables(page, prims, stage_info)
        candidates.extend(items_a)

        # Mode B: Inlines & Margin miniatures
        items_b = parse_mode_b_inlines_and_margins(page, prims, stage_info)
        candidates.extend(items_b)

        # Step 4: OpenCV Penetrating Line Removal and Tight Cropping
        refined_items: List[ExtractedLegendItem] = []
        for it in candidates:
            tight_sym_box = refine_tight_symbol_crop(page, it.symbol_box)
            it.symbol_box = tight_sym_box
            refined_items.append(it)

        # Step 5: IoU Deduplication & Natural Reading Order Sorting
        iou_thresh = float(cfg.thresholds.get("iou_dedup_threshold", 0.40))
        unique_items: List[ExtractedLegendItem] = []

        # Sort candidates by confidence descending
        refined_items.sort(key=lambda it: it.confidence, reverse=True)

        for it in refined_items:
            is_dup = False
            for kept in unique_items:
                # Check symbol box IoU or label box IoU
                sym_iou = it.symbol_box.iou(kept.symbol_box)
                lbl_iou = it.label_box.iou(kept.label_box)
                if sym_iou > iou_thresh or (lbl_iou > 0.5 and it.name == kept.name):
                    is_dup = True
                    break
            if not is_dup:
                unique_items.append(it)

        # Sort by natural reading order: row bands (Y) then column (X)
        unique_items.sort(key=lambda it: (round(it.symbol_box.y / 12.0), it.symbol_box.x))

        return unique_items

def extract_legends(doc: fitz.Document, page_num: int = 0) -> List[ExtractedLegendItem]:
    page = doc[page_num]
    if page.rotation != 0:
        page.remove_rotation()
    extractor = LegendExtractor()
    return extractor.extract(page)
