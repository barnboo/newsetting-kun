from __future__ import annotations
from typing import Optional, List, Any, Tuple
import fitz
import cv2
import numpy as np

from .models import Box
from .config import cfg

def refine_tight_symbol_crop(
    page: fitz.Page,
    raw_box: Box,
    target_char_rect: Optional[fitz.Rect] = None,
    all_page_chars: Optional[List[Any]] = None,
    inner_clamp_rect: Optional[fitz.Rect] = None,
    bracket_rects: Optional[List[fitz.Rect]] = None
) -> Box:
    """
    Precision OpenCV-based tight cropping with:
    - Otsu thresholding + inversion
    - Explicit bracket/delimiter/adjacent char zero-masking
    - Penetrating grid/border line removal (morphological opening)
    - Strict inner clamping for bracketed symbols (Requirement 5)
    """
    page_rect = fitz.Rect(page.rect)
    thresh = cfg.thresholds
    render_dpi = float(thresh.get("render_dpi", 300))
    scale = render_dpi / 72.0
    margin_ratio = float(thresh.get("tight_crop_margin_ratio", 0.08))
    min_margin = float(thresh.get("tight_crop_min_margin_pt", 1.2))

    cand_rect = raw_box.to_fitz_rect()
    # Expand window by +6pt
    ext_rect = fitz.Rect(
        max(page_rect.x0, cand_rect.x0 - 6.0),
        max(page_rect.y0, cand_rect.y0 - 6.0),
        min(page_rect.x1, cand_rect.x1 + 6.0),
        min(page_rect.y1, cand_rect.y1 + 6.0)
    )

    if ext_rect.width <= 2.0 or ext_rect.height <= 2.0:
        return raw_box

    try:
        # High resolution grayscale render of local window
        mat = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat, clip=ext_rect, colorspace=fitz.csGRAY)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape((pix.height, pix.width))

        # Otsu thresholding with inversion (foreground ink = 255, white paper = 0)
        _, binary = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

        # 1. Mask out explicit bracket characters (Requirement 5)
        if bracket_rects:
            for br in bracket_rects:
                if ext_rect.intersects(br):
                    # Inset by 0.3pt so we don't accidentally shave off the symbol
                    in_br = fitz.Rect(br.x0 + 0.3, br.y0 + 0.3, br.x1 - 0.3, br.y1 - 0.3)
                    px0 = max(0, int((in_br.x0 - ext_rect.x0) * scale))
                    py0 = max(0, int((in_br.y0 - ext_rect.y0) * scale))
                    px1 = min(pix.width, int((in_br.x1 - ext_rect.x0) * scale) + 1)
                    py1 = min(pix.height, int((in_br.y1 - ext_rect.y0) * scale) + 1)
                    if px1 > px0 and py1 > py0:
                        binary[py0:py1, px0:px1] = 0

        # 2. Non-target character masking:
        if target_char_rect is not None and all_page_chars:
            for ch in all_page_chars:
                cr = ch.rect
                if ext_rect.intersects(cr):
                    # Check if cr is concentric / overlapping with target_char_rect
                    inter = fitz.Rect(cr) & fitz.Rect(target_char_rect)
                    inter_area = (inter.width * inter.height) if not inter.is_empty else 0.0
                    if inter_area > 0.5 * (target_char_rect.width * target_char_rect.height):
                        # This is the target symbol character, keep it!
                        continue
                    # Non-target character: mask out to 0 (background)
                    # Inset by 0.5pt to protect adjacent target symbol boundary
                    in_cr = fitz.Rect(cr.x0 + 0.5, cr.y0 + 0.5, cr.x1 - 0.5, cr.y1 - 0.5)
                    px0 = max(0, int((in_cr.x0 - ext_rect.x0) * scale))
                    py0 = max(0, int((in_cr.y0 - ext_rect.y0) * scale))
                    px1 = min(pix.width, int((in_cr.x1 - ext_rect.x0) * scale) + 1)
                    py1 = min(pix.height, int((in_cr.y1 - ext_rect.y0) * scale) + 1)
                    if px1 > px0 and py1 > py0:
                        binary[py0:py1, px0:px1] = 0

        # 3. Inner clamp masking (Requirement 5.3):
        # Zero out any pixels outside inner_clamp_rect horizontally
        if inner_clamp_rect is not None:
            c_px0 = int((inner_clamp_rect.x0 - ext_rect.x0) * scale)
            c_px1 = int((inner_clamp_rect.x1 - ext_rect.x0) * scale)
            if c_px0 > 0:
                binary[:, :max(0, min(pix.width, c_px0))] = 0
            if c_px1 < pix.width:
                binary[:, max(0, min(pix.width, c_px1)):] = 0

        h, w = binary.shape

        # 4. Penetrating line removal:
        # Detect lines spanning >= 78% of window
        kw = int(w * 0.78)
        if kw >= 8:
            h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kw, 1))
            h_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, h_kernel)
            h_lines = cv2.dilate(h_lines, cv2.getStructuringElement(cv2.MORPH_RECT, (1, 3)))
            binary[h_lines > 0] = 0

        kh = int(h * 0.78)
        if kh >= 8:
            v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, kh))
            v_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, v_kernel)
            v_lines = cv2.dilate(v_lines, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 1)))
            binary[v_lines > 0] = 0

        # Find non-zero symbol pixels
        pts = cv2.findNonZero(binary)
        if pts is not None and len(pts) > 0:
            bx, by, bw, bh = cv2.boundingRect(pts)
            if bw >= 2 and bh >= 2:
                # Convert back to PDF coordinate system
                pdf_x = ext_rect.x0 + (bx / scale)
                pdf_y = ext_rect.y0 + (by / scale)
                pdf_w = bw / scale
                pdf_h = bh / scale

                # Uniform margin: 8% of symbol size, min 1.2pt
                pad = max(min_margin, max(pdf_w, pdf_h) * margin_ratio)

                final_x0 = max(page_rect.x0, pdf_x - pad)
                final_y0 = max(page_rect.y0, pdf_y - pad)
                final_x1 = min(page_rect.x1, pdf_x + pdf_w + pad)
                final_y1 = min(page_rect.y1, pdf_y + pdf_h + pad)

                # Requirement 5.3: Strict clamp inside inner_clamp_rect [open_p.x1 + 0.2, close_p.x0 - 0.2]
                if inner_clamp_rect is not None:
                    final_x0 = max(final_x0, inner_clamp_rect.x0)
                    final_x1 = min(final_x1, inner_clamp_rect.x1)

                return Box(
                    x=final_x0,
                    y=final_y0,
                    width=max(1.0, final_x1 - final_x0),
                    height=max(1.0, final_y1 - final_y0)
                )

    except Exception:
        # If any OpenCV processing fails, fallback gracefully
        pass

    return raw_box
