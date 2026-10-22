import time

import os
import uuid
import fitz  # PyMuPDF
import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from PIL import Image
from pydantic import BaseModel
from typing import List, Optional

app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
STATIC_DIR = os.path.join(BASE_DIR, "static")

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)

def cleanup_old_files(max_age_seconds: int = 7200):
    """Automatically delete temporary files older than 2 hours."""
    now = time.time()
    for directory in [UPLOAD_DIR, STATIC_DIR]:
        if not os.path.exists(directory):
            continue
        for fname in os.listdir(directory):
            if fname.startswith("."):
                continue
            fpath = os.path.join(directory, fname)
            try:
                if os.path.isfile(fpath):
                    file_age = now - os.path.getmtime(fpath)
                    if file_age > max_age_seconds:
                        os.remove(fpath)
            except Exception as e:
                print(f"Error removing {fpath}: {e}")

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.on_event("startup")
def startup_cleanup():
    cleanup_old_files()

@app.post("/api/upload-pdf/")
async def upload_pdf(file: UploadFile = File(...)):
    cleanup_old_files()

    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")
    
    file_id = str(uuid.uuid4())
    pdf_path = os.path.join(UPLOAD_DIR, f"{file_id}.pdf")
    
    with open(pdf_path, "wb") as f:
        content = await file.read()
        f.write(content)
        
    try:
        # Open PDF with PyMuPDF
        doc = fitz.open(pdf_path)
        if len(doc) == 0:
            doc.close()
            if os.path.exists(pdf_path):
                os.remove(pdf_path)
            raise HTTPException(status_code=400, detail="PDFが空です。")
            
        # Get first page
        page = doc[0]
        
        # Render page to an image (PNG)
        # Using a matrix to increase resolution (e.g., zoom factor 2)
        zoom = 2.0
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)
        
        image_filename = f"{file_id}_page1.png"
        image_path = os.path.join(STATIC_DIR, image_filename)
        pix.save(image_path)
        
        doc.close()
        
        return {
            "file_id": file_id,
            "image_url": f"/static/{image_filename}",
            "width": pix.width,
            "height": pix.height
        }
        
    except HTTPException:
        raise
    except Exception as e:
        if os.path.exists(pdf_path):
            os.remove(pdf_path)
        raise HTTPException(status_code=400, detail=f"PDFファイルの読み込みに失敗しました（破損または未対応のファイル形式）: {str(e)}")

class RegionCrop(BaseModel):
    x: float
    y: float
    width: float
    height: float

class Region(BaseModel):
    type: str
    crop: RegionCrop

class ExtractRequest(BaseModel):
    file_id: str
    regions: List[Region]

class AdjustedRect(BaseModel):
    id: str
    x: float
    y: float
    width: float
    height: float
    label: Optional[str] = None

class CropIconsRequest(BaseModel):
    file_id: str
    icons_region_url: str
    rects: List[AdjustedRect]

def extract_label_for_icon(bbox: fitz.Rect, page_words: list) -> str:
    """
    Given an icon bounding box on the PDF page, finds the associated item name
    from the adjacent table column in the same vertical row (Y band).
    Works generically across different table layouts (item name on left or right).
    """
    y_mid = (bbox.y0 + bbox.y1) / 2
    
    left_words = []
    right_words = []
    
    for w in page_words:
        w_rect = fitz.Rect(w[:4])
        # Vertical match: either geometric vertical overlap or center distance within ±18 pt
        vert_overlap = max(0, min(bbox.y1, w_rect.y1) - max(bbox.y0, w_rect.y0))
        vert_dist = abs((w_rect.y0 + w_rect.y1) / 2 - y_mid)
        if vert_overlap > 2 or vert_dist < 18:
            # Word is on the left of the icon (within 220 pt)
            if w_rect.x1 <= bbox.x0 + 5 and (bbox.x0 - w_rect.x1) < 220:
                left_words.append(w)
            # Word is on the right of the icon (within 220 pt)
            elif w_rect.x0 >= bbox.x1 - 5 and (w_rect.x0 - bbox.x1) < 220:
                right_words.append(w)
                
    left_words.sort(key=lambda w: w[0])
    right_words.sort(key=lambda w: w[0])
    
    ignored_headers = {
        "品名", "品名記号", "記号", "要・不要", "個数", "備考", "番号", "No", "No.", "品名/記号",
        "使用備品", "数", "脚", "本", "台", "個", "枚", "組", "記", "号"
    }

    # Known standard item names to prioritize
    standard_names = [
        "合奏用譜面台", "合奏用椅子", "合奏譜面台", "合奏椅子", "パイプ椅子",
        "指揮用譜面台", "指揮譜面台", "指揮者用譜面台", "指揮者譜面台",
        "ピアノ用椅子", "ピアノ椅子", "ピアノイス",
        "譜めくり椅子", "譜めくりイス", "譜めくり",
        "指揮台", "長机", "マイク", "電源", "ピアノ", "延長コード", "譜面台", "椅子", "イス"
    ]
    
    def find_standard_name(text: str) -> str:
        for name in standard_names:
            if name in text:
                return name
        return ""

    # 1. Primary check: left side (most common in Japanese band sheets, e.g. [品名] [記号])
    left_text = "".join(w[4] for w in left_words).strip().replace(" ", "")
    matched_left = find_standard_name(left_text)
    if matched_left:
        return matched_left
    if left_text and left_text not in ignored_headers:
        cleaned = left_text.lstrip("0123456789０１２３４５６７８９")
        if cleaned:
            return cleaned
        
    # 2. Secondary check: right side (e.g. [記号] [品名])
    units_stop = {
        "要", "不要", "・", "要・不要", "本", "脚", "台", "個", "枚", "組", 
        "閉", "蒲鉾板", "半開", "全開", "○", "レ", "有", "無"
    }
    filtered_right = [w for w in right_words if w[4] not in units_stop and not w[4].isdigit()]
    right_text = "".join(w[4] for w in filtered_right).strip().replace(" ", "")
    matched_right = find_standard_name(right_text)
    if matched_right:
        return matched_right
    if right_text and right_text not in ignored_headers:
        cleaned = right_text.lstrip("0123456789０１２３４５６７８９")
        if cleaned:
            return cleaned
        
    return ""

