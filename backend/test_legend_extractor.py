"""
Comprehensive 10-Case Verification Test Suite for Legend Extractor Engine.
Faithfully tests all 10 real-world competition stage layout diagram edge cases:
1. 山梨コンクール型 (左下枠の3凡例 ＋ 右下の縦書き ピアノ|使う・使わない 表 -> 左下3件のみ、右下ピアノ誤検出0件)
2. 茨城県北型 (椅子(○), 譜面台(X), 電源(☆), ピアノ椅子(■) -> 括弧・セル罫線を含まないタイト切り抜き)
3. 滋賀コンクール型 (1行に 椅子…○ ピアノ椅子…● 譜面台…× ＋ 右隣に ピアノ使用|する・しない 表 -> 3件すべて抽出)
4. 宮崎コンクール型 (5列の 1〜4段目 椅子ー○ / 譜面台ーY ＋ ※借用ピアノ椅子は [h] と記入... ＋ 電源使用ー★ -> 重複なく4件のみ)
5. 佐賀型 (譜面台|台|記号[┬], 椅子|脚|記号○, ※A……電源100V, 余白 Timp., B.D., Marinba. -> 6件すべて抽出)
6. 北九州吹奏楽祭・コンクール型 (<例> イス：○ 譜面台：Y 指揮台：[▭] 指揮者用譜面台：[┬] ピアノ用椅子：[Ⓟ] 電源：[(||)] ＋ 退場(花道)➡（チューバ・弦バス） -> 6件抽出、退場/チューバ0件)
7. 福岡コンクール型 (・譜面台 T ____台 ・椅子 ○ ____脚 ・ピアノ椅子 ◎ ____脚 -> 下線除外、3件抽出)
8. 徳島コンクール型 (左に注意書き ＋ 右下に ○…椅子 / ×…譜面台（最大70本） / ◎…ピアノ椅子 -> 3件抽出、最大70本除外)
9. 相模原アンコン型 (※会館の通常椅子は○印、会館のピアノ椅子は (P)、持ち込み椅子は●、譜面台は×印で記入する。 -> 4件抽出)
10. CAD標準4列テーブル型 (実線格子No付き4列テーブル、No列排除、ベクター図形タイトクロップ -> 3件抽出)
"""

import os
import sys
import fitz

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from legend_extractor import extract_legends

def create_case1_yamanashi_concours(pdf_path: str):
    """
    Case 1: 山梨コンクール型
    左下枠の3凡例 ＋ 右下の ピアノ|使う・使わない 表
    期待: 左下3件のみ、右下のピアノ誤検出0件
    """
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

    # Bottom right: dimension 3.7 and table ピアノ | 使う・使わない | 蓋 | 全開・半開
    page.insert_text(fitz.Point(450, 680), "3.7", fontsize=10, fontname="japan")
    page.draw_rect(fitz.Rect(440, 700, 560, 780), color=(0.4, 0.4, 0.4), width=1.0)
    page.draw_line(fitz.Point(440, 740), fitz.Point(560, 740), color=(0.4, 0.4, 0.4), width=1.0)
    page.draw_line(fitz.Point(490, 700), fitz.Point(490, 780), color=(0.4, 0.4, 0.4), width=1.0)
    page.insert_text(fitz.Point(445, 725), "ピアノ", fontsize=10, fontname="japan")
    page.insert_text(fitz.Point(495, 725), "使う・使わない", fontsize=8, fontname="japan")
    page.insert_text(fitz.Point(445, 765), "蓋", fontsize=10, fontname="japan")
    page.insert_text(fitz.Point(495, 765), "全開・半開", fontsize=9, fontname="japan")

    doc.save(pdf_path)
    doc.close()


