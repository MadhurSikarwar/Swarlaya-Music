import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))                    # synth.py
sys.path.insert(0, str(HERE.parent.parent))      # webapp/ → import audio_lab
