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


def keep_main_component(alpha: np.ndarray) -> np.ndarray:
    # Use a firm core for component selection so soft generated floor shadows
    # are not joined to the shoes. Edge antialiasing is restored by dilation.
    hard_mask = (alpha > 96).astype(np.uint8)
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(
        hard_mask, connectivity=8
    )
    if count <= 1:
        return alpha
    height, width = alpha.shape
    candidates: list[tuple[float, int]] = []
    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        center_x, center_y = centroids[label]
        if width * 0.18 < center_x < width * 0.82 and height * 0.05 < center_y < height * 0.98:
            candidates.append((area, label))
    if not candidates:
        return alpha
    chosen = max(candidates)[1]
    component = (labels == chosen).astype(np.uint8)
    component = cv2.dilate(component, np.ones((5, 5), np.uint8))
    return alpha * component


def green_alpha(frame: np.ndarray) -> np.ndarray:
    b, g, r = cv2.split(frame.astype(np.float32) / 255.0)
    greenness = g - np.maximum(r, b)
    alpha = np.clip((0.18 - greenness) / 0.14, 0.0, 1.0)
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    green = (
        (hsv[:, :, 0] >= 32)
        & (hsv[:, :, 0] <= 96)
        & (hsv[:, :, 1] >= 45)
        & (hsv[:, :, 2] >= 90)
        & (g > r * 1.04)
        & (g > b * 1.02)
    )
    alpha[green] = np.minimum(alpha[green], 0.04)
    alpha = keep_main_component((alpha * 255).astype(np.uint8)).astype(np.float32) / 255.0
    alpha = cv2.GaussianBlur(alpha, (0, 0), 0.75)
    alpha[alpha < 0.025] = 0
    return np.clip(alpha * 255, 0, 255).astype(np.uint8)


