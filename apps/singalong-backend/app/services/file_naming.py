import re
import sys


def normalize_title(title: str) -> str:
    """
    Normalize title to filesystem-safe name.
    
    Rules:
    - Replace spaces and most punctuation with underscores
    - Remove special characters but keep alphanumeric, underscores, hyphens
    - Preserve CJK characters (for Japanese, Chinese, Korean titles)
    - Lowercase English text
    """
    print(f"[FILE_NAMING] Normalizing title: {title}", file=sys.stderr, flush=True)
    
    # Replace spaces with underscores
    normalized = title.replace(" ", "_")
    
    # Replace common punctuation with underscores
    normalized = re.sub(r'[():,.\'"!?&\[\]{}]', '_', normalized)
    
    # Remove other special characters but keep alphanumeric, underscores, hyphens, and CJK
    # Keep Unicode characters for CJK scripts
    normalized = re.sub(r'[^\w\-\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]', '', normalized)
    
    # Replace multiple underscores with single underscore
    normalized = re.sub(r'_+', '_', normalized)
    
    # Remove leading/trailing underscores
    normalized = normalized.strip('_')
    
    # Lowercase English parts (but keep CJK as-is)
    normalized = normalized.lower()
    
    # Limit length
    if len(normalized) > 100:
        normalized = normalized[:100]
    
    print(f"[FILE_NAMING] Normalized to: {normalized}", file=sys.stderr, flush=True)
    return normalized


def generate_song_filename(title: str, source_id: str, ext: str) -> str:
    """
    Generate filename following convention: {normalized_title}[{source_id}].{ext}
    
    Example: never_gonna_give_you_up[dQw4w9WgXcQ].mp4
    """
    normalized = normalize_title(title)
    filename = f"{normalized}[{source_id}].{ext}"
    
    # Validate source_id contains only valid characters
    if not re.match(r'^[a-zA-Z0-9_-]+$', source_id):
        raise ValueError(f"Invalid source_id: {source_id}")
    
    return filename
