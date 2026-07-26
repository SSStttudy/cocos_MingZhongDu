from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np


CANVAS_WIDTH = 384
CANVAS_HEIGHT = 512
TARGET_HEIGHT = 440
FOOT_Y = 480
FRAME_COUNT = 8
EXPECTED_PERIOD = 32


def decode_video(path: Path) -> tuple[list[np.ndarray], float]:
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise RuntimeError(f"Cannot open video: {path}")
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    frames: list[np.ndarray] = []
    while True:
        success, frame = capture.read()
        if not success:
            break
        frames.append(frame)
    capture.release()
    if not frames:
        raise RuntimeError(f"No frames decoded: {path}")
    return frames, fps


def foreground_alpha(frame: np.ndarray) -> np.ndarray:
    b, g, r = cv2.split(frame.astype(np.float32) / 255.0)
    greenness = g - np.maximum(r, b)
    alpha = np.clip((0.17 - greenness) / 0.13, 0.0, 1.0)
    # Hair is nearly black, but green-screen antialiasing can make its edge look
    # green. Preserve dark pixels before applying the bright-green key.
    row_indices = np.arange(frame.shape[0])[:, None]
    dark_foreground = (
        (np.maximum(np.maximum(b, g), r) < 0.48)
        & (row_indices < frame.shape[0] * 0.72)
    )
    alpha[dark_foreground] = 1.0

    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    green = (
        (hsv[:, :, 0] >= 34)
        & (hsv[:, :, 0] <= 94)
        & (hsv[:, :, 1] >= 55)
        & (hsv[:, :, 2] >= 115)
        & (g > r * 1.06)
        & (g > b * 1.03)
    )
    alpha[green] = np.minimum(alpha[green], 0.08)

    hard_mask = (alpha > 0.22).astype(np.uint8)
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(
        hard_mask, connectivity=8
    )
    if count > 1:
        height, width = hard_mask.shape
        candidates: list[tuple[float, int]] = []
        for label in range(1, count):
            area = int(stats[label, cv2.CC_STAT_AREA])
            center_x, center_y = centroids[label]
            if not (width * 0.18 < center_x < width * 0.82):
                continue
            if not (height * 0.05 < center_y < height * 0.98):
                continue
            candidates.append((area, label))
        if candidates:
            chosen = max(candidates)[1]
            component = (labels == chosen).astype(np.uint8)
            component = cv2.dilate(component, np.ones((7, 7), np.uint8))
            alpha *= component

    alpha = cv2.GaussianBlur(alpha, (0, 0), 0.8)
    alpha[alpha < 0.025] = 0
    return np.clip(alpha * 255.0, 0, 255).astype(np.uint8)


def bbox_from_alpha(alpha: np.ndarray) -> tuple[int, int, int, int]:
    points = cv2.findNonZero((alpha > 20).astype(np.uint8))
    if points is None:
        raise RuntimeError("Foreground mask is empty")
    return cv2.boundingRect(points)


def normalized_pose(frame: np.ndarray) -> np.ndarray:
    alpha = foreground_alpha(frame)
    x, y, width, height = bbox_from_alpha(alpha)
    crop = frame[y : y + height, x : x + width]
    mask = alpha[y : y + height, x : x + width]
    scale = 180.0 / max(height, 1)
    resized = cv2.resize(
        crop, (max(1, round(width * scale)), 180), interpolation=cv2.INTER_AREA
    )
    resized_mask = cv2.resize(
        mask,
        (resized.shape[1], resized.shape[0]),
        interpolation=cv2.INTER_AREA,
    )
    canvas = np.full((192, 192, 3), 245, dtype=np.uint8)
    paste_x = (192 - resized.shape[1]) // 2
    paste_y = 6
    alpha_float = resized_mask.astype(np.float32)[:, :, None] / 255.0
    region = canvas[
        paste_y : paste_y + resized.shape[0],
        paste_x : paste_x + resized.shape[1],
    ]
    region[:] = (
        resized.astype(np.float32) * alpha_float
        + region.astype(np.float32) * (1.0 - alpha_float)
    ).astype(np.uint8)
    return canvas


