from __future__ import annotations
from typing import Optional
import fitz
import cv2
import numpy as np

from .models import Box
from .config import cfg

def refine_tight_symbol_crop(
    page: fitz.Page,
    raw_box: Box
) -> Box:
    page_rect = fitz.Rect(page.rect)
    thresh = cfg.thresholds
    render_dpi = float(thresh.get("render_dpi", 300))
    scale = render_dpi / 72.0
    pen_ratio = float(thresh.get("line_removal_penetration_ratio", 0.88))
    margin_ratio = float(thresh.get("tight_crop_margin_ratio", 0.08))
    min_margin = float(thresh.get("tight_crop_min_margin_pt", 1.5))

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

        # Otsu thresholding with inversion (foreground = 255, white paper = 0)
        _, binary = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

        h, w = binary.shape

        # Penetrating line removal:
        # Detect lines spanning >= 88% of window
        kw = int(w * pen_ratio)
        if kw >= 8:
            h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kw, 1))
            h_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, h_kernel)
            # Expand line thickness slightly to erase anti-aliasing edges
            h_lines = cv2.dilate(h_lines, cv2.getStructuringElement(cv2.MORPH_RECT, (1, 3)))
            binary[h_lines > 0] = 0

        kh = int(h * pen_ratio)
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

                # Uniform margin: 8% of symbol size, min 1.5pt
                pad = max(min_margin, max(pdf_w, pdf_h) * margin_ratio)
                return Box(
                    x=max(page_rect.x0, pdf_x - pad),
                    y=max(page_rect.y0, pdf_y - pad),
                    width=min(page_rect.x1 - pdf_x + pad, pdf_w + pad * 2.0),
                    height=min(page_rect.y1 - pdf_y + pad, pdf_h + pad * 2.0)
                )

    except Exception as e:
        # If any OpenCV processing fails, fallback gracefully
        pass

    return raw_box