def neutral_alpha(frame: np.ndarray) -> np.ndarray:
    height, width = frame.shape[:2]
    border = np.concatenate(
        [
            frame[: max(8, height // 12)].reshape(-1, 3),
            frame[-max(8, height // 12) :].reshape(-1, 3),
            frame[:, : max(8, width // 12)].reshape(-1, 3),
            frame[:, -max(8, width // 12) :].reshape(-1, 3),
        ],
        axis=0,
    )
    background_bgr = np.median(border, axis=0).astype(np.uint8)
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB).astype(np.float32)
    background_lab = cv2.cvtColor(background_bgr.reshape(1, 1, 3), cv2.COLOR_BGR2LAB).astype(np.float32)[0, 0]
    distance = np.linalg.norm(lab - background_lab, axis=2)
    # The neutral source contains a soft generated floor shadow. Starting the
    # matte farther away from the sampled backdrop removes that shadow while
    # preserving the character's antialiased silhouette.
    alpha = np.clip((distance - 9.0) / 11.0, 0.0, 1.0)
    matte = (alpha * 255).astype(np.uint8)
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    rows = np.arange(height)[:, None]
    soft_floor_shadow = (
        (rows > height * 0.62)
        & (hsv[:, :, 1] < 42)
        & (hsv[:, :, 2] > 105)
        & (distance < 46)
    )
    matte[soft_floor_shadow] = 0
    alpha = keep_main_component(matte).astype(np.float32) / 255.0
    alpha = cv2.GaussianBlur(alpha, (0, 0), 0.8)
    alpha[alpha < 0.025] = 0
    return np.clip(alpha * 255, 0, 255).astype(np.uint8)


def foreground_alpha(frame: np.ndarray, mode: str) -> np.ndarray:
    return neutral_alpha(frame) if mode == "neutral" else green_alpha(frame)


def bbox_from_alpha(alpha: np.ndarray) -> tuple[int, int, int, int]:
    points = cv2.findNonZero((alpha > 20).astype(np.uint8))
    if points is None:
        raise RuntimeError("Foreground mask is empty")
    return cv2.boundingRect(points)


def normalized_pose(frame: np.ndarray, mode: str) -> np.ndarray:
    alpha = foreground_alpha(frame, mode)
    x, y, width, height = bbox_from_alpha(alpha)
    crop = frame[y : y + height, x : x + width]
    mask = alpha[y : y + height, x : x + width]
    target_height = 180
    scale = target_height / max(height, 1)
    target_width = max(1, round(width * scale))
    crop = cv2.resize(crop, (target_width, target_height), interpolation=cv2.INTER_AREA)
    mask = cv2.resize(mask, (target_width, target_height), interpolation=cv2.INTER_AREA)
    canvas = np.full((192, 192, 3), 245, dtype=np.uint8)
    paste_x = (192 - target_width) // 2
    paste_y = 6
    alpha_float = mask.astype(np.float32)[:, :, None] / 255.0
    region = canvas[paste_y : paste_y + target_height, paste_x : paste_x + target_width]
    region[:] = (crop * alpha_float + region * (1.0 - alpha_float)).astype(np.uint8)
    return canvas


def choose_cycle(
    frames: list[np.ndarray], mode: str, max_frame: int | None = None
) -> tuple[int, int]:
    usable = frames[: max_frame + 1] if max_frame is not None else frames
    normalized = [normalized_pose(frame, mode).astype(np.float32) for frame in usable]
    best = (float("inf"), 0, 24)
    for period in range(18, 31):
        for start in range(0, min(25, len(normalized) - period - 1)):
            comparison_count = min(period, len(normalized) - start - period)
            if comparison_count < 10:
                continue
            sample_offsets = np.linspace(0, comparison_count - 1, 8).round().astype(int)
            scores = []
            for offset in sample_offsets:
                difference = normalized[start + offset] - normalized[start + period + offset]
                scores.append(float(np.mean(difference * difference)))
            score = float(np.mean(scores))
            if score < best[0]:
                best = (score, start, period)
    return best[1], best[2]


def key_frame(frame: np.ndarray, mode: str) -> tuple[np.ndarray, tuple[int, int, int, int]]:
    alpha = foreground_alpha(frame, mode)
    x, y, width, height = bbox_from_alpha(alpha)
    rgba = cv2.cvtColor(frame, cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = alpha
    if mode == "neutral":
        # Remove the neutral backdrop mixed into antialiased edge pixels. Merely
        # lowering alpha leaves a pale fringe once Cocos applies linear sampling.
        frame_height, frame_width = frame.shape[:2]
        border = np.concatenate(
            [
                frame[: max(8, frame_height // 12)].reshape(-1, 3),
                frame[-max(8, frame_height // 12) :].reshape(-1, 3),
                frame[:, : max(8, frame_width // 12)].reshape(-1, 3),
                frame[:, -max(8, frame_width // 12) :].reshape(-1, 3),
            ],
            axis=0,
        )
        background = np.median(border, axis=0).astype(np.float32)
        alpha_float = alpha.astype(np.float32) / 255.0
        edge = (alpha > 0) & (alpha < 250)
        safe_alpha = np.maximum(alpha_float[edge, None], 0.08)
        recovered = (
            frame[edge].astype(np.float32)
            - background[None, :] * (1.0 - safe_alpha)
        ) / safe_alpha
        rgba[edge, :3] = np.clip(recovered, 0, 255).astype(np.uint8)
    elif mode == "green":
        foreground = alpha > 0
        b, g, r = rgba[:, :, 0], rgba[:, :, 1], rgba[:, :, 2]
        edge_limit = np.clip(np.maximum(r[foreground], b[foreground]).astype(np.uint16) + 6, 0, 255).astype(np.uint8)
        g[foreground] = np.minimum(g[foreground], edge_limit)
    # Transparent RGB must be black; otherwise texture filtering pulls the
    # original backdrop into the visible silhouette at runtime.
    rgba[alpha == 0, :3] = 0
    return rgba, (x, y, width, height)


def place_frames(selected: list[np.ndarray], mode: str) -> list[np.ndarray]:
    keyed = [key_frame(frame, mode) for frame in selected]
    median_height = float(np.median([bbox[3] for _, bbox in keyed]))
    scale = TARGET_HEIGHT / median_height
    output: list[np.ndarray] = []
    for rgba, (x, y, width, height) in keyed:
        crop = rgba[y : y + height, x : x + width]
        target_width = max(1, round(width * scale))
        target_height = max(1, round(height * scale))
        resized = cv2.resize(
            crop,
            (target_width, target_height),
            interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC,
        )
        if mode == "neutral":
            # The generated neutral-background clip contains a narrow, mostly
            # opaque pale rim that is part of the source image rather than just
            # transparent RGB. Contracting the matte removes that baked-in rim;
            # a small blur restores a clean antialiased edge.
            contracted = cv2.erode(
                resized[:, :, 3],
                cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
                iterations=2,
            )
            contracted = cv2.GaussianBlur(contracted, (0, 0), 0.55)
            contracted[contracted < 3] = 0
            resized[:, :, 3] = contracted
            resized[contracted == 0, :3] = 0
        canvas = np.zeros((CANVAS_HEIGHT, CANVAS_WIDTH, 4), dtype=np.uint8)
        paste_x = round((CANVAS_WIDTH - target_width) / 2)
        paste_y = round(FOOT_Y - target_height)
        source_x, source_y = max(0, -paste_x), max(0, -paste_y)
        destination_x, destination_y = max(0, paste_x), max(0, paste_y)
        copy_width = min(target_width - source_x, CANVAS_WIDTH - destination_x)
        copy_height = min(target_height - source_y, CANVAS_HEIGHT - destination_y)
        canvas[destination_y : destination_y + copy_height, destination_x : destination_x + copy_width] = resized[source_y : source_y + copy_height, source_x : source_x + copy_width]
        output.append(canvas)
    return output


def checker_preview(frame: np.ndarray) -> np.ndarray:
    y_grid, x_grid = np.indices(frame.shape[:2])
    checker = ((x_grid // 24 + y_grid // 24) % 2) * 42 + 180
    background = np.repeat(checker[:, :, None], 3, axis=2).astype(np.uint8)
    alpha = frame[:, :, 3:4].astype(np.float32) / 255.0
    return (frame[:, :, :3] * alpha + background * (1.0 - alpha)).astype(np.uint8)


def write_direction(direction: str, frames: list[np.ndarray], output_root: Path, preview_root: Path, mirror: bool = False) -> None:
    final_frames = [cv2.flip(frame, 1) for frame in frames] if mirror else frames
    frame_dir = output_root / direction
    frame_dir.mkdir(parents=True, exist_ok=True)
    for index, frame in enumerate(final_frames):
        cv2.imwrite(str(frame_dir / f"{direction}-{index:02d}.png"), frame)
    preview = np.zeros((CANVAS_HEIGHT * 2, CANVAS_WIDTH * 4, 3), dtype=np.uint8)
    for index, frame in enumerate(final_frames):
        row, column = divmod(index, 4)
        preview[row * CANVAS_HEIGHT : (row + 1) * CANVAS_HEIGHT, column * CANVAS_WIDTH : (column + 1) * CANVAS_WIDTH] = checker_preview(frame)
    preview_root.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(preview_root / f"run-{direction}-preview.jpg"), preview, [cv2.IMWRITE_JPEG_QUALITY, 94])


def process_video(
    path: Path,
    direction: str,
    mode: str,
    output_root: Path,
    preview_root: Path,
    max_frame: int | None = None,
    cycle: tuple[int, int] | None = None,
) -> tuple[list[np.ndarray], dict[str, object]]:
    frames, fps = decode_video(path)
    start, period = cycle or choose_cycle(frames, mode, max_frame)
    indices = [start + round(index * period / FRAME_COUNT) for index in range(FRAME_COUNT)]
    selected = [frames[index] for index in indices]
    placed = place_frames(selected, mode)
    write_direction(direction, placed, output_root, preview_root)
    return placed, {
        "direction": direction,
        "source": str(path),
        "fps": fps,
        "cycle_start_frame": start,
        "cycle_period_frames": period,
        "source_frame_indices": indices,
        "output_frame_duration_seconds": period / fps / FRAME_COUNT,
        "canvas": [CANVAS_WIDTH, CANVAS_HEIGHT],
        "anchor_normalized": [0.5, 1.0 - FOOT_Y / CANVAS_HEIGHT],
    }


def main() -> None:
    if len(sys.argv) != 6:
        raise SystemExit("Usage: extract_run_frames.py OUTPUT_ROOT PREVIEW_ROOT FRONT_VIDEO RIGHT_VIDEO BACK_VIDEO")
    output_root = Path(sys.argv[1])
    preview_root = Path(sys.argv[2])
    # These cycle windows were selected from contact sheets and pose matching.
    # The right clip intentionally excludes the changed gait after 2.5 seconds.
    down, down_report = process_video(Path(sys.argv[3]), "down", "green", output_root, preview_root, cycle=(32, 32))
    right, right_report = process_video(Path(sys.argv[4]), "right", "green", output_root, preview_root, max_frame=56, cycle=(22, 20))
    up, up_report = process_video(Path(sys.argv[5]), "up", "green", output_root, preview_root, cycle=(16, 24))
    write_direction("left", right, output_root, preview_root, mirror=True)
    left_report = dict(right_report)
    left_report.update({"direction": "left", "source": "horizontal mirror of right", "mirrored_from": "right"})
    report = {"frame_count_per_direction": FRAME_COUNT, "directions": [down_report, up_report, right_report, left_report]}
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "run-animation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
