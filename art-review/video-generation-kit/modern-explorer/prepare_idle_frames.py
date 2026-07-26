from __future__ import annotations

import shutil
import sys
from pathlib import Path

from PIL import Image, ImageOps


CANVAS_SIZE = (384, 512)
TARGET_HEIGHT = 440
FOOT_Y = 480


def normalize(source: Path) -> Image.Image:
    image = Image.open(source).convert("RGBA")
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        raise RuntimeError(f"Empty alpha channel: {source}")
    cropped = image.crop(bbox)
    scale = TARGET_HEIGHT / cropped.height
    target_width = round(cropped.width * scale)
    resized = cropped.resize((target_width, TARGET_HEIGHT), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
    paste_x = round((CANVAS_SIZE[0] - target_width) / 2)
    paste_y = FOOT_Y - TARGET_HEIGHT
    canvas.alpha_composite(resized, (paste_x, paste_y))
    return canvas


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit(
            "Usage: prepare_idle_frames.py WALK_ROOT SIDE_ALPHA OUTPUT_DIR"
        )
    walk_root = Path(sys.argv[1])
    side_source = Path(sys.argv[2])
    output_dir = Path(sys.argv[3])
    output_dir.mkdir(parents=True, exist_ok=True)

    shutil.copy2(walk_root / "down" / "down-05.png", output_dir / "down-idle.png")
    shutil.copy2(walk_root / "up" / "up-04.png", output_dir / "up-idle.png")
    right = normalize(side_source)
    right.save(output_dir / "right-idle.png")
    ImageOps.mirror(right).save(output_dir / "left-idle.png")

    for path in sorted(output_dir.glob("*.png")):
        image = Image.open(path)
        alpha_range = image.getchannel("A").getextrema()
        print(f"{path.name}: {image.size}, {image.mode}, alpha={alpha_range}")


if __name__ == "__main__":
    main()
