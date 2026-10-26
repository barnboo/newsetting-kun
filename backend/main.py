import time
import unicodedata
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

def clean_japanese_text(text: str) -> str:
    """Normalize Japanese text from PDFs, fixing CJK/Kangxi radical codepoint discrepancies."""
    if not text:
        return ""
    # 1. NFKC normalization
    text = unicodedata.normalize("NFKC", text)
    # 2. Map CJK Radicals Supplement (2E80-2EFF) and Kangxi Radicals (2F00-2FDF) to standard unified ideographs
    radical_map = {
        '\u2ED1': '長', '\u2EC8': '長', '\u2F26': '子', '\u2F64': '用',
        '\u2FAD': '面', '\u2FA8': '風', '\u2F47': '木', '\u2F57': '示',
        '\u2F6F': '生', '\u2F77': '目', '\u2F96': '見', '\u2F9F': '言',
        '\u2F8B': '色', '\u2F24': '大', '\u2F1D': '口', '\u2F49': '月',
        '\u2F4A': '木', '\u2F45': '手', '\u2F90': '至', '\u2F92': '舌',
        '\u2F83': '自', '\u2F69': '白', '\u2F51': '毛', '\u2F4F': '母',
        '\u2F3C': '心', '\u2F2F': '工', '\u2F1F': '土', '\u2F17': '十',
        '\u2F08': '人', '\u2F00': '一', '\u2F06': '二', '\u2F12': '力',
    }
    for k, v in radical_map.items():
        text = text.replace(k, v)
    return text

SYMBOL_CHARS = set("○◯⚪◎●◉□■◇◆△▲▽▼×✕✗✘＋+＊*☆✭♩♪♫♬〒⊥⊤⊢⊣┳┻╋") | set("①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳")
DELIM_CHARS = set("=＝:：→⇒←↔…‥・/／()（）[]［］【】「」『』")
PAIR_DELIMS = {"=", "＝", ":", "：", "→", "⇒", "←", "↔", "…", "‥", "-", "―", "ー"}
STANDALONE_STOP_WORDS = {"要", "不要", "有", "無", "閉", "半開", "全開", "蒲鉾板", "立奏", "座奏"}
NON_ICON_1CHAR = set("品名記号要不有無閉開本脚台個枚組式張対番部門団体客席数等印") | set("0123456789")

def classify_equipment_label(raw_text: str):
    """
    Universal semantic equipment classifier.
    Decomposes Japanese competition equipment strings into role + core category,
    returning (canonical_label, category_key) or None if the text is a header/unit/note.
    """
    import re as _re
    t = clean_japanese_text(raw_text).strip()
    t = _re.sub(r'^[0-9０-９①-⑳・\*\-\s\.]+', '', t).strip()
    t = _re.sub(r'[=＝:：→⇒…‥\(\)（）\[\]［］【】]+$', '', t).strip()
    if not t:
        return None

    ignore_exact = {
        "品名", "記号", "品名記号", "品名/記号", "使用備品", "備品名", "備品",
        "要", "不要", "要・不要", "不要・要", "個数", "数量", "使用数", "個数等",
        "要・不要/個数等", "備考", "番号", "No", "No.", "凡例", "記載例",
        "閉", "蒲鉾板", "カマボコ", "ｶﾏﾎﾞｺ", "半開", "全開", "立奏", "座奏",
        "本", "脚", "台", "個", "枚", "組", "式", "張", "対", "有", "無",
        "借用品", "○印", "印", "をつける", "○をつける", "伝達事項", "ステージ配置図",
        "団体名", "出演番号", "部門", "プログラム", "番", "客席", "下手側", "上手側",
        "下手", "上手", "待機場所", "次の団体", "本部", "ふりがな", "指揮者氏名",
        "ピアノ蓋", "ピアノの蓋", "反響板"
    }
    if t in ignore_exact or len(t) > 16:
        return None
    if any(k in t for k in ["ください", "提出", "コピー", "原則", "場合", "貸出可能", "借用楽器", "サイズ", "をつける", "別も忘れず"]):
        return None
    if "蓋" in t or "反響板" in t:
        return None

    # 1. Page turner chair (譜めくり椅子)
    if any(k in t for k in ["譜めくり", "譜捲り", "めくり", "頁めくり"]):
        return ("譜めくり椅子", "turner_chair")
    # 2. Piano chair (ピアノ椅子)
    if any(k in t for k in ["ピアノ", "Pf", "PF", "ピアニスト", "背付", "高低"]) and any(k in t for k in ["椅子", "イス", "いす", "チェア", "スツール"]):
        return ("ピアノ椅子", "p_chair")
    # 3. Conductor stand (指揮譜面台)
    if any(k in t for k in ["指揮", "コンダクター", "Cond"]) and any(k in t for k in ["譜面", "譜立", "スタンド"]):
        return ("指揮譜面台", "p_stand")
    # 4. Conductor podium (指揮台)
    if any(k in t for k in ["指揮台", "指揮者台", "コンダクター台", "指揮者用台"]):
        return ("指揮台", "podium")
    # 5. Specific instrument chairs (keep distinct from general chorus chairs)
    if any(k in t for k in ["コントラバス", "コンバス", "弦バス", "Cb", "チェロ", "打楽器", "パーカッション", "ティンパニ", "ハープ", "ギター", "補助"]) and any(k in t for k in ["椅子", "イス", "いす", "チェア", "スツール"]):
        return (t, f"dyn_{t}")
    # 6. Ensemble / General chair (合奏用椅子 / パイプ椅子 / 丸椅子 / 椅子)
    if any(k in t for k in ["椅子", "イス", "いす", "チェア", "スツール"]):
        return ("合奏用椅子", "chair")
    # 7. Ensemble / General stand (合奏用譜面台 / 譜面台)
    if any(k in t for k in ["譜面台", "譜面立", "譜立", "スタンド"]):
        return ("合奏用譜面台", "stand")
    # 8. Piano (ピアノ / グランドピアノ / アップライトピアノ)
    if any(k in t for k in ["グランドピアノ", "アップライトピアノ", "ピアノ"]):
        return ("ピアノ", "piano")
    # 9. Long desk / Table (長机 / 机 / テーブル)
    if any(k in t for k in ["長机", "テーブル", "デスク", "机"]):
        return ("長机", "table")
    # 10. Extension cord / Power (延長コード / 電源 / コンセント)
    if any(k in t for k in ["延長コード", "電源コード", "コードリール", "ドラムコード", "コンセント", "電源", "コード"]):
        return ("延長コード", "cord")
    # 11. Microphone (マイク / マイクロフォン)
    if any(k in t for k in ["マイク", "マイクロフォン", "マイクロホン"]):
        return ("マイク", "mic")
    # 12. Stage platform / risers (平台 / ひな壇 / 立奏台)
    if any(k in t for k in ["平台", "ひな壇", "雛壇", "立奏台", "ステージ台", "箱馬"]):
        return (t, f"dyn_{t}")

    return None

