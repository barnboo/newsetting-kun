from __future__ import annotations
import math
import re
from typing import List, Dict, Any, Tuple, Optional
import fitz
import cv2
import numpy as np

from .models import Box, SymbolType, ExtractedLegendItem
from .config import cfg
from .roi_filter import StageRoiInfo, is_circulation_or_stage_structure, normalize_equipment_name_for_dedup

from .primitives import PrimitivesCollection

_rapid_ocr_instance = None

def get_rapid_ocr():
    global _rapid_ocr_instance
    if _rapid_ocr_instance is None:
        try:
            from rapidocr_onnxruntime import RapidOCR
            _rapid_ocr_instance = RapidOCR()
        except Exception as e:
            print(f"[legend_extractor] Warning: Failed to initialize RapidOCR: {e}")
            _rapid_ocr_instance = False
    return _rapid_ocr_instance if _rapid_ocr_instance is not False else None

def run_ocr_fallback(
    page: fitz.Page,
    prims: PrimitivesCollection,
    stage_info: StageRoiInfo,
    existing_items: Optional[List[ExtractedLegendItem]] = None
) -> List[ExtractedLegendItem]:
    """
    Requirement 5.2: Complete local offline OCR fallback.
    Triggers when:
      1. Page rawdict valid text count < 15 (scanned PDF / outlined PDF like Fukuoka)
      2. Margin contains medium/large embedded raster image with no text layer (like Saga)
    """
    ocr = get_rapid_ocr()
    if ocr is None:
        return []

    prims_chars_count = len(prims.chars)
    items: List[ExtractedLegendItem] = []
    claimed_names = set(normalize_equipment_name_for_dedup(it.name) for it in (existing_items or []))
    zoom = 300.0 / 72.0
    page_rect = fitz.Rect(page.rect)

    # -------------------------------------------------------------------------
    # Case 1: Full-page Scanned PDF (text count < 15)
    # -------------------------------------------------------------------------
    if prims_chars_count < 15:
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        img_bgr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, 3)

        # Try original orientation and 90-degree rotated orientation
        orientations = [
            (img_bgr, 0),
            (cv2.rotate(img_bgr, cv2.ROTATE_90_COUNTERCLOCKWISE), 90),
            (cv2.rotate(img_bgr, cv2.ROTATE_90_CLOCKWISE), 270)
        ]

        best_found_items: List[ExtractedLegendItem] = []

        for curr_img, rot_deg in orientations:
            res, _ = ocr(curr_img)
            if not res:
                continue

            # Check if any equipment keywords are found in this orientation
            matched_ocr_boxes = []
            for box, text, score in res:
                if score < 0.6:
                    continue
                clean_t = text.strip(" ·・-—:：")
                if is_circulation_or_stage_structure(clean_t):
                    continue

                matched_name = None
                for kw in cfg.equipment_keywords:
                    if kw in clean_t:
                        matched_name = kw
                        break
                if not matched_name:
                    for suf in cfg.equipment_suffixes:
                        if clean_t.endswith(suf) and 2 <= len(clean_t) <= 8:
                            matched_name = clean_t
                            break

                if matched_name:
                    matched_ocr_boxes.append((box, clean_t, matched_name, score))

            if matched_ocr_boxes:
                # Binary image for connected components (symbols)
                gray = cv2.cvtColor(curr_img, cv2.COLOR_BGR2GRAY)
                _, bin_img = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)
                num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(bin_img)

                # Collect CCs of valid symbol size (3pt to 28pt)
                valid_ccs = []
                for c_idx in range(1, num_labels):
                    x, y, w, h, area = stats[c_idx]
                    pw, ph = w / zoom, h / zoom
                    if 3.0 <= pw <= 30.0 and 3.0 <= ph <= 30.0 and area > 12:
                        valid_ccs.append((x, y, w, h, pw, ph, fitz.Rect(x / zoom, y / zoom, (x + w) / zoom, (y + h) / zoom)))

                for box, full_text, eq_name, score in matched_ocr_boxes:
                    xs = [p[0] for p in box]
                    ys = [p[1] for p in box]
                    lbl_x0, lbl_y0, lbl_x1, lbl_y1 = min(xs), min(ys), max(xs), max(ys)
                    lbl_pt = fitz.Rect(lbl_x0 / zoom, lbl_y0 / zoom, lbl_x1 / zoom, lbl_y1 / zoom)

                    # Search for symbol right next to label (within 65pt horizontally)
                    best_sym_rect: Optional[fitz.Rect] = None
                    best_sym_text: Optional[str] = None
                    min_dist = 999999.0

                    # 1. First check if OCR detected single char symbol (T, Y, X, O, etc.)
                    for o_box, o_text, o_score in res:
                        o_txt = o_text.strip()
                        if o_txt in ("T", "Y", "X", "O", "○", "●", "◎", "□", "■", "△", "▲", "☆", "★"):
                            oxs = [p[0] / zoom for p in o_box]
                            oys = [p[1] / zoom for p in o_box]
                            o_rect = fitz.Rect(min(oxs), min(oys), max(oxs), max(oys))
                            # Check horizontal alignment
                            dx = o_rect.x0 - lbl_pt.x1
                            dy = abs((o_rect.y0 + o_rect.y1)/2.0 - (lbl_pt.y0 + lbl_pt.y1)/2.0)
                            if 0.0 <= dx <= 65.0 and dy <= 20.0:
                                if dx < min_dist:
                                    min_dist = dx
                                    best_sym_rect = o_rect
                                    best_sym_text = o_txt

                    # 2. If no text glyph found, check black pixel connected components
                    if best_sym_rect is None:
                        for cc_x, cc_y, cc_w, cc_h, pw, ph, cc_rect in valid_ccs:
                            dx = cc_rect.x0 - lbl_pt.x1
                            dy = abs((cc_rect.y0 + cc_rect.y1)/2.0 - (lbl_pt.y0 + lbl_pt.y1)/2.0)
                            if 2.0 <= dx <= 65.0 and dy <= 18.0:
                                if dx < min_dist:
                                    min_dist = dx
                                    best_sym_rect = cc_rect
                                    best_sym_text = None

                    if best_sym_rect is not None:
                        # Convert coordinates back to original page orientation if rotated
                        def map_rect_back(r: fitz.Rect, rot: int, W: float, H: float) -> fitz.Rect:
                            if rot == 90:  # ROTATE_90_COUNTERCLOCKWISE (orig_x = W - r.y1, orig_y = r.x0)
                                return fitz.Rect(W - r.y1, r.x0, W - r.y0, r.x1)
                            elif rot == 270:  # ROTATE_90_CLOCKWISE (orig_x = r.y0, orig_y = H - r.x1)
                                return fitz.Rect(r.y0, H - r.x1, r.y1, H - r.x0)
                            return r

                        orig_lbl = map_rect_back(lbl_pt, rot_deg, page_rect.width, page_rect.height)
                        orig_sym = map_rect_back(best_sym_rect, rot_deg, page_rect.width, page_rect.height)

                        best_found_items.append(ExtractedLegendItem(
                            name=eq_name,
                            symbol_box=Box.from_fitz_rect(orig_sym),
                            label_box=Box.from_fitz_rect(orig_lbl),
                            symbol_type=SymbolType.TEXT_GLYPH.value if best_sym_text else SymbolType.VECTOR_DRAWING.value,
                            confidence=0.90,
                            source_mode="ocr_fallback",
                            raw_symbol_text=best_sym_text,
                            priority=2,
                            extra_meta={"detection_rule": "OCR_Fallback_ScannedPage"}
                        ))

            if len(best_found_items) >= 2:
                break

        if best_found_items:
            items.extend(best_found_items)

    # -------------------------------------------------------------------------
    # Case 2: Margin Embedded Images with no text layer (Saga pattern)
    # -------------------------------------------------------------------------
    try:
        images = page.get_image_info()
    except Exception:
        images = []

    PERC_MAP = {
        "timp": "Timp", "timpani": "Timp", "b.d": "B.D", "bd": "B.D", "marinba": "Marinba",
        "marimba": "Marimba", "xylo": "Xylo", "glocken": "Glocken", "chime": "Chime", "gong": "Gong",
        "vib": "Vib", "cym": "Cym", "set": "Dr.Set", "drums": "Drums"
    }

    for img_info in images:
        bbox = img_info.get("bbox")
        if not bbox:
            continue
        img_rect = fitz.Rect(bbox)

        # Must be outside stage and reasonably large (area >= 5000 pt^2 or w>=60, h>=60)
        if stage_info.is_inside_stage(img_rect):
            continue
        if (img_rect.width * img_rect.height < 5000.0) and not (img_rect.width >= 60.0 and img_rect.height >= 60.0):
            continue

        # Check if text layer already exists inside this image rect
        chars_inside = page.get_text("words", clip=img_rect)
        if len(chars_inside) >= 4:
            continue  # Already has vector text layer

        # Render image region at 300 DPI
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=img_rect, alpha=False)
        crop_bgr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, 3)

        res, _ = ocr(crop_bgr)
        if not res:
            continue

        gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
        _, bin_img = cv2.threshold(gray, 210, 255, cv2.THRESH_BINARY_INV)
        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(bin_img)

        # Collect CCs inside the image (miniature icon candidates: 8pt to 65pt)
        cc_candidates = []
        for c_idx in range(1, num_labels):
            x, y, w, h, area = stats[c_idx]
            pw, ph = w / zoom, h / zoom
            if 8.0 <= pw <= 65.0 and 8.0 <= ph <= 65.0 and area > 20:
                cc_rect_pt = fitz.Rect(
                    img_rect.x0 + x / zoom,
                    img_rect.y0 + y / zoom,
                    img_rect.x0 + (x + w) / zoom,
                    img_rect.y0 + (y + h) / zoom
                )
                cc_candidates.append(cc_rect_pt)

        for box, text, score in res:
            clean_t = text.strip(" .·・:：")
            norm_name: Optional[str] = None
            for p_kw, p_label in PERC_MAP.items():
                if p_kw in clean_t.lower():
                    norm_name = p_label
                    break

            if not norm_name or norm_name in claimed_names:
                continue

            # Label rect in PDF coordinates
            xs = [p[0] / zoom + img_rect.x0 for p in box]
            ys = [p[1] / zoom + img_rect.y0 for p in box]
            lbl_r = fitz.Rect(min(xs), min(ys), max(xs), max(ys))

            # Match closest CC directly adjacent above or below within 18pt
            best_cc: Optional[fitz.Rect] = None
            best_dist = 999999.0
            mid_lbl_x = (lbl_r.x0 + lbl_r.x1) / 2.0

            for cc in cc_candidates:
                mid_cc_x = (cc.x0 + cc.x1) / 2.0
                dx = abs(mid_cc_x - mid_lbl_x)
                if dx <= max(25.0, (cc.width + lbl_r.width)/2.0 + 4.0):
                    dy: Optional[float] = None
                    if 0.0 <= (lbl_r.y0 - cc.y1) <= 18.0:  # CC directly above label
                        dy = lbl_r.y0 - cc.y1
                    elif 0.0 <= (cc.y0 - lbl_r.y1) <= 18.0:  # CC directly below label
                        dy = cc.y0 - lbl_r.y1

                    if dy is not None:
                        d2d = dx * dx + dy * dy
                        if d2d < best_dist:
                            best_dist = d2d
                            best_cc = cc

            if best_cc is not None:
                claimed_names.add(norm_name)
                items.append(ExtractedLegendItem(
                    name=norm_name,
                    symbol_box=Box.from_fitz_rect(best_cc),
                    label_box=Box.from_fitz_rect(lbl_r),
                    symbol_type=SymbolType.RASTER_IMAGE.value,
                    confidence=0.92,
                    source_mode="ocr_fallback",
                    priority=2,
                    extra_meta={"detection_rule": "OCR_Fallback_MarginImage"}
                ))

    return items
