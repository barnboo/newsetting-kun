#!/usr/bin/env python3
"""
一括テスト＆デバッグ診断スクリプト (scripts/diagnose_pdfs.py)
指定フォルダ内の全PDFに対して凡例自動抽出を実行し、
視覚化アノテーション画像 (PNG) と Markdown 診断レポートを出力します。
"""

import os
import sys
import argparse
from pathlib import Path
from typing import List, Dict, Any
import fitz
from PIL import Image, ImageDraw, ImageFont

# Ensure backend modules can be imported
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from legend_extractor import extract_legends, ExtractedLegendItem
from legend_extractor.config import cfg

def get_japanese_font(size: int = 14) -> ImageFont.ImageFont:
    candidate_fonts = [
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
        "/System/Library/Fonts/AppleSDGothicNeo.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
    ]
    for font_path in candidate_fonts:
        if os.path.exists(font_path):
            try:
                return ImageFont.truetype(font_path, size)
            except Exception:
                pass
    return ImageFont.load_default()

def annotate_pdf_page(
    page: fitz.Page,
    items: List[ExtractedLegendItem],
    out_png_path: Path,
    dpi: int = 150
) -> None:
    scale = dpi / 72.0
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples).convert("RGBA")
    
    overlay = Image.new("RGBA", img.size, (255, 255, 255, 0))
    draw = ImageDraw.Draw(overlay)
    font = get_japanese_font(max(12, int(11 * scale)))
    font_small = get_japanese_font(max(10, int(9 * scale)))

    for idx, it in enumerate(items):
        sb = it.symbol_box
        lb = it.label_box

        s_rect = [sb.x * scale, sb.y * scale, (sb.x + sb.width) * scale, (sb.y + sb.height) * scale]
        l_rect = [lb.x * scale, lb.y * scale, (lb.x + lb.width) * scale, (lb.y + lb.height) * scale]

        # Draw symbol_box (Green)
        draw.rectangle(s_rect, outline=(0, 204, 68, 255), width=int(2.5 * scale))
        draw.rectangle(s_rect, fill=(0, 204, 68, 40))

        # Draw label_box (Blue)
        draw.rectangle(l_rect, outline=(0, 119, 255, 255), width=int(2.5 * scale))
        draw.rectangle(l_rect, fill=(0, 119, 255, 40))

        # Connecting line between label center and symbol center
        sc_x = (s_rect[0] + s_rect[2]) / 2.0
        sc_y = (s_rect[1] + s_rect[3]) / 2.0
        lc_x = (l_rect[0] + l_rect[2]) / 2.0
        lc_y = (l_rect[1] + l_rect[3]) / 2.0
        draw.line([(sc_x, sc_y), (lc_x, lc_y)], fill=(255, 128, 0, 180), width=int(1.5 * scale))

        # Text banner
        tag_text = f"#{idx+1} {it.name} [{it.source_mode}] ({it.symbol_type})"
        text_bbox = draw.textbbox((l_rect[0], max(0, l_rect[1] - 18 * scale)), tag_text, font=font)
        # Pad banner
        banner_rect = [text_bbox[0] - 2, text_bbox[1] - 2, text_bbox[2] + 2, text_bbox[3] + 2]
        draw.rectangle(banner_rect, fill=(30, 30, 30, 220))
        draw.text((l_rect[0], max(0, l_rect[1] - 18 * scale)), tag_text, fill=(255, 255, 255, 255), font=font)

    # Composite overlay
    final_img = Image.alpha_composite(img, overlay).convert("RGB")
    out_png_path.parent.mkdir(parents=True, exist_ok=True)
    final_img.save(str(out_png_path))

