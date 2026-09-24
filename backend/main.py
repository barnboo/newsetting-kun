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

UPLOAD_DIR = "uploads"
STATIC_DIR = "static"

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.post("/api/upload-pdf/")
async def upload_pdf(file: UploadFile = File(...)):
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
            raise HTTPException(status_code=400, detail="PDF is empty")
            
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
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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
        "品名", "品名記号", "記号", "要・不要", "個数", "備考", "番号", "No", "No.", "品名/記号"
    }

    # Known standard item names to prioritize
    standard_names = [
        "合奏用譜面台", "合奏用椅子", "合奏譜面台", "合奏椅子", "パイプ椅子",
        "指揮用譜面台", "指揮譜面台", "指揮者用譜面台", "指揮者譜面台",
        "ピアノ用椅子", "ピアノ椅子", "ピアノイス",
        "指揮台", "長机", "ピアノ", "延長コード", "譜面台", "椅子", "イス"
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
        return left_text
        
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
        return right_text
        
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
                
                # IMPORTANT: Extract text words BEFORE applying redactions!
                page_words = page.get_text("words")

                icon_zoom = 4.0
                mat = fitz.Matrix(icon_zoom, icon_zoom)
                
                # Render WITH text for the modal background (so user can read the table)
                pix_region_with_text = page.get_pixmap(matrix=mat, clip=rect_points)
                region_filename = f"{req.file_id}_icons_region_{cache_buster}.png"
                region_path = os.path.join(STATIC_DIR, region_filename)
                pix_region_with_text.save(region_path)
                icons_region_url = f"/static/{region_filename}"

                # Apply text AND graphics redaction NOW so any cropped icons are rendered cleanly
                text_blocks = page.get_text("blocks", clip=rect_points)
                for b in text_blocks:
                    t_rect = fitz.Rect(b[:4])
                    page.add_redact_annot(t_rect, cross_out=False)
                    
                drawings = page.get_drawings()
                for d in drawings:
                    if d["rect"].intersects(rect_points):
                        page.add_redact_annot(d["rect"], cross_out=False)
                        
                # 2 for text and graphics means "remove", 0 means "keep"
                page.apply_redactions(images=0, graphics=2, text=2)
                
                # Render CLEAN version for cropping
                pix_region_clean = page.get_pixmap(matrix=mat, clip=rect_points)
                region_clean_path = os.path.join(STATIC_DIR, f"{req.file_id}_icons_region_notext_{cache_buster}.png")
                pix_region_clean.save(region_clean_path)
                
                extracted_icons = []
                
                # Check for raster images in this region
                raw_images = page.get_image_info(xrefs=True)
                candidate_images = []
                for img in raw_images:
                    bbox = fitz.Rect(img['bbox'])
                    if bbox.intersects(rect_points):
                        # Filter out tiny artefacts or huge whole-page backgrounds
                        if bbox.width >= 5 and bbox.height >= 5 and bbox.width <= 200 and bbox.height <= 200:
                            candidate_images.append(img)
                
                if len(candidate_images) > 0:
                    # Sort top to bottom by y coordinate
                    candidate_images.sort(key=lambda img: img['bbox'][1])
                    
                    for idx, img in enumerate(candidate_images):
                        bbox = fitz.Rect(img['bbox'])
                        icon_filename = f"{req.file_id}_icon_{idx}_{cache_buster}.png"
                        icon_path = os.path.join(STATIC_DIR, icon_filename)
                        
                        # Crop exact bbox without padding from the clean rendered page
                        rel_x = (bbox.x0 - rect_points.x0) * icon_zoom
                        rel_y = (bbox.y0 - rect_points.y0) * icon_zoom
                        rel_w = bbox.width * icon_zoom
                        rel_h = bbox.height * icon_zoom
                        
                        with Image.open(region_clean_path) as im:
                            cropped = im.crop((rel_x, rel_y, rel_x + rel_w, rel_y + rel_h))
                            cropped.save(icon_path)
                                
                        make_white_transparent(icon_path)
                                
                        rel_x = (bbox.x0 - rect_points.x0) * icon_zoom
                        rel_y = (bbox.y0 - rect_points.y0) * icon_zoom
                        rel_width = bbox.width * icon_zoom
                        rel_height = bbox.height * icon_zoom
                        
                        label = extract_label_for_icon(bbox, page_words)
                        
                        extracted_icons.append({
                            "id": f"icon_{idx}",
                            "url": f"/static/{icon_filename}",
                            "label": label,
                            "rect": {
                                "x": rel_x,
                                "y": rel_y,
                                "width": rel_width,
                                "height": rel_height
                            }
                        })
                else:
                    # Fallback for purely vector-drawn icons: extract drawings
                    drawings = page.get_drawings()
                    item_rects = []
                    for d in drawings:
                        d_rect = d["rect"]
                        if not d_rect.intersects(rect_points):
                            continue
                        if d_rect.width > 90 or d_rect.height > 90:
                            continue
                        aspect = d_rect.width / max(d_rect.height, 0.1)
                        if aspect > 4 or aspect < 0.25:
                            if d_rect.width > 10 or d_rect.height > 10:
                                continue
                        if len(d["items"]) == 1 and d["items"][0][0] == "re":
                            continue
                        is_only_lines = all(item[0] == "l" for item in d["items"])
                        if is_only_lines and (d_rect.width > 20 or d_rect.height > 20):
                            continue
                        r = d_rect.intersect(rect_points)
                        if r.width > 1 and r.height > 1:
                            item_rects.append(r)
                            
                    merged_rects = merge_rects(item_rects, margin=0.2)
                    for idx, r in enumerate(merged_rects):
                        if r.width < 5 or r.height < 5: continue
                        if r.width > 120 or r.height > 120: continue
                        
                        rel_x = (r.x0 - rect_points.x0) * icon_zoom
                        rel_y = (r.y0 - rect_points.y0) * icon_zoom
                        rel_width = r.width * icon_zoom
                        rel_height = r.height * icon_zoom
                        
                        icon_crop_path = os.path.join(STATIC_DIR, f"{req.file_id}_icon_{idx}_{cache_buster}.png")
                        with Image.open(region_clean_path) as im:
                            cropped = im.crop((rel_x, rel_y, rel_x + rel_width, rel_y + rel_height))
                            cropped.save(icon_crop_path)
                        make_white_transparent(icon_crop_path)
                        
                        label = extract_label_for_icon(r, page_words)
                            
                        extracted_icons.append({
                            "id": f"icon_{idx}",
                            "url": f"/static/{req.file_id}_icon_{idx}_{cache_buster}.png",
                            "label": label,
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
        cache_buster = str(int(time.time()))
        
        # Load the base image
        filename = os.path.basename(req.icons_region_url)
        # e.g. fileId_icons_region_123456.png -> fileId_icons_region_notext_123456.png
        filename = filename.replace("_icons_region_", "_icons_region_notext_")
        base_img_path = os.path.join(STATIC_DIR, filename)
        
        if not os.path.exists(base_img_path):
            raise HTTPException(status_code=404, detail="Base image not found")
            
        extracted_icons = []
        with Image.open(base_img_path) as img:
            for i, r in enumerate(req.rects):
                icon_filename = f"{req.file_id}_icon_adj_{i}_{cache_buster}.png"
                icon_path = os.path.join(STATIC_DIR, icon_filename)
                
                # Crop and save
                cropped = img.crop((r.x, r.y, r.x + r.width, r.y + r.height))
                cropped.save(icon_path)
                make_white_transparent(icon_path)
                
                label = getattr(r, 'label', '') or ''
                extracted_icons.append({
                    "id": r.id,
                    "url": f"/static/{icon_filename}",
                    "label": label,
                    "rect": {
                        "x": r.x,
                        "y": r.y,
                        "width": r.width,
                        "height": r.height
                    }
                })
                
        icon_labels = {icon["id"]: icon["label"] for icon in extracted_icons if icon.get("label")}
        return {
            "extracted_icons": extracted_icons,
            "icon_labels": icon_labels
        }
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
                "stand": 0,    # 合奏用譜面台
                "chair": 0,    # 合奏用椅子
                "p_chair": 0,  # ピアノ椅子
                "table": 0,    # 長机
                "podium": 0,   # 指揮台
                "p_stand": 0,  # 指揮譜面台
                "piano": 0,    # ピアノ
                "cord": 0,     # 延長コード
            }

            for t in tallies:
                c = t.count
                if c <= 0:
                    continue
                label = (t.label or "").strip()
                icon_id = (t.icon_id or "").strip()

                # 1. ピアノ椅子 (チェック優先: 合奏用椅子と混同しないよう先に判定)
                if icon_id in ['tmpl_pianoChair', 'tmpl_turnerChair'] or \
                   ('ピアノ' in label and any(k in label for k in ['椅子', 'イス', 'いす'])) or \
                   ('譜めくり' in label):
                    res["p_chair"] += c
                    continue

                # 2. 合奏用椅子 (パイプ椅子 / 普通椅子)
                if icon_id in ['tmpl_chorusChair', 'tmpl_pipeChair'] or \
                   (not any(ex in label for ex in ['ピアノ', '指揮', 'パーカッション', '打楽器']) and
                    any(k in label for k in ['合奏用椅子', '合奏椅子', 'パイプ椅子', '普通椅子', '椅子', 'イス', 'いす'])):
                    res["chair"] += c
                    continue

                # 3. 指揮譜面台
                if icon_id in ['tmpl_conductorStand'] or \
                   ('指揮' in label and any(k in label for k in ['譜面台', 'ふめんだい', 'スタンド'])):
                    res["p_stand"] += c
                    continue

                # 4. 合奏用譜面台
                if icon_id in ['tmpl_ensembleStand'] or \
                   (not any(ex in label for ex in ['指揮']) and
                    any(k in label for k in ['合奏用譜面台', '合奏譜面台', '譜面台', 'ふめんだい'])):
                    res["stand"] += c
                    continue

                # 5. 指揮台
                if icon_id in ['tmpl_podium'] or ('指揮台' in label or 'しきだい' in label):
                    res["podium"] += c
                    continue

                # 6. 長机
                if icon_id in ['tmpl_longDesk', 'tmpl_desk'] or \
                   any(k in label for k in ['長机', '机', 'デスク', 'テーブル']):
                    res["table"] += c
                    continue

                # 7. ピアノ
                if icon_id in ['tmpl_piano', 'tmpl_grandPiano'] or \
                   (not any(ex in label for ex in ['椅子', 'イス', 'いす', '譜めくり']) and 'ピアノ' in label):
                    res["piano"] += c
                    continue

                # 8. 延長コード
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
                for w in line['words']:
                    w_text = w[4]
                    w_r = fitz.Rect(w[:4])
                    if w_text == '要' and piano_count > 0:
                        add_auto_circle(w_r, "piano_yo")
                        added_keys.add('piano')
                        break
                    elif w_text == '不要' and piano_count == 0:
                        add_auto_circle(w_r, "piano_fuyo")
                        added_keys.add('piano')
                        break

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
                for w in line['words']:
                    w_text = w[4]
                    w_r = fitz.Rect(w[:4])
                    if w_text == '要' and podium_count > 0:
                        add_auto_circle(w_r, "podium_yo")
                        added_keys.add('podium')
                        break
                    elif w_text == '不要' and podium_count == 0:
                        add_auto_circle(w_r, "podium_fuyo")
                        added_keys.add('podium')
                        break

            # 4. 指揮用譜面台 (要 / 不要)
            if 'p_stand' not in added_keys and ('指揮用譜面台' in line_text or '指揮譜面台' in line_text or '指揮者用譜面台' in line_text):
                for w in line['words']:
                    w_text = w[4]
                    w_r = fitz.Rect(w[:4])
                    if w_text == '要' and p_stand_count > 0:
                        add_auto_circle(w_r, "p_stand_yo")
                        added_keys.add('p_stand')
                        break
                    elif w_text == '不要' and p_stand_count == 0:
                        add_auto_circle(w_r, "p_stand_fuyo")
                        added_keys.add('p_stand')
                        break

            # 5. 延長コード (要 / 不要)
            if 'cord' not in added_keys and ('延長コード' in line_text or ('コード' in line_text and ('要' in line_text or '不要' in line_text))):
                for w in line['words']:
                    w_text = w[4]
                    w_r = fitz.Rect(w[:4])
                    if w_text == '要' and cord_count > 0:
                        add_auto_circle(w_r, "cord_yo")
                        added_keys.add('cord')
                        break
                    elif w_text == '不要' and cord_count == 0:
                        add_auto_circle(w_r, "cord_fuyo")
                        added_keys.add('cord')
                        break

            # 6. 合奏用譜面台 (本)
            if 'stand' not in added_keys and ('合奏用譜面台' in line_text or ('譜面台' in line_text and '指揮' not in line_text)):
                if stand_count > 0:
                    for w in line['words']:
                        if w[4] == '本':
                            add_auto_num(fitz.Rect(w[:4]), stand_count, "stand")
                            added_keys.add('stand')
                            break

            # 7. 合奏用椅子 (脚)
            if 'chair' not in added_keys and ('合奏用椅子' in line_text or '合奏椅子' in line_text or ('椅子' in line_text and 'ピアノ' not in line_text and '指揮' not in line_text)):
                if chair_count > 0:
                    for w in line['words']:
                        if w[4] == '脚':
                            add_auto_num(fitz.Rect(w[:4]), chair_count, "chair")
                            added_keys.add('chair')
                            break

            # 8. ピアノ椅子 (脚)
            if 'p_chair' not in added_keys and ('ピアノ椅子' in line_text or 'ピアノイス' in line_text or 'ピアノ用椅子' in line_text):
                if p_chair_count > 0:
                    for w in line['words']:
                        if w[4] == '脚':
                            add_auto_num(fitz.Rect(w[:4]), p_chair_count, "p_chair")
                            added_keys.add('p_chair')
                            break

            # 9. 長机 (台)
            if 'table' not in added_keys and ('長机' in line_text or ('机' in line_text and '台' in line_text)):
                if table_count > 0:
                    for w in line['words']:
                        if w[4] == '台':
                            add_auto_num(fitz.Rect(w[:4]), table_count, "table")
                            added_keys.add('table')
                            break

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
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="Original PDF not found")
        
    try:
        cache_buster = str(int(time.time()))
        doc = fitz.open(pdf_path)
        
        # Determine list of images to render
        images = []
        if req.full_page_images and len(req.full_page_images) > 0:
            images = req.full_page_images
        elif req.full_page_image:
            images = [req.full_page_image]
            
        if not images:
            raise HTTPException(status_code=400, detail="No overlay image provided")

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
                page.insert_image(page.rect, stream=image_bytes)

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