def tokenize_pdf_region(page, clip_rect: Optional[fitz.Rect] = None):
    """
    Tokenize PDF page (or clipped region) at the character level.
    Reconstructs justified/character-spaced words (e.g. '指 揮 台', '長 机') within table cells,
    while separating inline delimiters ('=', '→', '：', '(', ')') and symbol glyphs ('○', '◎', '×').
    """
    v_lines = []
    for d in page.get_drawings():
        r = fitz.Rect(d["rect"])
        if r.width <= 3.0 and r.height >= 12.0:
            v_lines.append(((r.x0 + r.x1) / 2.0, r.y0 - 2.0, r.y1 + 2.0))

    def has_v_line_between(x1: float, x2: float, y_mid: float) -> bool:
        if x2 <= x1:
            return False
        for vx, vy0, vy1 in v_lines:
            if vy0 <= y_mid <= vy1 and (x1 - 1.5) <= vx <= (x2 + 1.5):
                return True
        return False

    raw = page.get_text("rawdict", clip=clip_rect) if clip_rect else page.get_text("rawdict")
    chars = []
    for b in raw.get("blocks", []):
        if b.get("type") != 0:
            continue
        for l in b.get("lines", []):
            for s in l.get("spans", []):
                for c in s.get("chars", []):
                    ch = clean_japanese_text(c.get("c", ""))
                    if ch and not ch.isspace():
                        r = fitz.Rect(c["bbox"])
                        if clip_rect is None or r.intersects(clip_rect):
                            chars.append({
                                "rect": r,
                                "ch": ch,
                                "y_mid": (r.y0 + r.y1) / 2.0,
                                "h": r.height,
                                "w": max(1.0, r.width),
                            })

    lines = []
    for c in sorted(chars, key=lambda x: (x["y_mid"], x["rect"].x0)):
        placed = False
        for line in lines:
            if abs(line["y_mid"] - c["y_mid"]) < max(5.5, min(line["avg_h"], c["h"]) * 0.55):
                line["chars"].append(c)
                n = len(line["chars"])
                line["y_mid"] = sum(x["y_mid"] for x in line["chars"]) / n
                line["avg_h"] = sum(x["h"] for x in line["chars"]) / n
                placed = True
                break
        if not placed:
            lines.append({"y_mid": c["y_mid"], "avg_h": c["h"], "chars": [c]})

    lines.sort(key=lambda l: l["y_mid"])
    for line in lines:
        line["chars"].sort(key=lambda c: c["rect"].x0)
        n_chars = len(line["chars"])
        tokens = []
        for c_idx, c in enumerate(line["chars"]):
            ch = c["ch"]
            r = c["rect"]
            ttype = "SYMBOL" if ch in SYMBOL_CHARS else ("DELIM" if ch in DELIM_CHARS else "WORD")
            if tokens and ttype == "WORD" and tokens[-1]["type"] == "WORD":
                prev = tokens[-1]
                gap = r.x0 - prev["rect"].x1
                if not has_v_line_between(prev["rect"].x1, r.x0, line["y_mid"]):
                    can_merge = False
                    tight_thresh = max(prev["avg_w"] * 0.45, 4.0)
                    if gap <= tight_thresh:
                        can_merge = True
                    elif gap <= 24.0 and prev["text"] not in STANDALONE_STOP_WORDS and ch not in STANDALONE_STOP_WORDS:
                        # Only merge across wide justification gaps if BOTH sides are single spaced characters
                        next_is_tight = False
                        if c_idx + 1 < n_chars:
                            next_c = line["chars"][c_idx + 1]
                            next_ttype = "SYMBOL" if next_c["ch"] in SYMBOL_CHARS else ("DELIM" if next_c["ch"] in DELIM_CHARS else "WORD")
                            if next_ttype == "WORD" and (next_c["rect"].x0 - r.x1) <= max(c["w"] * 0.45, 4.0):
                                next_is_tight = True
                        prev_eligible = (len(prev["chars"]) == 1) or (prev.get("is_justified", False) and abs(gap - prev.get("last_gap", gap)) <= 6.0)
                        if prev_eligible and not next_is_tight:
                            can_merge = True
                            prev["is_justified"] = True
                            prev["last_gap"] = gap
                    if can_merge:
                        prev["text"] += ch
                        prev["rect"] = prev["rect"] | r
                        prev["chars"].append(c)
                        prev["avg_w"] = sum(x["w"] for x in prev["chars"]) / len(prev["chars"])
                        continue
            tokens.append({
                "type": ttype,
                "text": ch,
                "rect": fitz.Rect(r),
                "chars": [c],
                "avg_w": c["w"],
                "is_justified": False,
                "last_gap": 0.0,
            })
        line["tokens"] = tokens
    return lines