def merge_rects(rects, margin=10.0):
    """Merge rectangles that are close to each other."""
    if not rects:
        return []
    
    merged = []
    for orig_r in rects:
        # Check if it intersects with any existing merged rect (expanded)
        found = False
        for j, m in enumerate(merged):
            m_expanded = fitz.Rect(m.x0 - margin, m.y0 - margin, m.x1 + margin, m.y1 + margin)
            r_expanded = fitz.Rect(orig_r.x0 - margin, orig_r.y0 - margin, orig_r.x1 + margin, orig_r.y1 + margin)
            if r_expanded.intersects(m_expanded):
                merged[j] = m.include_rect(orig_r)
                found = True
                break
        
        if not found:
            merged.append(fitz.Rect(orig_r))
            
    # Iterate to merge transitively
    for _ in range(3):
        new_merged = []
        for m in merged:
            found = False
            for j, nm in enumerate(new_merged):
                m_expanded = fitz.Rect(m.x0 - margin, m.y0 - margin, m.x1 + margin, m.y1 + margin)
                nm_expanded = fitz.Rect(nm.x0 - margin, nm.y0 - margin, nm.x1 + margin, nm.y1 + margin)
                if m_expanded.intersects(nm_expanded):
                    new_merged[j] = nm.include_rect(m)
                    found = True
                    break
            if not found:
                new_merged.append(m)
        merged = new_merged
        
    return merged

def make_white_transparent(img_path: str, threshold: int = 238):
    try:
        img = Image.open(img_path).convert("RGBA")
        data = np.array(img)
        r, g, b = data[:, :, 0], data[:, :, 1], data[:, :, 2]
        white_mask = (r >= threshold) & (g >= threshold) & (b >= threshold)
        data[white_mask, 3] = 0
        result = Image.fromarray(data)
        result.save(img_path, "PNG")
    except Exception as e:
        print(f"Error making {img_path} transparent: {e}")

