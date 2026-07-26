from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np


def analyze(video_path: Path, output_dir: Path) -> dict[str, object]:
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    duration = frame_count / fps if fps else 0.0
    sample_indices = np.linspace(
        0, max(frame_count - 1, 0), num=min(16, max(frame_count, 1)), dtype=int
    )

    frames: list[np.ndarray] = []
    frame_files: list[str] = []
    stem_dir = output_dir / video_path.stem
    stem_dir.mkdir(parents=True, exist_ok=True)

    for sample_number, frame_index in enumerate(sample_indices):
        capture.set(cv2.CAP_PROP_POS_FRAMES, int(frame_index))
        success, frame = capture.read()
        if not success:
            continue
        frames.append(frame)
        frame_file = stem_dir / f"{sample_number:02d}-frame-{frame_index:04d}.png"
        cv2.imwrite(str(frame_file), frame)
        frame_files.append(str(frame_file))

    capture.release()

    if not frames:
        raise RuntimeError(f"No frames decoded: {video_path}")

    thumb_width = 320
    thumb_height = round(height * thumb_width / width)
    columns = 4
    rows = (len(frames) + columns - 1) // columns
    label_height = 34
    sheet = np.full(
        (rows * (thumb_height + label_height), columns * thumb_width, 3),
        28,
        dtype=np.uint8,
    )

    for index, (frame, frame_index) in enumerate(zip(frames, sample_indices)):
        thumb = cv2.resize(frame, (thumb_width, thumb_height), interpolation=cv2.INTER_AREA)
        row, column = divmod(index, columns)
        y = row * (thumb_height + label_height)
        x = column * thumb_width
        sheet[y : y + thumb_height, x : x + thumb_width] = thumb
        timestamp = frame_index / fps if fps else 0
        cv2.putText(
            sheet,
            f"{timestamp:0.2f}s  frame {frame_index}",
            (x + 8, y + thumb_height + 24),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (235, 235, 235),
            1,
            cv2.LINE_AA,
        )

    sheet_file = output_dir / f"{video_path.stem}-contact-sheet.jpg"
    cv2.imwrite(str(sheet_file), sheet, [cv2.IMWRITE_JPEG_QUALITY, 94])

    return {
        "source": str(video_path),
        "width": width,
        "height": height,
        "fps": fps,
        "frame_count": frame_count,
        "duration": duration,
        "contact_sheet": str(sheet_file),
        "sample_frames": frame_files,
    }


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit("Usage: analyze_walk_video.py OUTPUT_DIR VIDEO [VIDEO ...]")
    output_dir = Path(sys.argv[1])
    output_dir.mkdir(parents=True, exist_ok=True)
    reports = [analyze(Path(path), output_dir) for path in sys.argv[2:]]
    report_path = output_dir / "video-report.json"
    report_path.write_text(
        json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(report_path)
    for report in reports:
        print(
            f"{Path(str(report['source'])).name}: "
            f"{report['width']}x{report['height']}, "
            f"{report['fps']:.3f} fps, {report['duration']:.3f}s"
        )


if __name__ == "__main__":
    main()
