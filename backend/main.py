import time
import re
import unicodedata
import os
import uuid
import fitz  # PyMuPDF
import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from PIL import Image
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
            if fname.startswith(".") or fname == "manual.pdf":
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

def detect_stage_region(page: fitz.Page, zoom: float = 2.0) -> dict:
    """Automatically detect the stage diagram bounding box on a competition setting sheet.

    Uses structural stage geometry (symmetric acoustic reflector wings, back reflector wall,
    stage risers, stage front line/apron, and stage direction markers) while strictly
    excluding peripheral headers, footers, equipment tables, and inline symbol legends.
    Returns pixel coordinates scaled by zoom (ready for cropping the visual pixmap).
    """
    page_w = page.rect.width
    page_h = page.rect.height
    page_area = page_w * page_h

    def _union_bounds(boxes):
        return (
            min(b[0] for b in boxes),
            min(b[1] for b in boxes),
            max(b[2] for b in boxes),
            max(b[3] for b in boxes),
        )

    draws = []
    try:
        for d in page.get_drawings():
            r = d["rect"]
            if r.width > 0 or r.height > 0:
                draws.append(fitz.Rect(r.x0, r.y0, max(r.x0 + 0.5, r.x1), max(r.y0 + 0.5, r.y1)))
    except Exception as e:
        print(f"Drawing extraction error: {e}")

    words = []
    try:
        words = page.get_text("words")
    except Exception as e:
        print(f"Word extraction error: {e}")

    # 1. Detect symmetric left & right acoustic reflector wings (側面反響板)
    wing_cands = [
        r for r in draws
        if 25.0 <= r.width <= 0.16 * page_w
        and 0.12 * page_h <= r.height <= 0.65 * page_h
        and r.y0 >= 0.12 * page_h
        and r.y1 <= 0.90 * page_h
    ]
    sym_wings = []
    for i, l_cand in enumerate(wing_cands):
        for r_cand in wing_cands[i + 1:]:
            left, right = (l_cand, r_cand) if l_cand.x0 < r_cand.x0 else (r_cand, l_cand)
            if (
                right.x0 - left.x1 >= 0.25 * page_w
                and abs(left.y0 - right.y0) <= 15.0
                and abs(left.y1 - right.y1) <= 15.0
                and abs(left.width - right.width) <= 15.0
                and abs(left.height - right.height) <= 15.0
            ):
                sym_wings.append(left)
                sym_wings.append(right)

    chosen = None
    if sym_wings:
        sx0, sy0, sx1, sy1 = _union_bounds([(w.x0, w.y0, w.x1, w.y1) for w in sym_wings])
        cx = (sx0 + sx1) / 2.0

        # Include back reflector bar (正面反響板) immediately above/connecting the wings
        for r in draws:
            if (
                0.25 * page_w <= r.width <= 0.75 * page_w
                and r.height <= 25.0
                and sy0 - 45.0 <= r.y0 <= sy0 + 20.0
                and abs(((r.x0 + r.x1) / 2.0) - cx) <= 45.0
            ):
                sx0, sy0, sx1, sy1 = _union_bounds([(sx0, sy0, sx1, sy1), (r.x0, r.y0, r.x1, r.y1)])

        # Peripheral header boundary (horizontally overlapping the stage shell)
        header_y1 = 0.08 * page_h
        for w in words:
            wr = fitz.Rect(w[:4])
            txt = w[4]
            if wr.y1 < sy0 - 2.0 and wr.x0 < sx1 and wr.x1 > sx0:
                if any(k in txt for k in (
                    "プログラム", "部門", "団体名", "出演順", "出演番号", "配置図",
                    "セッティング表", "重奏", "立奏", "座奏", "をつける", "記入して"
                )):
                    header_y1 = max(header_y1, wr.y1 + 5.0)
        for r in draws:
            if r.y1 < sy0 - 2.0 and r.x0 < sx1 and r.x1 > sx0:
                if r.width >= 0.30 * page_w and r.height <= 50.0 and r.y1 <= 150.0:
                    header_y1 = max(header_y1, r.y1 + 5.0)

        # Peripheral footer boundary (horizontally overlapping the stage shell)
        footer_y0 = 0.96 * page_h
        for r in draws:
            if r.y0 > sy1 + 5.0 and r.x0 < sx1 - 20.0 and r.x1 > sx0 + 20.0:
                if r.width >= 0.25 * page_w and (r.height >= 18.0 or r.y0 > sy1 + 35.0):
                    has_footer_word = any(
                        w[1] >= r.y0 - 4.0 and w[3] <= r.y0 + 35.0 and w[0] < sx1 and w[2] > sx0
                        and any(k in w[4] for k in ("伝達事項", "備考", "マイク", "前団体", "打楽器は"))
                        for w in words
                    )
                    if has_footer_word or r.y0 > 0.86 * page_h:
                        footer_y0 = min(footer_y0, r.y0 - 4.0)
        for w in words:
            wr = fitz.Rect(w[:4])
            txt = w[4]
            if wr.y0 > sy1 + 15.0 and wr.x0 < sx1 and wr.x1 > sx0:
                if any(k in txt for k in ("伝達事項", "備考", "打楽器はできるかぎり", "マイク・マイクスタンド", "前団体と共通")):
                    footer_y0 = min(footer_y0, wr.y0 - 5.0)

        # Peripheral left/right boxes (equipment tables, tally boxes, rental boxes, legends)
        periph_side_rects = []
        for r in draws:
            if r.width >= 38.0 and r.height >= 16.0:
                if (r.x1 <= sx0 + 40.0 and r.x0 < sx0 - 25.0) or (r.x0 >= sx1 - 35.0 and r.x1 > sx1 + 35.0):
                    if not any(abs(r.x0 - sw.x0) < 5.0 and abs(r.y0 - sw.y0) < 5.0 for sw in sym_wings):
                        periph_side_rects.append(r)

        stage_boxes = [(sx0, sy0, sx1, sy1)]

        # First pass: include wide centered stage lines / risers / stage front line
        for r in draws:
            if r.y0 < header_y1 or r.y1 > footer_y0:
                continue
            if any(r.intersects(ps) and r.x0 >= ps.x0 - 5.0 and r.x1 <= ps.x1 + 5.0 for ps in periph_side_rects):
                continue
            rcx = (r.x0 + r.x1) / 2.0
            if r.width >= 0.25 * page_w and r.height <= 0.30 * page_h and abs(rcx - cx) <= 65.0:
                if r.x0 >= sx0 - 40.0 and r.x1 <= sx1 + 40.0:
                    stage_boxes.append((r.x0, r.y0, r.x1, r.y1))

        cur_x0, cur_y0, cur_x1, cur_y1 = _union_bounds(stage_boxes)

        # Second pass: include connected stage drawings (apron, podium, stage house, stairs)
        for r in draws:
            if r.y0 < header_y1 or r.y1 > footer_y0:
                continue
            if r.x0 < 0 or r.x1 > page_w:
                continue
            if any(r.intersects(ps) and (r.x0 >= sx1 - 30.0 or r.x1 <= sx0 + 30.0) for ps in periph_side_rects):
                continue
            if r.x0 >= cur_x0 - 15.0 and r.x1 <= cur_x1 + 28.0:
                if r.y0 >= header_y1 + 2.0 and r.y1 <= footer_y0 - 2.0:
                    if r.width <= (cur_x1 - cur_x0) + 40.0 and r.height <= 0.45 * page_h:
                        stage_boxes.append((r.x0, r.y0, r.x1, r.y1))

        cur_x0, cur_y0, cur_x1, cur_y1 = _union_bounds(stage_boxes)

        # Include stage direction labels (下手側, 上手側, 客席) immediately adjacent to stage
        for w in words:
            wr = fitz.Rect(w[:4])
            txt = w[4]
            if any(k in txt for k in ("下手", "上手", "客席")) and header_y1 <= wr.y0 and wr.y1 <= footer_y0:
                if cur_x0 - 25.0 <= wr.x0 and wr.x1 <= cur_x1 + 25.0:
                    stage_boxes.append((wr.x0, wr.y0, wr.x1, wr.y1))

        cur_x0, cur_y0, cur_x1, cur_y1 = _union_bounds(stage_boxes)

        # Include non-white raster stage graphics (e.g. architectural stage house wall) between header_y1 and cur_y0
        try:
            pix_72 = page.get_pixmap(dpi=72)
            img_72 = np.frombuffer(pix_72.samples, dtype=np.uint8).reshape((pix_72.height, pix_72.width, pix_72.n))
            gray_72 = cv2.cvtColor(img_72, cv2.COLOR_RGBA2GRAY if pix_72.n == 4 else cv2.COLOR_RGB2GRAY)
            sx0_i, sx1_i = max(0, int(cur_x0)), min(pix_72.width, int(cur_x1))
            hy_i, cy0_i = max(0, int(header_y1 + 6)), min(pix_72.height, int(cur_y0))
            if cy0_i > hy_i and sx1_i > sx0_i:
                roi = gray_72[hy_i:cy0_i, sx0_i:sx1_i]
                dark_rows = np.where(np.sum(roi < 220, axis=1) > 15)[0]
                if len(dark_rows) > 0:
                    cur_y0 = min(cur_y0, float(hy_i + dark_rows[0]))
        except Exception as e:
            print(f"Raster stage top check error: {e}")

        pad = 6.0
        x0 = max(4.0, cur_x0 - pad)
        y0 = max(header_y1, cur_y0 - pad)
        x1 = min(page_w - 4.0, cur_x1 + pad)
        y1 = min(footer_y0, cur_y1 + pad)
        chosen = (x0, y0, x1 - x0, y1 - y0)

    # 2. Fallback for sheets without symmetric angled wings
    if chosen is None:
        # Determine peripheral equipment table bound if present
        right_limit = page_w * 0.96
        for w in words:
            if w[4] in ("品名", "記号") and w[0] > 0.55 * page_w:
                right_limit = min(right_limit, w[0] - 16.0)

        best_table = None
        best_table_area = 0
        try:
            tables = page.find_tables()
            for t in tables.tables:
                bx0, by0, bx1, by1 = t.bbox
                w = bx1 - bx0
                h = by1 - by0
                area = w * h
                # Reject page-spanning outer frames or tables overlapping header/equipment columns
                if (
                    0.15 * page_area <= area <= 0.65 * page_area
                    and 0.30 * page_w <= w <= 0.82 * page_w
                    and 0.25 * page_h <= h <= 0.72 * page_h
                    and by0 >= 0.14 * page_h
                    and by1 <= 0.88 * page_h
                    and bx1 <= right_limit + 10.0
                ):
                    if area > best_table_area:
                        best_table_area = area
                        best_table = (bx0, by0, w, h)
        except Exception as e:
            print(f"Table detection error: {e}")

        if best_table:
            chosen = best_table
        else:
            chosen = (page_w * 0.08, page_h * 0.18, min(page_w * 0.84, right_limit - page_w * 0.08), page_h * 0.68)

    x, y, w, h = chosen
    return {
        "x": round(x * zoom, 1),
        "y": round(y * zoom, 1),
        "width": round(w * zoom, 1),
        "height": round(h * zoom, 1)
    }

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
            
        # Get first page and normalize rotation so text/drawing/image coordinates match visual pixmap
        page = doc[0]
        if page.rotation != 0:
            page.remove_rotation()
        
        # Render page to an image (PNG)
        # Using a matrix to increase resolution (e.g., zoom factor 2)
        zoom = 2.0
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)
        
        image_filename = f"{file_id}_page1.png"
        image_path = os.path.join(STATIC_DIR, image_filename)
        pix.save(image_path)
        
        auto_stage_region = detect_stage_region(page, zoom=zoom)
        doc.close()
        
        return {
            "file_id": file_id,
            "image_url": f"/static/{image_filename}",
            "width": pix.width,
            "height": pix.height,
            "auto_stage_region": auto_stage_region
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
STANDALONE_STOP_WORDS = {"要", "不要", "有", "無", "閉", "半開", "半半開", "全開", "蒲鉾板", "立奏", "座奏", "蓋"}
NON_ICON_1CHAR = set("品名記号要不有無閉開本脚台個枚組式張対番部門団体客席数等印") | set("0123456789")

def classify_equipment_label(raw_text: str):
    """
    Universal semantic equipment classifier.
    Decomposes Japanese competition equipment strings into role + core category,
    returning (canonical_label, category_key) or None if the text is a header/unit/note.
    """
    import re as _re
    t = clean_japanese_text(raw_text).strip()
    if t.startswith(("※", "＊")):
        return None
    t = _re.sub(r'^[0-9０-９①-⑳・\*\-\s\.]+', '', t).strip()
    t = _re.sub(r'[=＝:：→⇒…‥\(\)（）\[\]［］【】]+$', '', t).strip()
    if not t:
        return None

    ignore_exact = {
        "品名", "記号", "品名記号", "品名/記号", "使用備品", "備品名", "備品",
        "要", "不要", "要・不要", "不要・要", "個数", "数量", "使用数", "個数等",
        "要・不要/個数等", "備考", "番号", "No", "No.", "凡例", "記載例",
        "閉", "蒲鉾板", "カマボコ", "ｶﾏﾎﾞｺ", "半開", "半半開", "全開", "立奏", "座奏",
        "本", "脚", "台", "個", "枚", "組", "式", "張", "対", "有", "無",
        "借用品", "借用楽器等", "○印", "印", "をつける", "○をつける", "伝達事項", "ステージ配置図",
        "団体名", "出演番号", "部門", "プログラム", "番", "客席", "下手側", "上手側",
        "下手", "上手", "待機場所", "次の団体", "本部", "ふりがな", "指揮者氏名",
        "ピアノ蓋", "ピアノの蓋", "蓋", "反響板", "合計使用数", "合計"
    }
    if t in ignore_exact or len(t) > 16:
        return None
    if any(k in t for k in ["ください", "提出", "コピー", "原則", "場合", "貸出可能", "借用楽器", "サイズ", "をつける", "別も忘れず", "の使用", "使用数", "借用する", "借用しない", "使わない"]):
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
    # 12. Chime / Tubular bells (チャイム / チューブラーベル)
    if any(k in t for k in ["チャイム", "チューブラーベル"]):
        return ("チャイム", "chime")
    # 13. Gong / Tam-tam (ドラ / 銅鑼 / ゴング / タムタム)
    if t in ("ドラ", "銅鑼", "ゴング", "タムタム"):
        return ("ドラ", "gong")
    # 14. Stage platform / risers (平台 / ひな壇 / 立奏台)
    if any(k in t for k in ["平台", "ひな壇", "雛壇", "立奏台", "ステージ台", "箱馬"]):
        return (t, f"dyn_{t}")

    return None

def extract_all_lines(page):
    """
    Extract vertical and horizontal lines from page vector drawings,
    supporting path segments ('l') and rectangle strokes ('re') as well as thin filled rects.
    """
    v_lines = []
    h_lines = []
    for d in page.get_drawings():
        r = fitz.Rect(d["rect"])
        if r.width <= 3.5 and r.height >= 10.0:
            v_lines.append(((r.x0 + r.x1) / 2.0, r.y0 - 2.0, r.y1 + 2.0))
        if r.height <= 3.5 and r.width >= 10.0:
            h_lines.append(((r.y0 + r.y1) / 2.0, r.x0 - 2.0, r.x1 + 2.0))
        for it in d.get("items", []):
            if it[0] == "l":
                p1, p2 = it[1], it[2]
                if abs(p1.x - p2.x) <= 2.0 and abs(p1.y - p2.y) >= 10.0:
                    v_lines.append(((p1.x + p2.x) / 2.0, min(p1.y, p2.y) - 2.0, max(p1.y, p2.y) + 2.0))
                elif abs(p1.y - p2.y) <= 2.0 and abs(p1.x - p2.x) >= 10.0:
                    h_lines.append(((p1.y + p2.y) / 2.0, min(p1.x, p2.x) - 2.0, max(p1.x, p2.x) + 2.0))
            elif it[0] == "re":
                rect = fitz.Rect(it[1])
                if rect.height >= 10.0 and rect.width >= 10.0:
                    v_lines.append((rect.x0, rect.y0 - 2.0, rect.y1 + 2.0))
                    v_lines.append((rect.x1, rect.y0 - 2.0, rect.y1 + 2.0))
                    h_lines.append((rect.y0, rect.x0 - 2.0, rect.x1 + 2.0))
                    h_lines.append((rect.y1, rect.x0 - 2.0, rect.x1 + 2.0))
    v_lines.sort(key=lambda v: v[0])
    h_lines.sort(key=lambda h: h[0])
    return v_lines, h_lines

def tokenize_pdf_region(page, clip_rect: Optional[fitz.Rect] = None):
    """
    Tokenize PDF page (or clipped region) at the character level.
    Reconstructs justified/character-spaced words (e.g. '指 揮 台', '長 机') within table cells,
    while separating inline delimiters ('=', '→', '：', '(', ')') and symbol glyphs ('○', '◎', '×').
    """
    v_lines, _ = extract_all_lines(page)

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
                    raw_c = c.get("c", "")
                    if raw_c in ("\u3099", "\u309a", "゛", "゜", "ﾞ", "ﾟ") and chars:
                        comb = "\u3099" if raw_c in ("\u3099", "゛", "ﾞ") else "\u309a"
                        r_comb = fitz.Rect(c["bbox"])
                        if abs(((r_comb.y0 + r_comb.y1) / 2.0) - chars[-1]["y_mid"]) < 10.0 and (r_comb.x0 - chars[-1]["rect"].x1) < 8.0:
                            chars[-1]["ch"] = unicodedata.normalize("NFC", chars[-1]["ch"] + comb)
                            chars[-1]["rect"] |= r_comb
                            chars[-1]["w"] = max(1.0, chars[-1]["rect"].width)
                            continue
                    ch = clean_japanese_text(raw_c)
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
                    if gap <= tight_thresh and prev["text"] != "蓋":
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

    # Reconstruct vertically stacked short equipment or form labels (e.g. '電'+'源' -> '電源', 'ピ'+'ア'+'ノ' -> 'ピアノ', '団'+'体'+'名' -> '団体名')
    VERT_EQUIPMENT_WORDS = {
        "電源", "ピアノ", "チャイム", "ドラ", "銅鑼", "指揮台", "譜面台", "椅子", "長机", "マイク",
        "部門", "団体名", "学校名", "バンド名", "出演順", "出演番号", "出場順", "出場番号", "受付番号",
        "出演者名", "出演者", "指揮者", "指揮者名", "指揮者氏名", "代表者名", "ふりがな", "フリガナ", "備考",
    }
    tok_id = 0
    for l in lines:
        for t in l["tokens"]:
            t["id"] = tok_id
            tok_id += 1

    consumed_ids = set()
    n_lines = len(lines)
    for l_i in range(n_lines):
        for tok in lines[l_i]["tokens"]:
            if tok["id"] in consumed_ids or tok["type"] != "WORD" or len(tok["text"]) > 2:
                continue
            chain = [(l_i, tok)]
            cur_rect = fitz.Rect(tok["rect"])
            cur_cx = (cur_rect.x0 + cur_rect.x1) / 2.0
            for next_l in range(l_i + 1, min(n_lines, l_i + 6)):
                found_next = None
                for ntok in lines[next_l]["tokens"]:
                    if ntok["id"] in consumed_ids or ntok["type"] != "WORD" or len(ntok["text"]) > 2:
                        continue
                    nr = ntok["rect"]
                    ncx = (nr.x0 + nr.x1) / 2.0
                    v_gap = nr.y0 - cur_rect.y1
                    if abs(ncx - cur_cx) <= 6.0 and -2.0 <= v_gap <= 14.0:
                        found_next = (next_l, ntok)
                        break
                if found_next:
                    chain.append(found_next)
                    cur_rect = cur_rect | found_next[1]["rect"]
                    joined_so_far = "".join(item[1]["text"] for item in chain)
                    if joined_so_far in VERT_EQUIPMENT_WORDS or classify_equipment_label(joined_so_far):
                        break
                elif lines[next_l]["y_mid"] - cur_rect.y1 > 16.0:
                    break
            if len(chain) >= 2:
                joined_txt = "".join(item[1]["text"] for item in chain)
                if joined_txt in VERT_EQUIPMENT_WORDS or classify_equipment_label(joined_txt):
                    u_rect = fitz.Rect(chain[0][1]["rect"])
                    u_chars = []
                    for _, ch_tok in chain:
                        u_rect |= ch_tok["rect"]
                        u_chars.extend(ch_tok["chars"])
                        consumed_ids.add(ch_tok["id"])
                    chain[0][1]["text"] = joined_txt
                    chain[0][1]["rect"] = u_rect
                    chain[0][1]["chars"] = u_chars
                    consumed_ids.remove(chain[0][1]["id"])

    for l in lines:
        l["tokens"] = [t for t in l["tokens"] if t["id"] not in consumed_ids]

    return lines

def extract_piano_lid_options(page, tokenized_lines: Optional[list] = None) -> List[str]:
    """
    Extracts piano lid state options printed on the PDF form (e.g. ['閉', '蒲鉾板', '半開', '全開'] or ['全開', '半開', 'カマボコ', '閉']).
    Returns an empty list if no piano lid field/choices exist on the page.
    """
    import re as _re
    if tokenized_lines is None:
        tokenized_lines = tokenize_pdf_region(page)
    for line in tokenized_lines:
        toks = line["tokens"]
        full_line_text = unicodedata.normalize("NFC", "".join(t["text"] for t in toks))
        if any(skip_kw in full_line_text for skip_kw in [
            "（注）", "(注)", "原則禁止", "お借りします", "ご相談ください",
            "提出書類", "記入してください", "明記してください", "忘れずに"
        ]):
            continue
        lid_anchor = None
        other_anchors_x = []
        for t_idx, tok in enumerate(toks):
            if tok["type"] != "WORD":
                continue
            t_text = unicodedata.normalize("NFC", tok["text"])
            tr = tok["rect"]
            is_lid = (
                ("ピアノ" in t_text and ("蓋" in t_text or "屋根" in t_text))
                or t_text in ("ピアノの蓋", "ピアノ蓋", "ピアノの屋根", "ピアノ屋根")
                or (t_text in ("蓋", "屋根") and any(kw in full_line_text for kw in ("全開", "半開", "半半開", "閉", "カマボコ", "蒲鉾")))
            )
            if is_lid and lid_anchor is None:
                lid_anchor = (t_idx, tr)
                continue
            sem = classify_equipment_label(t_text)
            if sem or t_text in ("立奏", "座奏", "反響板"):
                other_anchors_x.append(tr.x0)
        if lid_anchor is not None:
            lid_idx, lid_rect = lid_anchor
            right_bound = min([x for x in other_anchors_x if x > lid_rect.x1], default=99999.0)
            options = []
            for tok in toks[lid_idx + 1:]:
                if tok["rect"].x0 >= right_bound - 18.0:
                    break
                if tok["type"] != "WORD":
                    continue
                w = unicodedata.normalize("NFC", clean_japanese_text(tok["text"])).strip()
                if not w or _re.match(r"^[0-9０-９①-⑳\.]+$", w):
                    continue
                if w in ("要", "不要", "有", "無", "使用", "不使用", "ピアノ", "蓋", "屋根", "の"):
                    continue
                if w not in options:
                    options.append(w)
            if options:
                return options
    return []

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
        if page.rotation != 0:
            page.remove_rotation()
        
        zoom = 2.0  
        background_url = ""
        icon_urls = []
        icons_region_url = ''
        extracted_icons = []
        bg_rect_points: Optional[fitz.Rect] = None
        
        for region in req.regions:
            if region.type == "background":
                c = region.crop
                bg_rect_points = fitz.Rect(
                    c.x / zoom,
                    c.y / zoom,
                    (c.x + c.width) / zoom,
                    (c.y + c.height) / zoom
                )
                bg_zoom = 2.0
                mat = fitz.Matrix(bg_zoom, bg_zoom)
                pix = page.get_pixmap(matrix=mat, clip=bg_rect_points)
                bg_filename = f"{req.file_id}_bg.png"
                bg_path = os.path.join(STATIC_DIR, bg_filename)
                pix.save(bg_path)
                background_url = f"/static/{bg_filename}"
                break

        if bg_rect_points is None:
            auto_reg = detect_stage_region(page, zoom=1.0)
            bg_rect_points = fitz.Rect(
                auto_reg["x"],
                auto_reg["y"],
                auto_reg["x"] + auto_reg["width"],
                auto_reg["y"] + auto_reg["height"]
            )
            bg_zoom = 2.0
            mat = fitz.Matrix(bg_zoom, bg_zoom)
            pix = page.get_pixmap(matrix=mat, clip=bg_rect_points)
            bg_filename = f"{req.file_id}_bg.png"
            bg_path = os.path.join(STATIC_DIR, bg_filename)
            pix.save(bg_path)
            background_url = f"/static/{bg_filename}"

        # Use explicit 'icons' region if provided, otherwise automatically scan outside the stage diagram
        icons_region_item = next((r for r in req.regions if r.type == "icons"), None)
        is_auto_icons = icons_region_item is None
        if icons_region_item is not None:
            ic_crop = icons_region_item.crop
            rect_points = fitz.Rect(
                ic_crop.x / zoom,
                ic_crop.y / zoom,
                (ic_crop.x + ic_crop.width) / zoom,
                (ic_crop.y + ic_crop.height) / zoom
            )
        else:
            rect_points = fitz.Rect(page.rect)

        bg_excl: Optional[fitz.Rect] = None
        if is_auto_icons and bg_rect_points is not None:
            bg_excl = fitz.Rect(
                bg_rect_points.x0 + 4.0,
                bg_rect_points.y0 + 4.0,
                bg_rect_points.x1 - 4.0,
                bg_rect_points.y1 - 4.0
            )

        def is_inside_bg(r: fitz.Rect) -> bool:
            if bg_excl is None:
                return False
            cx = (r.x0 + r.x1) / 2.0
            cy = (r.y0 + r.y1) / 2.0
            return bg_excl.x0 <= cx <= bg_excl.x1 and bg_excl.y0 <= cy <= bg_excl.y1

        if True:
                import time
                cache_buster = str(int(time.time()))
                
                page_words = page.get_text("words")
                tokenized_lines = tokenize_pdf_region(page, rect_points)

                # Detect '記号' and '品名' column headers BEFORE masking so an explicit equipment table
                # is never accidentally suppressed even if the stage crop box slightly overlaps it
                sym_col_bounds = None
                label_col_bounds = None
                equip_header_rects = []
                for line in tokenized_lines:
                    for tok in line["tokens"]:
                        if tok["text"] in ("記号", "図"):
                            sym_col_bounds = (tok["rect"].x0 - 18.0, tok["rect"].x1 + 18.0)
                            equip_header_rects.append(tok["rect"])
                        elif tok["text"] in ("品名", "備品", "備品名", "使用備品"):
                            label_col_bounds = (tok["rect"].x0 - 25.0, tok["rect"].x1 + 25.0)
                            equip_header_rects.append(tok["rect"])
                    if sym_col_bounds:
                        break

                def is_in_equip_table(r: fitz.Rect) -> bool:
                    if sym_col_bounds is None:
                        return False
                    x0_lim = (label_col_bounds[0] - 15.0) if label_col_bounds else (sym_col_bounds[0] - 95.0)
                    x1_lim = sym_col_bounds[1] + 20.0
                    cx = (r.x0 + r.x1) / 2.0
                    return x0_lim <= cx <= x1_lim

                icon_zoom = 4.0
                mat = fitz.Matrix(icon_zoom, icon_zoom)
                
                # Render high-resolution scan region image
                pix_region = page.get_pixmap(matrix=mat, clip=rect_points)
                region_filename = f"{req.file_id}_icons_region_{cache_buster}.png"
                region_path = os.path.join(STATIC_DIR, region_filename)
                region_clean_path = os.path.join(STATIC_DIR, f"{req.file_id}_icons_region_notext_{cache_buster}.png")
                if not is_auto_icons:
                    pix_region.save(region_path)
                    pix_region.save(region_clean_path)
                    icons_region_url = f"/static/{region_filename}"

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

                # In auto-scan mode, mask out the stage diagram region so stage graphics are never picked up,
                # while preserving any explicit '記号' column if bg_rect_points slightly overlaps it
                if bg_rect_points is not None and is_auto_icons:
                    saved_sym_col = None
                    if sym_col_bounds is not None:
                        sx0_p = max(0, int((sym_col_bounds[0] - rect_points.x0) * icon_zoom))
                        sx1_p = min(pix_region.width, int((sym_col_bounds[1] - rect_points.x0) * icon_zoom))
                        if sx1_p > sx0_p:
                            saved_sym_col = (sx0_p, sx1_p, no_grid[:, sx0_p:sx1_p].copy())
                    bx0 = max(0, int((bg_rect_points.x0 - rect_points.x0) * icon_zoom))
                    bx1 = min(pix_region.width, int((bg_rect_points.x1 - rect_points.x0) * icon_zoom))
                    by0 = max(0, int((bg_rect_points.y0 - rect_points.y0) * icon_zoom))
                    by1 = min(pix_region.height, int((bg_rect_points.y1 - rect_points.y0) * icon_zoom))
                    if bx1 > bx0 and by1 > by0:
                        no_grid[by0:by1, bx0:bx1] = 0
                    if saved_sym_col is not None:
                        no_grid[:, saved_sym_col[0]:saved_sym_col[1]] = saved_sym_col[2]

                candidate_boxes = []
                inline_sym_rects = []
                associated_label_rects = []
                consumed_tokens = set()  # (line_idx, tok_idx)

                def is_valid_symbol_token(tok):
                    if tok["type"] == "SYMBOL":
                        return True
                    if tok["type"] == "WORD" and len(tok["text"]) == 1 and tok["text"] not in NON_ICON_1CHAR:
                        return True
                    return False

                # Mode A: Inline Key-Value / Delimiter / Parenthesized Legend (e.g. '椅子=○', '椅子→○', '○：椅子', '椅子(○)')
                # Explicit [Label][Delim][Symbol] pairs (A1, A2, A3) are never stage-interior placed symbols,
                # so they are exempt from is_inside_bg in case the stage box overlapped the legend
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
                                associated_label_rects.append(toks[t_idx]["rect"] | dr | sym_box)
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
                                associated_label_rects.append(sym_box | dr | toks[t_idx + 2]["rect"])
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
                                associated_label_rects.append(toks[t_idx]["rect"] | toks[t_idx + 3]["rect"])
                                consumed_tokens.update({(l_idx, t_idx), (l_idx, t_idx + 1), (l_idx, t_idx + 2), (l_idx, t_idx + 3)})
                                continue

                # Pattern A4 fallback (only if no explicit legend pairs A1/A2/A3 were found and no '記号' table exists): [SYMBOL] [WORD(label)] '(' ')'
                if not inline_sym_rects and sym_col_bounds is None:
                    for l_idx, line in enumerate(tokenized_lines):
                        toks = line["tokens"]
                        n_toks = len(toks)
                        for t_idx in range(n_toks):
                            if (l_idx, t_idx) in consumed_tokens or is_inside_bg(toks[t_idx]["rect"]):
                                continue
                            if (
                                t_idx + 3 < n_toks
                                and is_valid_symbol_token(toks[t_idx])
                                and toks[t_idx + 1]["type"] == "WORD"
                                and toks[t_idx + 2]["text"] in ("(", "（")
                                and toks[t_idx + 3]["text"] in (")", "）")
                                and (toks[t_idx + 1]["rect"].x0 - toks[t_idx]["rect"].x1) < 16.0
                            ):
                                eq = classify_equipment_label(toks[t_idx + 1]["text"])
                                if eq:
                                    sr = toks[t_idx]["rect"]
                                    lr = toks[t_idx + 1]["rect"]
                                    pad = 2.0
                                    x0 = sr.x0 - pad
                                    if t_idx > 0:
                                        x0 = max(toks[t_idx - 1]["rect"].x1 + 1.0, x0)
                                    x1 = min(lr.x0 - 0.5, sr.x1 + pad)
                                    sym_box = fitz.Rect(x0, sr.y0 - pad, x1, sr.y1 + pad)
                                    candidate_boxes.append((sym_box, eq[0], "inline_sym"))
                                    inline_sym_rects.append(sym_box)
                                    associated_label_rects.append(sym_box | lr)
                                    consumed_tokens.update({(l_idx, t_idx), (l_idx, t_idx + 1)})

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

                # Remove oversized graphical structures (e.g. stage walls, large boxes) and tiny specks from no_grid_no_text
                num_labels, cc_labels, cc_stats, _ = cv2.connectedComponentsWithStats(no_grid_no_text, connectivity=8)
                for lbl_i in range(1, num_labels):
                    cw = cc_stats[lbl_i, cv2.CC_STAT_WIDTH]
                    ch = cc_stats[lbl_i, cv2.CC_STAT_HEIGHT]
                    carea = cc_stats[lbl_i, cv2.CC_STAT_AREA]
                    if (
                        carea < 12
                        or cw > int(65 * icon_zoom)
                        or ch > int(48 * icon_zoom)
                        or (cw >= int(16 * icon_zoom) and ch <= int(3 * icon_zoom))
                        or (ch >= int(16 * icon_zoom) and cw <= int(3 * icon_zoom))
                    ):
                        no_grid_no_text[cc_labels == lbl_i] = 0

                # Mode B, Mode C & Mode D: Raster images, Table row-based & vector drawing search
                # Skip when auto-detect already found an explicit inline symbol legend (e.g. '椅子=○', '譜面台=×') and there is no '記号' table column
                if not (is_auto_icons and len(inline_sym_rects) >= 2 and sym_col_bounds is None):
                    # Mode B: Raster Images in rect_points
                    raw_images = page.get_image_info(xrefs=True)
                    for img in raw_images:
                        b = fitz.Rect(img['bbox'])
                        if b.intersects(rect_points) and (not is_inside_bg(b) or is_in_equip_table(b)):
                            if 6 <= b.width <= 160 and 6 <= b.height <= 160:
                                # If '記号' column is present in auto mode, only accept raster icons aligned with '記号' column
                                if is_auto_icons and sym_col_bounds is not None:
                                    bcx = (b.x0 + b.x1) / 2.0
                                    if not (sym_col_bounds[0] - 12.0 <= bcx <= sym_col_bounds[1] + 12.0):
                                        continue
                                # Skip raster images that are actually text-boxes (contain selectable words of len >= 2 inside bbox)
                                has_word_inside = any(
                                    tok["type"] == "WORD" and len(tok["text"]) >= 2 and b.intersects(tok["rect"])
                                    for line in tokenized_lines
                                    for tok in line["tokens"]
                                )
                                if has_word_inside:
                                    continue
                                lbl = extract_label_for_icon(b, page_words, tokenized_lines)
                                if lbl or not is_auto_icons:
                                    candidate_boxes.append((b, lbl, 'raster'))

                    # Mode C: Table row-based search
                    for l_idx, line in enumerate(tokenized_lines):
                        toks = line["tokens"]
                        line_txt = "".join(t["text"] for t in toks)
                        if sym_col_bounds is None and any(kw in line_txt for kw in ("借用する", "借用しない", "使う", "使わない")):
                            continue
                        for t_idx, tok in enumerate(toks):
                            if (l_idx, t_idx) in consumed_tokens or tok["type"] != "WORD":
                                continue
                            if is_inside_bg(tok["rect"]) and not is_in_equip_table(tok["rect"]):
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
                                        associated_label_rects.append(r)
                                        break

                    # Mode D: Vector drawings fallback / supplement (filtering out cell border segments)
                    drawings = page.get_drawings()
                    drawing_rects = []
                    for d in drawings:
                        r = fitz.Rect(d['rect'])
                        if not r.intersects(rect_points):
                            continue
                        if bg_excl is not None and r.intersects(bg_excl) and not is_in_equip_table(r):
                            continue
                        if is_auto_icons and sym_col_bounds is not None and not is_in_equip_table(r):
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
                                md_ymid = (md.y0 + md.y1) / 2.0
                                already_found_in_row = any(
                                    clbl == lbl and abs(((cb.y0 + cb.y1) / 2.0) - md_ymid) < 16.0
                                    for cb, clbl, _ in candidate_boxes
                                )
                                if not already_found_in_row:
                                    candidate_boxes.append((md, lbl, 'drawing'))

                # Deduplicate overlapping candidate boxes and avoid duplicate icons for the same equipment label in auto mode
                unique_candidates = []
                seen_auto_labels = set()
                for b, lbl, typ in candidate_boxes:
                    if is_auto_icons and lbl and lbl in seen_auto_labels:
                        continue
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
                                    if is_auto_icons:
                                        seen_auto_labels.add(lbl)
                                break
                    if not overlap:
                        final_lbl = lbl or extract_label_for_icon(b, page_words, tokenized_lines)
                        if is_auto_icons and final_lbl and final_lbl in seen_auto_labels:
                            continue
                        if final_lbl:
                            seen_auto_labels.add(final_lbl)
                        unique_candidates.append((b, final_lbl, typ))

                # If icons region was auto-detected, crop icons_region_url tightly around the detected legend/table
                if is_auto_icons:
                    if unique_candidates:
                        u_rect = fitz.Rect(unique_candidates[0][0])
                        for b, _, _ in unique_candidates[1:]:
                            u_rect = u_rect | b
                        for lr in associated_label_rects:
                            u_rect = u_rect | lr
                        for hr in equip_header_rects:
                            u_rect = u_rect | hr
                        # Include same-row equipment label tokens directly adjacent to candidate icons
                        for line in tokenized_lines:
                            for tok in line["tokens"]:
                                tr = tok["rect"]
                                if is_inside_bg(tr) and not is_in_equip_table(tr):
                                    continue
                                if classify_equipment_label(tok["text"]):
                                    near_cand = any(
                                        abs(((tr.y0 + tr.y1) - (b.y0 + b.y1)) / 2.0) < 12.0
                                        and min(abs(tr.x1 - b.x0), abs(tr.x0 - b.x1), abs(tr.x0 - b.x0)) < 90.0
                                        for b, _, _ in unique_candidates
                                    )
                                    if near_cand:
                                        u_rect = u_rect | tr
                        # If the legend/table is enclosed by a tight border box, expand to include the box frame
                        try:
                            for d in page.get_drawings():
                                dr = fitz.Rect(d["rect"])
                                if (
                                    dr.x0 <= u_rect.x0 + 4.0
                                    and dr.y0 <= u_rect.y0 + 4.0
                                    and dr.x1 >= u_rect.x1 - 4.0
                                    and dr.y1 >= u_rect.y1 - 4.0
                                    and dr.width <= u_rect.width + 150.0
                                    and dr.height <= u_rect.height + 32.0
                                ):
                                    u_rect = u_rect | dr
                        except Exception:
                            pass
                        pad_x, pad_y = 14.0, 10.0
                        rect_points = fitz.Rect(
                            max(page.rect.x0, u_rect.x0 - pad_x),
                            max(page.rect.y0, u_rect.y0 - pad_y),
                            min(page.rect.x1, u_rect.x1 + pad_x),
                            min(page.rect.y1, u_rect.y1 + pad_y)
                        )
                    else:
                        rect_points = fitz.Rect(page.rect)

                    pix_region = page.get_pixmap(matrix=mat, clip=rect_points)
                    pix_region.save(region_path)
                    pix_region.save(region_clean_path)
                    icons_region_url = f"/static/{region_filename}"

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
                    
        piano_lid_options = extract_piano_lid_options(page)
        doc.close()
        
        icon_labels = {icon["id"]: icon["label"] for icon in extracted_icons if icon.get("label")}
        
        return {
            "background_url": background_url,
            "icons_region_url": icons_region_url,
            "extracted_icons": extracted_icons,
            "icon_labels": icon_labels,
            "piano_lid_options": piano_lid_options
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
    positions: Optional[List[List[float]]] = None

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
        if page.rotation != 0:
            page.remove_rotation()

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
            {
                "key": "chime",
                "names": ["チャイム", "チューブラーベル", "Chime"],
                "tmpls": ["tmpl_chime"],
                "neg": [],
            },
            {
                "key": "gong",
                "names": ["ドラ", "銅鑼", "ゴング", "タムタム", "Gong"],
                "tmpls": ["tmpl_gong"],
                "neg": ["ドラム"],
            },
        ]

        # 1. ユーザーの配置パーツ群を照合（定型定義 STD_DEFS ＋ 意味分類器 ＋ 動的定義 DYNAMIC_DEFS）
        import re as _re
        assigned_counts = {d["key"]: 0 for d in STD_DEFS}
        assigned_positions = {d["key"]: [] for d in STD_DEFS}
        dynamic_defs = {}
        unmapped_tallies = []

        for t in req.tallies:
            c = max(0, int(t.count or 0))
            lbl = clean_japanese_text(t.label or "").strip()
            iid = (t.icon_id or "").strip()
            pos_list = []
            if t.positions:
                for p in t.positions:
                    if isinstance(p, (list, tuple)) and len(p) >= 2:
                        pos_list.append((float(p[0]), float(p[1])))
            if not lbl and not iid:
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
                assigned_positions[best_def["key"]].extend(pos_list)
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
                        assigned_positions[dyn_key] = []
                    assigned_counts[dyn_key] += c
                    assigned_positions[dyn_key].extend(pos_list)
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
            Context-aware '要・不要' / '有・無' / '使用・不使用' / '使う・使わない' / '借用する・借用しない'
            detector using character-level rects.
            Locks negative phrases first so split characters never accidentally circle positive substrings.
            """
            if not cell_chars:
                return False
            joined = "".join(c["ch"] for c in cell_chars)
            # Skip column header strings like '使用有無' or '要・不要/個数等'
            if "有無" in joined or "個数" in joined or "数量" in joined:
                return False
            locked = [False] * len(cell_chars)

            neg_spans = []
            for neg_kw in ("借用しない", "使用しない", "使わない", "不要", "不使用", "無"):
                start = 0
                while True:
                    idx = joined.find(neg_kw, start)
                    if idx == -1:
                        break
                    end_idx = idx + len(neg_kw)
                    if any(locked[k_i] for k_i in range(idx, end_idx)):
                        start = end_idx
                        continue
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
            for pos_kw in ("借用する", "使用する", "使う", "要", "使用", "有"):
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
        total_header_rects = []
        circle_mark_mode = False
        for line in tokenized_lines:
            line_txt = "".join(t["text"] for t in line["tokens"])
            if "○印" in line_txt or "◯印" in line_txt:
                circle_mark_mode = True
            for tok in line["tokens"]:
                if ("合計" in tok["text"] or "総数" in tok["text"]) and len(tok["text"]) <= 8:
                    total_header_rects.append(tok["rect"])
                if tok["text"] in ("数量", "個数", "使用数", "借用数", "必要数") and "要" not in line_txt and "合計" not in line_txt:
                    qty_col_headers.append((tok["rect"].x0 - 15.0, tok["rect"].x1 + 15.0, tok["rect"].y1))

        # Detect stage riser tiers (ひな壇) and enclosure boxes from PDF vector drawings
        drawings = page.get_drawings()
        raw_riser_rects = []
        enclosure_boxes = []
        arrow_segments = []
        for d in drawings:
            r = fitz.Rect(d["rect"])
            if 180 <= r.width <= 450 and 30 <= r.height <= 125 and 120 <= r.x0 <= 350 and 420 <= r.x1 <= 720 and 120 <= r.y0 <= 420:
                raw_riser_rects.append(r)
            elif 45 <= r.width <= 240 and 20 <= r.height <= 120:
                enclosure_boxes.append(r)
            for item in d.get("items", []):
                if item[0] == "l":
                    p1, p2 = item[1], item[2]
                    if abs(p1.x - p2.x) >= 35.0 and abs(p1.y - p2.y) >= 15.0:
                        arrow_segments.append((p1, p2))

        # Deduplicate riser rectangles by approximate Y bounds
        riser_rects = []
        for r in sorted(raw_riser_rects, key=lambda x: x.y0):
            if not riser_rects or abs(r.y0 - riser_rects[-1].y0) > 15.0:
                riser_rects.append(r)

        stage_tier_bands = []
        if len(riser_rects) >= 1:
            for idx_r, rr in enumerate(riser_rects):
                y_top = 0.0 if idx_r == 0 else (riser_rects[idx_r - 1].y1 + rr.y0) / 2.0
                y_bot = (rr.y1 + riser_rects[idx_r + 1].y0) / 2.0 if idx_r + 1 < len(riser_rects) else rr.y1
                stage_tier_bands.append((y_top, y_bot))
            # Floor tier (平床) below the bottom-most riser
            stage_tier_bands.append((riser_rects[-1].y1, page.rect.height))

        piano_lid_setting = clean_japanese_text(req.piano_lid or "半開").strip()
        matched_lid = False
        UNIT_CHARS = ("脚", "本", "台", "個", "枚", "組", "式", "張", "対")
        slots_by_key = {}

        # Step 2: 各行内の備品アンカーを検出し、全ての有効スロットを収集
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

                # Check piano_lid first (including standalone '蓋' when line has lid openness options)
                is_lid_tok = (
                    ("ピアノ" in t_text and "蓋" in t_text)
                    or t_text in ("ピアノの蓋", "ピアノ蓋")
                    or (t_text == "蓋" and any(kw in full_line_text for kw in ("全開", "半開", "半半開", "閉", "カマボコ", "蒲鉾板")))
                )
                if is_lid_tok:
                    if not matched_lid:
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

                if matched_k and matched_k in DEF_BY_KEY:
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

            # 同一行内で同じキーのアンカーが近接している場合は一番長い name のアンカーを残す
            dedup_anchors = []
            for a in sorted(anchors, key=lambda x: x["x_start"]):
                if dedup_anchors and dedup_anchors[-1]["key"] == a["key"] and (a["x_start"] - dedup_anchors[-1]["x_end"]) < 60.0:
                    if len(a["name"]) > len(dedup_anchors[-1]["name"]):
                        dedup_anchors[-1] = a
                else:
                    dedup_anchors.append(a)
            final_anchors = dedup_anchors

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

            # 各セルのスロット情報を収集
            for i, a in enumerate(final_anchors):
                k = a["key"]
                x_min = splits[i]
                x_max = splits[i + 1]
                cell_tokens = [t for t in toks if x_min <= t["rect"].x0 < x_max]
                cell_chars = [c for c in line["chars"] if x_min <= c["rect"].x0 < x_max]

                # Skip pure inline legend definitions (e.g. '椅子 → ○', '◎：ピアノ椅子', '指揮台（□）')
                after_anchor_tokens = [t for t in cell_tokens if t["rect"].x0 >= a["x_end"] - 1.0]
                before_anchor_tokens = [t for t in toks if t["rect"].x1 <= a["x_start"] + 1.0 and (a["x_start"] - t["rect"].x1) < 35.0]
                has_unit_or_yo = (
                    any(any(u in t["text"] for u in UNIT_CHARS) for t in after_anchor_tokens)
                    or any(any(kw in t["text"] for kw in ("要", "使", "借用", "有", "無")) for t in after_anchor_tokens)
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
                    matched_lid = True
                    if assigned_counts.get("piano", 0) > 0:
                        lid_targets = [piano_lid_setting]
                        if piano_lid_setting in ("蒲鉾板", "カマボコ", "ｶﾏﾎﾞｺ"):
                            lid_targets.extend(["蒲鉾板", "カマボコ", "ｶﾏﾎﾞｺ"])

                        joined_cell = "".join(c["ch"] for c in cell_chars)
                        # Lock '半半開' when searching for '半開' so '半開' never matches inside '半半開'
                        locked_lid = [False] * len(cell_chars)
                        if piano_lid_setting == "半開":
                            hh_idx = joined_cell.find("半半開")
                            if hh_idx != -1:
                                for h_i in range(hh_idx, hh_idx + 3):
                                    locked_lid[h_i] = True
                        for target in lid_targets:
                            start_pos = 0
                            found_lid = False
                            while True:
                                idx = joined_cell.find(target, start_pos)
                                if idx == -1:
                                    break
                                if any(locked_lid[k_i] for k_i in range(idx, idx + len(target))):
                                    start_pos = idx + len(target)
                                    continue
                                r_lid = fitz.Rect(cell_chars[idx]["rect"])
                                for k_i in range(idx + 1, idx + len(target)):
                                    r_lid |= cell_chars[k_i]["rect"]
                                add_auto_circle(r_lid, "piano_lid")
                                found_lid = True
                                break
                            if found_lid:
                                break
                    continue

                slot_info = {
                    "key": k,
                    "anchor_rect": a["rect"],
                    "y_mid": line["y_mid"],
                    "line_txt": full_line_text,
                    "num_mode": None,       # 'centered' | 'before_unit' | None
                    "num_pos": None,        # (cx_pt, cy0_pt) or unit_rect
                    "after_chars": [c for c in cell_chars if c["rect"].x0 >= a["x_end"] - 1.0],
                    "has_bullet": any(
                        t["text"] == "・" and abs(a["x_start"] - t["rect"].x1) < 15.0
                        for t in cell_tokens
                    ),
                }

                # 1) Tier 1: カッコ空欄（例: '椅子（　）個', '○椅子( )脚'）へのセンタリング記入
                open_paren_tok = None
                close_paren_tok = None
                for idx_t, t in enumerate(after_anchor_tokens):
                    if t["text"] in ("(", "（"):
                        if idx_t + 1 < len(after_anchor_tokens) and after_anchor_tokens[idx_t + 1]["text"] in (")", "）"):
                            open_paren_tok = t
                            close_paren_tok = after_anchor_tokens[idx_t + 1]
                            break

                if open_paren_tok is not None and close_paren_tok is not None:
                    cx_pt = (open_paren_tok["rect"].x1 + close_paren_tok["rect"].x0) / 2.0
                    cy0_pt = (open_paren_tok["rect"].y0 + close_paren_tok["rect"].y0) / 2.0
                    slot_info["num_mode"] = "centered"
                    slot_info["num_pos"] = (cx_pt, cy0_pt)

                # 2) Tier 2: 助数詞（脚・本・台・個・枚・組など）の手前への記入
                if slot_info["num_mode"] is None:
                    for c_idx, c in enumerate(cell_chars):
                        if c["rect"].x0 < a["x_end"] - 1.0:
                            continue
                        if c["ch"] in UNIT_CHARS:
                            next_ch = cell_chars[c_idx + 1]["ch"] if c_idx + 1 < len(cell_chars) else ""
                            if next_ch == "数":
                                continue
                            slot_info["num_mode"] = "before_unit"
                            slot_info["num_pos"] = c["rect"]
                            break

                # 3) Tier 3: 助数詞なしの空欄「数量 / 個数」列へのフォールバック記入
                if slot_info["num_mode"] is None:
                    for qx0, qx1, qy1 in qty_col_headers:
                        if x_min <= (qx0 + qx1) / 2.0 < x_max and line["y_mid"] > qy1:
                            slot_info["num_mode"] = "centered"
                            slot_info["num_pos"] = ((qx0 + qx1) / 2.0, a["rect"].y0)
                            break

                # Check if this cell has any valid output mechanism (number slot, yo/fuyo, or bullet circle)
                joined_after = "".join(c["ch"] for c in slot_info["after_chars"])
                has_yo_fuyo = any(kw in joined_after for kw in ("借用", "使用", "使う", "使わない", "要", "不要", "有", "無")) and "有無" not in joined_after and "個数" not in joined_after and "数量" not in joined_after
                if slot_info["num_mode"] is not None or has_yo_fuyo or (circle_mark_mode and slot_info["has_bullet"]):
                    slots_by_key.setdefault(k, []).append(slot_info)

        # Step 3: 収集したスロットに対して単一スロットまたは複数スロット（ひな壇段別＋合計）の値を解決して出力
        def is_total_slot(slot):
            if "合計" in slot["line_txt"] or "総数" in slot["line_txt"]:
                return True
            ar = slot["anchor_rect"]
            # Check if slot is inside an enclosure box that has a '合計' header right above it
            encl = None
            for eb in enclosure_boxes:
                if eb.x0 - 5.0 <= ar.x0 and ar.x1 <= eb.x1 + 5.0 and eb.y0 - 5.0 <= ar.y0 and ar.y1 <= eb.y1 + 5.0:
                    encl = eb
                    break
            for th in total_header_rects:
                if abs(th.x0 - ar.x0) < 90.0:
                    ref_y0 = encl.y0 if encl is not None else ar.y0
                    if -2.0 <= (ref_y0 - th.y1) <= 30.0 or (encl is None and 0.0 <= (ar.y0 - th.y1) <= 45.0):
                        return True
            return False

        def find_arrow_target_y(slot):
            ar = slot["anchor_rect"]
            encl = None
            for eb in enclosure_boxes:
                if eb.x0 - 5.0 <= ar.x0 and ar.x1 <= eb.x1 + 5.0 and eb.y0 - 5.0 <= ar.y0 and ar.y1 <= eb.y1 + 5.0:
                    encl = eb
                    break
            box_r = encl if encl is not None else fitz.Rect(ar.x0 - 15.0, ar.y0 - 10.0, ar.x1 + 80.0, ar.y1 + 10.0)
            for p1, p2 in arrow_segments:
                if (box_r.x0 - 15.0 <= p1.x <= box_r.x1 + 15.0) and (box_r.y0 - 8.0 <= p1.y <= box_r.y1 + 8.0):
                    return p2.y
                if (box_r.x0 - 15.0 <= p2.x <= box_r.x1 + 15.0) and (box_r.y0 - 8.0 <= p2.y <= box_r.y1 + 8.0):
                    return p1.y
            return None

        def emit_slot(slot, cnt_val, suffix_id, force_write_zero=False):
            has_emitted = False
            if slot["num_mode"] == "centered":
                if cnt_val > 0 or force_write_zero:
                    cx_pt, cy0_pt = slot["num_pos"]
                    add_auto_num_centered(cx_pt, cy0_pt, cnt_val, suffix_id)
                    has_emitted = True
            elif slot["num_mode"] == "before_unit":
                if cnt_val > 0 or force_write_zero:
                    add_auto_num(slot["num_pos"], cnt_val, suffix_id)
                    has_emitted = True

            if circle_yo_or_fuyo_chars(slot["after_chars"], cnt_val > 0, suffix_id):
                has_emitted = True

            if circle_mark_mode and slot["has_bullet"] and not has_emitted and slot["num_mode"] is None:
                if cnt_val > 0:
                    add_auto_circle(slot["anchor_rect"], f"{suffix_id}_item")

        for k, slots in slots_by_key.items():
            total_cnt = assigned_counts.get(k, 0)
            if len(slots) == 1:
                emit_slot(slots[0], total_cnt, k, force_write_zero=False)
            else:
                # Multiple slots for the same equipment key (e.g. 2段目ひな壇, 1段目ひな壇, 平床, 合計使用数)
                total_slots = [s for s in slots if is_total_slot(s)]
                tier_slots = [s for s in slots if not is_total_slot(s)]
                if not total_slots and len(slots) >= 2:
                    total_slots = [slots[-1]]
                    tier_slots = slots[:-1]

                # Emit total slots
                for idx_s, ts in enumerate(total_slots):
                    sid = f"{k}_total" if idx_s == 0 else f"{k}_total_{idx_s}"
                    emit_slot(ts, total_cnt, sid, force_write_zero=False)

                # Emit tier slots
                if len(tier_slots) == 1:
                    emit_slot(tier_slots[0], total_cnt, f"{k}_tier_0", force_write_zero=False)
                elif len(tier_slots) >= 2:
                    pts = assigned_positions.get(k, [])
                    tier_counts = [0] * len(tier_slots)
                    if total_cnt > 0:
                        if pts and len(stage_tier_bands) >= len(tier_slots):
                            # Map each tier_slot to its corresponding stage_tier_band via arrow target_y or index
                            for idx_t, ts in enumerate(tier_slots):
                                arrow_y = find_arrow_target_y(ts)
                                band = None
                                if arrow_y is not None:
                                    for b_y0, b_y1 in stage_tier_bands:
                                        if b_y0 <= arrow_y <= b_y1:
                                            band = (b_y0, b_y1)
                                            break
                                if band is None:
                                    band = stage_tier_bands[min(idx_t, len(stage_tier_bands) - 1)]
                                b_y0, b_y1 = band
                                tier_counts[idx_t] = sum(1 for (_, py) in pts if b_y0 <= py <= b_y1)
                            # Any remainder (or items outside bands) goes to the floor tier (last tier_slot)
                            rem = total_cnt - sum(tier_counts)
                            if rem > 0:
                                tier_counts[-1] += rem
                        else:
                            # Default when no position breakdown is provided: put total on floor tier
                            tier_counts[-1] = total_cnt

                        for idx_t, ts in enumerate(tier_slots):
                            emit_slot(ts, tier_counts[idx_t], f"{k}_tier_{idx_t}", force_write_zero=(tier_counts[idx_t] == 0))

        # Step 4: 団体名・指揮者氏名・番号などのテキスト入力欄を自動検出し、係記入欄（「係が記入」「記入しないで」等）を除外して配置
        v_lines, h_lines = extract_all_lines(page)

        STAFF_ONLY_KEYWORDS = (
            "係が記入", "係で記入", "係員記入", "係記入", "係専用", "係のみ", "係の記入",
            "※係", "（係", "(係", "【係", "［係", "[係", "係で記入します", "係が記入します",
            "事務局記入", "事務局用", "本部記入", "本部用", "主催者記入", "主催者用",
            "受付記入", "受付で記入", "受付専用", "受付欄",
            "審査員記入", "審査欄", "講評欄", "採点欄", "点数欄",
            "記入しないで", "記入不要", "空欄のまま", "未記入のまま", "記入禁止", "記入不可",
        )
        FORM_FIELD_PATTERNS = [
            {
                "key": "org_name",
                "labels": ["出演団体名", "出場団体名", "団体名", "学校名", "バンド名"],
                "placeholder": "団体名を入力",
                "font_size": 20,
                "min_blank_pt": 30.0,
            },
            {
                "key": "conductor",
                "labels": ["指揮者氏名", "指揮者名", "指揮者", "出演者氏名", "出演者名", "出演者", "代表者氏名", "代表者名"],
                "neg": ["譜面台", "台", "椅子", "イス", "賞"],
                "placeholder": "指揮者氏名を入力",
                "font_size": 20,
                "min_blank_pt": 25.0,
            },
            {
                "key": "furigana",
                "labels": [
                    "ふりがな", "フリガナ", "ふり・がな", "フリ・ガナ",
                    "（ふりがな）", "(ふりがな)", "（フリガナ）", "(フリガナ)",
                    "ルビ", "（ルビ）", "(ルビ)", "かな", "カナ",
                ],
                "placeholder": "ふりがなを入力",
                "font_size": 13,
                "min_blank_pt": 20.0,
            },
            {
                "key": "program_no",
                "labels": ["プログラム", "出演順", "出演番号", "出場順", "出場番号", "受付番号"],
                "placeholder": "番号",
                "font_size": 20,
                "min_blank_pt": 14.0,
            },
            {
                "key": "day_no",
                "labels": ["第"],
                "suffix": "日目",
                "placeholder": "日",
                "font_size": 20,
                "min_blank_pt": 12.0,
            },
            {
                "key": "division",
                "labels": ["部門", "の部"],
                "placeholder": "部門を入力",
                "font_size": 18,
                "min_blank_pt": 25.0,
            },
        ]

        staff_regions = []
        for ln in tokenized_lines:
            for tok in ln["tokens"]:
                ct = tok["text"].replace(" ", "").replace("　", "")
                if any(kw in ct for kw in STAFF_ONLY_KEYWORDS):
                    staff_regions.append((tok["rect"], ct))
            full_ln = "".join(c["ch"] for c in ln["chars"]).replace(" ", "").replace("　", "")
            for kw in STAFF_ONLY_KEYWORDS:
                if kw in full_ln:
                    idx = full_ln.find(kw)
                    if idx < len(ln["chars"]):
                        kw_r = fitz.Rect(
                            ln["chars"][idx]["rect"].x0,
                            ln["chars"][idx]["rect"].y0,
                            ln["chars"][min(idx + len(kw) - 1, len(ln["chars"]) - 1)]["rect"].x1,
                            ln["chars"][min(idx + len(kw) - 1, len(ln["chars"]) - 1)]["rect"].y1,
                        )
                        staff_regions.append((kw_r, kw))

        def is_staff_only_region(tr: fitz.Rect, blank_x0: float, blank_x1: float, line_text: str) -> bool:
            clean_line = line_text.replace(" ", "").replace("　", "")
            if any(kw in clean_line for kw in ("※係", "（係", "(係", "【係", "［係", "[係", "係記入", "係専用", "係のみ", "係で記入", "係が記入", "記入しないで")):
                for s_rect, _ in staff_regions:
                    if abs((s_rect.y0 + s_rect.y1) / 2.0 - (tr.y0 + tr.y1) / 2.0) <= 25.0:
                        if not (s_rect.x1 < tr.x0 - 20.0 or s_rect.x0 > blank_x1 + 30.0):
                            return True
            y_mid = (tr.y0 + tr.y1) / 2.0
            for s_rect, _ in staff_regions:
                s_ymid = (s_rect.y0 + s_rect.y1) / 2.0
                if abs(s_ymid - y_mid) <= 50.0:
                    if not (s_rect.x1 < (tr.x0 - 15.0) or s_rect.x0 > (blank_x1 + 15.0)):
                        return True
            return False

        def find_cell_right(tr: fitz.Rect):
            y_mid = (tr.y0 + tr.y1) / 2.0
            h_above = [hy for (hy, hx0, hx1) in h_lines if hx0 <= tr.x0 <= hx1 and hy <= y_mid + 2.0]
            h_below = [hy for (hy, hx0, hx1) in h_lines if hx0 <= tr.x0 <= hx1 and hy >= y_mid - 2.0]
            y_top = max(h_above) if h_above else tr.y0 - 2.0
            y_bot = min(h_below) if h_below else tr.y1 + 2.0

            v_right = [vx for (vx, vy0, vy1) in v_lines if vy0 <= y_mid <= vy1 and tr.x1 - 2.0 <= vx <= tr.x1 + 30.0]
            if not v_right:
                return None
            cell_x0 = v_right[0]
            v_next = [vx for (vx, vy0, vy1) in v_lines if vy0 <= y_mid <= vy1 and vx >= cell_x0 + 15.0]
            cell_x1 = v_next[0] if v_next else page_w - 20.0
            return (cell_x0 + 4.0, cell_x1 - 4.0, (y_top + y_bot) / 2.0)

        emitted_field_coords = []
        field_seq = 0
        page_w = page.rect.width

        for line in tokenized_lines:
            full_line_text = "".join(c["ch"] for c in line["chars"])
            if any(skip_w in full_line_text for skip_w in ("記入してください", "提出してください", "ステージ配置図", "セッティングシート", "音楽会合同音楽会")):
                if len(full_line_text) > 30 and "団体名" not in full_line_text and "プログラム" not in full_line_text:
                    continue

            toks = line["tokens"]
            for t_idx, tok in enumerate(toks):
                if tok["type"] != "WORD":
                    continue
                t_text = tok["text"]
                tr = tok["rect"]
                y_mid = (tr.y0 + tr.y1) / 2.0

                for fp in FORM_FIELD_PATTERNS:
                    f_key = fp["key"]
                    matched_lbl = None

                    # Special case: '第 X 日目'
                    if f_key == "day_no":
                        if t_text == "第":
                            next_tok = toks[t_idx + 1] if (t_idx + 1) < len(toks) else None
                            if next_tok and next_tok["text"].startswith("日目"):
                                gap_w = next_tok["rect"].x0 - tr.x1
                                if gap_w >= fp["min_blank_pt"]:
                                    bx0, bx1 = tr.x1 + 2.0, next_tok["rect"].x0 - 2.0
                                    if not is_staff_only_region(tr, bx0, bx1, full_line_text):
                                        target_x_pt = (bx0 + bx1) / 2.0
                                        target_y_pt = y_mid - fp["font_size"] * 0.26
                                        field_seq += 1
                                        auto_nodes.append({
                                            "id": f"field_{f_key}_{field_seq}",
                                            "type": "text",
                                            "text": fp["placeholder"],
                                            "x": round(target_x_pt * 2.0 - 10.0),
                                            "y": round(target_y_pt * 2.0),
                                            "fontSize": fp["font_size"],
                                            "radius": 15,
                                        })
                                        emitted_field_coords.append((target_x_pt, target_y_pt))
                        continue

                    # Special case: '［　］部門' or '[　] 部門' (preceding brackets)
                    if f_key == "division" and (t_text == "部門" or t_text.endswith("部門")):
                        prev_tokens = toks[:t_idx]
                        open_b = None
                        close_b = None
                        for pt in reversed(prev_tokens):
                            if pt["text"] in ("]", "］", "】", ")", "）"):
                                close_b = pt
                            elif pt["text"] in ("[", "［", "【", "(", "（") and close_b:
                                open_b = pt
                                break
                        if open_b and close_b and (close_b["rect"].x0 - open_b["rect"].x1) >= fp["min_blank_pt"]:
                            bx0 = open_b["rect"].x1 + 2.0
                            bx1 = close_b["rect"].x0 - 2.0
                            if not is_staff_only_region(tr, bx0, bx1, full_line_text):
                                target_x_pt = (bx0 + bx1) / 2.0 - len(fp["placeholder"]) * 4.0
                                target_y_pt = y_mid - fp["font_size"] * 0.26
                                if not any(abs(ex - target_x_pt) < 25.0 and abs(ey - target_y_pt) < 12.0 for ex, ey in emitted_field_coords):
                                    field_seq += 1
                                    auto_nodes.append({
                                        "id": f"field_{f_key}_{field_seq}",
                                        "type": "text",
                                        "text": fp["placeholder"],
                                        "x": round(target_x_pt * 2.0),
                                        "y": round(target_y_pt * 2.0),
                                        "fontSize": fp["font_size"],
                                        "radius": 15,
                                    })
                                    emitted_field_coords.append((target_x_pt, target_y_pt))
                                    continue

                    # Special case: '... の部' (preceding blank)
                    if f_key == "division" and t_text in ("の部", "部"):
                        prev_x1 = toks[t_idx - 1]["rect"].x1 if t_idx > 0 else max(30.0, tr.x0 - 150.0)
                        gap_w = tr.x0 - prev_x1
                        if gap_w >= fp["min_blank_pt"]:
                            bx0 = prev_x1 + 6.0
                            bx1 = tr.x0 - 4.0
                            if not is_staff_only_region(tr, bx0, bx1, full_line_text):
                                target_x_pt = (bx0 + bx1) / 2.0 - len(fp["placeholder"]) * 4.0
                                target_y_pt = y_mid - fp["font_size"] * 0.26
                                if not any(abs(ex - target_x_pt) < 25.0 and abs(ey - target_y_pt) < 12.0 for ex, ey in emitted_field_coords):
                                    field_seq += 1
                                    auto_nodes.append({
                                        "id": f"field_{f_key}_{field_seq}",
                                        "type": "text",
                                        "text": fp["placeholder"],
                                        "x": round(target_x_pt * 2.0),
                                        "y": round(target_y_pt * 2.0),
                                        "fontSize": fp["font_size"],
                                        "radius": 15,
                                    })
                                    emitted_field_coords.append((target_x_pt, target_y_pt))
                                    continue

                    # Negative keyword check
                    if fp.get("neg") and any(neg in t_text for neg in fp["neg"]):
                        continue

                    # Match field labels
                    clean_t = re.sub(r"[（）()【】\[\]:：・\s]", "", t_text)
                    for lbl in fp["labels"]:
                        clean_lbl = re.sub(r"[（）()【】\[\]:：・\s]", "", lbl)
                        if t_text == lbl or clean_t == clean_lbl or (len(clean_lbl) >= 3 and clean_t.startswith(clean_lbl) and len(clean_t) <= len(clean_lbl) + 4):
                            matched_lbl = lbl
                            break
                    if not matched_lbl:
                        continue

                    # 1) Try table cell to the right
                    cell = find_cell_right(tr)
                    blank_x0, blank_x1, target_y_pt = None, None, y_mid
                    if cell:
                        blank_x0, blank_x1, cell_ymid = cell
                        target_y_pt = cell_ymid
                        # If there is a '番' inside the cell, stop before '番'
                        for nt in line["tokens"]:
                            if nt["rect"].x0 > tr.x1 and nt["text"].startswith("番") and blank_x0 <= nt["rect"].x0 <= blank_x1:
                                blank_x1 = nt["rect"].x0 - 2.0
                                break

                    # 2) If not in table cell, check brackets following the label
                    if blank_x0 is None or (blank_x1 - blank_x0) < fp["min_blank_pt"]:
                        open_b = None
                        close_b = None
                        for nt in toks[t_idx + 1:]:
                            if nt["text"] in ("【", "[", "［", "(", "（") and not open_b:
                                open_b = nt
                            elif nt["text"] in ("】", "]", "］", ")", "）") and open_b:
                                close_b = nt
                                break
                        if open_b and close_b and (close_b["rect"].x0 - open_b["rect"].x1) >= fp["min_blank_pt"]:
                            blank_x0 = open_b["rect"].x1 + 4.0
                            blank_x1 = close_b["rect"].x0 - 4.0
                        else:
                            # 3) Fallback: space until next token or right edge
                            next_x0 = page_w - 20.0
                            for nt in toks[t_idx + 1:]:
                                if nt["text"] in (":", "：", "・", "(", "（", ")", "）", "【", "】", "［", "］"):
                                    continue
                                next_x0 = nt["rect"].x0
                                break
                            blank_x0 = tr.x1 + 6.0
                            blank_x1 = next_x0 - 4.0

                    blank_w = blank_x1 - blank_x0
                    if blank_w < fp["min_blank_pt"]:
                        continue

                    if is_staff_only_region(tr, blank_x0, blank_x1, full_line_text):
                        continue

                    # Determine font size and placeholder text
                    font_sz = fp["font_size"]
                    placeholder_txt = fp["placeholder"]
                    if f_key == "conductor":
                        if blank_w < 65.0:
                            font_sz = min(font_sz, 15)
                            placeholder_txt = "出演者名" if "出演者" in matched_lbl else ("代表者名" if "代表者" in matched_lbl else "指揮者名")
                        else:
                            placeholder_txt = "出演者名を入力" if "出演者" in matched_lbl else ("代表者名を入力" if "代表者" in matched_lbl else "指揮者氏名を入力")
                    elif f_key == "furigana":
                        if any(k in t_text for k in ("フリガナ", "カナ")):
                            placeholder_txt = "フリガナを入力"
                        else:
                            placeholder_txt = "ふりがなを入力"

                    # Determine horizontal placement
                    if f_key == "program_no":
                        target_x_pt = (blank_x0 + min(blank_x1, blank_x0 + 70.0)) / 2.0 - 10.0
                    elif blank_w > 100.0:
                        target_x_pt = blank_x0 + 6.0
                    else:
                        target_x_pt = (blank_x0 + blank_x1) / 2.0 - len(placeholder_txt) * 4.0

                    target_x_pt = max(blank_x0 + 4.0, target_x_pt)
                    target_y_pt = target_y_pt - font_sz * 0.26

                    if any(abs(ex - target_x_pt) < 25.0 and abs(ey - target_y_pt) < 12.0 for ex, ey in emitted_field_coords):
                        continue

                    field_seq += 1
                    auto_nodes.append({
                        "id": f"field_{f_key}_{field_seq}",
                        "type": "text",
                        "text": placeholder_txt,
                        "x": round(target_x_pt * 2.0),
                        "y": round(target_y_pt * 2.0),
                        "fontSize": font_sz,
                        "radius": 15,
                    })
                    emitted_field_coords.append((target_x_pt, target_y_pt))

                    # Inline furigana in cell/box
                    if f_key in ("org_name", "conductor") and ("ふりがな" in full_line_text or "フリガナ" in full_line_text):
                        furi_y_pt = target_y_pt - 18.0
                        furi_x_pt = target_x_pt
                        if not any(abs(ex - furi_x_pt) < 20.0 and abs(ey - furi_y_pt) < 10.0 for ex, ey in emitted_field_coords):
                            field_seq += 1
                            furi_placeholder = "フリガナを入力" if "フリガナ" in full_line_text else "ふりがなを入力"
                            auto_nodes.append({
                                "id": f"field_furigana_{field_seq}",
                                "type": "text",
                                "text": furi_placeholder,
                                "x": round(furi_x_pt * 2.0),
                                "y": round(furi_y_pt * 2.0),
                                "fontSize": 13,
                                "radius": 15,
                            })
                            emitted_field_coords.append((furi_x_pt, furi_y_pt))

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

@app.get("/api/manual-pdf/")
async def get_manual_pdf():
    candidates = [
        os.path.abspath(os.path.join(BASE_DIR, "..", "セッティングくん_取扱説明書.pdf")),
        os.path.abspath(os.path.join(BASE_DIR, "..", "frontend", "public", "manual.pdf")),
        os.path.join(STATIC_DIR, "manual.pdf"),
    ]
    for p in candidates:
        if os.path.exists(p):
            return FileResponse(p, media_type="application/pdf", filename="セッティングくん_取扱説明書.pdf")
    raise HTTPException(status_code=404, detail="Manual PDF not found")

# Mount built frontend files if available (for production deployments like Render.com)
FRONTEND_DIST = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))
if os.path.exists(FRONTEND_DIST):
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")