def create_case2_ibaraki_kenhoku(pdf_path: str):
    """
    Case 2: 茨城県北型
    椅子(○), 譜面台(X), 電源(☆), ピアノ椅子(■) ＋ 直下の縦罫線
    期待: 括弧やセル罫線を含まず中身の記号4件のみタイトに切り抜き
    """
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)

    # Left side: Stage border and dimension 9m
    page.draw_rect(fitz.Rect(50, 80, 400, 600), color=(0.3, 0.3, 0.3), width=1.5)
    page.insert_text(fitz.Point(30, 300), "9m", fontsize=10, fontname="japan")

    # Stage center bottom: 指揮台
    page.draw_rect(fitz.Rect(200, 520, 250, 560), color=(0.2, 0.2, 0.8), width=1.0)
    page.insert_text(fitz.Point(210, 545), "指揮台", fontsize=9, fontname="japan")

    # Top-right header legends with vertical cell lines
    # Table borders
    page.draw_line(fitz.Point(415, 80), fitz.Point(575, 80), color=(0.0, 0.0, 0.0), width=1.0)
    page.draw_line(fitz.Point(415, 115), fitz.Point(575, 115), color=(0.0, 0.0, 0.0), width=1.0)
    page.draw_line(fitz.Point(415, 145), fitz.Point(575, 145), color=(0.0, 0.0, 0.0), width=1.0)
    page.draw_line(fitz.Point(415, 175), fitz.Point(575, 175), color=(0.0, 0.0, 0.0), width=1.0)
    page.draw_line(fitz.Point(415, 80), fitz.Point(415, 175), color=(0.0, 0.0, 0.0), width=1.0)
    page.draw_line(fitz.Point(495, 80), fitz.Point(495, 115), color=(0.0, 0.0, 0.0), width=1.0)
    page.draw_line(fitz.Point(575, 80), fitz.Point(575, 175), color=(0.0, 0.0, 0.0), width=1.0)

    # 椅子(○) | 譜面台(X)
    page.insert_text(fitz.Point(420, 102), "椅子(○)", fontsize=10, fontname="japan")
    page.insert_text(fitz.Point(500, 102), "譜面台(X)", fontsize=10, fontname="japan")
    # Below it: 電源 (☆)
    page.insert_text(fitz.Point(420, 132), "電源 (☆)", fontsize=10, fontname="japan")
    # ピアノ椅子 (■)
    page.insert_text(fitz.Point(420, 162), "ピアノ椅子 (■)", fontsize=10, fontname="japan")

    doc.save(pdf_path)
    doc.close()


def create_case3_shiga_concours(pdf_path: str):
    """
    Case 3: 滋賀コンクール型
    1行に 椅子…○ ピアノ椅子…● 譜面台…× ＋ 右隣に ピアノ使用 | する・しない
    期待: 3件すべて漏れなく抽出、ピアノ使用表は除外
    """
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)

    # Stage outline
    page.draw_rect(fitz.Rect(50, 80, 545, 550), color=(0.3, 0.3, 0.3), width=1.5)

    # Bottom: 椅子…○ ピアノ椅子…● 譜面台…×
    page.insert_text(fitz.Point(60, 720), "椅子…○    ピアノ椅子…●    譜面台…×", fontsize=11, fontname="japan")

    # Right side table: ピアノ使用 | する・しない
    page.draw_rect(fitz.Rect(400, 700, 550, 740), color=(0.4, 0.4, 0.4), width=1.0)
    page.draw_line(fitz.Point(470, 700), fitz.Point(470, 740), color=(0.4, 0.4, 0.4), width=1.0)
    page.insert_text(fitz.Point(405, 725), "ピアノ使用", fontsize=9, fontname="japan")
    page.insert_text(fitz.Point(475, 725), "する・しない", fontsize=9, fontname="japan")

    # Caution text: ＊ピアノは下手固定でお願いします。
    page.insert_text(fitz.Point(60, 760), "＊ピアノは下手固定でお願いします。", fontsize=10, fontname="japan")

    doc.save(pdf_path)
    doc.close()


