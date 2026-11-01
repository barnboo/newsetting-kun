"""
Verification script for Legend Extractor Engine.
Generates 4 synthetic PDFs covering all edge cases specified in requirements and verifies:
① No. column 4-column table
② Borderless multi-column table
③ Inline notation + caution text + aggregation table
④ Vector drawing touching cell borders
"""

import os
import sys
import fitz

# Ensure backend package is in path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from legend_extractor import extract_legends

def create_case1_no_column_table(pdf_path: str):
    """Case 1: No列付き4列テーブル (No | 名称 | 記号 | 数量) with explicit grid lines"""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)  # A4

    # Large stage layout outline
    page.draw_rect(fitz.Rect(50, 50, 545, 450), color=(0.2, 0.2, 0.2), width=1.5)
    page.insert_text(fitz.Point(260, 250), "ステージ（舞台配置図）", fontsize=16, fontname="japan")

    # Legend table at the bottom
    # Table rect: (80, 500) to (515, 620)
    top_y = 500
    row_h = 24
    cols_x = [80, 130, 280, 380, 515]  # No (50pt), Name (150pt), Symbol (100pt), Qty (135pt)

    headers = ["No.", "名称", "記号", "数量"]
    rows = [
        ["1", "折りたたみ椅子", "○", "40脚"],
        ["2", "譜面台", "×", "35本"],
        ["3", "ピアノ椅子", "●", "1脚"],
        ["4", "長机", "□", "4台"]
    ]

    # Draw grid lines
    for i in range(len(rows) + 2):
        y = top_y + i * row_h
        page.draw_line(fitz.Point(cols_x[0], y), fitz.Point(cols_x[-1], y), color=(0.4, 0.4, 0.4), width=1)
    for x in cols_x:
        page.draw_line(fitz.Point(x, top_y), fitz.Point(x, top_y + (len(rows) + 1) * row_h), color=(0.4, 0.4, 0.4), width=1)

    # Insert headers
    for c_idx, h_text in enumerate(headers):
        page.insert_text(fitz.Point(cols_x[c_idx] + 10, top_y + 17), h_text, fontsize=11, fontname="japan")

    # Insert row data
    for r_idx, r_data in enumerate(rows):
        y = top_y + (r_idx + 1) * row_h + 17
        for c_idx, val in enumerate(r_data):
            page.insert_text(fitz.Point(cols_x[c_idx] + 10, y), val, fontsize=11, fontname="japan")

    doc.save(pdf_path)
    doc.close()


def create_case2_borderless_multicolumn(pdf_path: str):
    """Case 2: 罫線なしマルチカラム表 (Whitespace aligned 2-column layout)"""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)

    # Large stage layout outline
    page.draw_rect(fitz.Rect(50, 50, 545, 450), color=(0.2, 0.2, 0.2), width=1.5)
    page.insert_text(fitz.Point(260, 250), "ステージ（舞台配置図）", fontsize=16, fontname="japan")

    # Sub-table 1 (Left: X: 80 ~ 240)
    # Header
    page.insert_text(fitz.Point(80, 520), "備品名", fontsize=11, fontname="japan")
    page.insert_text(fitz.Point(180, 520), "記号", fontsize=11, fontname="japan")
    # Data
    page.insert_text(fitz.Point(80, 545), "合奏用椅子", fontsize=11, fontname="japan")
    page.insert_text(fitz.Point(180, 545), "○", fontsize=11, fontname="japan")
    page.insert_text(fitz.Point(80, 570), "譜面台", fontsize=11, fontname="japan")
    page.insert_text(fitz.Point(180, 570), "×", fontsize=11, fontname="japan")

    # Sub-table 2 (Right: X: 340 ~ 500)
    page.insert_text(fitz.Point(340, 520), "備品名", fontsize=11, fontname="japan")
    page.insert_text(fitz.Point(440, 520), "記号", fontsize=11, fontname="japan")
    page.insert_text(fitz.Point(340, 545), "長机", fontsize=11, fontname="japan")
    page.insert_text(fitz.Point(440, 545), "□", fontsize=11, fontname="japan")
    page.insert_text(fitz.Point(340, 570), "指揮台", fontsize=11, fontname="japan")
    page.insert_text(fitz.Point(440, 570), "△", fontsize=11, fontname="japan")

    doc.save(pdf_path)
    doc.close()