def choose_cycle_start(frames: list[np.ndarray]) -> int:
    max_start = min(EXPECTED_PERIOD - 1, len(frames) - EXPECTED_PERIOD * 2 - 1)
    if max_start < 0:
        return 0
    normalized = [
        normalized_pose(frame)
        for frame in frames[: min(len(frames), EXPECTED_PERIOD * 3)]
    ]
    best_start = 0
    best_score = float("inf")
    for start in range(max_start + 1):
        comparisons = []
        for offset in (EXPECTED_PERIOD, EXPECTED_PERIOD * 2):
            if start + offset >= len(normalized):
                continue
            difference = normalized[start].astype(np.float32) - normalized[
                start + offset
            ].astype(np.float32)
            comparisons.append(float(np.mean(difference * difference)))
        if comparisons:
            score = sum(comparisons) / len(comparisons)
            if score < best_score:
                best_start = start
                best_score = score
    return best_start


def key_frame(frame: np.ndarray) -> tuple[np.ndarray, tuple[int, int, int, int]]:
    alpha = foreground_alpha(frame)
    x, y, width, height = bbox_from_alpha(alpha)
    rgba = cv2.cvtColor(frame, cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = alpha

    foreground = alpha > 0
    if np.any(foreground):
        b = rgba[:, :, 0]
        g = rgba[:, :, 1]
        r = rgba[:, :, 2]
        edge_limit = np.clip(
            np.maximum(r[foreground], b[foreground]).astype(np.uint16) + 5, 0, 255
        ).astype(np.uint8)
        g[foreground] = np.minimum(g[foreground], edge_limit)
    return rgba, (x, y, width, height)


def place_frames(selected: list[np.ndarray]) -> list[np.ndarray]:
    keyed = [key_frame(frame) for frame in selected]
    median_height = float(np.median([bbox[3] for _, bbox in keyed]))
    scale = TARGET_HEIGHT / median_height
    output: list[np.ndarray] = []

    for rgba, (x, y, width, height) in keyed:
        crop = rgba[y : y + height, x : x + width]
        target_width = max(1, round(width * scale))
        target_height = max(1, round(height * scale))
        interpolation = cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC
        resized = cv2.resize(
            crop, (target_width, target_height), interpolation=interpolation
        )
        canvas = np.zeros((CANVAS_HEIGHT, CANVAS_WIDTH, 4), dtype=np.uint8)
        paste_x = round((CANVAS_WIDTH - target_width) / 2)
        paste_y = round(FOOT_Y - target_height)
        source_x = max(0, -paste_x)
        source_y = max(0, -paste_y)
        destination_x = max(0, paste_x)
        destination_y = max(0, paste_y)
        copy_width = min(target_width - source_x, CANVAS_WIDTH - destination_x)
        copy_height = min(target_height - source_y, CANVAS_HEIGHT - destination_y)
        canvas[
            destination_y : destination_y + copy_height,
            destination_x : destination_x + copy_width,
        ] = resized[
            source_y : source_y + copy_height,
            source_x : source_x + copy_width,
        ]
        output.append(canvas)
    return output


def checker_preview(frame: np.ndarray) -> np.ndarray:
    square = 24
    y_grid, x_grid = np.indices(frame.shape[:2])
    checker = ((x_grid // square + y_grid // square) % 2) * 42 + 180
    background = np.repeat(checker[:, :, None], 3, axis=2).astype(np.uint8)
    alpha = frame[:, :, 3:4].astype(np.float32) / 255.0
    return (
        frame[:, :, :3].astype(np.float32) * alpha
        + background.astype(np.float32) * (1.0 - alpha)
    ).astype(np.uint8)


def write_direction(
    direction: str,
    frames: list[np.ndarray],
    output_root: Path,
    preview_root: Path,
    mirror: bool = False,
) -> None:
    frame_dir = output_root / direction
    frame_dir.mkdir(parents=True, exist_ok=True)
    final_frames = [cv2.flip(frame, 1) for frame in frames] if mirror else frames
    for index, frame in enumerate(final_frames):
        cv2.imwrite(str(frame_dir / f"{direction}-{index:02d}.png"), frame)

    columns = 4
    rows = 2
    sheet = np.zeros(
        (rows * CANVAS_HEIGHT, columns * CANVAS_WIDTH, 4), dtype=np.uint8
    )
    preview = np.zeros(
        (rows * CANVAS_HEIGHT, columns * CANVAS_WIDTH, 3), dtype=np.uint8
    )
    for index, frame in enumerate(final_frames):
        row, column = divmod(index, columns)
        y = row * CANVAS_HEIGHT
        x = column * CANVAS_WIDTH
        sheet[y : y + CANVAS_HEIGHT, x : x + CANVAS_WIDTH] = frame
        preview[y : y + CANVAS_HEIGHT, x : x + CANVAS_WIDTH] = checker_preview(frame)
    preview_root.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(preview_root / f"walk-{direction}-sheet.png"), sheet)
    cv2.imwrite(
        str(preview_root / f"walk-{direction}-preview.jpg"),
        preview,
        [cv2.IMWRITE_JPEG_QUALITY, 94],
    )


def process_video(
    path: Path, direction: str, output_root: Path, preview_root: Path
) -> tuple[list[np.ndarray], dict[str, object]]:
    frames, fps = decode_video(path)
    start = choose_cycle_start(frames)
    indices = [
        start + round(index * EXPECTED_PERIOD / FRAME_COUNT)
        for index in range(FRAME_COUNT)
    ]
    selected = [frames[index] for index in indices]
    placed = place_frames(selected)
    write_direction(direction, placed, output_root, preview_root)
    return placed, {
        "direction": direction,
        "source": str(path),
        "fps": fps,
        "cycle_start_frame": start,
        "cycle_period_frames": EXPECTED_PERIOD,
        "source_frame_indices": indices,
        "output_frame_duration_seconds": EXPECTED_PERIOD / fps / FRAME_COUNT,
        "canvas": [CANVAS_WIDTH, CANVAS_HEIGHT],
        "anchor_normalized": [0.5, 1.0 - FOOT_Y / CANVAS_HEIGHT],
    }


def main() -> None:
    if len(sys.argv) != 6:
        raise SystemExit(
            "Usage: extract_walk_frames.py OUTPUT_ROOT PREVIEW_ROOT "
            "FRONT_VIDEO RIGHT_VIDEO BACK_VIDEO"
        )
    output_root = Path(sys.argv[1])
    preview_root = Path(sys.argv[2])
    output_root.mkdir(parents=True, exist_ok=True)

    down, down_report = process_video(
        Path(sys.argv[3]), "down", output_root, preview_root
    )
    right, right_report = process_video(
        Path(sys.argv[4]), "right", output_root, preview_root
    )
    up, up_report = process_video(Path(sys.argv[5]), "up", output_root, preview_root)
    write_direction("left", right, output_root, preview_root, mirror=True)
    left_report = dict(right_report)
    left_report.update(
        {
            "direction": "left",
            "source": "horizontal mirror of right",
            "mirrored_from": "right",
        }
    )

    report = {
        "frame_count_per_direction": FRAME_COUNT,
        "directions": [down_report, up_report, right_report, left_report],
    }
    (output_root / "walk-animation.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(output_root)
    for item in report["directions"]:
        print(
            f"{item['direction']}: "
            f"frames={item.get('source_frame_indices')}, "
            f"duration={item['output_frame_duration_seconds']:.4f}s/frame"
        )


if __name__ == "__main__":
    main()