@app.post("/api/extract/")
async def extract_regions(req: ExtractRequest):
    pdf_path = os.path.join(UPLOAD_DIR, f"{req.file_id}.pdf")
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="PDF not found")
        
    try:
        doc = fitz.open(pdf_path)
        page = doc[0]
        
        zoom = 2.0  
        background_url = ""
        icon_urls = []
        icons_region_url = ''
        extracted_icons = []
        
        # Sort regions so 'background' is processed before 'icons' (which modifies the page via redaction)
        sorted_regions = sorted(req.regions, key=lambda r: 0 if r.type == 'background' else 1)
        
        for region in sorted_regions:
            c = region.crop
            rect_points = fitz.Rect(
                c.x / zoom,
                c.y / zoom,
                (c.x + c.width) / zoom,
                (c.y + c.height) / zoom
            )
            
            if region.type == "background":
                bg_zoom = 2.0
                mat = fitz.Matrix(bg_zoom, bg_zoom)
                pix = page.get_pixmap(matrix=mat, clip=rect_points)
                bg_filename = f"{req.file_id}_bg.png"
                bg_path = os.path.join(STATIC_DIR, bg_filename)
                pix.save(bg_path)
                background_url = f"/static/{bg_filename}"
                
            elif region.type == "icons":
                import time
                cache_buster = str(int(time.time()))
                
                page_words = page.get_text("words")

                icon_zoom = 4.0
                mat = fitz.Matrix(icon_zoom, icon_zoom)
                
                # Render high-resolution region image
                pix_region = page.get_pixmap(matrix=mat, clip=rect_points)
                region_filename = f"{req.file_id}_icons_region_{cache_buster}.png"
                region_path = os.path.join(STATIC_DIR, region_filename)
                pix_region.save(region_path)
                icons_region_url = f"/static/{region_filename}"

                # Also save clean version without destructive redaction (so manual crop works with 100% fidelity)
                region_clean_path = os.path.join(STATIC_DIR, f"{req.file_id}_icons_region_notext_{cache_buster}.png")
                pix_region.save(region_clean_path)

                # Convert pix_region to OpenCV for table grid removal and symbol cell analysis
                img_data = np.frombuffer(pix_region.samples, dtype=np.uint8).reshape((pix_region.height, pix_region.width, pix_region.n))
                if pix_region.n == 4:
                    img_bgr = cv2.cvtColor(img_data, cv2.COLOR_RGBA2BGR)
                else:
                    img_bgr = cv2.cvtColor(img_data, cv2.COLOR_RGB2BGR)

                gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
                _, thresh = cv2.threshold(gray, 225, 255, cv2.THRESH_BINARY_INV)

                # Filter out table grid lines (horizontal and vertical lines >= 20 pt)
                h_k = cv2.getStructuringElement(cv2.MORPH_RECT, (int(20 * icon_zoom), 1))
                v_k = cv2.getStructuringElement(cv2.MORPH_RECT, (1, int(20 * icon_zoom)))
                lines_grid = cv2.add(cv2.morphologyEx(thresh, cv2.MORPH_OPEN, h_k), cv2.morphologyEx(thresh, cv2.MORPH_OPEN, v_k))
                no_grid = cv2.subtract(thresh, lines_grid)

                candidate_boxes = []

                # Strategy 1: Raster Images in rect_points
                raw_images = page.get_image_info(xrefs=True)
                for img in raw_images:
                    b = fitz.Rect(img['bbox'])
                    if b.intersects(rect_points):
                        if 6 <= b.width <= 160 and 6 <= b.height <= 160:
                            lbl = extract_label_for_icon(b, page_words)
                            candidate_boxes.append((b, lbl, 'raster'))

                # Strategy 2: Row-based symbol cell search for known band sheet equipment items
                target_names = [
                    '指揮台', '指揮者譜面台', '指揮用譜面台', '指揮者用譜面台',
                    'ピアノ椅子', '譜めくり椅子', '譜めくりイス', '譜めくり',
                    'ピアノ', '合奏用譜面台', '合奏用椅子', '合奏譜面台', '合奏椅子',
                    '長机', 'マイク', '電源'
                ]
                for w in page_words:
                    if not fitz.Rect(w[:4]).intersects(rect_points):
                        continue
                    if 'ピアノの蓋' in w[4]:
                        continue
                    for tn in target_names:
                        if tn in w[4]:
                            r = fitz.Rect(w[:4])
                            # Check to the right (common in Japanese tables) and then to the left
                            for dx0, dx1 in [(10, 95), (-95, -10)]:
                                sym_x0 = r.x1 + dx0 if dx0 > 0 else r.x0 + dx0
                                sym_x1 = r.x1 + dx1 if dx0 > 0 else r.x0 + dx1
                                if sym_x0 > sym_x1:
                                    sym_x0, sym_x1 = sym_x1, sym_x0
                                sym_y0 = r.y0 - 8
                                sym_y1 = r.y1 + 8

                                px0 = max(0, int((sym_x0 - rect_points.x0) * icon_zoom))
                                px1 = min(pix_region.width, int((sym_x1 - rect_points.x0) * icon_zoom))
                                py0 = max(0, int((sym_y0 - rect_points.y0) * icon_zoom))
                                py1 = min(pix_region.height, int((sym_y1 - rect_points.y0) * icon_zoom))

                                if px1 > px0 and py1 > py0:
                                    cell_content = no_grid[py0:py1, px0:px1]
                                    dark_y, dark_x = np.where(cell_content > 0)
                                    if len(dark_x) >= 20:
                                        pad = 4
                                        min_x = max(0, np.min(dark_x) + px0 - pad)
                                        max_x = min(pix_region.width, np.max(dark_x) + px0 + pad)
                                        min_y = max(0, np.min(dark_y) + py0 - pad)
                                        max_y = min(pix_region.height, np.max(dark_y) + py0 + pad)

                                        box_pt = fitz.Rect(
                                            rect_points.x0 + min_x / icon_zoom,
                                            rect_points.y0 + min_y / icon_zoom,
                                            rect_points.x0 + max_x / icon_zoom,
                                            rect_points.y0 + max_y / icon_zoom
                                        )
                                        candidate_boxes.append((box_pt, tn, 'row_cell'))
                                        break
                            break

                # Strategy 3: Vector drawings fallback / supplement
                drawings = page.get_drawings()
                drawing_rects = []
                for d in drawings:
                    r = fitz.Rect(d['rect'])
                    if not r.intersects(rect_points):
                        continue
                    if r.width > 120 or r.height > 120:
                        continue
                    sw = d.get('width', 1.0) or 1.0
                    r_exp = fitz.Rect(r.x0 - sw/2, r.y0 - sw/2, r.x1 + sw/2, r.y1 + sw/2)
                    if (r.width > 50 and r.height <= 2) or (r.height > 50 and r.width <= 2):
                        continue
                    drawing_rects.append(r_exp)

                merged_drawings = merge_rects(drawing_rects, margin=6.0)
                for md in merged_drawings:
                    if 5 <= md.width <= 120 and 5 <= md.height <= 120:
                        lbl = extract_label_for_icon(md, page_words)
                        if lbl:
                            candidate_boxes.append((md, lbl, 'drawing'))

                # Deduplicate overlapping candidate boxes
                unique_candidates = []
                for b, lbl, typ in candidate_boxes:
                    overlap = False
                    for idx_u, (ub, ulbl, utyp) in enumerate(unique_candidates):
                        inter = fitz.Rect(b).intersect(fitz.Rect(ub))
                        if inter.width > 0 and inter.height > 0:
                            inter_area = inter.width * inter.height
                            min_area = min(b.width * b.height, ub.width * ub.height)
                            if inter_area / min_area > 0.4:
                                overlap = True
                                if not ulbl and lbl:
                                    unique_candidates[idx_u] = (ub, lbl, utyp)
                                break
                    if not overlap:
                        final_lbl = lbl or extract_label_for_icon(b, page_words)
                        unique_candidates.append((b, final_lbl, typ))

                # Sort candidates in visual reading order: left column top-to-bottom, right column top-to-bottom
                median_x = (rect_points.x0 + rect_points.x1) / 2
                unique_candidates.sort(key=lambda item: (0 if item[0].x0 < median_x else 1, item[0].y0))

                extracted_icons = []
                with Image.open(region_path) as im:
                    for idx, (b, lbl, typ) in enumerate(unique_candidates):
                        rel_x = max(0, (b.x0 - rect_points.x0) * icon_zoom)
                        rel_y = max(0, (b.y0 - rect_points.y0) * icon_zoom)
                        rel_width = min(pix_region.width - rel_x, b.width * icon_zoom)
                        rel_height = min(pix_region.height - rel_y, b.height * icon_zoom)

                        if rel_width < 5 or rel_height < 5:
                            continue

                        icon_filename = f"{req.file_id}_icon_{idx}_{cache_buster}.png"
                        icon_crop_path = os.path.join(STATIC_DIR, icon_filename)

                        cropped = im.crop((rel_x, rel_y, rel_x + rel_width, rel_y + rel_height))
                        cropped.save(icon_crop_path)
                        make_white_transparent(icon_crop_path)

                        extracted_icons.append({
                            "id": f"icon_{idx}",
                            "url": f"/static/{icon_filename}",
                            "label": lbl or f"パーツ {idx + 1}",
                            "rect": {
                                "x": rel_x,
                                "y": rel_y,
                                "width": rel_width,
                                "height": rel_height
                            }
                        })
                    
        doc.close()
        
        icon_labels = {icon["id"]: icon["label"] for icon in extracted_icons if icon.get("label")}
        
        return {
            "background_url": background_url,
            "icons_region_url": icons_region_url,
            "extracted_icons": extracted_icons,
            "icon_labels": icon_labels
        }
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))



