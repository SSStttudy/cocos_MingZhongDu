"""Build one original, periodic background cue and a self-contained review page.

Requires Python 3 + NumPy. No network, samples, API keys, or third-party audio.
Run from any directory; output stays in art-review/audio/v01, outside Cocos assets.
"""
from pathlib import Path
import base64
import hashlib
import json
import math
import wave

import numpy as np


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "art-review" / "audio" / "v01"
RATE = 44100
SECONDS = 24
N = RATE * SECONDS
SEED = 9042026
NAME = "mzd_bgm_wind_over_zhongdu_v01"
rng = np.random.default_rng(SEED)
mix = np.zeros((N, 2), dtype=np.float64)


def hz(midi):
    return 440 * 2 ** ((midi - 69) / 12)


def add_periodic(signal, start, pan=0.0, level=1.0):
    """Wrap every release across the boundary: no truncated reverb tails."""
    indices = (np.arange(len(signal)) + round(start * RATE)) % N
    angle = (pan + 1) * math.pi / 4
    mix[indices, 0] += signal * math.cos(angle) * level
    mix[indices, 1] += signal * math.sin(angle) * level


def pluck(midi, strength=1.0):
    t = np.arange(round(5.2 * RATE)) / RATE
    fundamental = hz(midi)
    tone = np.zeros_like(t)
    # Rounded attacks and rapidly decaying upper partials; a reference timbre,
    # deliberately not labelled as a recording of any historical instrument.
    for partial in range(1, 12):
        frequency = fundamental * partial * math.sqrt(1 + 0.00004 * partial**2)
        decay = 1.70 / partial**0.52
        phase = rng.uniform(-0.18, 0.18)
        vibration = 0.025 * np.sin(2 * np.pi * 4.6 * t) * (1 - np.exp(-t * 2))
        tone += (
            np.sin(2 * np.pi * frequency * t + phase + vibration)
            * np.exp(-t / decay)
            * np.exp(-frequency / 5500)
            / partial**1.5
        )
    attack = 1 - np.exp(-t / 0.008)
    release = np.clip((5.2 - t) / 0.45, 0, 1)
    return tone * attack * release**2 * 0.12 * strength


# Eight bars, 80 BPM. A sparse, newly written D-pentatonic phrase.
melody = [
    (0.35, 62, .90), (1.85, 69, .63),
    (3.35, 66, .80), (4.85, 64, .59),
    (6.35, 71, .74), (7.85, 69, .63),
    (9.35, 64, .75), (10.85, 66, .57),
    (12.35, 74, .67), (13.85, 71, .58),
    (15.35, 69, .79), (16.85, 66, .61),
    (18.35, 64, .75), (19.85, 69, .56),
    (21.35, 66, .72), (22.85, 62, .78),
]
for index, (start, midi, strength) in enumerate(melody):
    add_periodic(pluck(midi, strength), start, (-.20, .16, -.08, .22)[index % 4])

# Quiet overlapping open intervals, with their attacks softened to 1.8 seconds.
for index, pair in enumerate([(50, 57), (47, 54), (43, 50), (45, 52)]):
    t = np.arange(9 * RATE) / RATE
    envelope = np.sin(np.pi * np.clip(t / 9, 0, 1)) ** 2
    for voice, midi in enumerate(pair):
        f = hz(midi)
        tone = (
            np.sin(2 * np.pi * f * t)
            + .16 * np.sin(2 * np.pi * 2 * f * t + .12)
            + .055 * np.sin(2 * np.pi * 3 * f * t)
        )
        add_periodic(tone * envelope * .026, index * 6 - 1.5, -.32 + voice * .64)

# Periodic band-limited air. FFT bins ensure the noise itself loops continuously.
frequencies = np.fft.rfftfreq(N, 1 / RATE)
shape = np.exp(-frequencies / 1600) * (frequencies / (frequencies + 160)) ** 2
shape[0] = 0
time = np.arange(N) / RATE
for channel in range(2):
    spectrum = (rng.normal(size=len(shape)) + 1j * rng.normal(size=len(shape))) * shape
    spectrum[-1] = spectrum[-1].real
    air = np.fft.irfft(spectrum, n=N)
    air /= np.sqrt(np.mean(air**2))
    swell = .72 + .18 * np.sin(2 * np.pi * time / SECONDS + channel * .35)
    swell += .10 * np.cos(6 * np.pi * time / SECONDS)
    mix[:, channel] += air * swell * .0017