def create_case4_miyazaki_concours(pdf_path: str):
    """
    Case 4: 宮崎コンクール型
    5列の 1段目〜4段目 椅子ー○ / 譜面台ーY
    ＋ ※借用ピアノ椅子は [h] と記入し、赤○で囲んでください。
    ＋ 電源使用ー★（・を○で囲む）
    期待: 重複なく 椅子, 譜面台, 借用ピアノ椅子, 電源 の計4件のみ抽出
    """
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)

    # Stage outline
    page.draw_rect(fitz.Rect(50, 100, 545, 500), color=(0.3, 0.3, 0.3), width=1.5)

    # Tiered columns (5 repetitions of 椅子ー○ and 譜面台ーY)
    col_x = [60, 150, 240, 330, 420]
    headers = ["ベタ", "1段目", "2段目", "3段目", "4段目"]
    for idx, x in enumerate(col_x):
        page.insert_text(fitz.Point(x, 600), headers[idx], fontsize=9, fontname="japan")
        page.insert_text(fitz.Point(x, 620), "椅子ー○", fontsize=10, fontname="japan")
        page.insert_text(fitz.Point(x, 640), "譜面台ーY", fontsize=10, fontname="japan")

    # In-sentence note: ※借用ピアノ椅子は [h] と記入し、赤○で囲んでください。
    page.insert_text(fitz.Point(60, 700), "※借用ピアノ椅子は", fontsize=10, fontname="japan")
    # Inline vector 'h' icon
    h_rect = fitz.Rect(155, 688, 168, 702)
    page.draw_line(fitz.Point(157, 688), fitz.Point(157, 702), color=(0.0, 0.0, 0.0), width=1.2)
    page.draw_line(fitz.Point(157, 695), fitz.Point(166, 695), color=(0.0, 0.0, 0.0), width=1.2)
    page.draw_line(fitz.Point(166, 695), fitz.Point(166, 702), color=(0.0, 0.0, 0.0), width=1.2)
    page.insert_text(fitz.Point(175, 700), "と記入し、赤○で囲んでください。", fontsize=10, fontname="japan")

    # Delimiter note: 電源使用ー★（・を○で囲む）
    page.insert_text(fitz.Point(60, 740), "電源使用ー★（・を○で囲む）", fontsize=10, fontname="japan")

    doc.save(pdf_path)
    doc.close()


