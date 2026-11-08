"""Run the Audio Lab pipeline from a terminal.

  python -m audio_lab.cli tabla.mp4 --lehra lehra.mp3 --target reel --out results/
  python -m audio_lab.cli tabla.wav --denoise on --variants balanced phone_bass

Writes <out>/<variant>.wav|mp3|m4a|mp4, report.json and spectrograms.json,
and prints the quality gates.  Exit status 1 if every version failed its gates.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .processing import VARIANTS, AudioLabError, JobOptions, JobSpec, run_pipeline


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("tabla", type=Path, help="the tabla recording (audio or video)")
    p.add_argument("--lehra", type=Path, help="a lehra loop to mix under it")
    p.add_argument("--reference", type=Path, help="a track whose tone to match (matchering)")
    p.add_argument("--out", type=Path, default=Path("audio_lab_out"), help="output folder")
    p.add_argument("--target", choices=("reel", "youtube", "loud"), default="reel")
    p.add_argument("--lehra-db", type=float, default=-7.0, help="lehra level against the tabla, in LU")
    p.add_argument("--offset", type=float, default=None, help="lehra offset in seconds (default: detect)")
    p.add_argument("--brightness", type=float, default=0.0)
    p.add_argument("--bass", type=float, default=0.0)
    p.add_argument("--denoise", choices=("auto", "on", "off"), default="auto")
    p.add_argument("--separate-drums", action="store_true", help="the input is a full song: take the drums stem first")
    p.add_argument("--match-pitch", action="store_true")
    p.add_argument("--match-tempo", action="store_true")
    p.add_argument("--variants", nargs="+", choices=list(VARIANTS), default=list(VARIANTS))
    a = p.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):      # Windows consoles default to a legacy code page
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    options = JobOptions.from_dict({
        "target": a.target, "lehra_db": a.lehra_db, "offset_seconds": a.offset, "brightness_db": a.brightness,
        "bass_db": a.bass, "denoise": a.denoise, "separate_drums": a.separate_drums, "match_pitch": a.match_pitch,
        "match_tempo": a.match_tempo, "variants": a.variants,
    })
    spec = JobSpec(tabla=a.tabla, lehra=a.lehra, reference=a.reference, out_dir=a.out, options=options,
                   display_name=a.tabla.name)

    def progress(stage, fraction, message):
        print(f"[{fraction:4.0%}] {message}", file=sys.stderr, flush=True)

    try:
        report = run_pipeline(spec, progress)
    except AudioLabError as e:
        print(f"FAILED ({e.code}): {e.message}", file=sys.stderr)
        return 1
    for name, v in report["variants"].items():
        print(f"\n{v['label']}: {'PASS' if v['passed'] else 'FAIL'}")
        for g in v["gates"]:
            print(f"  {'ok  ' if g['pass'] else 'FAIL'} {g['name']:<22} {g['value']}  (limit {g['limit']})")
    for w in report["warnings"]:
        print("warning:", w)
    print(f"\nreport: {a.out / 'report.json'}   ({report['seconds_taken']} s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