def run_diagnostics(input_dir: Path, output_dir: Path, dpi: int = 150) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    pdf_files = sorted(list(input_dir.rglob("*.pdf")))
    if not pdf_files:
        print(f"No PDF files found in {input_dir}")
        return

    print(f"Found {len(pdf_files)} PDF file(s) in {input_dir}. Running diagnostics...")

    results: List[Dict[str, Any]] = []
    mode_counts: Dict[str, int] = {}
    type_counts: Dict[str, int] = {}

    for pdf_path in pdf_files:
        print(f"Processing: {pdf_path.name} ...", end=" ", flush=True)
        try:
            doc = fitz.open(str(pdf_path))
            if len(doc) == 0:
                print("Empty document, skipped.")
                continue
            page = doc[0]
            items = extract_legends(doc, 0)
            print(f"Extracted {len(items)} item(s)")

            png_filename = f"{pdf_path.stem}.png"
            png_out_path = output_dir / png_filename
            annotate_pdf_page(page, items, png_out_path, dpi=dpi)

            for it in items:
                mode_counts[it.source_mode] = mode_counts.get(it.source_mode, 0) + 1
                type_counts[it.symbol_type] = type_counts.get(it.symbol_type, 0) + 1

            results.append({
                "filename": pdf_path.name,
                "png_filename": png_filename,
                "page_width": round(page.rect.width, 1),
                "page_height": round(page.rect.height, 1),
                "item_count": len(items),
                "items": items
            })
            doc.close()
        except Exception as e:
            print(f"FAILED: {e}")
            results.append({
                "filename": pdf_path.name,
                "error": str(e),
                "item_count": 0,
                "items": []
            })

    # Generate Markdown Report
    total_items = sum(r["item_count"] for r in results)
    report_path = output_dir / "debug_report.md"

    with open(report_path, "w", encoding="utf-8") as f:
        f.write("# 凡例抽出エンジン 一括診断レポート (Diagnostic Report)\n\n")
        f.write(f"- **診断日時**: {Path().cwd()}\n")
        f.write(f"- **対象PDF数**: {len(pdf_files)}\n")
        f.write(f"- **総抽出凡例数**: {total_items}\n\n")

        f.write("## 1. 抽出モード別・記号タイプ別 内訳\n\n")
        f.write("| 抽出モード (source_mode) | 検出数 | 記号タイプ (symbol_type) | 検出数 |\n")
        f.write("| :--- | :--- | :--- | :--- |\n")
        modes = sorted(list(mode_counts.keys()))
        types = sorted(list(type_counts.keys()))
        max_rows = max(len(modes), len(types))
        for i in range(max_rows):
            m_str = f"`{modes[i]}`" if i < len(modes) else ""
            m_cnt = str(mode_counts[modes[i]]) if i < len(modes) else ""
            t_str = f"`{types[i]}`" if i < len(types) else ""
            t_cnt = str(type_counts[types[i]]) if i < len(types) else ""
            f.write(f"| {m_str} | {m_cnt} | {t_str} | {t_cnt} |\n")

        f.write("\n## 2. 各PDFの抽出結果サマリー\n\n")
        f.write("| PDFファイル名 | 抽出数 | 抽出アイテム一覧 (名称 / 記号種類 / モード) | 診断画像 |\n")
        f.write("| :--- | :---: | :--- | :---: |\n")

        for r in results:
            fname = r["filename"]
            cnt = r["item_count"]
            if "error" in r:
                f.write(f"| `{fname}` | **ERROR** | エラー: {r['error']} | - |\n")
                continue

            item_descs = []
            for it in r["items"]:
                sym_info = f"`{it.raw_symbol_text}`" if it.raw_symbol_text else it.symbol_type
                item_descs.append(f"**{it.name}** ({sym_info}, `{it.source_mode}`)")
            
            items_str = "<br>".join(item_descs) if item_descs else "*(抽出なし)*"
            img_link = f"[{r['png_filename']}](./{r['png_filename']})"
            f.write(f"| `{fname}` | **{cnt}** | {items_str} | {img_link} |\n")

        f.write("\n## 3. 検出アイテム詳細仕様一覧\n\n")
        for r in results:
            if not r.get("items"):
                continue
            f.write(f"### `{r['filename']}` ({r['item_count']} 件)\n\n")
            f.write("| # | 備品名 (name) | 記号種類 (symbol_type) | モード (source_mode) | symbol_box [x, y, w, h] | label_box [x, y, w, h] |\n")
            f.write("| :-: | :--- | :--- | :--- | :--- | :--- |\n")
            for idx, it in enumerate(r["items"]):
                sb = it.symbol_box
                lb = it.label_box
                sb_str = f"[{sb.x:.1f}, {sb.y:.1f}, {sb.width:.1f}, {sb.height:.1f}]"
                lb_str = f"[{lb.x:.1f}, {lb.y:.1f}, {lb.width:.1f}, {lb.height:.1f}]"
                sym_disp = f"{it.symbol_type} (`{it.raw_symbol_text}`)" if it.raw_symbol_text else it.symbol_type
                f.write(f"| {idx+1} | **{it.name}** | {sym_disp} | `{it.source_mode}` | `{sb_str}` | `{lb_str}` |\n")
            f.write("\n")

    print(f"\nDiagnostics completed! Report written to: {report_path}")

def main():
    parser = argparse.ArgumentParser(description="PDF Legend Extraction Batch Diagnostics")
    parser.add_argument("--input-dir", "-i", type=Path, default=PROJECT_ROOT / "test_drive", help="Input directory containing PDF files")
    parser.add_argument("--output-dir", "-o", type=Path, default=PROJECT_ROOT / "debug_out", help="Output directory for annotated PNGs and report")
    parser.add_argument("--dpi", type=int, default=150, help="DPI for rendering debug PNG images (default 150)")

    args = parser.parse_args()
    run_diagnostics(args.input_dir, args.output_dir, args.dpi)

if __name__ == "__main__":
    main()