def create_case5_saga(pdf_path: str):
    """
    Case 5: 佐賀型
    譜面台 | 台 | 記号 [┬ベクター]
    椅子 | 脚 | 記号 ○
    ※A……電源100V
    右下余白の Timp., B.D., Marinba. ミニチュア図形
    期待: すべて抽出 (計6件)
    """
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)

    # Stage outline
    page.draw_rect(fitz.Rect(50, 100, 545, 550), color=(0.3, 0.3, 0.3), width=1.5)

    # Table with 記号 cell header
    top_y = 600
    page.draw_rect(fitz.Rect(60, top_y, 350, top_y + 60), color=(0.4, 0.4, 0.4), width=1.0)
    page.draw_line(fitz.Point(60, top_y + 30), fitz.Point(350, top_y + 30), color=(0.4, 0.4, 0.4), width=1.0)
    page.draw_line(fitz.Point(130, top_y), fitz.Point(130, top_y + 60), color=(0.4, 0.4, 0.4), width=1.0)
    page.draw_line(fitz.Point(190, top_y), fitz.Point(190, top_y + 60), color=(0.4, 0.4, 0.4), width=1.0)
    page.draw_line(fitz.Point(250, top_y), fitz.Point(250, top_y + 60), color=(0.4, 0.4, 0.4), width=1.0)

    # Row 1: 譜面台 | 台 | 記号 | [┬]
    page.insert_text(fitz.Point(70, top_y + 20), "譜面台", fontsize=10, fontname="japan")
    page.insert_text(fitz.Point(145, top_y + 20), "台", fontsize=10, fontname="japan")
    page.insert_text(fitz.Point(205, top_y + 20), "記号", fontsize=10, fontname="japan")
    # Draw [┬] shape
    page.draw_line(fitz.Point(270, top_y + 10), fitz.Point(290, top_y + 10), color=(0.0, 0.0, 0.0), width=1.5)
    page.draw_line(fitz.Point(280, top_y + 10), fitz.Point(280, top_y + 25), color=(0.0, 0.0, 0.0), width=1.5)

    # Row 2: 椅子 | 脚 | 記号 | ○
    page.insert_text(fitz.Point(70, top_y + 50), "椅子", fontsize=10, fontname="japan")
    page.insert_text(fitz.Point(145, top_y + 50), "脚", fontsize=10, fontname="japan")
    page.insert_text(fitz.Point(205, top_y + 50), "記号", fontsize=10, fontname="japan")
    page.insert_text(fitz.Point(275, top_y + 50), "○", fontsize=11, fontname="japan")

    # Left-symbol pattern: ※A……電源100V
    page.insert_text(fitz.Point(60, 700), "※A……電源100V", fontsize=10, fontname="japan")

    # Bottom margin percussion miniatures: Timp., B.D., Marinba.
    perc_x = [380, 440, 500]
    perc_names = ["Timp.", "B.D.", "Marinba."]
    for idx, px in enumerate(perc_x):
        # Draw vector icon (circle / rect 20x20)
        page.draw_rect(fitz.Rect(px, 730, px + 22, 752), color=(0.1, 0.5, 0.1), width=1.2)
        page.insert_text(fitz.Point(px, 768), perc_names[idx], fontsize=9)

    doc.save(pdf_path)
    doc.close()


def create_case6_kitakyushu(pdf_path: str):
    """
    Case 6: 北九州吹奏楽祭・コンクール型
    <例> イス：○ 譜面台：Y 指揮台：[▭] 指揮者用譜面台：[┬] ピアノ用椅子：[Ⓟ] 電源：[(||)]
    ＋ 退場(花道)➡（チューバ・弦バス）
    期待: <例>混入せず イス〜電源 の6件すべて抽出、退場/チューバ0件
    """
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)

    # Stage outline
    page.draw_rect(fitz.Rect(50, 100, 545, 550), color=(0.3, 0.3, 0.3), width=1.5)

    # Legends line:
    # イス：○
    page.insert_text(fitz.Point(50, 50), "<例> イス：○", fontsize=10, fontname="japan")
    # 譜面台：Y
    page.insert_text(fitz.Point(140, 50), "譜面台：Y", fontsize=10, fontname="japan")
    # 指揮台：[▭]
    page.insert_text(fitz.Point(215, 50), "指揮台：", fontsize=10, fontname="japan")
    page.draw_rect(fitz.Rect(260, 40, 276, 52), color=(0.0, 0.0, 0.0), width=1.2)
    # 指揮者用譜面台：[┬]
    page.insert_text(fitz.Point(290, 50), "指揮者用譜面台：", fontsize=10, fontname="japan")
    page.draw_line(fitz.Point(375, 42), fitz.Point(391, 42), color=(0.0, 0.0, 0.0), width=1.2)
    page.draw_line(fitz.Point(383, 42), fitz.Point(383, 52), color=(0.0, 0.0, 0.0), width=1.2)
    # ピアノ用椅子：[Ⓟ]
    page.insert_text(fitz.Point(405, 50), "ピアノ用椅子：", fontsize=10, fontname="japan")
    page.draw_circle(fitz.Point(485, 46), 7, color=(0.0, 0.0, 0.0), width=1.0)
    page.insert_text(fitz.Point(481, 50), "P", fontsize=8)
    # 電源：[(||)]
    page.insert_text(fitz.Point(505, 50), "電源：", fontsize=10, fontname="japan")
    page.draw_circle(fitz.Point(550, 46), 7, color=(0.0, 0.0, 0.0), width=1.0)
    page.draw_line(fitz.Point(548, 42), fitz.Point(548, 50), color=(0.0, 0.0, 0.0), width=1.2)
    page.draw_line(fitz.Point(552, 42), fitz.Point(552, 50), color=(0.0, 0.0, 0.0), width=1.2)

    # Caution / Stage circulation: 退場(花道)➡（チューバ・弦バス）
    page.insert_text(fitz.Point(60, 700), "退場(花道)➡（チューバ・弦バス）", fontsize=10, fontname="japan")

    doc.save(pdf_path)
    doc.close()


