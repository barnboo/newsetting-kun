"""
Comprehensive 7-Case Verification Test Suite for Legend Extractor Engine.
Faithfully tests all 7 real-world layout edge cases:
1. 山梨アンコン型 (矢印区切り、広い空白、上部数量記入欄、丸囲み指示、箇条書き中黒)
2. 山梨コンクール型 (余白小枠内、均等割り付け、○椅子( )脚、3.7寸法、全開半開、ステージ内ピアノ)
3. 茨城県北型 (ヘッダ型、Xアルファベット記号、(■)黒四角、9m寸法、ステージ内指揮台)
4. 茨城中央型 (角丸枠内、均等割り付け+空白区切り、電源|有無|借持、二段目|一段目、オフステージA)
5. 第66回茨城型 (~印表記、印の除外、持参借用脚、○で囲んでください、大会当日受付、部は○で囲む)
6. 滋賀コンクール型 (リーダー点・・・、非対象文字マスク、下手固定注意書き、列別集計表)
7. CAD標準4列テーブル型 (実線格子No付き4列テーブル、No列排除、ベクター図形タイトクロップ)
"""

import os
import sys
import fitz

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from legend_extractor import extract_legends

def create_case1_yamanashi_ancon(pdf_path: str):
    """Case 1: 山梨アンコン型"""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)

    # Stage outline
    page.draw_rect(fitz.Rect(50, 100, 545, 500), color=(0.3, 0.3, 0.3), width=1.5)

    # 1. Top noise: 数量記入欄・丸囲み指示
    page.insert_text(fitz.Point(70, 45), "椅子 (   ) 個  譜面台 (   ) 本  【立奏・座奏】○をつける", fontsize=10, fontname="japan")

    # 2. Top-left noise: 借用品(○印), ・ピアノ椅子(  )個, ・電源
    page.insert_text(fitz.Point(60, 75), "借用品(○印)  ・ピアノ椅子(  )個  ・電源", fontsize=9, fontname="japan")

    # 3. Bottom legend: 椅子 → ○   ピアノ椅子 → ◎   譜面台 →        ×
    # Note wide gap between → and × for 譜面台
    page.insert_text(fitz.Point(70, 750), "椅子 → ○   ピアノ椅子 → ◎   譜面台 →        ×", fontsize=11, fontname="japan")

    doc.save(pdf_path)
    doc.close()


def create_case2_yamanashi_concours(pdf_path: str):
    """Case 2: 山梨コンクール型"""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)

    # Stage outline
    page.draw_rect(fitz.Rect(120, 80, 500, 550), color=(0.3, 0.3, 0.3), width=1.5)

    # Inside stage: unlabeled ピアノ outline shape
    page.draw_rect(fitz.Rect(200, 250, 260, 310), color=(0.2, 0.2, 0.8), width=1.0)
    page.insert_text(fitz.Point(215, 280), "ピアノ", fontsize=10, fontname="japan")

    # Stage left margin: small box containing justified ＝ legends
    page.draw_rect(fitz.Rect(20, 300, 105, 420), color=(0.4, 0.4, 0.4), width=1.0)
    page.insert_text(fitz.Point(28, 335), "椅 子＝○", fontsize=10, fontname="japan")
    page.insert_text(fitz.Point(28, 365), "ピアノ椅子＝◎", fontsize=10, fontname="japan")
    page.insert_text(fitz.Point(28, 395), "譜面台＝×", fontsize=10, fontname="japan")

    # Right margin: ○椅 子（  ）脚 (Quantity entry noise)
    page.insert_text(fitz.Point(510, 350), "○椅 子（  ）脚", fontsize=10, fontname="japan")

    # Bottom right: dimension 3.7 and table 蓋 | 全開・半開
    page.insert_text(fitz.Point(450, 680), "3.7", fontsize=10, fontname="japan")
    page.draw_rect(fitz.Rect(440, 700, 550, 740), color=(0.4, 0.4, 0.4), width=1.0)
    page.insert_text(fitz.Point(445, 725), "蓋 | 全開・半開", fontsize=9, fontname="japan")

    doc.save(pdf_path)
    doc.close()