# A small circular room, not a long cinematic wash.
dry = mix.copy()
for delay, gain in [(.113, .12), (.197, .10), (.293, .08), (.421, .06), (.613, .04)]:
    mix += np.roll(dry[:, ::-1], round(delay * RATE), axis=0) * gain
mix -= np.mean(mix, axis=0)
peak_before = float(np.max(np.abs(mix)))
gain = (10 ** (-5 / 20)) / peak_before
mix *= gain

OUT.mkdir(parents=True, exist_ok=True)
pcm = np.rint(np.clip(mix, -1, 1) * 32767).astype("<i2")
audio_path = OUT / f"{NAME}.wav"
with wave.open(str(audio_path), "wb") as output:
    output.setnchannels(2)
    output.setsampwidth(2)
    output.setframerate(RATE)
    output.writeframes(pcm.tobytes())
audio_bytes = audio_path.read_bytes()
decoded = pcm.astype(np.float64) / 32768

# Oversampled periodic reconstruction estimates inter-sample peaks of the WAV.
true_peak = 0.0
for channel in range(2):
    spectrum = np.fft.rfft(decoded[:, channel])
    spectrum[-1] *= .5
    oversampled = np.fft.irfft(spectrum, n=N * 4) * 4
    true_peak = max(true_peak, float(np.max(np.abs(oversampled))))
seam_delta = float(np.max(np.abs(decoded[0] - decoded[-1])))
all_deltas = np.abs(np.diff(decoded, axis=0))
rms = float(np.sqrt(np.mean(decoded**2)))
qa = {
    "duration_seconds": SECONDS,
    "sample_rate_hz": RATE,
    "channels": 2,
    "pcm_bits": 16,
    "sample_peak_dbfs": round(20 * math.log10(float(np.max(np.abs(decoded)))), 3),
    "estimated_true_peak_dbtp_4x": round(20 * math.log10(true_peak), 3),
    "rms_dbfs_not_lufs": round(20 * math.log10(rms), 3),
    "dc_offset": [round(float(x), 9) for x in decoded.mean(axis=0)],
    "clipped_sample_count": int(np.sum(np.abs(pcm.astype(np.int32)) >= 32767)),
    "boundary_step_linear": round(seam_delta, 8),
    "max_internal_step_linear": round(float(np.max(all_deltas)), 8),
    "p99_internal_step_linear": round(float(np.percentile(all_deltas, 99)), 8),
    "loop_method": "periodic overlap-add, circular reverb and periodic FFT noise",
    "bytes": len(audio_bytes),
    "sha256": hashlib.sha256(audio_bytes).hexdigest(),
    "subjective_listening": "pending user review",
}
assert qa["clipped_sample_count"] == 0
assert true_peak < 10 ** (-1 / 20)
assert seam_delta < float(np.percentile(all_deltas, 99))

