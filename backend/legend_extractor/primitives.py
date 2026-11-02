from __future__ import annotations
import unicodedata
from typing import List, Dict, Any, Tuple, Optional
import fitz
from .models import Box, SymbolType
from .config import cfg

# Unicode bidi formatting characters to strip
BIDI_CHARS = {
    '\u200e', '\u200f', '\u202a', '\u202b', '\u202c', '\u202d', '\u202e',
    '\u2066', '\u2067', '\u2068', '\u2069', '\ufeff'
}

class CharPrimitive:
    def __init__(self, raw_char: str, norm_char: str, rect: fitz.Rect, span_flags: int = 0):
        self.raw_char = raw_char
        self.norm_char = norm_char
        self.rect = rect
        self.span_flags = span_flags
        self.box = Box.from_fitz_rect(rect)

    @property
    def is_symbol(self) -> bool:
        return self.norm_char in cfg.standard_symbols

class VectorClusterPrimitive:
    def __init__(self, rect: fitz.Rect, sub_element_count: int = 1):
        self.rect = rect
        self.box = Box.from_fitz_rect(rect)
        self.sub_element_count = sub_element_count

class RasterPrimitive:
    def __init__(self, rect: fitz.Rect, image_id: Optional[int] = None):
        self.rect = rect
        self.box = Box.from_fitz_rect(rect)
        self.image_id = image_id

class PrimitivesCollection:
    def __init__(
        self,
        chars: List[CharPrimitive],
        vectors: List[VectorClusterPrimitive],
        rasters: List[RasterPrimitive],
        page_rect: fitz.Rect
    ):
        self.chars = chars
        self.vectors = vectors
        self.rasters = rasters
        self.page_rect = page_rect

class UnionFind:
    def __init__(self, n: int):
        self.parent = list(range(n))

    def find(self, i: int) -> int:
        if self.parent[i] == i:
            return i
        self.parent[i] = self.find(self.parent[i])
        return self.parent[i]

    def union(self, i: int, j: int):
        root_i = self.find(i)
        root_j = self.find(j)
        if root_i != root_j:
            self.parent[root_i] = root_j

def normalize_char(c: str) -> str:
    # Filter bidi control codes
    clean_c = "".join(ch for ch in c if ch not in BIDI_CHARS)
    if not clean_c:
        return ""
    nfkc = unicodedata.normalize("NFKC", clean_c)
    return cfg.normalization_map.get(nfkc, cfg.normalization_map.get(clean_c, nfkc))

