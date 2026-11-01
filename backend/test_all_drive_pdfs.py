"""
Automated regression test suite for stage diagram PDF equipment/icon extraction.
Runs extraction against all competition PDFs downloaded from Google Drive.
"""
import glob
import os
import sys
import fitz
import requests

def run_tests():
    pdf_files = sorted(glob.glob('test_drive/**/*.pdf', recursive=True))
    print(f"=== Starting Stage Layout Extraction Test Suite ({len(pdf_files)} PDFs) ===")
    
    passed = 0
    failed = 0
    skipped = 0
    
    for pdf_path in pdf_files:
        filename = os.path.basename(pdf_path)
        try:
            doc = fitz.open(pdf_path)
        except Exception as e:
            print(f"[-] {filename}: Failed to open ({e})")
            failed += 1
            continue
            
        page_count = len(doc)
        # Check text presence
        total_text_len = sum(len(page.get_text()) for page in doc)
        if total_text_len < 10:
            print(f"[-] {filename}: Scanned/raster-only PDF (text < 10 chars)")
            skipped += 1
            continue
            
        with open(pdf_path, 'rb') as f:
            up_res = requests.post(
                'http://127.0.0.1:8000/api/upload-pdf/',
                files={'file': (filename, f, 'application/pdf')}
            )
            
        if up_res.status_code != 200:
            print(f"[FAIL] {filename}: Upload failed with status {up_res.status_code}")
            failed += 1
            continue
            
        up_data = up_res.json()
        file_id = up_data['file_id']
        w = up_data['width']
        h = up_data['height']
        auto_crop = up_data.get('auto_stage_region') or {
            'x': w * 0.08, 'y': h * 0.18, 'width': w * 0.84, 'height': h * 0.68
        }
        
        ext_res = requests.post('http://127.0.0.1:8000/api/extract/', json={
            'file_id': file_id,
            'regions': [{'type': 'background', 'crop': auto_crop}]
        })
        
        if ext_res.status_code != 200:
            print(f"[FAIL] {filename}: Extract failed with status {ext_res.status_code}")
            failed += 1
            continue
            
        ext_data = ext_res.json()
        icons = ext_data.get('extracted_icons', [])
        labels = [ic.get('label') for ic in icons]
        
        # Verify that pure numbers are NEVER labels or falsely included as symbol images
        has_digit_icons = False
        for ic in icons:
            lbl = ic.get('label', '')
            if lbl.isdigit():
                has_digit_icons = True
                break
                
        if has_digit_icons:
            print(f"[FAIL] {filename}: Digit incorrectly extracted as icon: {labels}")
            failed += 1
            continue
            
        print(f"[PASS] {filename[:42]:<42} | {len(icons)} icons: {labels[:5]}")
        passed += 1

    print("\n" + "=" * 60)
    print(f"Test Suite Summary: PASSED: {passed}, SKIPPED (scanned): {skipped}, FAILED: {failed}")
    print("=" * 60)
    return failed == 0

if __name__ == '__main__':
    success = run_tests()
    sys.exit(0 if success else 1)
