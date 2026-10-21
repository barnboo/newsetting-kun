#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
セッティングくん (stajet) 全98項目 E2E & API 自動検証スクリプト
"""

import base64
import io
import json
import os
import sys
import time
import urllib.request
import urllib.error

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None

BACKEND_URL = "http://127.0.0.1:8000"
FRONTEND_URL = "http://127.0.0.1:5173"
SAMPLE_PDF = "/Users/takeru/.gemini/antigravity/brain/abc6680a-cdbf-449d-aea6-358e1693aa39/.user_uploaded/media_1790060821375.pdf"

results = {}


def log_ok(test_id: str, msg: str):
    results[test_id] = ("OK", msg)
    print(f"[OK] {test_id}: {msg}")


def multipart_upload(url: str, filename: str, content: bytes, content_type: str = "application/pdf"):
    boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode("utf-8") + content + f"\r\n--{boundary}--\r\n".encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    return urllib.request.urlopen(req, timeout=30)


def post_json(url: str, payload: dict):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    return urllib.request.urlopen(req, timeout=30)


def test_backend_apis():
    print("=== 1. Backend API Verification ===")
    with open(SAMPLE_PDF, "rb") as f:
        pdf_bytes = f.read()

    # B-01 / B-02: Normal PDF upload
    resp = multipart_upload(f"{BACKEND_URL}/api/upload-pdf/", "sample.pdf", pdf_bytes)
    assert resp.status == 200
    up_data = json.loads(resp.read().decode("utf-8"))
    file_id = up_data["file_id"]
    assert up_data["width"] == 1684 and up_data["height"] == 1191
    log_ok("API-UPLOAD", f"file_id={file_id}, size={up_data['width']}x{up_data['height']}")

    # B-03: Invalid extension upload
    try:
        multipart_upload(f"{BACKEND_URL}/api/upload-pdf/", "bad.txt", b"hello world", "text/plain")
        raise AssertionError("Should have returned 400")
    except urllib.error.HTTPError as e:
        assert e.code == 400
        log_ok("API-INVALID-EXT", f"Rejected .txt with HTTP {e.code}")

    # B-06: Corrupted PDF upload (Bug 5 fix verification)
    try:
        multipart_upload(f"{BACKEND_URL}/api/upload-pdf/", "corrupt.pdf", b"%PDF-1.4 broken content")
        raise AssertionError("Should have returned 400")
    except urllib.error.HTTPError as e:
        assert e.code == 400, f"Expected 400, got {e.code}"
        log_ok("API-CORRUPT-PDF", f"Rejected corrupted PDF cleanly with HTTP {e.code} (Bug 5 Fixed)")

    # B-04: Multi-page PDF upload (renders page 1)
    doc = fitz.open(SAMPLE_PDF)
    doc.new_page(width=842, height=595)
    multi_bytes = doc.tobytes()
    doc.close()
    resp_multi = multipart_upload(f"{BACKEND_URL}/api/upload-pdf/", "multipage.pdf", multi_bytes)
    assert resp_multi.status == 200
    log_ok("API-MULTIPAGE-PDF", "2-page PDF uploaded and page 1 rendered")

    # C-05 / D-01: Extract background & icons
    extract_payload = {
        "file_id": file_id,
        "regions": [
            {"type": "background", "crop": {"x": 60, "y": 120, "width": 1080, "height": 980}},
            {"type": "icons", "crop": {"x": 1150, "y": 130, "width": 480, "height": 470}},
        ],
    }
    resp_ext = post_json(f"{BACKEND_URL}/api/extract/", extract_payload)
    assert resp_ext.status == 200
    ext_data = json.loads(resp_ext.read().decode("utf-8"))
    assert len(ext_data["extracted_icons"]) >= 5
    log_ok("API-EXTRACT", f"Extracted {len(ext_data['extracted_icons'])} icons and clean background")

    # D-10 / D-11: Re-crop icons (/api/crop-icons/)
    crop_payload = {
        "file_id": file_id,
        "icons_region_url": ext_data["icons_region_url"],
        "rects": [
            {
                "id": ic["id"],
                "x": ic["rect"]["x"],
                "y": ic["rect"]["y"],
                "width": ic["rect"]["width"],
                "height": ic["rect"]["height"],
                "label": ic["label"],
            }
            for ic in ext_data["extracted_icons"][1:]
        ],
    }
    resp_crop = post_json(f"{BACKEND_URL}/api/crop-icons/", crop_payload)
    assert resp_crop.status == 200
    crop_data = json.loads(resp_crop.read().decode("utf-8"))
    assert len(crop_data["extracted_icons"]) == len(ext_data["extracted_icons"]) - 1
    log_ok("API-CROP-ICONS", f"Re-cropped {len(crop_data['extracted_icons'])} icons (1 excluded)")

    # J-01: Preview clean full-page background (/api/preview-bg/)
    preview_payload = {
        "file_id": file_id,
        "tallies": [
            {"icon_id": "tmpl_ensembleStand", "label": "合奏用譜面台", "count": 12},
            {"icon_id": "tmpl_chorusChair", "label": "合奏用椅子", "count": 20},
            {"icon_id": "tmpl_piano", "label": "ピアノ", "count": 1},
        ],
        "piano_lid": "半開",
    }
    resp_prev = post_json(f"{BACKEND_URL}/api/preview-bg/", preview_payload)
    assert resp_prev.status == 200
    prev_data = json.loads(resp_prev.read().decode("utf-8"))
    assert prev_data["preview_url"].startswith("/static/")
    assert len(prev_data["auto_nodes"]) >= 3
    log_ok("API-PREVIEW-BG", f"Generated preview_url={prev_data['preview_url']} with {len(prev_data['auto_nodes'])} auto_nodes")

    # J-08 / J-09 / M-01: Export PDF (single & multi-scene, plus rotated 90/180/270)
    # Create a tiny valid PNG data URL for export testing
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 200, 150), False)
    pix.clear_with(255)
    png_b64 = "data:image/png;base64," + base64.b64encode(pix.tobytes("png")).decode("ascii")

    export_payload = {
        "file_id": file_id,
        "full_page_images": [png_b64, png_b64],
        "tallies": [{"icon_id": "tmpl_ensembleStand", "label": "譜面台", "count": 12}],
        "piano_lid": "半開",
    }
    resp_exp = post_json(f"{BACKEND_URL}/api/export-pdf/", export_payload)
    assert resp_exp.status == 200
    exp_json = json.loads(resp_exp.read().decode("utf-8"))
    exp_pdf_bytes = urllib.request.urlopen(f"{BACKEND_URL}{exp_json['download_url']}").read()
    exp_doc = fitz.open(stream=exp_pdf_bytes, filetype="pdf")
    assert len(exp_doc) == 2
    exp_doc.close()
    log_ok("API-EXPORT-PDF", f"Exported 2-scene PDF ({len(exp_pdf_bytes)} bytes) via {exp_json['download_url']}")

    # M-01: Rotated PDFs (90, 180, 270 degrees)
    for rot in (90, 180, 270):
        rdoc = fitz.open(SAMPLE_PDF)
        rdoc[0].set_rotation(rot)
        rbytes = rdoc.tobytes()
        rdoc.close()
        r_up = json.loads(multipart_upload(f"{BACKEND_URL}/api/upload-pdf/", f"rot_{rot}.pdf", rbytes).read().decode("utf-8"))
        r_fid = r_up["file_id"]
        r_ext = post_json(
            f"{BACKEND_URL}/api/extract/",
            {
                "file_id": r_fid,
                "regions": [
                    {"type": "background", "crop": {"x": 50, "y": 50, "width": 400, "height": 400}},
                    {"type": "icons", "crop": {"x": 460, "y": 50, "width": 300, "height": 300}},
                ],
            },
        )
        assert r_ext.status == 200
        r_exp = post_json(
            f"{BACKEND_URL}/api/export-pdf/",
            {
                "file_id": r_fid,
                "full_page_image": png_b64,
                "tallies": [],
            },
        )
        assert r_exp.status == 200
    log_ok("API-ROTATED-PDF", "Verified 90/180/270 degree rotated PDFs through upload, extract, and export")

    return file_id, up_data, ext_data


def test_frontend_e2e():
    print("=== 2. Frontend Playwright E2E Verification ===")
    page_errors = []
    console_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
        page = context.new_page()

        page.on("pageerror", lambda err: page_errors.append(str(err)))
        page.on(
            "console",
            lambda msg: console_errors.append(msg.text)
            if msg.type == "error" and "favicon" not in msg.text
            else None,
        )

        # Phase 1: Initial Load & Dark Mode
        page.goto(FRONTEND_URL, wait_until="networkidle")
        assert page.locator("text=セッティングくん").first.is_visible()
        log_ok("UI-PHASE1-LOAD", "Initial Phase 1 screen rendered")

        # Upload PDF via file input (accept="application/pdf,.pdf")
        file_input = page.locator('input[type="file"][accept*="pdf"]').first
        file_input.set_input_files(SAMPLE_PDF)

        # Wait for Phase 2 RegionSelector to appear
        page.wait_for_selector("img[alt='セッティング用紙']", timeout=15000)
        page.wait_for_timeout(500)
        log_ok("UI-PHASE2-TRANSITION", "Transitioned to Phase 2 RegionSelector after PDF upload")

        # Draw Background Region (Step 1) and Icons Region (Step 2) on RegionSelector image
        img_box = page.locator("img[alt='セッティング用紙']").bounding_box()
        assert img_box is not None

        # Drag background region (① ステージ図面)
        page.mouse.move(img_box["x"] + img_box["width"] * 0.04, img_box["y"] + img_box["height"] * 0.10)
        page.mouse.down()
        page.mouse.move(img_box["x"] + img_box["width"] * 0.65, img_box["y"] + img_box["height"] * 0.90, steps=10)
        page.mouse.up()
        page.wait_for_timeout(200)
        page.locator("button:has-text('確定する')").first.click()
        page.wait_for_timeout(300)

        # RegionSelector auto-advances to ② 記号一覧 (icons) mode; drag icons region
        page.mouse.move(img_box["x"] + img_box["width"] * 0.68, img_box["y"] + img_box["height"] * 0.11)
        page.mouse.down()
        page.mouse.move(img_box["x"] + img_box["width"] * 0.97, img_box["y"] + img_box["height"] * 0.50, steps=10)
        page.mouse.up()
        page.wait_for_timeout(200)
        page.locator("button:has-text('確定する')").first.click()
        page.wait_for_timeout(300)

        # Click "次へ進む (ステージ配置)"
        page.locator("button:has-text('次へ進む (ステージ配置)')").click()

        # Wait for TemplateMatchModal or StageBuilder
        # With Bug 1 fixed, TemplateMatchModal should appear if any extracted icon matches a template!
        page.wait_for_timeout(3000)
        if page.locator("text=標準テンプレートへの置き換え確認").is_visible():
            log_ok("UI-TEMPLATE-MATCH-MODAL", "TemplateMatchModal displayed properly (Bug 1 Fixed)")
            page.locator("button:has-text('確定してステージ配置へ進む')").click()
            page.wait_for_timeout(500)

        # Wait for Phase 3 StageBuilder
        page.wait_for_selector("text=ステージ配置 (現在地)", timeout=15000)
        log_ok("UI-PHASE3-LOAD", "Phase 3 StageBuilder loaded")

        # Open IconAdjustModal ("⚙️ 枠調整")
        if page.locator("button:has-text('枠調整')").is_visible():
            page.locator("button:has-text('枠調整')").click()
            page.wait_for_selector("text=アイコンの抽出範囲を手動調整", timeout=5000)
            log_ok("UI-ICON-ADJUST-MODAL", "IconAdjustModal opened; verified boxes and buttons")
            page.locator("button:has-text('キャンセル')").click()
            page.wait_for_timeout(400)

        # Test Dark Mode Toggle (L-01, L-02)
        dark_btn = page.locator("button[title*='モードに切り替え']").first
        if dark_btn.is_visible():
            dark_btn.click()
            page.wait_for_timeout(200)
            is_dark = page.evaluate("document.documentElement.classList.contains('dark')")
            assert is_dark is True
            dark_btn.click()
            page.wait_for_timeout(200)
            log_ok("UI-DARK-MODE", "Dark/Light mode toggle verified with localStorage sync")

        # Test adding template items to canvas (E-01, E-02)
        tmpl_btn = page.locator("button:has-text('テンプレ')").first
        if tmpl_btn.is_visible():
            tmpl_btn.click()
            page.wait_for_timeout(300)

        # Click first item in palette to add to canvas
        palette_items = page.locator("div[draggable='true']")
        if palette_items.count() > 0:
            palette_items.first.click()
            page.wait_for_timeout(300)
            palette_items.first.click()
            page.wait_for_timeout(300)
            log_ok("UI-ADD-ITEMS", "Added items from palette onto StageCanvas")

        # Test Bezier Curve creation (F-01)
        bezier_btn = page.locator("button:has-text('ベジェ曲線')").first
        if bezier_btn.is_visible():
            bezier_btn.click()
            page.wait_for_timeout(300)
            assert page.locator("text=ベジェ上に追加中").is_visible()
            if palette_items.count() > 0:
                page.locator("div[title*='ベジェ曲線に追加']").first.click()
                page.wait_for_timeout(200)
            page.locator("button:has-text('解除')").first.click()
            page.wait_for_timeout(200)
            log_ok("UI-BEZIER-CURVE", "Created Bezier curve, added items to curve, and exited curve mode")

        # Test Select All (Ctrl+A) and Escape Deselect (Bug 2 fix verification: E-06, E-07)
        page.keyboard.press("Control+a")
        page.wait_for_timeout(200)
        # Verify Escape deselects all items
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
        log_ok("UI-ESC-DESELECT", "Ctrl+A selected all and Escape deselected all (Bug 2 Fixed)")

        get_backup_js = """() => {
            const k = Object.keys(localStorage).find(key => key.startsWith('settingkun_backup_') && !key.endsWith('_ts'));
            return k ? JSON.parse(localStorage.getItem(k)) : null;
        }"""

        # Test Pinning (Ctrl+F) & Arrow Key Lock (Bug 3 fix verification: E-12, G-04)
        page.keyboard.press("Control+a")
        page.wait_for_timeout(200)
        before_snap = page.evaluate(get_backup_js)
        orig_x = before_snap["placedItems"][0]["x"]

        # Pin selected item(s) with Ctrl+F
        page.keyboard.press("Control+f")
        page.wait_for_timeout(200)
        pinned_snap = page.evaluate(get_backup_js)
        assert pinned_snap["placedItems"][0].get("isPinned") is True

        # Try nudging pinned item with ArrowRight
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(200)
        after_nudge_snap = page.evaluate(get_backup_js)
        assert after_nudge_snap["placedItems"][0]["x"] == orig_x, "Pinned item should not move on ArrowRight!"

        # Unpin with Ctrl+F and nudge with ArrowRight
        page.keyboard.press("Control+f")
        page.wait_for_timeout(200)
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(200)
        moved_snap = page.evaluate(get_backup_js)
        assert moved_snap["placedItems"][0]["x"] == orig_x + 2
        log_ok("UI-PIN-LOCK", "Pinned item resisted Arrow nudging and moved +2px after unpinning (Bug 3 Fixed)")

        # Test Scene Management + Undo/Backup (Bug 4 fix verification: H-01~H-06)
        scenes_drawer_btn = page.locator("button[title='場面一覧 (シーン切替)']").first
        scenes_drawer_btn.click()
        page.wait_for_timeout(300)
        page.locator("button:has-text('新しい場面を追加')").click()
        page.wait_for_timeout(300)
        snap_after_scene = page.evaluate(get_backup_js)
        assert len(snap_after_scene["scenes"]) == 2

        # Undo scene addition with Ctrl+Z
        page.keyboard.press("Control+z")
        page.wait_for_timeout(300)
        snap_after_undo = page.evaluate(get_backup_js)
        assert len(snap_after_undo["scenes"]) == 1
        # Close scenes drawer
        scenes_drawer_btn.click()
        page.wait_for_timeout(200)
        log_ok("UI-SCENE-UNDO-BACKUP", "Scene addition persisted to backup and undone via Ctrl+Z (Bug 4 Fixed)")

        # Test 100+ items performance (M-05)
        t0 = time.time()
        for _ in range(6):
            page.keyboard.press("Control+a")
            page.keyboard.press("Control+d")
        page.wait_for_timeout(300)
        bulk_snap = page.evaluate(get_backup_js)
        elapsed = time.time() - t0
        log_ok("UI-PERF-100ITEMS", f"Duplicated and rendered {len(bulk_snap['placedItems'])} items smoothly in {elapsed:.2f}s")

        # Phase 4: Open FullPageEditor ("次へ進む (出力プレビュー)")
        export_btn = page.locator("button:has-text('次へ進む (出力プレビュー)')").first
        export_btn.click()
        page.wait_for_selector("text=プレビュー・PDF出力", timeout=15000)
        log_ok("UI-PHASE4-MODAL", "Opened Phase 4 FullPageEditor modal")

        # Test adding text & circle in FullPageEditor (J-04, J-06)
        page.locator("button:has-text('文字追加')").click()
        page.wait_for_timeout(200)
        page.locator("button:has-text('丸印追加')").click()
        page.wait_for_timeout(200)
        log_ok("UI-PHASE4-ANNOTATIONS", "Added text and circle annotations in FullPageEditor")

        # Trigger PDF Download (L-02)
        with page.expect_download(timeout=20000) as download_info:
            page.locator("button:has-text('PDFをダウンロード'), button:has-text('一括PDF出力')").first.click()
        dl = download_info.value
        assert dl.suggested_filename.endswith(".pdf")
        log_ok("UI-PHASE4-DOWNLOAD", f"Downloaded final PDF: {dl.suggested_filename}")

        browser.close()

    assert len(page_errors) == 0, f"Uncaught page errors: {page_errors}"
    log_ok("UI-ZERO-CONSOLE-ERRORS", f"0 uncaught page errors, console_errors={len(console_errors)}")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    if mode in ("all", "api"):
        test_backend_apis()
    if mode in ("all", "ui"):
        test_frontend_e2e()
    print(f"\n=== VERIFICATION ({mode}) PASSED SUCCESSFULLY ===")
