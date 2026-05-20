import base64
import sys
from io import BytesIO
from pathlib import Path

import requests
from PIL import Image


def download_thumbnail(url: str, timeout: int = 10) -> bytes:
    """Download thumbnail from URL and return as bytes."""
    print(f"[THUMBNAIL] Downloading from {url}", file=sys.stderr, flush=True)
    try:
        response = requests.get(url, timeout=timeout)
        response.raise_for_status()
        print(f"[THUMBNAIL] Downloaded {len(response.content)} bytes", file=sys.stderr, flush=True)
        return response.content
    except Exception as e:
        print(f"[THUMBNAIL] Download failed: {e}", file=sys.stderr, flush=True)
        raise


def convert_base64_to_jpg(data_url: str, target_quality: int = 85) -> bytes:
    """Convert base64 data URL to JPG bytes."""
    print("[THUMBNAIL] Converting base64 to JPG", file=sys.stderr, flush=True)
    try:
        # Extract base64 data from data URL
        if "," in data_url:
            base64_data = data_url.split(",", 1)[1]
        else:
            base64_data = data_url

        # Decode base64
        image_data = base64.b64decode(base64_data)

        # Open as PIL Image
        image = Image.open(BytesIO(image_data))

        # Convert RGBA to RGB if necessary
        if image.mode in ("RGBA", "P"):
            rgb_image = Image.new("RGB", image.size, (255, 255, 255))
            rgb_image.paste(image, mask=image.split()[-1] if image.mode == "RGBA" else None)
            image = rgb_image

        # Save as JPG
        jpg_buffer = BytesIO()
        image.save(jpg_buffer, format="JPEG", quality=target_quality, optimize=True)
        jpg_buffer.seek(0)
        result = jpg_buffer.getvalue()

        print(f"[THUMBNAIL] Converted to JPG ({len(result)} bytes)", file=sys.stderr, flush=True)
        return result
    except Exception as e:
        print(f"[THUMBNAIL] Conversion failed: {e}", file=sys.stderr, flush=True)
        raise


def save_thumbnail(data: bytes, filename: str, media_dir: Path) -> str:
    """Save thumbnail to disk and return relative path."""
    print(f"[THUMBNAIL] Saving as {filename}", file=sys.stderr, flush=True)
    try:
        thumbnail_dir = media_dir / "thumbnails"
        thumbnail_dir.mkdir(parents=True, exist_ok=True)

        file_path = thumbnail_dir / filename
        file_path.write_bytes(data)

        relative_path = f"thumbnails/{filename}"
        print(f"[THUMBNAIL] Saved to {relative_path}", file=sys.stderr, flush=True)
        return relative_path
    except Exception as e:
        print(f"[THUMBNAIL] Save failed: {e}", file=sys.stderr, flush=True)
        raise