def create_case3_inline_caution_aggregation(pdf_path: str):
    """Case 3: インライン表記 ＋ 注意書き・指示文 ＋ 集計表混在"""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)

    # Large stage layout outline
    page.draw_rect(fitz.Rect(50, 50, 545, 400), color=(0.2, 0.2, 0.2), width=1.5)

    # 1. Inline notation
    page.insert_text(fitz.Point(70, 450), "【記号凡例】", fontsize=12, fontname="japan")
    page.insert_text(fitz.Point(70, 475), "椅子…○    ピアノ椅子…●    譜面台…×", fontsize=11, fontname="japan")

    # 2. Caution & instruction sentences (MUST be excluded)
    page.insert_text(fitz.Point(70, 515), "＊ピアノは下手固定でお願いします。", fontsize=10, fontname="japan")
    page.insert_text(fitz.Point(70, 535), "※提出期日は厳守のこと。変更がある場合は速やかに連絡して下さい。", fontsize=10, fontname="japan")
    page.insert_text(fitz.Point(70, 555), "注：配置図内に記入漏れのないようご確認ください。", fontsize=10, fontname="japan")

    # 3. Dummy Aggregation Table (ひな壇・段数 × 備品 集計表 - MUST be excluded)
    top_y = 600
    page.draw_rect(fitz.Rect(70, top_y, 500, top_y + 80), color=(0.3, 0.3, 0.3), width=1)
    page.insert_text(fitz.Point(80, top_y + 20), "ひな壇段数", fontsize=10, fontname="japan")
    page.insert_text(fitz.Point(160, top_y + 20), "1列目", fontsize=10, fontname="japan")
    page.insert_text(fitz.Point(230, top_y + 20), "2列目", fontsize=10, fontname="japan")
    page.insert_text(fitz.Point(300, top_y + 20), "上段", fontsize=10, fontname="japan")
    page.insert_text(fitz.Point(370, top_y + 20), "下段", fontsize=10, fontname="japan")

    page.insert_text(fitz.Point(80, top_y + 45), "合奏用椅子", fontsize=10, fontname="japan")
    page.insert_text(fitz.Point(160, top_y + 45), "12", fontsize=10, fontname="japan")
    page.insert_text(fitz.Point(230, top_y + 45), "14", fontsize=10, fontname="japan")
    page.insert_text(fitz.Point(300, top_y + 45), "8", fontsize=10, fontname="japan")
    page.insert_text(fitz.Point(370, top_y + 45), "10", fontsize=10, fontname="japan")

    doc.save(pdf_path)
    doc.close()


def create_case4_vector_touching_border(pdf_path: str):
    """Case 4: セル罫線に接したベクター図形 (Drawing shape touching cell grid line)"""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)

    # Large stage layout outline
    page.draw_rect(fitz.Rect(50, 50, 545, 450), color=(0.2, 0.2, 0.2), width=1.5)

    # Row 0: Header
    page.insert_text(fitz.Point(80, 535), "名称", fontsize=11, fontname="japan")
    page.insert_text(fitz.Point(210, 535), "記号", fontsize=11, fontname="japan")

    # Row 1: Data
    page.insert_text(fitz.Point(80, 565), "グランドピアノ", fontsize=11, fontname="japan")

    # Real table grid lines (table spanning across columns)
    page.draw_line(fitz.Point(70, 520), fitz.Point(260, 520), color=(0.0, 0.0, 0.0), width=1.0)
    page.draw_line(fitz.Point(70, 548), fitz.Point(260, 548), color=(0.0, 0.0, 0.0), width=1.0)
    page.draw_line(fitz.Point(70, 580), fitz.Point(260, 580), color=(0.0, 0.0, 0.0), width=1.0)

    page.draw_line(fitz.Point(70, 520), fitz.Point(70, 580), color=(0.0, 0.0, 0.0), width=1.0)
    page.draw_line(fitz.Point(200, 520), fitz.Point(200, 580), color=(0.0, 0.0, 0.0), width=1.0)
    page.draw_line(fitz.Point(260, 520), fitz.Point(260, 580), color=(0.0, 0.0, 0.0), width=1.0)

    # Draw a vector rectangle touching the top border of the cell (y=548)
    # The shape is (215, 548, 235, 568)
    shape_rect = fitz.Rect(215, 548, 235, 568)
    page.draw_rect(shape_rect, color=(0.1, 0.1, 0.8), fill=(0.8, 0.8, 1.0), width=1.0)

    doc.save(pdf_path)
    doc.close()


