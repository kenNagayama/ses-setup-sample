# /// script
# requires-python = ">=3.11"
# dependencies = ["requests", "python-dotenv"]
# ///

import base64
import os
from pathlib import Path

import requests
from dotenv import load_dotenv

# プロジェクトルートの .env を読み込む
project_root = Path(__file__).parent.parent
load_dotenv(project_root / "tools" / ".env")

API_ENDPOINT = os.environ["API_ENDPOINT"]
API_KEY = os.environ["API_KEY"]
TO_EMAIL = os.environ["TO_EMAIL"]
IMAGE_PATH = os.environ.get("IMAGE_PATH", "sample-image/image.png")

# 画像を base64 エンコード
image_file = project_root / IMAGE_PATH
with open(image_file, "rb") as f:
    encoded_image = base64.b64encode(f.read()).decode("utf-8")

payload = {
    "to": [TO_EMAIL],
    "templateName": "CameraNotificationTemplate",
    "templateData": {
        "datetime": "2026-03-19 14:30:00",
        "line-name": "山手線",
        "station": "田町駅",
        "line-direction": "内回り",
        "kiro-tei": "12k345m",
        "pole-num": "77号柱",
        "encoded-image": encoded_image,
        "panta-camera-system-link": "https://example.com/camera/1",
    },
}

url = f"{API_ENDPOINT.rstrip('/')}/send-template"
headers = {
    "Content-Type": "application/json",
    "x-api-key": API_KEY,
}

print(f"送信先: {TO_EMAIL}")
print(f"エンドポイント: {url}")
print(f"画像ファイル: {image_file} ({len(encoded_image)} bytes, base64)")

response = requests.post(url, json=payload, headers=headers)
print(f"ステータスコード: {response.status_code}")
print(f"レスポンス: {response.text}")
