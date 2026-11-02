"""
Regression test suite for '電源' (power supply / cord) auto-count and auto-input into PDF form fields.
Tests all real-world competition PDF patterns across Japan:
1. Hokkaido: 【電源使用】○で囲む / あり・なし
2. Shiga: 電源 / 要（上手・下手）・不要
3. Yamagata: ※ 電源ドラム （ 要 ・ 不要 ）
4. Tokyo: 電源使用 する しない
5. Miyazaki: 電源使用＝★ (下を〇で囲む) / 使用しない・上手・中央・下手
6. Ibaraki Ken Taikai: 電源 ☆印 / ( 持参 ・ 借用 )
7. Ibaraki Chuo: 電源 / 有・無 / 借・持
8. East Kanto Ibaraki: 電源 / ( 持参 ・ 借用 ) (vertical table)
9. Kitakyushu: 電源： (colon blank slot)
"""
import fitz, glob, os, asyncio
from main import preview_bg, PreviewRequest, TallyItem

PDF_TEST_CASES = [
    ('Hokkaido', 'test_drive/全国の吹奏楽連盟_ステージセッティング図（提出用・作成見本）/08_北海道・東北・関西（北海道・山形・福島・大阪・神戸_提出用・見本）/北海道アンサンブルコンテスト_舞台配置図（提出用）.pdf'),
    ('Shiga', 'test_drive/全国の吹奏楽連盟_ステージセッティング図（提出用・作成見本）/03_滋賀県吹奏楽連盟（コンクール・吹奏楽祭・アンコン_提出用・作成見本）/滋賀県アンサンブルコンテスト_県大会_舞台配置図（提出用）.pdf'),
    ('Yamagata', 'test_drive/全国の吹奏楽連盟_ステージセッティング図（提出用・作成見本）/08_北海道・東北・関西（北海道・山形・福島・大阪・神戸_提出用・見本）/山形県吹奏楽コンクール_ステージ配置図（提出用・記入注意付）.pdf'),
    ('Tokyo', 'test_drive/全国の吹奏楽連盟_ステージセッティング図（提出用・作成見本）/07_東関東・相模原・東京都吹奏楽連盟（提出用・記入例）/第66回東京都高等学校吹奏楽コンクール_舞台配置図（どりーむホール_打楽器図見本入）.pdf'),
    ('Miyazaki', 'test_drive/全国の吹奏楽連盟_ステージセッティング図（提出用・作成見本）/04_宮崎県吹奏楽連盟（コンクール・小学生BF_提出用・楽器図見本入）/第71回宮崎県吹奏楽コンクール_ステージ配置図【提出用_楽器図見本入り】(PDF).pdf'),
    ('IbarakiKen', 'test_drive/全国の吹奏楽連盟_ステージセッティング図（提出用・作成見本）/02_茨城県吹奏楽連盟（県大会・県北・中央_提出用・記入例）/第66回茨城県吹奏楽コンクール_県大会_ステージ配置図（提出用）.pdf'),
    ('IbarakiChuo', 'test_drive/全国の吹奏楽連盟_ステージセッティング図（提出用・作成見本）/02_茨城県吹奏楽連盟（県大会・県北・中央_提出用・記入例）/茨城県吹奏楽コンクール_中央地区_ステージ配置図（提出用）.pdf'),
    ('EastKanto', 'test_drive/全国の吹奏楽連盟_ステージセッティング図（提出用・作成見本）/07_東関東・相模原・東京都吹奏楽連盟（提出用・記入例）/第32回東関東吹奏楽コンクール_茨城会場_ステージ配置図.pdf'),
    ('Kitakyushu', 'test_drive/全国の吹奏楽連盟_ステージセッティング図（提出用・作成見本）/05_九州支部（北九州・熊本・福岡・佐賀_提出用・記入例）/第66回北九州吹奏楽祭_ステージ配置図（提出用・記号記入例付）.pdf'),
]