def extract_label_for_icon(bbox: fitz.Rect, page_words: list, tokenized_lines: Optional[list] = None) -> str:
    """
    Given an icon bounding box on the PDF page, finds the associated item name
    from the same row using character-reconstructed phrases and semantic classification.
    """
    y_mid = (bbox.y0 + bbox.y1) / 2.0

    # 1. First try tokenized_lines (handles character-spaced words like '指 揮 台' and '長 机')
    if tokenized_lines:
        left_candidates = []
        right_candidates = []
        for line in tokenized_lines:
            if abs(line["y_mid"] - y_mid) < 16.0:
                for tok in line["tokens"]:
                    if tok["type"] != "WORD":
                        continue
                    tr = tok["rect"]
                    if tr.x1 <= bbox.x0 + 6.0 and (bbox.x0 - tr.x1) < 220.0:
                        left_candidates.append((bbox.x0 - tr.x1, tok["text"]))
                    elif tr.x0 >= bbox.x1 - 6.0 and (tr.x0 - bbox.x1) < 220.0:
                        right_candidates.append((tr.x0 - bbox.x1, tok["text"]))

        # Closest token on the left first, then right
        left_candidates.sort(key=lambda x: x[0])
        for _, txt in left_candidates:
            eq = classify_equipment_label(txt)
            if eq:
                return eq[0]
        right_candidates.sort(key=lambda x: x[0])
        for _, txt in right_candidates:
            eq = classify_equipment_label(txt)
            if eq:
                return eq[0]

    # 2. Fallback to page_words
    left_words = []
    right_words = []
    for w in page_words:
        w_rect = fitz.Rect(w[:4])
        vert_overlap = max(0, min(bbox.y1, w_rect.y1) - max(bbox.y0, w_rect.y0))
        vert_dist = abs((w_rect.y0 + w_rect.y1) / 2 - y_mid)
        if vert_overlap > 2 or vert_dist < 18:
            if w_rect.x1 <= bbox.x0 + 5 and (bbox.x0 - w_rect.x1) < 220:
                left_words.append(w)
            elif w_rect.x0 >= bbox.x1 - 5 and (w_rect.x0 - bbox.x1) < 220:
                right_words.append(w)

    left_words.sort(key=lambda w: w[0])
    right_words.sort(key=lambda w: w[0])

    raw_left = "".join(w[4] for w in left_words).strip().replace(" ", "")
    eq_left = classify_equipment_label(raw_left)
    if eq_left:
        return eq_left[0]

    units_stop = {
        "要", "不要", "・", "要・不要", "本", "脚", "台", "個", "枚", "組",
        "閉", "蒲鉾板", "半開", "全開", "○", "レ", "有", "無"
    }
    filtered_right = [w for w in right_words if clean_japanese_text(w[4]) not in units_stop and not w[4].isdigit()]
    raw_right = "".join(w[4] for w in filtered_right).strip().replace(" ", "")
    eq_right = classify_equipment_label(raw_right)
    if eq_right:
        return eq_right[0]

    return ""