def create_case3_ibaraki_kenhoku(pdf_path: str):
    """Case 3: 茨城県北型"""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)

    # Left side: Stage border and dimension 9m
    page.draw_rect(fitz.Rect(50, 80, 400, 600), color=(0.3, 0.3, 0.3), width=1.5)
    page.insert_text(fitz.Point(30, 300), "9m", fontsize=10, fontname="japan")

    # Stage center bottom: 指揮台
    page.draw_rect(fitz.Rect(200, 520, 250, 560), color=(0.2, 0.2, 0.8), width=1.0)
    page.insert_text(fitz.Point(210, 545), "指揮台", fontsize=9, fontname="japan")

    # Top-right header legends:
    # 椅子(○) | 譜面台(X)
    page.insert_text(fitz.Point(420, 100), "椅子(○)   譜面台(X)", fontsize=10, fontname="japan")
    # Below it: 電源 (☆)
    page.insert_text(fitz.Point(420, 130), "電源 (☆)", fontsize=10, fontname="japan")
    # ピアノ椅子 (■) with small black square
    page.insert_text(fitz.Point(420, 160), "ピアノ椅子 (■)", fontsize=10, fontname="japan")

    doc.save(pdf_path)
    doc.close()


def create_case4_ibaraki_chuo(pdf_path: str):
    """Case 4: 茨城中央型"""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)

    # Stage outline
    page.draw_rect(fitz.Rect(60, 120, 520, 550), color=(0.3, 0.3, 0.3), width=1.5)

    # Top-left table: 電源 | 有無 | 借持
    page.draw_rect(fitz.Rect(60, 40, 200, 90), color=(0.4, 0.4, 0.4), width=1.0)
    page.insert_text(fitz.Point(65, 65), "電源 | 有無 | 借持", fontsize=9, fontname="japan")

    # Top-right table: 二段目 | 一段目
    page.draw_rect(fitz.Rect(380, 40, 520, 90), color=(0.4, 0.4, 0.4), width=1.0)
    page.insert_text(fitz.Point(385, 65), "二段目 | 一段目", fontsize=9, fontname="japan")

    # Bottom-right rounded box with justified + space delimited legends:
    # 椅   子 ○
    # 譜 面 台 ×
    # ピアノ椅子 □
    # 電   源 ☆
    page.draw_rect(fitz.Rect(360, 640, 520, 780), color=(0.2, 0.2, 0.2), width=1.2)
    page.insert_text(fitz.Point(380, 670), "椅   子 ○", fontsize=11, fontname="japan")
    page.insert_text(fitz.Point(380, 700), "譜 面 台 ×", fontsize=11, fontname="japan")
    page.insert_text(fitz.Point(380, 730), "ピアノ椅子 □", fontsize=11, fontname="japan")
    page.insert_text(fitz.Point(380, 760), "電   源 ☆", fontsize=11, fontname="japan")

    # Bottom noise: オフステージA and dotted line 7.2m
    page.insert_text(fitz.Point(80, 680), "オフステージA", fontsize=10, fontname="japan")
    page.insert_text(fitz.Point(80, 710), "7.2m", fontsize=10, fontname="japan")

    doc.save(pdf_path)
    doc.close()


