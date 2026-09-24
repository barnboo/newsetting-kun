import requests
import base64
import json

# Create a dummy transparent 1x1 png
dummy_png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="

req_data = {
    "file_id": "d06c47dc-6c72-4e94-a8c9-64f6a92a3171",
    "full_page_image": dummy_png,
    "tallies": [
        {"icon_id": "icon_0", "label": "指揮台", "count": 1},
        {"icon_id": "icon_4", "label": "合奏用椅子", "count": 42},
        {"icon_id": "icon_3", "label": "合奏用譜面台", "count": 42},
        {"icon_id": "icon_6", "label": "長机", "count": 2}
    ],
    "piano_lid": ""
}

resp = requests.post("http://127.0.0.1:8000/api/export-pdf/", json=req_data)
print(resp.status_code)
print(resp.json())