def merge_rects(rects, margin=10.0):
    """Merge rectangles that are close to each other."""
    if not rects:
        return []
    
    merged = []
    for orig_r in rects:
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
                tokenized_lines = tokenize_pdf_region(page, rect_points)

                icon_zoom = 4.0
                mat = fitz.Matrix(icon_zoom, icon_zoom)
                
                # Render high-resolution region image
                pix_region = page.get_pixmap(matrix=mat, clip=rect_points)
                region_filename = f"{req.file_id}_icons_region_{cache_buster}.png"
                region_path = os.path.join(STATIC_DIR, region_filename)
                pix_region.save(region_path)
                icons_region_url = f"/static/{region_filename}"

                # Save clean version for manual crop fidelity
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

                # Filter out table grid lines (horizontal and vertical lines >= 16 pt)
                h_k = cv2.getStructuringElement(cv2.MORPH_RECT, (int(16 * icon_zoom), 1))
                v_k = cv2.getStructuringElement(cv2.MORPH_RECT, (1, int(16 * icon_zoom)))
                lines_grid = cv2.add(cv2.morphologyEx(thresh, cv2.MORPH_OPEN, h_k), cv2.morphologyEx(thresh, cv2.MORPH_OPEN, v_k))
                no_grid = cv2.subtract(thresh, lines_grid)

                candidate_boxes = []
                inline_sym_rects = []
                consumed_tokens = set()  # (line_idx, tok_idx)

                def is_valid_symbol_token(tok):
                    if tok["type"] == "SYMBOL":
                        return True
                    if tok["type"] == "WORD" and len(tok["text"]) == 1 and tok["text"] not in NON_ICON_1CHAR:
                        return True
                    return False

                # Mode A: Inline Key-Value / Delimiter / Parenthesized Legend (e.g. '椅子=○', '椅子→○', '○：椅子', '椅子(○)')
                for l_idx, line in enumerate(tokenized_lines):
                    toks = line["tokens"]
                    n_toks = len(toks)
                    for t_idx in range(n_toks):
                        if (l_idx, t_idx) in consumed_tokens:
                            continue

                        # Pattern A1: [WORD(label)] [DELIM in PAIR_DELIMS] [SYMBOL]
                        if (
                            t_idx + 2 < n_toks
                            and toks[t_idx]["type"] == "WORD"
                            and toks[t_idx + 1]["text"] in PAIR_DELIMS
                            and is_valid_symbol_token(toks[t_idx + 2])
                        ):
                            eq = classify_equipment_label(toks[t_idx]["text"])
                            if eq:
                                sr = toks[t_idx + 2]["rect"]
                                dr = toks[t_idx + 1]["rect"]
                                pad = 2.0
                                x0 = max(dr.x1 + 1.0, sr.x0 - pad)
                                x1 = sr.x1 + pad
                                if t_idx + 3 < n_toks:
                                    x1 = min(toks[t_idx + 3]["rect"].x0 - 1.0, x1)
                                sym_box = fitz.Rect(x0, sr.y0 - pad, x1, sr.y1 + pad)
                                candidate_boxes.append((sym_box, eq[0], "inline_sym"))
                                inline_sym_rects.append(sym_box)
                                consumed_tokens.update({(l_idx, t_idx), (l_idx, t_idx + 1), (l_idx, t_idx + 2)})
                                continue

                        # Pattern A2: [SYMBOL] [DELIM in PAIR_DELIMS] [WORD(label)]
                        if (
                            t_idx + 2 < n_toks
                            and is_valid_symbol_token(toks[t_idx])
                            and toks[t_idx + 1]["text"] in PAIR_DELIMS
                            and toks[t_idx + 2]["type"] == "WORD"
                        ):
                            eq = classify_equipment_label(toks[t_idx + 2]["text"])
                            if eq:
                                sr = toks[t_idx]["rect"]
                                dr = toks[t_idx + 1]["rect"]
                                pad = 2.0
                                x0 = sr.x0 - pad
                                if t_idx > 0:
                                    x0 = max(toks[t_idx - 1]["rect"].x1 + 1.0, x0)
                                x1 = min(dr.x0 - 1.0, sr.x1 + pad)
                                sym_box = fitz.Rect(x0, sr.y0 - pad, x1, sr.y1 + pad)
                                candidate_boxes.append((sym_box, eq[0], "inline_sym"))
                                inline_sym_rects.append(sym_box)
                                consumed_tokens.update({(l_idx, t_idx), (l_idx, t_idx + 1), (l_idx, t_idx + 2)})
                                continue

                        # Pattern A3: [WORD(label)] ['(' or '（'] [SYMBOL] [')' or '）']
                        if (
                            t_idx + 3 < n_toks
                            and toks[t_idx]["type"] == "WORD"
                            and toks[t_idx + 1]["text"] in ("(", "（")
                            and is_valid_symbol_token(toks[t_idx + 2])
                            and toks[t_idx + 3]["text"] in (")", "）")
                        ):
                            eq = classify_equipment_label(toks[t_idx]["text"])
                            if eq:
                                sr = toks[t_idx + 2]["rect"]
                                pad = 1.5
                                x0 = max(toks[t_idx + 1]["rect"].x1 + 0.5, sr.x0 - pad)
                                x1 = min(toks[t_idx + 3]["rect"].x0 - 0.5, sr.x1 + pad)
                                sym_box = fitz.Rect(x0, sr.y0 - pad, x1, sr.y1 + pad)
                                candidate_boxes.append((sym_box, eq[0], "inline_sym"))
                                inline_sym_rects.append(sym_box)
                                consumed_tokens.update({(l_idx, t_idx), (l_idx, t_idx + 1), (l_idx, t_idx + 2), (l_idx, t_idx + 3)})
                                continue

                # Create text-masked binary image (no_grid_no_text) so text words never contaminate icon crops
                no_grid_no_text = no_grid.copy()
                for l_idx, line in enumerate(tokenized_lines):
                    for t_idx, tok in enumerate(line["tokens"]):
                        tr = tok["rect"]
                        if any(tr.intersects(ir) for ir in inline_sym_rects):
                            continue
                        should_mask = False
                        if tok["type"] == "DELIM":
                            should_mask = True
                        elif tok["type"] == "WORD":
                            if len(tok["text"]) >= 2 or tok["text"] in NON_ICON_1CHAR:
                                should_mask = True
                        if should_mask:
                            mx0 = max(0, int((tr.x0 - rect_points.x0) * icon_zoom) - 2)
                            mx1 = min(pix_region.width, int((tr.x1 - rect_points.x0) * icon_zoom) + 2)
                            my0 = max(0, int((tr.y0 - rect_points.y0) * icon_zoom) - 2)
                            my1 = min(pix_region.height, int((tr.y1 - rect_points.y0) * icon_zoom) + 2)
                            if mx1 > mx0 and my1 > my0:
                                no_grid_no_text[my0:my1, mx0:mx1] = 0

                # Detect '記号' column header if present
                sym_col_bounds = None
                for line in tokenized_lines:
                    for tok in line["tokens"]:
                        if tok["text"] in ("記号", "図"):
                            sym_col_bounds = (tok["rect"].x0 - 18.0, tok["rect"].x1 + 18.0)
                            break
                    if sym_col_bounds:
                        break

                # Mode B: Raster Images in rect_points
                raw_images = page.get_image_info(xrefs=True)
                for img in raw_images:
                    b = fitz.Rect(img['bbox'])
                    if b.intersects(rect_points):
                        if 6 <= b.width <= 160 and 6 <= b.height <= 160:
                            lbl = extract_label_for_icon(b, page_words, tokenized_lines)
                            candidate_boxes.append((b, lbl, 'raster'))

                # Mode C: Row-based symbol search using reconstructed phrases & text-masked image
                for l_idx, line in enumerate(tokenized_lines):
                    toks = line["tokens"]
                    for t_idx, tok in enumerate(toks):
                        if (l_idx, t_idx) in consumed_tokens or tok["type"] != "WORD":
                            continue
                        eq = classify_equipment_label(tok["text"])
                        if not eq:
                            continue
                        r = tok["rect"]
                        canonical_lbl = eq[0]

                        # Build search intervals: 1) '記号' column if aligned, 2) right of label, 3) left of label
                        search_x_ranges = []
                        if sym_col_bounds and abs(sym_col_bounds[0] - r.x1) < 120.0:
                            search_x_ranges.append(sym_col_bounds)

                        # Right side: up to the next WORD token (e.g. '要', '本', '脚') or +95pt
                        right_limit = r.x1 + 95.0
                        for next_idx in range(t_idx + 1, len(toks)):
                            nt = toks[next_idx]
                            if nt["type"] == "WORD" and (len(nt["text"]) >= 2 or nt["text"] in NON_ICON_1CHAR):
                                right_limit = min(right_limit, nt["rect"].x0 - 3.0)
                                break
                        if right_limit > r.x1 + 6.0:
                            search_x_ranges.append((r.x1 + 4.0, right_limit))

                        # Left side: from previous WORD token or -95pt
                        left_limit = r.x0 - 95.0
                        for prev_idx in range(t_idx - 1, -1, -1):
                            pt = toks[prev_idx]
                            if pt["type"] == "WORD" and (len(pt["text"]) >= 2 or pt["text"] in NON_ICON_1CHAR):
                                left_limit = max(left_limit, pt["rect"].x1 + 3.0)
                                break
                        if r.x0 - 4.0 > left_limit:
                            search_x_ranges.append((left_limit, r.x0 - 4.0))

                        sym_y0 = r.y0 - 8.0
                        sym_y1 = r.y1 + 8.0
                        for sx0, sx1 in search_x_ranges:
                            px0 = max(0, int((sx0 - rect_points.x0) * icon_zoom))
                            px1 = min(pix_region.width, int((sx1 - rect_points.x0) * icon_zoom))
                            py0 = max(0, int((sym_y0 - rect_points.y0) * icon_zoom))
                            py1 = min(pix_region.height, int((sym_y1 - rect_points.y0) * icon_zoom))

                            if px1 > px0 and py1 > py0:
                                cell_content = no_grid_no_text[py0:py1, px0:px1]
                                dark_y, dark_x = np.where(cell_content > 0)
                                if len(dark_x) >= 16:
                                    pad = 4
                                    min_x = max(0, int(np.min(dark_x)) + px0 - pad)
                                    max_x = min(pix_region.width, int(np.max(dark_x)) + px0 + pad)
                                    min_y = max(0, int(np.min(dark_y)) + py0 - pad)
                                    max_y = min(pix_region.height, int(np.max(dark_y)) + py0 + pad)

                                    box_pt = fitz.Rect(
                                        rect_points.x0 + min_x / icon_zoom,
                                        rect_points.y0 + min_y / icon_zoom,
                                        rect_points.x0 + max_x / icon_zoom,
                                        rect_points.y0 + max_y / icon_zoom
                                    )
                                    candidate_boxes.append((box_pt, canonical_lbl, 'row_cell'))
                                    break

                # Mode D: Vector drawings fallback / supplement (filtering out cell border segments)
                drawings = page.get_drawings()
                drawing_rects = []
                for d in drawings:
                    r = fitz.Rect(d['rect'])
                    if not r.intersects(rect_points):
                        continue
                    if r.width > 120 or r.height > 120:
                        continue
                    # Filter out horizontal and vertical table border segments
                    if (r.width >= 12 and r.height <= 2.5) or (r.height >= 12 and r.width <= 2.5):
                        continue
                    if r.width <= 1.8 and r.height <= 1.8:
                        continue
                    sw = d.get('width', 1.0) or 1.0
                    r_exp = fitz.Rect(r.x0 - sw/2, r.y0 - sw/2, r.x1 + sw/2, r.y1 + sw/2)
                    drawing_rects.append(r_exp)

                merged_drawings = merge_rects(drawing_rects, margin=6.0)
                for md in merged_drawings:
                    if 5 <= md.width <= 120 and 5 <= md.height <= 120:
                        lbl = extract_label_for_icon(md, page_words, tokenized_lines)
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
                            if min_area > 0 and inter_area / min_area > 0.35:
                                overlap = True
                                if not ulbl and lbl:
                                    unique_candidates[idx_u] = (ub, lbl, utyp)
                                break
                    if not overlap:
                        final_lbl = lbl or extract_label_for_icon(b, page_words, tokenized_lines)
                        unique_candidates.append((b, final_lbl, typ))

                # Sort candidates in visual reading order:
                # If all candidates are on roughly the same horizontal band (inline legend), sort left-to-right;
                # otherwise sort top-to-bottom by column
                if len(unique_candidates) > 1:
                    y_vals = [item[0].y0 for item in unique_candidates]
                    if max(y_vals) - min(y_vals) < 25.0:
                        unique_candidates.sort(key=lambda item: item[0].x0)
                    else:
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

        # ─── 根本解決: 最長一致・厳格除外による備品シグネチャ定義 ──────────────────
        STD_DEFS = [
            {
                "key": "piano",
                "names": ["ピアノ", "グランドピアノ", "アップライトピアノ"],
                "tmpls": ["tmpl_piano", "tmpl_grandPiano"],
                "neg": ["蓋", "反響板", "椅子", "イス", "いす", "譜めくり", "めくり"],
            },
            {
                "key": "piano_lid",
                "names": ["ピアノの蓋", "ピアノ蓋"],
                "tmpls": [],
                "neg": [],
            },
            {
                "key": "podium",
                "names": ["指揮台"],
                "tmpls": ["tmpl_podium"],
                "neg": [],
            },
            {
                "key": "p_stand",
                "names": ["指揮用譜面台", "指揮譜面台", "指揮者用譜面台", "指揮者譜面台", "指揮者用"],
                "tmpls": ["tmpl_conductorStand"],
                "neg": ["合奏"],
            },
            {
                "key": "stand",
                "names": ["合奏用譜面台", "合奏譜面台", "譜面台"],
                "tmpls": ["tmpl_ensembleStand"],
                "neg": ["指揮"],
            },
            {
                "key": "p_chair",
                "names": ["ピアノ椅子", "ピアノイス", "ピアノ用椅子", "ピアノ用イス"],
                "tmpls": ["tmpl_pianoChair"],
                "neg": ["譜めくり", "めくり", "合奏"],
            },
            {
                "key": "turner_chair",
                "names": ["譜めくり椅子", "譜めくりイス", "譜捲り椅子", "めくり椅子", "譜めくり用椅子"],
                "tmpls": ["tmpl_turnerChair"],
                "neg": ["ピアノ"],
            },
            {
                "key": "chair",
                "names": ["合奏用椅子", "合奏椅子", "パイプ椅子", "普通椅子", "椅子"],
                "tmpls": ["tmpl_chorusChair", "tmpl_pipeChair"],
                "neg": ["ピアノ", "指揮", "パーカッション", "打楽器", "譜めくり", "めくり", "コントラバス", "バス", "チェロ", "補助", "立奏"],
            },
            {
                "key": "table",
                "names": ["長机", "机", "テーブル", "デスク"],
                "tmpls": ["tmpl_longDesk", "tmpl_desk"],
                "neg": [],
            },
            {
                "key": "cord",
                "names": ["延長コード", "電源コード", "コード", "電源"],
                "tmpls": ["tmpl_extensionCord"],
                "neg": [],
            },
            {
                "key": "mic",
                "names": ["マイク", "マイクロフォン", "マイクロホン", "アナウンスマイク"],
                "tmpls": ["tmpl_mic", "tmpl_microphone"],
                "neg": [],
            },
        ]

        # 1. ユーザーの配置パーツ群を照合（定型定義 STD_DEFS ＋ 意味分類器 ＋ 動的定義 DYNAMIC_DEFS）
        import re as _re
        assigned_counts = {d["key"]: 0 for d in STD_DEFS}
        dynamic_defs = {}
        unmapped_tallies = []

        for t in req.tallies:
            c = max(0, int(t.count or 0))
            lbl = clean_japanese_text(t.label or "").strip()
            iid = (t.icon_id or "").strip()
            if not lbl:
                continue

            best_def = None
            best_score = 0

            # First check template ID exact match
            for d in STD_DEFS:
                if iid in d["tmpls"]:
                    best_def = d
                    best_score = 1000
                    break

            # Next check universal semantic classifier
            if not best_def:
                sem = classify_equipment_label(lbl)
                if sem:
                    _, sem_key = sem
                    for d in STD_DEFS:
                        if d["key"] == sem_key:
                            best_def = d
                            best_score = 500
                            break

            # Fallback to STD_DEFS substring scoring
            if not best_def:
                for d in STD_DEFS:
                    if any(neg in lbl for neg in d["neg"]):
                        continue
                    for name in d["names"]:
                        if name == lbl:
                            score = len(name) * 2
                        elif name in lbl:
                            if name in ["椅子", "机", "台"] and len(lbl) > len(name):
                                continue
                            score = len(name)
                        else:
                            continue
                        if score > best_score:
                            best_score = score
                            best_def = d

            if best_def and best_score >= 2:
                assigned_counts[best_def["key"]] += c
            else:
                clean_lbl = _re.sub(r'^[0-9０-９①-⑳\.\s・]+', '', lbl).strip()
                if clean_lbl and not _re.match(r'^(パーツ|アイテム|icon)[_\s]*\d*$', clean_lbl, _re.IGNORECASE):
                    dyn_key = f"dyn_{clean_lbl}"
                    if dyn_key not in dynamic_defs:
                        names_list = [clean_lbl]
                        base_lbl = _re.sub(r'[（\(].*?[）\)]', '', clean_lbl).strip()
                        if base_lbl and base_lbl != clean_lbl and len(base_lbl) >= 2:
                            names_list.append(base_lbl)
                        dynamic_defs[dyn_key] = {
                            "key": dyn_key,
                            "names": names_list,
                            "tmpls": [],
                            "neg": [],
                        }
                        assigned_counts[dyn_key] = 0
                    assigned_counts[dyn_key] += c
                if c > 0:
                    unmapped_tallies.append(t)

        ALL_DEFS = STD_DEFS + list(dynamic_defs.values())
        DEF_BY_KEY = {d["key"]: d for d in ALL_DEFS}

        auto_nodes = []
        tokenized_lines = tokenize_pdf_region(page)

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

        def add_auto_num_centered(center_x_pt, y0_pt, count_val, name_id):
            s = str(count_val)
            half_w_px = len(s) * 6.0
            auto_nodes.append({
                "id": f"auto_num_{name_id}",
                "type": "text",
                "text": s,
                "x": round(center_x_pt * 2.0 - half_w_px),
                "y": round((y0_pt - 1.0) * 2.0),
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

        def circle_yo_or_fuyo_chars(cell_chars, is_yo, name_id):
            """
            Context-aware '要・不要' / '有・無' / '使用・不使用' detector using character-level rects.
            Locks negative phrases ('不要', '不使用', '無') first so split characters ('不' '要')
            never accidentally circle the '要' inside '不要' when is_yo=True.
            """
            if not cell_chars:
                return False
            joined = "".join(c["ch"] for c in cell_chars)
            # Skip column header strings like '使用有無' or '要・不要/個数等'
            if "有無" in joined or "個数" in joined or "数量" in joined:
                return False
            locked = [False] * len(cell_chars)

            neg_spans = []
            for neg_kw in ("不要", "不使用", "無"):
                start = 0
                while True:
                    idx = joined.find(neg_kw, start)
                    if idx == -1:
                        break
                    end_idx = idx + len(neg_kw)
                    # Avoid matching '無' inside unrelated words like '無線'
                    if neg_kw == "無" and end_idx < len(joined) and joined[end_idx] in ("線", "料", "効"):
                        start = end_idx
                        continue
                    for k_i in range(idx, end_idx):
                        locked[k_i] = True
                    r_neg = fitz.Rect(cell_chars[idx]["rect"])
                    for k_i in range(idx + 1, end_idx):
                        r_neg |= cell_chars[k_i]["rect"]
                    neg_spans.append((idx, r_neg))
                    start = end_idx

            pos_spans = []
            for pos_kw in ("要", "使用", "有"):
                start = 0
                while True:
                    idx = joined.find(pos_kw, start)
                    if idx == -1:
                        break
                    end_idx = idx + len(pos_kw)
                    if any(locked[k_i] for k_i in range(idx, end_idx)):
                        start = end_idx
                        continue
                    if pos_kw == "有" and end_idx < len(joined) and joined[end_idx] in ("線", "料", "効"):
                        start = end_idx
                        continue
                    for k_i in range(idx, end_idx):
                        locked[k_i] = True
                    r_pos = fitz.Rect(cell_chars[idx]["rect"])
                    for k_i in range(idx + 1, end_idx):
                        r_pos |= cell_chars[k_i]["rect"]
                    pos_spans.append((idx, r_pos))
                    start = end_idx

            if not neg_spans and not pos_spans:
                return False

            if is_yo and pos_spans:
                add_auto_circle(pos_spans[0][1], f"{name_id}_yo")
                return True
            elif not is_yo and neg_spans:
                add_auto_circle(neg_spans[0][1], f"{name_id}_fuyo")
                return True
            return True

        # Detect standalone quantity column headers (for tables where cells have no printed unit)
        qty_col_headers = []
        circle_mark_mode = False
        for line in tokenized_lines:
            line_txt = "".join(t["text"] for t in line["tokens"])
            if "○印" in line_txt or "◯印" in line_txt:
                circle_mark_mode = True
            for tok in line["tokens"]:
                if tok["text"] in ("数量", "個数", "使用数", "借用数", "必要数") and "要" not in line_txt:
                    qty_col_headers.append((tok["rect"].x0 - 15.0, tok["rect"].x1 + 15.0, tok["rect"].y1))

        piano_lid_setting = clean_japanese_text(req.piano_lid or "半開").strip()
        matched_keys = set()
        UNIT_CHARS = ("脚", "本", "台", "個", "枚", "組", "式", "張", "対")

        # Step 2: 各行内の備品アンカーを検出し、セル区間ごとに集計結果を適用
        for line in tokenized_lines:
            toks = line["tokens"]
            full_line_text = "".join(t["text"] for t in toks)

            # 注意書きなどの長文注釈行は誤爆防止のためスキップ
            if any(skip_kw in full_line_text for skip_kw in [
                "（注）", "(注)", "原則禁止", "お借りします", "ご相談ください",
                "提出書類", "記入してください", "明記してください", "忘れずに"
            ]):
                continue

            anchors = []
            for t_idx, tok in enumerate(toks):
                if tok["type"] != "WORD":
                    continue
                t_text = tok["text"]
                tr = tok["rect"]

                # Check piano_lid first
                if ("ピアノ" in t_text and "蓋" in t_text) or t_text in ("ピアノの蓋", "ピアノ蓋"):
                    if "piano_lid" not in matched_keys:
                        anchors.append({
                            "def": DEF_BY_KEY["piano_lid"],
                            "key": "piano_lid",
                            "x_start": tr.x0,
                            "x_end": tr.x1,
                            "rect": tr,
                            "name": t_text,
                            "tok_idx": t_idx,
                        })
                    continue

                # Check semantic classifier
                matched_k = None
                matched_name = t_text
                sem = classify_equipment_label(t_text)
                if sem and sem[1] in DEF_BY_KEY:
                    matched_k = sem[1]
                    matched_name = sem[0]
                else:
                    # Fallback to ALL_DEFS
                    best_len = 0
                    for d in ALL_DEFS:
                        if any(neg in t_text for neg in d["neg"]):
                            continue
                        for name in d["names"]:
                            if name in t_text:
                                if name in ("椅子", "机", "台") and len(t_text) > len(name):
                                    continue
                                if len(name) > best_len:
                                    best_len = len(name)
                                    matched_k = d["key"]
                                    matched_name = name

                if matched_k and matched_k not in matched_keys and matched_k in DEF_BY_KEY:
                    anchors.append({
                        "def": DEF_BY_KEY[matched_k],
                        "key": matched_k,
                        "x_start": tr.x0,
                        "x_end": tr.x1,
                        "rect": tr,
                        "name": matched_name,
                        "tok_idx": t_idx,
                    })

            if not anchors:
                continue

            # 各定義キーごとに一番長い name のアンカーを残す（重複排除）
            best_by_key = {}
            for a in anchors:
                k = a["key"]
                if k not in best_by_key or len(a["name"]) > len(best_by_key[k]["name"]):
                    best_by_key[k] = a
            final_anchors = sorted(best_by_key.values(), key=lambda a: a["x_start"])

            # セル境界（X座標）を算出
            splits = [0.0]
            for i in range(len(final_anchors) - 1):
                splits.append(max(final_anchors[i]["x_end"] + 2.0, final_anchors[i + 1]["x_start"] - 18.0))
            # Check if there is an unrelated section on the right (e.g. 【立奏・座奏】)
            right_cap = 99999.0
            for tok in toks:
                if tok["rect"].x0 > final_anchors[-1]["x_end"] and tok["text"] in ("立奏", "座奏"):
                    right_cap = min(right_cap, tok["rect"].x0 - 15.0)
                    break
            splits.append(right_cap)

            # 各セルごとに独立して集計結果を適用
            for i, a in enumerate(final_anchors):
                k = a["key"]
                cnt = assigned_counts.get(k, 0)
                x_min = splits[i]
                x_max = splits[i + 1]
                cell_tokens = [t for t in toks if x_min <= t["rect"].x0 < x_max]
                cell_chars = [c for c in line["chars"] if x_min <= c["rect"].x0 < x_max]

                # Skip pure inline legend definitions (e.g. '椅子 → ○', '◎：ピアノ椅子', '指揮台（□）')
                after_anchor_tokens = [t for t in cell_tokens if t["rect"].x0 >= a["x_end"] - 1.0]
                before_anchor_tokens = [t for t in toks if t["rect"].x1 <= a["x_start"] + 1.0 and (a["x_start"] - t["rect"].x1) < 35.0]
                has_unit_or_yo = (
                    any(any(u in t["text"] for u in UNIT_CHARS) for t in after_anchor_tokens)
                    or any("要" in t["text"] for t in after_anchor_tokens)
                )
                is_fwd_legend = (
                    len(after_anchor_tokens) >= 2
                    and after_anchor_tokens[0]["text"] in PAIR_DELIMS
                    and (after_anchor_tokens[1]["type"] == "SYMBOL" or len(after_anchor_tokens[1]["text"]) == 1)
                )
                is_rev_legend = (
                    len(before_anchor_tokens) >= 2
                    and before_anchor_tokens[-1]["text"] in PAIR_DELIMS
                    and (before_anchor_tokens[-2]["type"] == "SYMBOL" or len(before_anchor_tokens[-2]["text"]) == 1)
                )
                is_paren_legend = (
                    len(after_anchor_tokens) >= 3
                    and after_anchor_tokens[0]["text"] in ("(", "（")
                    and after_anchor_tokens[1]["type"] == "SYMBOL"
                    and after_anchor_tokens[2]["text"] in (")", "）")
                )
                if (is_fwd_legend or is_rev_legend or is_paren_legend) and not has_unit_or_yo:
                    continue

                # ピアノ蓋の処理
                if k == "piano_lid":
                    matched_keys.add(k)
                    if assigned_counts.get("piano", 0) > 0:
                        lid_targets = [piano_lid_setting]
                        if piano_lid_setting in ("蒲鉾板", "カマボコ", "ｶﾏﾎﾞｺ"):
                            lid_targets.extend(["蒲鉾板", "カマボコ", "ｶﾏﾎﾞｺ"])

                        joined_cell = "".join(c["ch"] for c in cell_chars)
                        for target in lid_targets:
                            idx = joined_cell.find(target)
                            if idx != -1:
                                r_lid = fitz.Rect(cell_chars[idx]["rect"])
                                for k_i in range(idx + 1, idx + len(target)):
                                    r_lid |= cell_chars[k_i]["rect"]
                                add_auto_circle(r_lid, "piano_lid")
                                break
                    continue

                has_slot = False
                num_placed = False

                # 1) Tier 1: カッコ空欄（例: '椅子（　）個', '・ピアノ椅子( )個'）へのセンタリング記入
                open_paren_tok = None
                close_paren_tok = None
                for idx_t, t in enumerate(after_anchor_tokens):
                    if t["text"] in ("(", "（"):
                        # Check if immediately closed by ')' or '）' (empty blank inside parens)
                        if idx_t + 1 < len(after_anchor_tokens) and after_anchor_tokens[idx_t + 1]["text"] in (")", "）"):
                            open_paren_tok = t
                            close_paren_tok = after_anchor_tokens[idx_t + 1]
                            break

                if open_paren_tok is not None and close_paren_tok is not None:
                    has_slot = True
                    if cnt > 0:
                        cx_pt = (open_paren_tok["rect"].x1 + close_paren_tok["rect"].x0) / 2.0
                        cy0_pt = (open_paren_tok["rect"].y0 + close_paren_tok["rect"].y0) / 2.0
                        add_auto_num_centered(cx_pt, cy0_pt, cnt, k)
                        num_placed = True

                # 2) Tier 2: 助数詞（脚・本・台・個・枚・組など）の手前への記入
                if not num_placed:
                    for c_idx, c in enumerate(cell_chars):
                        if c["rect"].x0 < a["x_end"] - 1.0:
                            continue
                        if c["ch"] in UNIT_CHARS:
                            # Skip header words like '個数', '台数', '本数'
                            next_ch = cell_chars[c_idx + 1]["ch"] if c_idx + 1 < len(cell_chars) else ""
                            if next_ch == "数":
                                continue
                            has_slot = True
                            if cnt > 0:
                                add_auto_num(c["rect"], cnt, k)
                                num_placed = True
                            break

                # 3) Tier 3: 助数詞なしの空欄「数量 / 個数」列へのフォールバック記入
                if not num_placed and not has_slot:
                    for qx0, qx1, qy1 in qty_col_headers:
                        if x_min <= (qx0 + qx1) / 2.0 < x_max and line["y_mid"] > qy1:
                            has_slot = True
                            if cnt > 0:
                                add_auto_num_centered((qx0 + qx1) / 2.0, a["rect"].y0, cnt, k)
                                num_placed = True
                            break

                # 4) 要・不要 / 有・無 の丸つけ
                after_chars = [c for c in cell_chars if c["rect"].x0 >= a["x_end"] - 1.0]
                if circle_yo_or_fuyo_chars(after_chars, cnt > 0, k):
                    has_slot = True

                # 5) 借用品（○印）形式（例: '・電源', '・ピアノ椅子'）の丸つけ
                has_leading_bullet = any(
                    t["text"] == "・" and abs(a["x_start"] - t["rect"].x1) < 15.0
                    for t in cell_tokens
                )
                if circle_mark_mode and has_leading_bullet:
                    if not has_slot:
                        has_slot = True
                        if cnt > 0:
                            add_auto_circle(a["rect"], f"{k}_item")

                if has_slot:
                    matched_keys.add(k)

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