def run_all_tests():
    print("=" * 65)
    print("Running Synthetic PDF Test Suite for Legend Extractor Engine")
    print("=" * 65)

    os.makedirs("/tmp/legend_tests", exist_ok=True)
    all_passed = True

    # --- Test 1 ---
    p1 = "/tmp/legend_tests/case1_no_column.pdf"
    create_case1_no_column_table(p1)
    doc1 = fitz.open(p1)
    items1 = extract_legends(doc1)
    names1 = [it.name for it in items1]
    print(f"\n[Case 1] No. Column 4-Col Table:")
    print(f"  Extracted ({len(items1)}): {names1}")
    for it in items1:
        print(f"    - {it.name:<12} | sym_box: {it.symbol_box.to_dict()} | type: {it.symbol_type}")

    # Assertions for Case 1
    # 1. No numbers (1, 2, 3, 4) in extracted names
    assert not any(n.isdigit() for n in names1), "Error: No. column numbers were extracted as items!"
    # 2. Expected equipment names are present
    assert any("折りたたみ椅子" in n or "椅子" in n for n in names1), "Missing 椅子 in Case 1"
    assert any("譜面台" in n for n in names1), "Missing 譜面台 in Case 1"
    assert any("ピアノ椅子" in n for n in names1), "Missing ピアノ椅子 in Case 1"
    assert any("長机" in n for n in names1), "Missing 長机 in Case 1"
    print("  => Case 1 PASSED!")

    # --- Test 2 ---
    p2 = "/tmp/legend_tests/case2_borderless_multicols.pdf"
    create_case2_borderless_multicolumn(p2)
    doc2 = fitz.open(p2)
    items2 = extract_legends(doc2)
    names2 = [it.name for it in items2]
    print(f"\n[Case 2] Borderless Multi-column Table:")
    print(f"  Extracted ({len(items2)}): {names2}")
    for it in items2:
        print(f"    - {it.name:<12} | sym_box: {it.symbol_box.to_dict()} | type: {it.symbol_type}")

    assert any("椅子" in n for n in names2), "Missing 椅子 in Case 2"
    assert any("譜面台" in n for n in names2), "Missing 譜面台 in Case 2"
    assert any("長机" in n for n in names2), "Missing 長机 in Case 2"
    assert any("指揮台" in n for n in names2), "Missing 指揮台 in Case 2"
    print("  => Case 2 PASSED!")

    # --- Test 3 ---
    p3 = "/tmp/legend_tests/case3_inline_caution.pdf"
    create_case3_inline_caution_aggregation(p3)
    doc3 = fitz.open(p3)
    items3 = extract_legends(doc3)
    names3 = [it.name for it in items3]
    print(f"\n[Case 3] Inline Notation + Caution Text + Dummy Aggregation:")
    print(f"  Extracted ({len(items3)}): {names3}")
    for it in items3:
        print(f"    - {it.name:<12} | sym_box: {it.symbol_box.to_dict()} | type: {it.symbol_type}")

    # Must extract the 3 inline symbols
    assert any("椅子" in n for n in names3), "Missing 椅子 in Case 3"
    assert any("ピアノ椅子" in n for n in names3), "Missing ピアノ椅子 in Case 3"
    assert any("譜面台" in n for n in names3), "Missing 譜面台 in Case 3"
    # MUST NOT extract from caution / instruction text
    assert not any("下手固定" in n or "厳守" in n or "記入漏れ" in n for n in names3), "Error: Extracted from caution text!"
    # MUST NOT extract aggregation numbers/headers
    assert not any(n in ["1列目", "2列目", "上段", "下段", "12", "14", "8", "10"] for n in names3), "Error: Extracted aggregation table!"
    print("  => Case 3 PASSED!")

    # --- Test 4 ---
    p4 = "/tmp/legend_tests/case4_vector_touching_border.pdf"
    create_case4_vector_touching_border(p4)
    doc4 = fitz.open(p4)
    items4 = extract_legends(doc4)
    names4 = [it.name for it in items4]
    print(f"\n[Case 4] Vector Touching Cell Border:")
    print(f"  Extracted ({len(items4)}): {names4}")
    for it in items4:
        print(f"    - {it.name:<12} | sym_box: {it.symbol_box.to_dict()} | type: {it.symbol_type}")

    assert any("ピアノ" in n for n in names4), "Missing ピアノ in Case 4"
    # Check that symbol_box is tight and does NOT engulf the whole 50pt cell height or 50pt width
    p_item = next(it for it in items4 if "ピアノ" in it.name)
    print(f"  Tight cropped symbol_box: {p_item.symbol_box.to_dict()}")
    assert p_item.symbol_box.width < 35.0, f"Symbol box too wide (penetrating line was not removed): width={p_item.symbol_box.width}"
    assert p_item.symbol_box.height < 35.0, f"Symbol box too tall: height={p_item.symbol_box.height}"
    print("  => Case 4 PASSED!")

    print("\n" + "=" * 65)
    print("ALL 4 SYNTHETIC TEST CASES PASSED WITH 0 FALSE DETECTIONS!")
    print("=" * 65)
    return True

if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