def create_case7_fukuoka(pdf_path: str):
    """
    Case 7: 福岡コンクール型
    [図示してください] ・譜面台 T ____台 ・椅子 ○ ____脚 ・ピアノ椅子 ◎ ____脚
    期待: 下線除外、T, ○, ◎ の3件すべて抽出
    """
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)

    # Stage outline
    page.draw_rect(fitz.Rect(50, 100, 545, 550), color=(0.3, 0.3, 0.3), width=1.5)

    page.insert_text(fitz.Point(60, 60), "[図示してください]", fontsize=10, fontname="japan")

    # ・譜面台 T ____台
    page.insert_text(fitz.Point(60, 650), "・譜面台  T", fontsize=11, fontname="japan")
    page.draw_line(fitz.Point(140, 652), fitz.Point(180, 652), color=(0.0, 0.0, 0.0), width=1.0) # underline
    page.insert_text(fitz.Point(185, 650), "台", fontsize=11, fontname="japan")

    # ・椅子 ○ ____脚
    page.insert_text(fitz.Point(210, 650), "・椅子  ○", fontsize=11, fontname="japan")
    page.draw_line(fitz.Point(270, 652), fitz.Point(310, 652), color=(0.0, 0.0, 0.0), width=1.0) # underline
    page.insert_text(fitz.Point(315, 650), "脚", fontsize=11, fontname="japan")

    # ・ピアノ椅子 ◎ ____脚
    page.insert_text(fitz.Point(340, 650), "・ピアノ椅子  ◎", fontsize=11, fontname="japan")
    page.draw_line(fitz.Point(435, 652), fitz.Point(475, 652), color=(0.0, 0.0, 0.0), width=1.0) # underline
    page.insert_text(fitz.Point(480, 650), "脚", fontsize=11, fontname="japan")

    doc.save(pdf_path)
    doc.close()


def create_case8_tokushima(pdf_path: str):
    """
    Case 8: 徳島コンクール型
    左に注意書き ＋ 右下に ○…椅子 / ×…譜面台（最大70本） / ◎…ピアノ椅子
    期待: 3件すべて抽出、name に （最大70本） を含めない
    """
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)

    # Stage outline
    page.draw_rect(fitz.Rect(50, 80, 545, 550), color=(0.3, 0.3, 0.3), width=1.5)

    # Left caution text: 〜してください。
    page.insert_text(fitz.Point(60, 620), "※配置図は黒ボールペンではっきりとご記入ください。", fontsize=9, fontname="japan")
    page.insert_text(fitz.Point(60, 640), "※打楽器の位置は正確に記載してください。", fontsize=9, fontname="japan")

    # Right bottom left-symbol legends:
    # ○…椅子
    page.insert_text(fitz.Point(380, 620), "○…椅子", fontsize=11, fontname="japan")
    # ×…譜面台（最大70本）
    page.insert_text(fitz.Point(380, 650), "×…譜面台（最大70本）", fontsize=11, fontname="japan")
    # ◎…ピアノ椅子
    page.insert_text(fitz.Point(380, 680), "◎…ピアノ椅子", fontsize=11, fontname="japan")

    doc.save(pdf_path)
    doc.close()