async def test_all():
    print("=" * 70)
    print("RUNNING REGRESSION TEST SUITE FOR 電源 AUTO-COUNT & AUTO-INPUT")
    print("=" * 70)

    for label, path in PDF_TEST_CASES:
        fname = os.path.basename(path)
        file_id = f"test_cord_{label}"
        dest = f"backend/uploads/{file_id}.pdf"
        with open(path, "rb") as f_in, open(dest, "wb") as f_out:
            f_out.write(f_in.read())

        # Test A: Placed extension cord from template (source='template') when project has extracted PDF chairs
        req_with_cord = PreviewRequest(
            file_id=file_id,
            tallies=[
                TallyItem(icon_id="icon_chair", label="椅子", count=5, source="pdf", is_template_replaced=False),
                TallyItem(icon_id="tmpl_extensionCord", label="延長コード", count=1, source="template", is_template_replaced=False, positions=[[200.0, 300.0]]),
            ],
            piano_lid="半開",
        )
        res1 = await preview_bg(req_with_cord)
        cord_nodes_1 = [n for n in res1.get("auto_nodes", []) if "cord" in n.get("id", "") or "電源" in n.get("id", "")]

        # Test B: No cord placed
        req_no_cord = PreviewRequest(
            file_id=file_id,
            tallies=[
                TallyItem(icon_id="icon_chair", label="椅子", count=5, source="pdf", is_template_replaced=False),
            ],
            piano_lid="半開",
        )
        res0 = await preview_bg(req_no_cord)
        cord_nodes_0 = [n for n in res0.get("auto_nodes", []) if "cord" in n.get("id", "") or "電源" in n.get("id", "")]

        assert len(cord_nodes_1) > 0, f"[{label}] Expected cord output when cord=1, but got none!"
        
        # Hokkaido: yo circle when cord=1, fuyo circle when cord=0
        if label == "Hokkaido":
            assert any("yo" in n.get("id", "") for n in cord_nodes_1)
            assert any("fuyo" in n.get("id", "") for n in cord_nodes_0)
        # Shiga: yo when cord=1, fuyo when cord=0
        elif label == "Shiga":
            assert any("yo" in n.get("id", "") for n in cord_nodes_1)
            assert any("fuyo" in n.get("id", "") for n in cord_nodes_0)
        # Yamagata: yo when cord=1, fuyo when cord=0
        elif label == "Yamagata":
            assert any("yo" in n.get("id", "") for n in cord_nodes_1)
            assert any("fuyo" in n.get("id", "") for n in cord_nodes_0)
        # Tokyo: yo when cord=1, fuyo when cord=0
        elif label == "Tokyo":
            assert any("yo" in n.get("id", "") for n in cord_nodes_1)
            assert any("fuyo" in n.get("id", "") for n in cord_nodes_0)
        # Miyazaki: yo when cord=1, fuyo when cord=0
        elif label == "Miyazaki":
            assert any("yo" in n.get("id", "") for n in cord_nodes_1)
            assert any("fuyo" in n.get("id", "") for n in cord_nodes_0)
        # Kitakyushu: number written in colon slot when cord=1
        elif label == "Kitakyushu":
            assert any(n.get("text") == "1" for n in cord_nodes_1)
        # Ibaraki Chuo: yo when cord=1, fuyo when cord=0
        elif label == "IbarakiChuo":
            assert any("yo" in n.get("id", "") for n in cord_nodes_1)
            assert any("fuyo" in n.get("id", "") for n in cord_nodes_0)
        # Ibaraki Ken & East Kanto: number 1 and/or circle
        elif label in ("IbarakiKen", "EastKanto"):
            assert any("yo" in n.get("id", "") or n.get("text") == "1" for n in cord_nodes_1)

        print(f"[PASS] {label:<12} | cord=1: {[n.get('id') or n.get('text') for n in cord_nodes_1]} | cord=0: {[n.get('id') or n.get('text') for n in cord_nodes_0]}")

    print("=" * 70)
    print("ALL 9 REAL-WORLD POWER AUTO-COUNT TESTS PASSED WITH 100% SUCCESS!")
    print("=" * 70)

if __name__ == "__main__":
    asyncio.run(test_all())