def create_case5_ibaraki_66(pdf_path: str):
    """Case 5: 第66回茨城型"""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)

    # Top noise: 大会当日受付に8部, 出演者数, 17.4m
    page.insert_text(fitz.Point(80, 50), "大会当日受付に8部提出", fontsize=10, fontname="japan")
    page.insert_text(fitz.Point(260, 50), "出演者数", fontsize=10, fontname="japan")
    page.insert_text(fitz.Point(400, 50), "17.4m", fontsize=10, fontname="japan")

    # Stage outline
    page.draw_rect(fitz.Rect(50, 90, 420, 650), color=(0.3, 0.3, 0.3), width=1.5)

    # Right side legends with 〜印:
    page.insert_text(fitz.Point(440, 200), "椅子  ○印", fontsize=11, fontname="japan")
    page.insert_text(fitz.Point(440, 240), "譜面台  ×印", fontsize=11, fontname="japan")
    page.insert_text(fitz.Point(440, 280), "ピアノ椅子 □印", fontsize=11, fontname="japan")
    page.insert_text(fitz.Point(440, 320), "（持参・借用 脚）", fontsize=9, fontname="japan")
    page.insert_text(fitz.Point(440, 360), "電源  ☆印", fontsize=11, fontname="japan")
    page.insert_text(fitz.Point(440, 400), "ピアノ開閉について ○で囲んでください", fontsize=9, fontname="japan")

    # Bottom noise: (部は○で囲む)
    page.insert_text(fitz.Point(100, 720), "(部は○で囲む)", fontsize=10, fontname="japan")

    doc.save(pdf_path)
    doc.close()


def create_case6_shiga_concours(pdf_path: str):
    """Case 6: 滋賀コンクール型"""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)

    # Stage outline
    page.draw_rect(fitz.Rect(50, 80, 545, 550), color=(0.3, 0.3, 0.3), width=1.5)

    # Top right: 列別集計表
    page.draw_rect(fitz.Rect(380, 30, 545, 75), color=(0.4, 0.4, 0.4), width=1.0)
    page.insert_text(fitz.Point(390, 55), "1段目 | 2段目 | 上段 | 下段", fontsize=9, fontname="japan")

    # Bottom: 椅子・・・○ ピアノ椅子・・・● 譜面台・・・×
    page.insert_text(fitz.Point(70, 720), "椅子・・・○    ピアノ椅子・・・●    譜面台・・・×", fontsize=11, fontname="japan")
    # Caution text: ＊ピアノは下手固定でお願いします。
    page.insert_text(fitz.Point(70, 760), "＊ピアノは下手固定でお願いします。", fontsize=10, fontname="japan")

    doc.save(pdf_path)
    doc.close()


def create_case7_cad_table(pdf_path: str):
    """Case 7: CAD標準4列テーブル型"""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)

    # Stage outline
    page.draw_rect(fitz.Rect(50, 50, 545, 450), color=(0.2, 0.2, 0.2), width=1.5)

    # Grid table with physical lines
    top_y = 520
    row_h = 28
    cols_x = [70, 110, 180, 320, 450]  # No, 記号, 名称, 数量

    headers = ["No.", "記号", "名称", "数量"]
    rows = [
        ["1", "", "折りたたみ椅子", "40脚"],
        ["2", "", "合奏用譜面台", "35本"],
        ["3", "", "ピアノ椅子", "1脚"]
    ]

    # Draw grid lines
    for i in range(len(rows) + 2):
        y = top_y + i * row_h
        page.draw_line(fitz.Point(cols_x[0], y), fitz.Point(cols_x[-1], y), color=(0.0, 0.0, 0.0), width=1.0)
    for x in cols_x:
        page.draw_line(fitz.Point(x, top_y), fitz.Point(x, top_y + (len(rows) + 1) * row_h), color=(0.0, 0.0, 0.0), width=1.0)

    # Insert headers
    for c_idx, h_text in enumerate(headers):
        page.insert_text(fitz.Point(cols_x[c_idx] + 8, top_y + 18), h_text, fontsize=11, fontname="japan")

    # Insert row texts and vector shapes in '記号' column
    for r_idx, r_data in enumerate(rows):
        y = top_y + (r_idx + 1) * row_h
        page.insert_text(fitz.Point(cols_x[0] + 10, y + 18), r_data[0], fontsize=11, fontname="japan")
        page.insert_text(fitz.Point(cols_x[2] + 10, y + 18), r_data[2], fontsize=11, fontname="japan")
        page.insert_text(fitz.Point(cols_x[3] + 10, y + 18), r_data[3], fontsize=11, fontname="japan")

        # Draw a vector rectangle touching the top line of the cell (y)
        shape_rect = fitz.Rect(cols_x[1] + 15, y, cols_x[1] + 35, y + 18)
        page.draw_rect(shape_rect, color=(0.1, 0.1, 0.8), fill=(0.8, 0.8, 1.0), width=1.0)

    doc.save(pdf_path)
    doc.close()