@app.post("/api/crop-icons/")
async def crop_icons(req: CropIconsRequest):
    try:
        import time
        import io
        import base64
        cache_buster = str(int(time.time()))
        
        img = None
        # Case 1: Base64 data URL (e.g. from IndexedDB session)
        if req.icons_region_url.startswith("data:image/"):
            try:
                header, encoded = req.icons_region_url.split(",", 1)
                img_bytes = base64.b64decode(encoded)
                img = Image.open(io.BytesIO(img_bytes))
                # Persist to STATIC_DIR for future reference
                saved_base_filename = f"{req.file_id}_icons_region_{cache_buster}.png"
                img.save(os.path.join(STATIC_DIR, saved_base_filename))
            except Exception as e:
                print("Failed to decode base64 icons_region_url:", e)

        # Case 2: File URL or path
        if img is None:
            clean_url = req.icons_region_url.split("?")[0]
            filename = os.path.basename(clean_url)
            base_img_path = os.path.join(STATIC_DIR, filename)
            if not os.path.exists(base_img_path):
                fallback = filename.replace("_icons_region_", "_icons_region_notext_")
                base_img_path = os.path.join(STATIC_DIR, fallback)
            
            # Case 3: Search STATIC_DIR for any icons_region matching this file_id
            if not os.path.exists(base_img_path) and req.file_id:
                candidates = [
                    f for f in os.listdir(STATIC_DIR)
                    if f.startswith(f"{req.file_id}_icons_region") and f.endswith(".png")
                ]
                if candidates:
                    candidates.sort(reverse=True)
                    base_img_path = os.path.join(STATIC_DIR, candidates[0])

            if os.path.exists(base_img_path):
                img = Image.open(base_img_path)

        if img is None:
            raise HTTPException(status_code=404, detail="Base image not found")

        # Ensure image is in RGB or RGBA mode
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA")
            
        extracted_icons = []
        for i, r in enumerate(req.rects):
            icon_filename = f"{req.file_id}_icon_adj_{i}_{cache_buster}.png"
            icon_path = os.path.join(STATIC_DIR, icon_filename)
            
            # Clamp crop bounds to valid image dimensions
            rx = max(0, min(int(round(r.x)), img.width - 1))
            ry = max(0, min(int(round(r.y)), img.height - 1))
            rw = max(1, min(int(round(r.width)), img.width - rx))
            rh = max(1, min(int(round(r.height)), img.height - ry))

            # Crop and save
            cropped = img.crop((rx, ry, rx + rw, ry + rh))
            cropped.save(icon_path)
            make_white_transparent(icon_path)
            
            label = getattr(r, 'label', '') or ''
            extracted_icons.append({
                "id": r.id,
                "url": f"/static/{icon_filename}",
                "label": label,
                "rect": {
                    "x": rx,
                    "y": ry,
                    "width": rw,
                    "height": rh
                }
            })
            
        icon_labels = {icon["id"]: icon["label"] for icon in extracted_icons if icon.get("label")}
        return {
            "extracted_icons": extracted_icons,
            "icon_labels": icon_labels
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))