def create_case9_sagamihara_ancon(pdf_path: str):
    """
    Case 9: 相模原アンコン型
    ※会館の通常椅子は○印、会館のピアノ椅子は (P)、持ち込み椅子は●、譜面台は×印で記入する。
    期待: 印を含めず4件すべて抽出
    """
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)

    # Stage outline
    page.draw_rect(fitz.Rect(50, 100, 545, 550), color=(0.3, 0.3, 0.3), width=1.5)

    # In-sentence multi-equipment legend definition
    page.insert_text(
        fitz.Point(50, 650),
        "※会館の通常椅子は○印、会館のピアノ椅子は (P)、持ち込み椅子は●、譜面台は×印で記入する。",
        fontsize=10,
        fontname="japan"
    )

    doc.save(pdf_path)
    doc.close()


def create_case10_cad_table(pdf_path: str):
    """
    Case 10: CAD標準4列テーブル型
    実線格子No付き4列テーブル、No列排除、ベクター図形タイトクロップ
    期待: 3件抽出
    """
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


def run_all_10_tests():
    print("=" * 75)
    print("RUNNING 10 REAL-WORLD LAYOUT TESTS FOR LEGEND EXTRACTOR ENGINE")
    print("=" * 75)

    os.makedirs("/tmp/legend_tests", exist_ok=True)
    all_passed = True

    # --- Test 1: 山梨コンクール型 ---
    p1 = "/tmp/legend_tests/case1_yamanashi_concours.pdf"
    create_case1_yamanashi_concours(p1)
    doc1 = fitz.open(p1)
    items1 = extract_legends(doc1)
    names1 = [it.name for it in items1]
    print(f"\n[Case 1: 山梨コンクール型] Extracted ({len(items1)}): {names1}")
    for it in items1:
        print(f"  - {it.name:<14} | sym: {it.raw_symbol_text} | box: {it.symbol_box.to_dict()}")
    assert len(items1) == 3, f"Expected exactly 3 items, got {len(items1)}: {names1}"
    assert not any("3.7" in n or "全開" in n for n in names1)
    assert not any(n == "ピアノ" for n in names1), f"Right-bottom ピアノ table false positive: {names1}"
    print("  => Case 1 PASSED (0 False Positives, table piano excluded)!")

    # --- Test 2: 茨城県北型 ---
    p2 = "/tmp/legend_tests/case2_ibaraki_kenhoku.pdf"
    create_case2_ibaraki_kenhoku(p2)
    doc2 = fitz.open(p2)
    items2 = extract_legends(doc2)
    names2 = [it.name for it in items2]
    print(f"\n[Case 2: 茨城県北型] Extracted ({len(items2)}): {names2}")
    for it in items2:
        print(f"  - {it.name:<14} | sym: {it.raw_symbol_text} | box: {it.symbol_box.to_dict()}")
    assert len(items2) == 4, f"Expected exactly 4 items, got {len(items2)}: {names2}"
    assert not any("9m" in n for n in names2)
    assert any("椅子" in n for n in names2)
    assert any("譜面台" in n for n in names2)
    assert any("電源" in n for n in names2)
    assert any("ピアノ椅子" in n for n in names2)
    # Check that brackets and vertical borders did not expand symbol width
    for it in items2:
        assert it.symbol_box.width < 22.0, f"Symbol box for {it.name} bleeds into brackets or lines: {it.symbol_box.to_dict()}"
    print("  => Case 2 PASSED (0 False Positives, bracket & border bleeds prevented)!")

    # --- Test 3: 滋賀コンクール型 ---
    p3 = "/tmp/legend_tests/case3_shiga_concours.pdf"
    create_case3_shiga_concours(p3)
    doc3 = fitz.open(p3)
    items3 = extract_legends(doc3)
    names3 = [it.name for it in items3]
    print(f"\n[Case 3: 滋賀コンクール型] Extracted ({len(items3)}): {names3}")
    for it in items3:
        print(f"  - {it.name:<14} | sym: {it.raw_symbol_text} | box: {it.symbol_box.to_dict()}")
    assert len(items3) == 3, f"Expected exactly 3 items, got {len(items3)}: {names3}"
    assert not any("固定" in n or "する" in n or "使用" in n for n in names3)
    print("  => Case 3 PASSED (0 False Positives, selection table excluded)!")

    # --- Test 4: 宮崎コンクール型 ---
    p4 = "/tmp/legend_tests/case4_miyazaki_concours.pdf"
    create_case4_miyazaki_concours(p4)
    doc4 = fitz.open(p4)
    items4 = extract_legends(doc4)
    names4 = [it.name for it in items4]
    print(f"\n[Case 4: 宮崎コンクール型] Extracted ({len(items4)}): {names4}")
    for it in items4:
        print(f"  - {it.name:<14} | type: {it.symbol_type} | sym: {it.raw_symbol_text} | box: {it.symbol_box.to_dict()}")
    assert len(items4) == 4, f"Expected exactly 4 items, got {len(items4)}: {names4}"
    assert any("椅子" == n for n in names4)
    assert any("譜面台" == n for n in names4)
    assert any("借用ピアノ椅子" == n for n in names4)
    assert any("電源" == n for n in names4)
    print("  => Case 4 PASSED (0 Duplicates, in-sentence and delimiter parsed)!")

    # --- Test 5: 佐賀型 ---
    p5 = "/tmp/legend_tests/case5_saga.pdf"
    create_case5_saga(p5)
    doc5 = fitz.open(p5)
    items5 = extract_legends(doc5)
    names5 = [it.name for it in items5]
    print(f"\n[Case 5: 佐賀型] Extracted ({len(items5)}): {names5}")
    for it in items5:
        print(f"  - {it.name:<14} | type: {it.symbol_type} | sym: {it.raw_symbol_text} | box: {it.symbol_box.to_dict()}")
    assert len(items5) == 6, f"Expected exactly 6 items, got {len(items5)}: {names5}"
    assert any("譜面台" in n for n in names5)
    assert any("椅子" in n for n in names5)
    assert any("電源" in n for n in names5)
    assert any("Timp" in n for n in names5)
    assert any("B.D" in n for n in names5)
    assert any("Marinba" in n for n in names5)
    print("  => Case 5 PASSED (All 6 items extracted, table 記号 + left symbol + margin miniatures)!")

    # --- Test 6: 北九州吹奏楽祭・コンクール型 ---
    p6 = "/tmp/legend_tests/case6_kitakyushu.pdf"
    create_case6_kitakyushu(p6)
    doc6 = fitz.open(p6)
    items6 = extract_legends(doc6)
    names6 = [it.name for it in items6]
    print(f"\n[Case 6: 北九州吹奏楽祭・コンクール型] Extracted ({len(items6)}): {names6}")
    for it in items6:
        print(f"  - {it.name:<14} | type: {it.symbol_type} | sym: {it.raw_symbol_text} | box: {it.symbol_box.to_dict()}")
    assert len(items6) == 6, f"Expected exactly 6 items, got {len(items6)}: {names6}"
    assert not any("例" in n for n in names6), f"<例> leaked into name: {names6}"
    assert not any("チューバ" in n or "花道" in n or "退場" in n for n in names6), f"Circulation/personal instrument leaked: {names6}"
    print("  => Case 6 PASSED (All 6 items extracted, <例> and circulation excluded)!")

    # --- Test 7: 福岡コンクール型 ---
    p7 = "/tmp/legend_tests/case7_fukuoka.pdf"
    create_case7_fukuoka(p7)
    doc7 = fitz.open(p7)
    items7 = extract_legends(doc7)
    names7 = [it.name for it in items7]
    print(f"\n[Case 7: 福岡コンクール型] Extracted ({len(items7)}): {names7}")
    for it in items7:
        print(f"  - {it.name:<14} | sym: {it.raw_symbol_text} | box: {it.symbol_box.to_dict()}")
    assert len(items7) == 3, f"Expected exactly 3 items, got {len(items7)}: {names7}"
    for it in items7:
        assert it.symbol_box.width < 22.0, f"Underline leaked into symbol box: {it.symbol_box.to_dict()}"
    print("  => Case 7 PASSED (All 3 items extracted, fill-in underlines cleanly excluded)!")

    # --- Test 8: 徳島コンクール型 ---
    p8 = "/tmp/legend_tests/case8_tokushima.pdf"
    create_case8_tokushima(p8)
    doc8 = fitz.open(p8)
    items8 = extract_legends(doc8)
    names8 = [it.name for it in items8]
    print(f"\n[Case 8: 徳島コンクール型] Extracted ({len(items8)}): {names8}")
    for it in items8:
        print(f"  - {it.name:<14} | sym: {it.raw_symbol_text} | box: {it.symbol_box.to_dict()}")
    assert len(items8) == 3, f"Expected exactly 3 items, got {len(items8)}: {names8}"
    fumentai = next(it for it in items8 if "譜面台" in it.name)
    assert "70本" not in fumentai.name, f"（最大70本） leaked into name: {fumentai.name}"
    assert fumentai.name == "譜面台", f"Clean name expected '譜面台', got '{fumentai.name}'"
    print("  => Case 8 PASSED (Left-symbol parsed, （最大70本） note stripped from label)!")

    # --- Test 9: 相模原アンコン型 ---
    p9 = "/tmp/legend_tests/case9_sagamihara_ancon.pdf"
    create_case9_sagamihara_ancon(p9)
    doc9 = fitz.open(p9)
    items9 = extract_legends(doc9)
    names9 = [it.name for it in items9]
    print(f"\n[Case 9: 相模原アンコン型] Extracted ({len(items9)}): {names9}")
    for it in items9:
        print(f"  - {it.name:<14} | type: {it.symbol_type} | sym: {it.raw_symbol_text} | box: {it.symbol_box.to_dict()}")
    assert len(items9) == 4, f"Expected exactly 4 items, got {len(items9)}: {names9}"
    assert any("会館の通常椅子" in n for n in names9)
    assert any("会館のピアノ椅子" in n for n in names9)
    assert any("持ち込み椅子" in n for n in names9)
    assert any("譜面台" in n for n in names9)
    # Check that '印' is NOT in symbol_box
    for it in items9:
        assert it.symbol_box.width < 25.0, f"Symbol box contains 印: {it.symbol_box.to_dict()}"
    print("  => Case 9 PASSED (In-sentence 4 items extracted, '印' cleanly stripped)!")

    # --- Test 10: CAD標準4列テーブル型 ---
    p10 = "/tmp/legend_tests/case10_cad_table.pdf"
    create_case10_cad_table(p10)
    doc10 = fitz.open(p10)
    items10 = extract_legends(doc10)
    names10 = [it.name for it in items10]
    print(f"\n[Case 10: CAD標準4列テーブル型] Extracted ({len(items10)}): {names10}")
    for it in items10:
        print(f"  - {it.name:<14} | type: {it.symbol_type} | box: {it.symbol_box.to_dict()}")
    assert len(items10) == 3, f"Expected exactly 3 items, got {len(items10)}: {names10}"
    assert not any(n.isdigit() for n in names10)
    for it in items10:
        assert it.symbol_box.width < 35.0, f"Symbol box too wide for {it.name}"
    print("  => Case 10 PASSED (0 False Positives, tight vector crop)!")

    print("\n" + "=" * 75)
    print("ALL 10 REAL-WORLD LAYOUT TESTS PASSED WITH 0 FALSE POSITIVES & 0 OMISSIONS!")
    print("=" * 75)
    return True

if __name__ == "__main__":
    success = run_all_10_tests()
    sys.exit(0 if success else 1)