def run_all_tests():
    print("=" * 70)
    print("RUNNING 7 REAL-WORLD LAYOUT TESTS FOR LEGEND EXTRACTOR ENGINE")
    print("=" * 70)

    os.makedirs("/tmp/legend_tests", exist_ok=True)

    # --- Test 1: 山梨アンコン型 ---
    p1 = "/tmp/legend_tests/case1_yamanashi_ancon.pdf"
    create_case1_yamanashi_ancon(p1)
    doc1 = fitz.open(p1)
    items1 = extract_legends(doc1)
    names1 = [it.name for it in items1]
    print(f"\n[Case 1: 山梨アンコン型] Extracted ({len(items1)}): {names1}")
    for it in items1:
        print(f"  - {it.name:<12} | sym: {it.raw_symbol_text} | box: {it.symbol_box.to_dict()}")
    assert len(items1) == 3, f"Expected exactly 3 items, got {len(items1)}: {names1}"
    assert any("椅子" in n for n in names1)
    assert any("ピアノ椅子" in n for n in names1)
    assert any("譜面台" in n for n in names1)
    # Check that 譜面台 paired with ×, NOT ◎
    fumentai_item = next(it for it in items1 if "譜面台" in it.name)
    assert fumentai_item.raw_symbol_text == "×", f"譜面台 incorrectly paired with {fumentai_item.raw_symbol_text}"
    print("  => Case 1 PASSED (0 False Positives)!")

    # --- Test 2: 山梨コンクール型 ---
    p2 = "/tmp/legend_tests/case2_yamanashi_concours.pdf"
    create_case2_yamanashi_concours(p2)
    doc2 = fitz.open(p2)
    items2 = extract_legends(doc2)
    names2 = [it.name for it in items2]
    print(f"\n[Case 2: 山梨コンクール型] Extracted ({len(items2)}): {names2}")
    for it in items2:
        print(f"  - {it.name:<12} | sym: {it.raw_symbol_text} | box: {it.symbol_box.to_dict()}")
    assert len(items2) == 3, f"Expected exactly 3 items, got {len(items2)}: {names2}"
    assert not any("3.7" in n or "全開" in n for n in names2)
    print("  => Case 2 PASSED (0 False Positives)!")

    # --- Test 3: 茨城県北型 ---
    p3 = "/tmp/legend_tests/case3_ibaraki_kenhoku.pdf"
    create_case3_ibaraki_kenhoku(p3)
    doc3 = fitz.open(p3)
    items3 = extract_legends(doc3)
    names3 = [it.name for it in items3]
    print(f"\n[Case 3: 茨城県北型] Extracted ({len(items3)}): {names3}")
    for it in items3:
        print(f"  - {it.name:<12} | sym: {it.raw_symbol_text} | box: {it.symbol_box.to_dict()}")
    assert len(items3) == 4, f"Expected exactly 4 items, got {len(items3)}: {names3}"
    assert not any("9m" in n for n in names3)
    assert any("譜面台" in n for n in names3)
    assert any("電源" in n for n in names3)
    assert any("ピアノ椅子" in n for n in names3)
    print("  => Case 3 PASSED (0 False Positives)!")

    # --- Test 4: 茨城中央型 ---
    p4 = "/tmp/legend_tests/case4_ibaraki_chuo.pdf"
    create_case4_ibaraki_chuo(p4)
    doc4 = fitz.open(p4)
    items4 = extract_legends(doc4)
    names4 = [it.name for it in items4]
    print(f"\n[Case 4: 茨城中央型] Extracted ({len(items4)}): {names4}")
    for it in items4:
        print(f"  - {it.name:<12} | sym: {it.raw_symbol_text} | box: {it.symbol_box.to_dict()}")
    assert len(items4) == 4, f"Expected exactly 4 items, got {len(items4)}: {names4}"
    assert not any("有無" in n or "二段目" in n or "オフステージ" in n or "7.2m" in n for n in names4)
    print("  => Case 4 PASSED (0 False Positives)!")

    # --- Test 5: 第66回茨城型 ---
    p5 = "/tmp/legend_tests/case5_ibaraki_66.pdf"
    create_case5_ibaraki_66(p5)
    doc5 = fitz.open(p5)
    items5 = extract_legends(doc5)
    names5 = [it.name for it in items5]
    print(f"\n[Case 5: 第66回茨城型] Extracted ({len(items5)}): {names5}")
    for it in items5:
        print(f"  - {it.name:<12} | sym: {it.raw_symbol_text} | box: {it.symbol_box.to_dict()}")
    assert len(items5) == 4, f"Expected exactly 4 items, got {len(items5)}: {names5}"
    assert not any("受付" in n or "出演者" in n or "17.4m" in n or "囲む" in n for n in names5)
    # Check that '印' is NOT in symbol_box
    for it in items5:
        assert it.symbol_box.width < 25.0, f"Symbol box for {it.name} too wide, contains 印: {it.symbol_box.to_dict()}"
    print("  => Case 5 PASSED (0 False Positives, '印' cleanly excluded)!")

    # --- Test 6: 滋賀コンクール型 ---
    p6 = "/tmp/legend_tests/case6_shiga_concours.pdf"
    create_case6_shiga_concours(p6)
    doc6 = fitz.open(p6)
    items6 = extract_legends(doc6)
    names6 = [it.name for it in items6]
    print(f"\n[Case 6: 滋賀コンクール型] Extracted ({len(items6)}): {names6}")
    for it in items6:
        print(f"  - {it.name:<12} | sym: {it.raw_symbol_text} | box: {it.symbol_box.to_dict()}")
    assert len(items6) == 3, f"Expected exactly 3 items, got {len(items6)}: {names6}"
    assert not any("固定" in n or "1段目" in n for n in names6)
    # Check that leader dots are not bleeding into symbol_box
    for it in items6:
        assert it.symbol_box.width < 25.0, f"Symbol box for {it.name} too wide: {it.symbol_box.to_dict()}"
    print("  => Case 6 PASSED (0 False Positives, leader dots cleanly masked)!")

    # --- Test 7: CAD標準4列テーブル型 ---
    p7 = "/tmp/legend_tests/case7_cad_table.pdf"
    create_case7_cad_table(p7)
    doc7 = fitz.open(p7)
    items7 = extract_legends(doc7)
    names7 = [it.name for it in items7]
    print(f"\n[Case 7: CAD標準4列テーブル型] Extracted ({len(items7)}): {names7}")
    for it in items7:
        print(f"  - {it.name:<12} | type: {it.symbol_type} | box: {it.symbol_box.to_dict()}")
    assert len(items7) == 3, f"Expected exactly 3 items, got {len(items7)}: {names7}"
    assert not any(n.isdigit() for n in names7)
    for it in items7:
        assert it.symbol_box.width < 35.0, f"Symbol box too wide for {it.name}"
    print("  => Case 7 PASSED (0 False Positives, tight vector crop)!")

    print("\n" + "=" * 70)
    print("ALL 7 REAL-WORLD LAYOUT TESTS PASSED WITH 0 FALSE POSITIVES!")
    print("=" * 70)
    return True

if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
