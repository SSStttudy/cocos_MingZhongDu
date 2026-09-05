#!/usr/bin/env python3
"""Rebuild and validate occlusion PNGs from their exact scene backgrounds.

The alpha channel is the authored occlusion mask.  Every visible RGB pixel is
copied from the corresponding background JPG so activating the foreground can
never introduce a second, independently generated version of the scenery.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
import sys

from PIL import Image, ImageChops


@dataclass(frozen=True)
class ForegroundPair:
    location: str
    background: str
    foreground: str


PAIRS = (
    ForegroundPair("visitor-center", "exterior", "exterior-wang-statue-foreground"),
    ForegroundPair("visitor-center", "interior", "interior-sand-table-foreground"),
    ForegroundPair("visitor-center", "leisure-plaza", "leisure-plaza-chairs-foreground"),
    ForegroundPair("location-2", "5", "5-plants-steps-foreground"),
    ForegroundPair("location-3", "3", "3-gate-foreground"),
    ForegroundPair("location-3", "4", "4-gate-foreground"),
    ForegroundPair("location-3", "5", "5-gate-left-foreground"),
    ForegroundPair("location-3", "5", "5-gate-right-foreground"),
    ForegroundPair("location-3", "7", "7-right-foreground"),
    ForegroundPair("location-4", "main", "main-flowerbed-foreground"),
)


def locations_root(project_root: Path) -> Path:
    return project_root / "assets" / "resources" / "locations"


def pair_paths(project_root: Path, pair: ForegroundPair) -> tuple[Path, Path]:
    scene_dir = locations_root(project_root) / pair.location / "scenes"
    return scene_dir / f"{pair.background}.jpg", scene_dir / f"{pair.foreground}.png"


def visible_rgb(image: Image.Image, alpha: Image.Image) -> Image.Image:
    # Keep transparent pixels black for much smaller PNGs.  A binary copy mask
    # deliberately preserves exact background RGB even at anti-aliased edges;
    # the original alpha is applied separately below.
    copy_mask = alpha.point(lambda value: 255 if value else 0)
    return Image.composite(image, Image.new("RGB", image.size), copy_mask)


def rebuild(project_root: Path) -> None:
    for pair in PAIRS:
        background_path, foreground_path = pair_paths(project_root, pair)
        background = Image.open(background_path).convert("RGB")
        foreground = Image.open(foreground_path).convert("RGBA")
        alpha = foreground.getchannel("A")
        if alpha.size != background.size:
            print(
                f"resize mask: {pair.location}/{pair.foreground} "
                f"{alpha.size[0]}x{alpha.size[1]} -> "
                f"{background.size[0]}x{background.size[1]}"
            )
            alpha = alpha.resize(background.size, Image.Resampling.LANCZOS)

        rgb = visible_rgb(background, alpha)
        rebuilt = Image.merge("RGBA", (*rgb.split(), alpha))
        rebuilt.save(foreground_path, optimize=True, compress_level=9)
        print(f"rebuilt: {foreground_path.relative_to(project_root)}")


def validate(project_root: Path) -> bool:
    ok = True
    for pair in PAIRS:
        background_path, foreground_path = pair_paths(project_root, pair)
        background = Image.open(background_path).convert("RGB")
        foreground = Image.open(foreground_path).convert("RGBA")
        alpha = foreground.getchannel("A")
        label = f"{pair.location}/{pair.foreground}"

        if foreground.size != background.size:
            print(
                f"ERROR {label}: foreground {foreground.size} != "
                f"background {background.size}"
            )
            ok = False
            continue
        if alpha.getbbox() is None:
            print(f"ERROR {label}: alpha mask is empty")
            ok = False
            continue

        stored_rgb = foreground.convert("RGB")
        expected_rgb = visible_rgb(background, alpha)
        mismatch = ImageChops.difference(stored_rgb, expected_rgb).getbbox()
        if mismatch is not None:
            print(f"ERROR {label}: visible RGB differs from background at {mismatch}")
            ok = False
            continue

        print(f"OK    {label}: {foreground.size[0]}x{foreground.size[1]}, alpha={alpha.getbbox()}")
    return validate_wang_regions(project_root) and ok


def point_in_polygon(point: tuple[float, float], polygon: list[dict[str, float]]) -> bool:
    inside = False
    x, y = point
    for index, current in enumerate(polygon):
        previous = polygon[index - 1]
        ax, ay = float(current["x"]), float(current["y"])
        bx, by = float(previous["x"]), float(previous["y"])
        intersects = ((ay > y) != (by > y)) and x < (bx - ax) * (y - ay) / (by - ay) + ax
        if intersects:
            inside = not inside
    return inside


def validate_wang_regions(project_root: Path) -> bool:
    regions_path = locations_root(project_root) / "visitor-center" / "regions.json"
    scene = json.loads(regions_path.read_text(encoding="utf-8"))["scenes"]["exterior"]
    obstacle = next(
        (region for region in scene["regions"] if region["id"] == "obstacle-wang"),
        None,
    )
    line = next(
        (item for item in scene["occlusionLines"] if item["id"] == "wang-statue"),
        None,
    )
    if obstacle is None or line is None:
        print("ERROR visitor-center/exterior: Wang statue regions are missing")
        return False

    samples = {
        "pedestal center": ((0.135, 0.52), True),
        "front walkway": ((0.135, 0.62), False),
        "left passage": ((0.025, 0.50), False),
        "right passage": ((0.27, 0.50), False),
    }
    ok = True
    for label, (point, expected) in samples.items():
        actual = point_in_polygon(point, obstacle["points"])
        if actual != expected:
            print(f"ERROR Wang statue obstacle: {label} expected blocked={expected}, got {actual}")
            ok = False

    line_points = line["points"]
    min_x = min(float(point["x"]) for point in line_points)
    max_x = max(float(point["x"]) for point in line_points)
    line_y = sum(float(point["y"]) for point in line_points) / len(line_points)
    if min_x > 0.032 or max_x < 0.240 or not 0.56 <= line_y <= 0.58:
        print("ERROR Wang statue occlusion line no longer follows the pedestal front edge")
        ok = False
    if ok:
        print("OK    visitor-center/exterior: Wang obstacle and occlusion line samples")
    return ok


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--project-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    project_root = args.project_root.resolve()

    if not args.check:
        rebuild(project_root)
    return 0 if validate(project_root) else 1


if __name__ == "__main__":
    sys.exit(main())