class TallyItem(BaseModel):
    icon_id: str
    label: str
    count: int

class PreviewRequest(BaseModel):
    file_id: str
    tallies: List[TallyItem]
    piano_lid: Optional[str] = ""

@app.post("/api/preview-bg/")
async def preview_bg(req: PreviewRequest):
    try:
        pdf_path = os.path.join(UPLOAD_DIR, f"{req.file_id}.pdf")
        if not os.path.exists(pdf_path):
            return {
                "preview_url": "",
                "auto_nodes": []
            }
        doc = fitz.open(pdf_path)
        page = doc[0]

        def circle_word(word_rect, color=(0, 0, 0)): # Match final output (black)
            shape = page.new_shape()
            center = fitz.Point((word_rect.x0 + word_rect.x1) / 2, (word_rect.y0 + word_rect.y1) / 2)
            radius = max(word_rect.width, word_rect.height) * 0.65
            shape.draw_circle(center, radius)
            shape.finish(color=color, width=1.1)
            shape.commit()

        def write_number_before(unit_rect, num_str, color=(0, 0, 0)):
            rect = fitz.Rect(unit_rect.x0 - 45, unit_rect.y0 - 2, unit_rect.x0 - 4, unit_rect.y1 + 15)
            page.insert_textbox(rect, str(num_str), fontname="helv", fontsize=11, align=fitz.TEXT_ALIGN_RIGHT, color=color)

        # Robust count aggregator combining template items and extracted icons
        def calculate_counts(tallies):
            res = {
                "stand": 0,         # 合奏用譜面台
                "chair": 0,         # 合奏用椅子
                "p_chair": 0,       # ピアノ椅子
                "turner_chair": 0,  # 譜めくり椅子 (独立集計)
                "table": 0,         # 長机
                "podium": 0,        # 指揮台
                "p_stand": 0,       # 指揮譜面台
                "piano": 0,         # ピアノ
                "cord": 0,          # 延長コード
            }

            for t in tallies:
                c = t.count
                if c <= 0:
                    continue
                label = (t.label or "").strip()
                icon_id = (t.icon_id or "").strip()

                # 1. 譜めくり椅子 (最優先: ピアノ椅子に絶対に混ざらないよう真っ先に判定)
                if icon_id in ['tmpl_turnerChair'] or \
                   any(k in label for k in ['譜めくり', '譜捲り', 'めくり']):
                    res["turner_chair"] += c
                    continue

                # 2. ピアノ椅子 (合奏用椅子や譜めくり椅子と混同しないよう判定)
                if icon_id in ['tmpl_pianoChair'] or \
                   ('ピアノ' in label and any(k in label for k in ['椅子', 'イス', 'いす']) and not any(k in label for k in ['譜めくり', '譜捲り', 'めくり'])):
                    res["p_chair"] += c
                    continue

                # 3. 合奏用椅子 (パイプ椅子 / 普通椅子)
                if icon_id in ['tmpl_chorusChair', 'tmpl_pipeChair'] or \
                   (not any(ex in label for ex in ['ピアノ', '指揮', 'パーカッション', '打楽器', '譜めくり', 'めくり']) and
                    any(k in label for k in ['合奏用椅子', '合奏椅子', 'パイプ椅子', '普通椅子', '椅子', 'イス', 'いす'])):
                    res["chair"] += c
                    continue

                # 4. 指揮譜面台
                if icon_id in ['tmpl_conductorStand'] or \
                   ('指揮' in label and any(k in label for k in ['譜面台', 'ふめんだい', 'スタンド'])):
                    res["p_stand"] += c
                    continue

                # 5. 合奏用譜面台
                if icon_id in ['tmpl_ensembleStand'] or \
                   (not any(ex in label for ex in ['指揮']) and
                    any(k in label for k in ['合奏用譜面台', '合奏譜面台', '譜面台', 'ふめんだい'])):
                    res["stand"] += c
                    continue

                # 6. 指揮台
                if icon_id in ['tmpl_podium'] or ('指揮台' in label or 'しきだい' in label):
                    res["podium"] += c
                    continue

                # 7. 長机
                if icon_id in ['tmpl_longDesk', 'tmpl_desk'] or \
                   any(k in label for k in ['長机', '机', 'デスク', 'テーブル']):
                    res["table"] += c
                    continue

                # 8. ピアノ
                if icon_id in ['tmpl_piano', 'tmpl_grandPiano'] or \
                   (not any(ex in label for ex in ['椅子', 'イス', 'いす', '譜めくり', 'めくり']) and 'ピアノ' in label):
                    res["piano"] += c
                    continue

                # 9. 延長コード
                if icon_id in ['tmpl_extensionCord'] or \
                   any(k in label for k in ['延長コード', 'コード', '電源']):
                    res["cord"] += c
                    continue

                # フォールバック: デフォルトIDマッピング (未命名アイコン用)
                if 'パーツ' in label or not label:
                    if icon_id == 'icon_4':
                        res["chair"] += c
                    elif icon_id == 'icon_3':
                        res["stand"] += c
                    elif icon_id == 'icon_5':
                        res["p_chair"] += c
                    elif icon_id == 'icon_0':
                        res["podium"] += c
                    elif icon_id == 'icon_1':
                        res["p_stand"] += c
                    elif icon_id == 'icon_2':
                        res["piano"] += c
                    elif icon_id == 'icon_6':
                        res["table"] += c
                    elif icon_id == 'icon_7':
                        res["cord"] += c

            return res

        counts = calculate_counts(req.tallies)
        chair_count = counts["chair"]
        stand_count = counts["stand"]
        p_chair_count = counts["p_chair"]
        turner_chair_count = counts["turner_chair"]
        table_count = counts["table"]
        podium_count = counts["podium"]
        p_stand_count = counts["p_stand"]
        piano_count = counts["piano"]
        cord_count = counts["cord"]

        auto_nodes = []
        words = page.get_text("words")

        def add_auto_num(unit_r, count_val, name_id):
            auto_nodes.append({
                "id": f"auto_num_{name_id}",
                "type": "text",
                "text": str(count_val),
                "x": round((unit_r.x0 - 26) * 2.0),
                "y": round((unit_r.y0) * 2.0),
                "fontSize": 22,
                "radius": 15,
            })

        def add_auto_circle(word_r, name_id):
            cx = (word_r.x0 + word_r.x1) / 2.0
            cy = (word_r.y0 + word_r.y1) / 2.0
            rad = max(word_r.width, word_r.height) * 0.7
            auto_nodes.append({
                "id": f"auto_circle_{name_id}",
                "type": "circle",
                "text": "",
                "x": round(cx * 2.0),
                "y": round(cy * 2.0),
                "fontSize": 22,
                "radius": round(rad * 2.0),
            })

        def circle_yo_or_fuyo(word_list, is_yo, name_id):
            """
            単語リスト内から『不要・要』または『要』『不要』を検出し、
            is_yo=True なら『要』に、is_yo=False なら『不要』に○を追加する。
            """
            for w in word_list:
                w_text = w[4]
                w_r = fitz.Rect(w[:4])
                if '不要・要' in w_text:
                    if is_yo:
                        target_r = fitz.Rect(w_r.x0 + w_r.width * 0.55, w_r.y0, w_r.x1, w_r.y1)
                        add_auto_circle(target_r, f"{name_id}_yo")
                    else:
                        target_r = fitz.Rect(w_r.x0, w_r.y0, w_r.x0 + w_r.width * 0.45, w_r.y1)
                        add_auto_circle(target_r, f"{name_id}_fuyo")
                    return True
                elif is_yo and w_text == '要':
                    add_auto_circle(w_r, f"{name_id}_yo")
                    return True
                elif not is_yo and w_text == '不要':
                    add_auto_circle(w_r, f"{name_id}_fuyo")
                    return True
            return False

        # Step 1: Group words into horizontal lines to handle separated characters (e.g. 'ピ','ア','ノ' or '指','揮','台')
        lines = []
        for w in words:
            y_mid = (w[1] + w[3]) / 2
            placed = False
            for line in lines:
                if abs(line['y_mid'] - y_mid) < 7:
                    line['words'].append(w)
                    line['y_mid'] = sum((ww[1] + ww[3])/2 for ww in line['words']) / len(line['words'])
                    placed = True
                    break
            if not placed:
                lines.append({'y_mid': y_mid, 'words': [w]})

        lines.sort(key=lambda l: l['y_mid'])

        added_keys = set()
        piano_lid_setting = (req.piano_lid or "半開").strip()

        # Step 2: Iterate through lines to detect items and place auto numbers / circles
        for line in lines:
            line['words'].sort(key=lambda w: w[0])
            line_text = "".join(w[4] for w in line['words'])

            # 1. ピアノ (要 / 不要)
            if 'piano' not in added_keys and 'ピアノ' in line_text and not any(k in line_text for k in ['蓋', '反響板', '椅子', 'イス']):
                if circle_yo_or_fuyo(line['words'], piano_count > 0, "piano"):
                    added_keys.add('piano')

            # 2. ピアノ蓋 (閉 / 蒲鉾板 / 半開 / 全開)
            if 'piano_lid' not in added_keys and piano_count > 0 and ('ピアノ蓋' in line_text or ('閉' in line_text and '開' in line_text)):
                for w in line['words']:
                    w_text = w[4]
                    w_r = fitz.Rect(w[:4])
                    if w_text == piano_lid_setting:
                        add_auto_circle(w_r, "piano_lid")
                        added_keys.add('piano_lid')
                        break

            # 3. 指揮台 (要 / 不要)
            if 'podium' not in added_keys and '指揮台' in line_text:
                if circle_yo_or_fuyo(line['words'], podium_count > 0, "podium"):
                    added_keys.add('podium')

            # 4. 指揮用譜面台 (要 / 不要)
            if 'p_stand' not in added_keys and ('指揮用譜面台' in line_text or '指揮譜面台' in line_text or '指揮者用譜面台' in line_text or '指揮者譜面台' in line_text):
                if circle_yo_or_fuyo(line['words'], p_stand_count > 0, "p_stand"):
                    added_keys.add('p_stand')

            # 5. 延長コード (要 / 不要)
            if 'cord' not in added_keys and ('延長コード' in line_text or ('コード' in line_text and ('要' in line_text or '不要' in line_text))):
                if circle_yo_or_fuyo(line['words'], cord_count > 0, "cord"):
                    added_keys.add('cord')

            # 6. 合奏用譜面台 (本 / 要・不要)
            if 'stand' not in added_keys and ('合奏用譜面台' in line_text or ('譜面台' in line_text and '指揮' not in line_text)):
                if stand_count > 0:
                    for w in line['words']:
                        if w[4] == '本':
                            add_auto_num(fitz.Rect(w[:4]), stand_count, "stand")
                            added_keys.add('stand')
                            break
                circle_yo_or_fuyo(line['words'], stand_count > 0, "stand")

            # 7. 合奏用椅子 (脚 / 要・不要)
            if 'chair' not in added_keys and ('合奏用椅子' in line_text or '合奏椅子' in line_text or ('椅子' in line_text and not any(ex in line_text for ex in ['ピアノ', '指揮', '譜めくり', 'めくり']))):
                if chair_count > 0:
                    for w in line['words']:
                        if w[4] == '脚':
                            add_auto_num(fitz.Rect(w[:4]), chair_count, "chair")
                            added_keys.add('chair')
                            break
                circle_yo_or_fuyo(line['words'], chair_count > 0, "chair")

            # 8. ピアノ椅子 (脚 / 要・不要) - 譜めくり椅子は絶対に含めない
            if 'p_chair' not in added_keys and ('ピアノ椅子' in line_text or 'ピアノイス' in line_text or 'ピアノ用椅子' in line_text) and not any(k in line_text for k in ['譜めくり', '譜捲り', 'めくり']):
                if p_chair_count > 0:
                    for w in line['words']:
                        if w[4] == '脚':
                            add_auto_num(fitz.Rect(w[:4]), p_chair_count, "p_chair")
                            break
                if circle_yo_or_fuyo(line['words'], p_chair_count > 0, "p_chair"):
                    added_keys.add('p_chair')

            # 8-2. 譜めくり椅子 (要・不要 / 脚) - 独立処理
            if 'turner_chair' not in added_keys and any(k in line_text for k in ['譜めくり', '譜捲り', 'めくり']):
                if turner_chair_count > 0:
                    for w in line['words']:
                        if w[4] == '脚':
                            add_auto_num(fitz.Rect(w[:4]), turner_chair_count, "turner")
                            break
                if circle_yo_or_fuyo(line['words'], turner_chair_count > 0, "turner"):
                    added_keys.add('turner_chair')

            # 9. 長机 (台 / 要・不要)
            if 'table' not in added_keys and ('長机' in line_text or ('机' in line_text and '台' in line_text)):
                if table_count > 0:
                    for w in line['words']:
                        if w[4] == '台':
                            add_auto_num(fitz.Rect(w[:4]), table_count, "table")
                            added_keys.add('table')
                            break
                circle_yo_or_fuyo(line['words'], table_count > 0, "table")

        # Step 3: Fallback for sheets with unusual layouts or text structures
        for w in words:
            text = w[4]
            r = fitz.Rect(w[:4])
            
            # ピアノ: fallback
            if 'piano' not in added_keys:
                if (140 < r.y0 < 170) or (120 < r.y0 < 148):
                    if text == '要' and piano_count > 0:
                        add_auto_circle(r, "piano_yo")
                        added_keys.add('piano')
                    elif text == '不要' and piano_count == 0:
                        add_auto_circle(r, "piano_fuyo")
                        added_keys.add('piano')

            # ピアノ蓋: fallback
            if 'piano_lid' not in added_keys and piano_count > 0:
                if (170 < r.y0 < 200):
                    if text == piano_lid_setting:
                        add_auto_circle(r, "piano_lid")
                        added_keys.add('piano_lid')

            # 譜面台: fallback
            if 'stand' not in added_keys and stand_count > 0 and text == '本':
                if (160 < r.y0 < 230):
                    add_auto_num(r, stand_count, "stand")
                    added_keys.add('stand')

            # 合奏用椅子: fallback
            if 'chair' not in added_keys and chair_count > 0 and text == '脚':
                if (190 < r.y0 < 255):
                    add_auto_num(r, chair_count, "chair")
                    added_keys.add('chair')

            # ピアノ椅子: fallback
            if 'p_chair' not in added_keys and p_chair_count > 0 and text == '脚':
                if (215 < r.y0 < 285):
                    add_auto_num(r, p_chair_count, "p_chair")
                    added_keys.add('p_chair')

            # 長机: fallback
            if 'table' not in added_keys and table_count > 0 and text == '台':
                if (235 < r.y0 < 315):
                    add_auto_num(r, table_count, "table")
                    added_keys.add('table')

            # 指揮台: fallback
            if 'podium' not in added_keys and (70 < r.y0 < 110):
                if text == '要' and podium_count > 0:
                    add_auto_circle(r, "podium_yo")
                    added_keys.add('podium')
                elif text == '不要' and podium_count == 0:
                    add_auto_circle(r, "podium_fuyo")
                    added_keys.add('podium')

            # 指揮用譜面台: fallback
            if 'p_stand' not in added_keys and (98 < r.y0 < 140):
                if text == '要' and p_stand_count > 0:
                    add_auto_circle(r, "p_stand_yo")
                    added_keys.add('p_stand')
                elif text == '不要' and p_stand_count == 0:
                    add_auto_circle(r, "p_stand_fuyo")
                    added_keys.add('p_stand')

            # 延長コード: fallback
            if 'cord' not in added_keys and (255 < r.y0 < 345):
                if text == '要' and cord_count > 0:
                    add_auto_circle(r, "cord_yo")
                    added_keys.add('cord')
                elif text == '不要' and cord_count == 0:
                    add_auto_circle(r, "cord_fuyo")
                    added_keys.add('cord')

        # Render clean page image without baked-in text/circles
        mat = fitz.Matrix(2.0, 2.0)
        pix = page.get_pixmap(matrix=mat)
        
        cache_buster = int(time.time())
        preview_filename = f"{req.file_id}_preview_{cache_buster}.png"
        preview_path = os.path.join(STATIC_DIR, preview_filename)
        pix.save(preview_path)
        
        return {
            "preview_url": f"/static/{preview_filename}",
            "auto_nodes": auto_nodes
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

class ExportPdfRequest(BaseModel):
    file_id: str
    full_page_image: Optional[str] = None  # base64 data URL of single page overlay
    full_page_images: Optional[List[str]] = None  # list of base64 data URLs for multi-scene export
    tallies: List[TallyItem]
    piano_lid: Optional[str] = ""

@app.post("/api/export-pdf/")
async def export_pdf(req: ExportPdfRequest):
    import base64
    import time
    
    pdf_path = os.path.join(UPLOAD_DIR, f"{req.file_id}.pdf")
    has_original_pdf = os.path.exists(pdf_path)
        
    try:
        cache_buster = str(int(time.time()))
        
        # Determine list of images to render
        images = []
        if req.full_page_images and len(req.full_page_images) > 0:
            images = req.full_page_images
        elif req.full_page_image:
            images = [req.full_page_image]
            
        if not images:
            raise HTTPException(status_code=400, detail="No overlay image provided")

        if has_original_pdf:
            doc = fitz.open(pdf_path)
            # Duplicate template page if multiple scenes are being exported
            if len(images) > 1:
                template_doc = fitz.open(pdf_path)
                for _ in range(1, len(images)):
                    doc.insert_pdf(template_doc, from_page=0, to_page=0)
                template_doc.close()

            # Insert transparent overlay images for each page
            for i, img_data in enumerate(images):
                if i < len(doc):
                    page = doc[i]
                    if "," in img_data:
                        image_bytes = base64.b64decode(img_data.split(",")[1])
                    else:
                        image_bytes = base64.b64decode(img_data)
                    # When a PDF page has rotation (/Rotate 90, 180, 270), PyMuPDF expects coordinates in the unrotated
                    # cropbox space and needs the rotate parameter set to page.rotation so the inserted overlay matches the
                    # rendered view orientation without being rotated independently.
                    page.insert_image(page.cropbox, stream=image_bytes, rotate=page.rotation)
        else:
            # Reconstruct PDF pages directly from images
            doc = fitz.open()
            for img_data in images:
                if "," in img_data:
                    image_bytes = base64.b64decode(img_data.split(",")[1])
                else:
                    image_bytes = base64.b64decode(img_data)
                img = fitz.open("png", image_bytes)
                rect = img[0].rect
                page = doc.new_page(width=rect.width, height=rect.height)
                page.insert_image(rect, stream=image_bytes)
                img.close()

        # Save completed PDF with aggressive compression
        completed_filename = f"{req.file_id}_completed_{cache_buster}.pdf"
        completed_path = os.path.join(STATIC_DIR, completed_filename)
        doc.save(completed_path, garbage=4, deflate=True)
        doc.close()
        
        return {
            "download_url": f"/static/{completed_filename}",
            "filename": completed_filename
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

# Mount built frontend files if available (for production deployments like Render.com)
FRONTEND_DIST = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))
if os.path.exists(FRONTEND_DIST):
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")