def extract_primitives(page: fitz.Page) -> PrimitivesCollection:
    page_rect = fitz.Rect(page.rect)
    thresh = cfg.thresholds
    min_sz = float(thresh.get("min_symbol_size_pt", 1.2))
    min_line_len = float(thresh.get("min_vector_line_len_pt", 1.2))
    max_sz = float(thresh.get("max_symbol_size_pt", 85.0))
    cluster_dist = float(thresh.get("vector_cluster_distance_pt", 1.8))

    # --- 1. Character Level Extraction via rawdict ---
    chars: List[CharPrimitive] = []
    raw = page.get_text("rawdict")
    for block in raw.get("blocks", []):
        if block.get("type") == 0:  # text block
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    flags = span.get("flags", 0)
                    for c_dict in span.get("chars", []):
                        ch = c_dict.get("c", "")
                        if not ch or ch.isspace():
                            continue
                        norm_ch = normalize_char(ch)
                        if not norm_ch:
                            continue
                        bbox = c_dict.get("bbox")
                        if not bbox:
                            continue
                        r = fitz.Rect(bbox)
                        if r.width <= 0 or r.height <= 0:
                            continue
                        chars.append(CharPrimitive(ch, norm_ch, r, flags))

    # --- 2. Decompose Drawings & Cluster Small Paths ---
    drawings = page.get_drawings()
    sub_rects: List[fitz.Rect] = []

    for d in drawings:
        d_rect = fitz.Rect(d["rect"])
        w_stroke = d.get("width") or 1.0
        pad = max(0.2, w_stroke / 2.0)

        # Standalone small drawing path
        # Exclude horizontal fill-in underlines (w > 26pt and h < 2.5pt)
        if min_sz <= d_rect.width <= max_sz and min_sz <= d_rect.height <= max_sz:
            if not (d_rect.width > 26.0 and d_rect.height < 2.5):
                sub_rects.append(fitz.Rect(d_rect.x0 - pad, d_rect.y0 - pad, d_rect.x1 + pad, d_rect.y1 + pad))
                continue

        # Composite path: decompose items into basic commands
        items = d.get("items", [])
        for item in items:
            cmd = item[0]
            item_rect: Optional[fitz.Rect] = None

            if cmd == "l":  # ("l", p1, p2)
                p1, p2 = item[1], item[2]
                rx0, rx1 = min(p1.x, p2.x), max(p1.x, p2.x)
                ry0, ry1 = min(p1.y, p2.y), max(p1.y, p2.y)
                w_seg = rx1 - rx0
                h_seg = ry1 - ry0
                seg_len = max(w_seg, h_seg)

                # Exclude long borders / grid lines (> max_sz) or sub-threshold tiny noise (< min_line_len)
                if w_seg > max_sz or h_seg > max_sz or seg_len < min_line_len:
                    continue
                # Exclude horizontal fill-in underline vectors (w > 26pt and h < 2.5pt)
                if w_seg > 26.0 and h_seg < 2.5:
                    continue
                item_rect = fitz.Rect(rx0 - pad, ry0 - pad, rx1 + pad, ry1 + pad)

            elif cmd == "re":  # ("re", rect)
                r = fitz.Rect(item[1])
                # Exclude long lines or large rectangles
                if r.width > max_sz or r.height > max_sz:
                    continue
                # Exclude horizontal fill-in underlines (w > 26pt and h < 2.5pt)
                if r.width > 26.0 and r.height < 2.5:
                    continue
                item_rect = fitz.Rect(r.x0 - pad, r.y0 - pad, r.x1 + pad, r.y1 + pad)

            elif cmd == "c":  # ("c", p1, p2, p3, p4)
                pts = [item[1], item[2], item[3], item[4]]
                rx0 = min(p.x for p in pts)
                rx1 = max(p.x for p in pts)
                ry0 = min(p.y for p in pts)
                ry1 = max(p.y for p in pts)
                if (rx1 - rx0) > max_sz or (ry1 - ry0) > max_sz:
                    continue
                item_rect = fitz.Rect(rx0 - pad, ry0 - pad, rx1 + pad, ry1 + pad)

            elif cmd == "qu":  # ("qu", quad)
                q = item[1]
                rx0 = min(q.ul.x, q.ur.x, q.ll.x, q.lr.x)
                rx1 = max(q.ul.x, q.ur.x, q.ll.x, q.lr.x)
                ry0 = min(q.ul.y, q.ur.y, q.ll.y, q.lr.y)
                ry1 = max(q.ul.y, q.ur.y, q.ll.y, q.lr.y)
                if (rx1 - rx0) > max_sz or (ry1 - ry0) > max_sz:
                    continue
                item_rect = fitz.Rect(rx0 - pad, ry0 - pad, rx1 + pad, ry1 + pad)

            if item_rect is not None:
                if min_sz <= max(item_rect.width, item_rect.height):
                    sub_rects.append(item_rect)

    # Union-Find Clustering on sub_rects
    n_sub = len(sub_rects)
    uf = UnionFind(n_sub)
    for i in range(n_sub):
        ri = sub_rects[i]
        ri_exp = fitz.Rect(ri.x0 - cluster_dist, ri.y0 - cluster_dist, ri.x1 + cluster_dist, ri.y1 + cluster_dist)
        for j in range(i + 1, min(n_sub, i + 80)):  # localized search window for speed
            rj = sub_rects[j]
            if ri_exp.intersects(rj):
                uf.union(i, j)

    # Aggregate clusters
    clusters: Dict[int, List[int]] = {}
    for i in range(n_sub):
        root = uf.find(i)
        clusters.setdefault(root, []).append(i)

    vectors: List[VectorClusterPrimitive] = []
    max_aspect = float(thresh.get("max_symbol_aspect_ratio", 5.0))

    for group in clusters.values():
        u_rect = fitz.Rect(sub_rects[group[0]])
        for idx in group[1:]:
            u_rect |= sub_rects[idx]

        w, h = u_rect.width, u_rect.height
        if min_sz <= w <= max_sz and min_sz <= h <= max_sz:
            aspect = max(w / max(0.1, h), h / max(0.1, w))
            if aspect <= max_aspect:
                # Requirement 4.3: Merge composite symbol if a small vector (4pt~24pt)
                # contains 1~2 characters (e.g. circle enclosing 'P' or brackets enclosing '||')
                if 4.0 <= w <= 26.0 and 4.0 <= h <= 26.0:
                    for ch in chars:
                        inter = u_rect & ch.rect
                        ch_area = ch.rect.width * ch.rect.height
                        if u_rect.contains(ch.rect) or (not inter.is_empty and ch_area > 0 and (inter.width * inter.height) > 0.6 * ch_area):
                            u_rect |= ch.rect
                vectors.append(VectorClusterPrimitive(u_rect, sub_element_count=len(group)))

    # --- 3. Raster Image Extraction via get_image_info ---
    rasters: List[RasterPrimitive] = []
    try:
        images = page.get_image_info()
        for img in images:
            bbox = img.get("bbox")
            if not bbox:
                continue
            r = fitz.Rect(bbox)
            if min_sz <= r.width <= max_sz and min_sz <= r.height <= max_sz:
                rasters.append(RasterPrimitive(r))
    except Exception:
        pass

    return PrimitivesCollection(chars, vectors, rasters, page_rect)
