from __future__ import annotations
import re
from typing import List, Optional, Dict, Tuple
import fitz

from .models import ExtractedLegendItem, Box
from .primitives import extract_primitives
from .roi_filter import estimate_stage_roi_and_symbols, normalize_equipment_name_for_dedup, has_dimension_text_near_box
from .parsers import parse_mode_a_tables, parse_mode_b_inlines_and_margins
from .cropper import refine_tight_symbol_crop
from .ocr_fallback import run_ocr_fallback
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

        # Mode A: Physical Grid Tables ONLY (returns items and claimed table bounding boxes)
        items_a, claimed_tables = parse_mode_a_tables(page, prims, stage_info)
        candidates.extend(items_a)

        # Mode B: Space-transparent Chunks & Local Pairs (excludes claimed table cells & stage interior)
        items_b = parse_mode_b_inlines_and_margins(page, prims, stage_info, claimed_table_rects=claimed_tables)
        candidates.extend(items_b)

        # Step 3.5: Local OCR Fallback (Requirement 5)
        # Triggered when text primitives count < 15 (pure scanned/raster PDF), or margin has medium/large raster images
        should_run_ocr = len(prims.chars) < 15
        if not should_run_ocr and len(candidates) == 0:
            # Check if there are medium/large raster images in margins without text
            for r in prims.rasters:
                if not stage_info.is_inside_stage(r.rect) and (r.rect.width >= 40.0 and r.rect.height >= 40.0):
                    should_run_ocr = True
                    break

        if should_run_ocr:
            ocr_items = run_ocr_fallback(page, prims, stage_info)
            candidates.extend(ocr_items)

        # Step 4: Page-wide Deduplication by Normalized Name & Symbol Signature (Requirement 6 & 3.4)
        # Groups items with identical normalized name and symbol
        dedup_groups: Dict[Tuple[str, str], List[ExtractedLegendItem]] = {}
        for it in candidates:
            norm_name = normalize_equipment_name_for_dedup(it.name)
            if it.raw_symbol_text:
                sym_sig = f"text:{it.raw_symbol_text}"
            else:
                # Vector symbol signature by shape aspect ratio / area bucket
                sym_sig = f"vec:{round(it.symbol_box.width / 4.0)}:{round(it.symbol_box.height / 4.0)}"
            dedup_groups.setdefault((norm_name, sym_sig), []).append(it)

        prioritized_items: List[ExtractedLegendItem] = []
        for (norm_name, sym_sig), group in dedup_groups.items():
            # Sort group by priority descending, confidence descending
            group.sort(key=lambda x: (x.priority, x.confidence), reverse=True)
            best = group[0]
            # Ensure representative item has cleaned normalized name
            best.name = norm_name
            prioritized_items.append(best)

        # Step 5: OpenCV Penetrating Line Removal, Inset Masking and Tight Cropping (Requirement 5)
        refined_items: List[ExtractedLegendItem] = []
        page_words = page.get_text("words")

        for it in prioritized_items:
            # Final defensive check: exclude if symbol is near dimension text or inside stage
            sym_rect = it.symbol_box.to_fitz_rect()
            if has_dimension_text_near_box(sym_rect, page_words, 3.0):
                continue
            if it.source_mode != "table" and stage_info.is_inside_stage(sym_rect):
                continue

            tight_sym_box = refine_tight_symbol_crop(
                page,
                it.symbol_box,
                target_char_rect=it.target_char_rect,
                all_page_chars=prims.chars,
                inner_clamp_rect=it.inner_clamp_rect,
                bracket_rects=it.bracket_rects
            )
            it.symbol_box = tight_sym_box
            refined_items.append(it)

        # Step 6: Spatial IoU Deduplication
        iou_thresh = float(cfg.thresholds.get("iou_dedup_threshold", 0.40))
        unique_items: List[ExtractedLegendItem] = []

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
