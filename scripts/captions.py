"""Nitro auto captions: prints JSON lines (status/progress/result/error) for the panel."""
import argparse
import json
import sys


def emit(**msg):
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def load_wav(path):
    """Reads the 16 kHz mono PCM wav produced by ffmpeg (avoids PyAV version issues)."""
    import wave

    import numpy as np

    with wave.open(path, "rb") as w:
        if w.getsampwidth() != 2 or w.getnchannels() != 1:
            return path
        data = w.readframes(w.getnframes())
    return np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--model", default="base")
    ap.add_argument("--language", default=None)
    args = ap.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        emit(type="error", message="faster-whisper não instalado. Abra Ajustes > Instalar Whisper.")
        return 2

    emit(type="status", message="Carregando modelo %s (1ª vez baixa o modelo)…" % args.model)
    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    audio = load_wav(args.input) if args.input.lower().endswith(".wav") else args.input
    segments, info = model.transcribe(
        audio,
        language=args.language,
        word_timestamps=True,
        vad_filter=True,
    )
    total = info.duration or 1.0
    words = []
    for seg in segments:
        for w in seg.words or []:
            words.append({"start": round(w.start, 3), "end": round(w.end, 3), "word": w.word.strip()})
        emit(type="progress", p=min(1.0, seg.end / total))
    emit(type="result", language=info.language, words=words)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # surfaced in the panel
        emit(type="error", message=str(exc))
        sys.exit(1)
