"""Synthetic tabla- and lehra-like signals for the tests (no real recordings are needed or used)."""
from __future__ import annotations

import numpy as np
import scipy.signal as sps

SR = 48000


def _stroke(kind: str, f0: float, rng: np.random.Generator) -> np.ndarray:
    """One stroke: 'na' (dayan, rings at f0), 'dha' (dayan + bayan), 'ge' (bayan only), 'ka' (closed, no ring)."""
    n = int(0.9 * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    if kind in ("na", "dha"):
        ring = sum(a * np.sin(2 * np.pi * f0 * h * t + 0.3 * h) for h, a in ((1, 1.0), (2, 0.35), (3, 0.2)))
        out += ring * np.exp(-t / 0.28)
        click = rng.normal(0, 1, n) * np.exp(-t / 0.004)
        sos = sps.butter(2, [2000, 5500], btype="band", fs=SR, output="sos")
        out += 0.35 * sps.sosfilt(sos, click)
    if kind == "ka":
        click = rng.normal(0, 1, n) * np.exp(-t / 0.012)
        sos = sps.butter(2, [600, 4000], btype="band", fs=SR, output="sos")
        out += 1.2 * sps.sosfilt(sos, click)
    if kind in ("ge", "dha"):
        glide = 105 + 40 * np.exp(-t / 0.05)
        phase = 2 * np.pi * np.cumsum(glide) / SR
        out += 0.9 * np.sin(phase) * np.exp(-t / 0.22)
    return out


def make_tabla(seconds: float = 14.0, f0: float = 196.0, level_db: float = -12.0, noise_db: float = -58.0,
               mud_db: float = 0.0, clip_at: float | None = None, hum_hz: float | None = None,
               seed: int = 0, beat: float = 0.4, stereo: bool = True, pattern: list | None = None,
               accelerate: float = 0.0) -> np.ndarray:
    """A 16-beat cycle (Teentaal-ish) repeated; returns float32 (frames, 2).

    `accelerate`: the beat gets this much shorter (as a fraction) by the end — for laya tests.
    """
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    y = np.zeros(n)
    pattern = pattern or ["dha", "na", "na", "dha", "dha", "na", "na", "dha", "dha", "na", "na", "ge", "na", "na", "na", "dha"]
    i = 0
    t_pos = 0.0
    while True:
        pos = int(t_pos * SR)
        if pos >= n:
            break
        s = _stroke(pattern[i % len(pattern)], f0, rng)
        end = min(n, pos + len(s))
        y[pos:end] += s[:end - pos]
        t_pos += beat * (1 - accelerate * t_pos / seconds)
        i += 1
    if mud_db:
        sos = sps.butter(2, [250, 500], btype="band", fs=SR, output="sos")
        y += (10 ** (mud_db / 20)) * sps.sosfilt(sos, y)
    y = y / (np.max(np.abs(y)) + 1e-9) * 10 ** (level_db / 20)
    y += rng.normal(0, 10 ** (noise_db / 20), n)
    if hum_hz:
        t = np.arange(n) / SR
        y += 10 ** (-48 / 20) * (np.sin(2 * np.pi * hum_hz * t) + 0.5 * np.sin(2 * np.pi * 2 * hum_hz * t))
    if clip_at is not None:
        y = np.clip(y / (np.max(np.abs(y)) + 1e-9) * clip_at * 1.8, -clip_at, clip_at)
    left = y
    right = y * 0.97 if stereo else y
    return np.stack([left, right], axis=1).astype(np.float32)


def make_lehra(seconds: float = 6.4, tonic_hz: float = 196.0, detune_cents: float = 0.0, level_db: float = -20.0,
               beat: float = 0.4, seed: int = 1) -> np.ndarray:
    """A 16-beat loop of sustained notes (tonic-heavy) whose onsets sit on the beats."""
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    y = np.zeros(n)
    tonic = tonic_hz * 2 ** (detune_cents / 1200)
    ratios = [1, 1, 9 / 8, 1, 5 / 4, 1, 3 / 2, 1, 5 / 4, 1, 9 / 8, 1, 1, 3 / 2, 1, 1]
    for i, r in enumerate(ratios):
        a = int(i * beat * SR)
        b = min(n, a + int(beat * SR))
        seg = np.arange(b - a) / SR
        env = np.minimum(1, seg / 0.02) * np.exp(-seg / 0.5)
        note = sum(amp * np.sin(2 * np.pi * tonic * r * h * seg) for h, amp in ((1, 1.0), (2, 0.4), (3, 0.2)))
        y[a:b] += note * env
    y += rng.normal(0, 0.002, n)
    y = y / (np.max(np.abs(y)) + 1e-9) * 10 ** (level_db / 20)
    return np.stack([y, y], axis=1).astype(np.float32)