manifest = {
    "id": "MZD-BG-001",
    "version": "v01",
    "title": "风过中都",
    "status": "试听待审，未接入游戏",
    "category": "background_music",
    "scope": "One locally synthesized looping background cue, requested for HTML review",
    "author": "明中都项目音效样例；Codex 辅助编写合成脚本与原创音符序列",
    "source": "tools/audio/create-background-review.py; no external recordings or samples",
    "source_url": None,
    "third_party_audio_license": "not applicable — no third-party audio assets used",
    "output_license": "未附加 CC 或其他公共许可证；公开发布时由项目方确定",
    "attribution": "没有第三方录音素材的署名条目；保留本生成记录",
    "generation": {
        "method": "Local deterministic additive synthesis + periodic filtered noise",
        "tools": {"python": "3.x", "numpy": np.__version__, "wave": "Python standard library"},
        "seed": SEED,
        "external_ai_service": None,
        "third_party_uploads": False,
        "brief": "安静、克制的国风游览背景；疏落合成拨弦、柔和持续音、极轻风声；无配音、无鼓点。",
        "tempo_bpm": 80,
        "bars": 8,
        "melody_midi": melody,
    },
    "processing": [
        "Soft 8 ms pluck attacks; partial-specific exponential decays; tapered releases",
        "Wrap note and pad tails across the 24 s boundary",
        "Add periodic low-level air and five circular stereo reverb taps",
        "Remove DC; apply one common gain to target -5 dBFS sample peak",
        "Round to stereo PCM16 WAV at 44.1 kHz; verify 4x estimated true peak and seam delta",
        "Embed identical WAV bytes in a self-contained HTML review page",
    ],
    "audio_file": audio_path.name,
    "qa": qa,
    "limitations": [
        "Synthetic timbres, not authentic guqin/guzheng recordings or an on-site field recording",
        "Review WAV and embedded HTML are outside assets; not game-ready size optimization",
        "No subjective listening approval or WeChat device playback test yet",
    ],
}
(OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(OUT / "qa.json").write_text(json.dumps(qa, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

mono = np.sqrt(np.mean(decoded**2, axis=1))
waveform = [float(np.sqrt(np.mean(block**2))) for block in np.array_split(mono, 144)]
waveform = [round(x / max(waveform), 4) for x in waveform]
meta = {
    "id": manifest["id"], "title": manifest["title"], "version": "v01",
    "duration": SECONDS, "fileName": audio_path.name, "sha256": qa["sha256"],
    "sizeMiB": round(len(audio_bytes) / 1024**2, 2),
    "peak": qa["sample_peak_dbfs"], "waveform": waveform,
}
template = (Path(__file__).parent / "review-template.html").read_text(encoding="utf-8")
page = template.replace("__TRACK_META__", json.dumps(meta, ensure_ascii=False))
page = page.replace("__AUDIO_B64__", base64.b64encode(audio_bytes).decode("ascii"))
(OUT / "index.html").write_text(page, encoding="utf-8")
(OUT / "REVIEW.md").write_text("""# 风过中都 · 背景循环音 v01

双击同目录 `index.html` 即可离线试听；音频已嵌入，不需要服务器或网络。
也可以用播放器打开同目录 WAV。HTML 页使用 Web Audio 循环缓冲区，
「听循环接缝」从第 21 秒开始，跨越尾首连接后继续播放。

这是一次背景音乐方向样例：24 秒 / 8 小节 / 80 BPM，疏落合成拨弦、
柔和持续音与极轻风声。它不是实地录音，也不声称复刻真实古代乐器。
所有声音在本地用数学合成产生，没有下载音频、调用第三方生成服务或上传项目。

## 审查

先完整听一轮，再听尾首接缝；关注音色是否过于电子、旋律是否抢注意力、
重复是否明显。页面上的意见只保存在本机浏览器，点击「导出审查意见」
得到 JSON 后需手动交回；页面不会自动向协作者发送信息。

## 交付与记录

- `index.html`：单文件审查页，包含与 WAV 完全相同的音频。
- `mzd_bgm_wind_over_zhongdu_v01.wav`：44.1 kHz / 16 bit / 双声道循环样音。
- `manifest.json`：作者、来源、生成方法、种子、处理记录和文件哈希。
- `qa.json`：峰值、直流偏移、削波和接缝波形检查；RMS 不是 LUFS。

试听 WAV 约 4.04 MiB，HTML 因嵌入音频约 5.4 MiB。这些文件在 `art-review`，
没有放入 Cocos 的 `assets`，也没有接入运行逻辑。正式接入前按确认的听感选择
压缩格式，并复测解码后的循环接缝、微信真机播放和包体；此版不声称已完成这些测试。
当前未为输出附加公共许可证；无第三方音频素材，公开发布方式由项目方确定。

## 复现

安装有 NumPy 的 Python 运行 `tools/audio/create-background-review.py`。
固定种子为 9042026；生成器只写入本审查目录，不触碰场景或游戏脚本。
""", encoding="utf-8")
print(json.dumps({"output": str(OUT), "qa": qa}, ensure_ascii=False, indent=2))
