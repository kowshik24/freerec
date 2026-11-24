"""Narration (text-to-speech), synthesized sound effects, a soft music bed and the final mix.

Everything is generated locally: Kokoro neural TTS when kokoro-onnx is installed (model is
downloaded once into build/voices), otherwise macOS `say`. Sound effects and music are
plain numpy synthesis, so there are no third-party audio assets to license.
"""
import hashlib
import os
import subprocess
import urllib.request
import wave

import imageio_ffmpeg
import numpy as np

SR = 48_000
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
KOKORO_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
KOKORO_VOICE = "af_heart"  # warm US English; try am_michael, af_bella, bf_emma, bm_george
KOKORO_SPEED = 1.0
SAY_VOICE = "Samantha"
SFX_GAIN = 0.45   # effects bus, ~-7 dB under the narration
MUSIC_GAIN = 0.09


# --- helpers ---------------------------------------------------------------

def _read_wav(path):
    with wave.open(path) as w:
        assert w.getframerate() == SR and w.getsampwidth() == 2
        a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
        return a.reshape(-1, w.getnchannels()).mean(axis=1)


def _to_wav48(src, dst):
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", src, "-ac", "1", "-ar", str(SR),
                    "-sample_fmt", "s16", dst], check=True)


def write_wav(path, stereo):
    pcm = (np.clip(stereo, -1, 1) * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def _t(seconds):
    return np.arange(int(SR * seconds)) / SR


def _env(n, attack=0.005, decay=None):
    """Linear attack then exponential decay (decay = time constant in seconds)."""
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(attack, 1e-4))
    if decay:
        e *= np.exp(-np.maximum(0, t - attack) / decay)
    return e


def _lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):  # small buffers only
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def _bell(freq, seconds, decay):
    t = _t(seconds)
    tone = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * freq * 2.01 * t) + 0.12 * np.sin(2 * np.pi * freq * 3.02 * t)
    return tone * _env(len(t), 0.004, decay)


# --- text to speech --------------------------------------------------------

class Narrator:
    """Kokoro-82M neural TTS (Apache-2.0) when kokoro-onnx is installed, else macOS `say`."""

    def __init__(self, build_dir, voice=KOKORO_VOICE):
        self.dir = os.path.join(build_dir, "voice")
        os.makedirs(self.dir, exist_ok=True)
        self.build_dir = build_dir
        self.voice = voice
        self.kokoro = None
        self.engine = None

    def _load_kokoro(self):
        try:
            from kokoro_onnx import Kokoro
        except ImportError:
            return None
        vdir = os.path.join(self.build_dir, "voices")
        os.makedirs(vdir, exist_ok=True)
        paths = []
        for name in ("kokoro-v1.0.onnx", "voices-v1.0.bin"):
            path = os.path.join(vdir, name)
            if not os.path.exists(path):
                print(f"Downloading {name}…")
                urllib.request.urlretrieve(f"{KOKORO_URL}/{name}", path + ".part")
                os.replace(path + ".part", path)
            paths.append(path)
        return Kokoro(*paths)

    def line(self, text):
        """Return (wav_path, seconds) for a narration line, cached by engine, voice and text."""
        if self.engine is None:
            try:
                self.kokoro = self._load_kokoro()
            except Exception as e:  # fall back to the OS voice
                print("Kokoro unavailable, using macOS say:", e)
            self.engine = f"kokoro:{self.voice}" if self.kokoro else f"say:{SAY_VOICE}"
            print("Narration voice:", self.engine)
        key = hashlib.sha1(f"{self.engine}|{text}".encode()).hexdigest()[:12]
        out = os.path.join(self.dir, key + ".wav")
        if not os.path.exists(out):
            raw = os.path.join(self.dir, key + ".raw.wav")
            if self.kokoro:
                samples, rate = self.kokoro.create(text, voice=self.voice, speed=KOKORO_SPEED, lang="en-us")
                pcm = (np.clip(samples, -1, 1) * 32767).astype(np.int16)
                with wave.open(raw, "wb") as w:
                    w.setnchannels(1)
                    w.setsampwidth(2)
                    w.setframerate(rate)
                    w.writeframes(pcm.tobytes())
            else:
                raw = raw[:-4] + ".aiff"
                subprocess.run(["say", "-v", SAY_VOICE, "-r", "182", "-o", raw, text], check=True)
            _to_wav48(raw, out)
            os.remove(raw)
        return out, len(_read_wav(out)) / SR


# --- sound effects ---------------------------------------------------------

def _click():
    n = int(SR * 0.03)
    rng = np.random.default_rng(1)
    noise = rng.standard_normal(n) * _env(n, 0.0005, 0.0025)
    noise = noise - _lowpass(noise, 2500)  # keep it crisp
    body = np.sin(2 * np.pi * 1800 * _t(0.03)) * _env(n, 0.0008, 0.006)
    return (0.55 * noise + 0.35 * body) * 0.5


def _soft_click():
    n = int(SR * 0.04)
    return np.sin(2 * np.pi * 420 * _t(0.04)) * _env(n, 0.001, 0.01) * 0.5


def _pop():
    t = _t(0.12)
    f = 900 * np.exp(-t * 18) + 300
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * _env(len(t), 0.002, 0.04) * 0.5


def _whoosh():
    seconds = 0.7
    n = int(SR * seconds)
    rng = np.random.default_rng(2)
    noise = rng.standard_normal(n)
    t = np.arange(n) / n
    swell = np.sin(np.pi * t) ** 2
    # crude sweep: blend two lowpassed copies as the gesture moves
    low, high = _lowpass(noise, 700), _lowpass(noise, 3500)
    mix = low * (1 - t) + high * t
    return mix * swell * 0.55


def _tick():
    return _bell(880, 0.25, 0.07) * 0.32


def _go():
    a = _bell(660, 0.5, 0.18)
    b = np.concatenate([np.zeros(int(SR * 0.09)), _bell(990, 0.6, 0.25)])
    out = np.zeros(len(b))
    out[:len(a)] += a
    out += b
    return out * 0.3


def _shutter():
    rng = np.random.default_rng(3)
    def snap(d):
        n = int(SR * 0.05)
        x = rng.standard_normal(n) * _env(n, 0.0005, d)
        return x - _lowpass(x, 1200)
    out = np.zeros(int(SR * 0.2))
    a, b = snap(0.008), snap(0.014)
    out[:len(a)] += a
    out[int(SR * 0.075):int(SR * 0.075) + len(b)] += b * 0.8
    return out * 0.45


def _success():
    out = np.zeros(int(SR * 1.3))
    for i, f in enumerate((523.25, 659.25, 783.99, 1046.5)):
        s = _bell(f, 1.0, 0.35)
        o = int(SR * 0.085 * i)
        out[o:o + len(s)] += s
    return out * 0.18


SFX = {"click": _click, "soft": _soft_click, "pop": _pop, "whoosh": _whoosh, "tick": _tick,
       "go": _go, "shutter": _shutter, "success": _success}


# --- music bed -------------------------------------------------------------

def _music(seconds):
    """Warm pad + sparse bell arpeggio, Cmaj7 - Am7 - Fmaj7 - G6, 72 bpm."""
    n = int(SR * seconds)
    out = np.zeros(n)
    chords = [(48, 52, 55, 59), (45, 48, 52, 55), (41, 45, 48, 52), (43, 47, 50, 52)]
    bar = 60 / 72 * 4
    hz = lambda m: 440 * 2 ** ((m - 69) / 12)
    t_bar = _t(bar + 1.5)
    k = 0
    start = 0.0
    while start < seconds:
        chord = chords[k % 4]
        pad = np.zeros(len(t_bar))
        for m in chord:
            for det in (-0.12, 0.0, 0.11):
                f = hz(m + 12) * 2 ** (det / 12)
                pad += np.sin(2 * np.pi * f * t_bar + det * 7)
        env = np.minimum(1, t_bar / 1.2) * np.clip((bar + 1.5 - t_bar) / 1.5, 0, 1)
        pad *= env / 12
        # arpeggio: 8th notes, every other bar busier
        step = 60 / 72 / 2
        notes = [chord[i % 4] + 24 for i in (0, 2, 1, 3, 2, 1, 3, 2)]
        for i, m in enumerate(notes):
            if k % 2 == 0 and i % 2:
                continue
            s = _bell(hz(m), 1.2, 0.35) * 0.05
            o = int(SR * step * i)
            pad[o:o + len(s)] += s[:max(0, len(pad) - o)]
        bass = np.sin(2 * np.pi * hz(chord[0] - 12) * t_bar) * env * 0.09
        pad += bass
        o = int(SR * start)
        seg = pad[:max(0, n - o)]
        out[o:o + len(seg)] += seg
        start += bar
        k += 1
    out = _lowpass_fast(out, 3200)
    fade = int(SR * 2)
    out[:fade] *= np.linspace(0, 1, fade)
    out[-fade:] *= np.linspace(1, 0, fade)
    return out / (np.abs(out).max() + 1e-9)


def _lowpass_fast(x, cutoff):
    # FFT brick-ish lowpass with a soft knee; fine for a background bed
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / (1 + (f / cutoff) ** 4)
    return np.fft.irfft(X, len(x))


# --- mix -------------------------------------------------------------------

def mix(duration, events, voice_files, out_wav, voice=True, sfx=True, music=True):
    """events: [{"t": seconds, "kind": "voice"|"sfx", "name": key}]"""
    n = int(SR * (duration + 0.5))
    vo = np.zeros(n)
    fx = np.zeros(n)
    cache = {}

    def place(buf, clip, t, gain=1.0):
        o = int(SR * t)
        if o >= n:
            return
        seg = clip[:n - o]
        buf[o:o + len(seg)] += seg * gain

    for e in events:
        if e["kind"] == "voice" and voice and e["name"] in voice_files:
            clip = _read_wav(voice_files[e["name"]])
            place(vo, clip / (np.abs(clip).max() + 1e-9) * 0.8, e["t"])
        elif e["kind"] == "sfx" and sfx:
            if e["name"] not in cache:
                cache[e["name"]] = SFX[e["name"]]()
            place(fx, cache[e["name"]], e["t"], e.get("gain", 1.0) * SFX_GAIN)

    left = right = vo.copy()
    left, right = left + fx, right + fx
    if music:
        bed = _music(duration + 0.5)[:n] * MUSIC_GAIN
        # duck under narration
        speaking = _smooth((np.abs(vo) > 0.02).astype(np.float64), 0.25) > 0.01
        duck = 1 - 0.55 * speaking.astype(np.float64)
        duck = _smooth(duck, 0.25)
        bed *= duck
        # tiny stereo width: delay right channel ~11ms
        d = int(SR * 0.011)
        left = left + bed
        right = right + np.concatenate([np.zeros(d), bed[:-d]])
    stereo = np.stack([left, right], axis=1)
    peak = np.abs(stereo).max()
    if peak > 0.95:
        stereo *= 0.95 / peak
    write_wav(out_wav, stereo)
    return out_wav


def _smooth(x, seconds):
    """Centered moving average via cumulative sums (fast on long buffers)."""
    k = max(1, int(SR * seconds))
    c = np.concatenate([[0.0], np.cumsum(x)])
    lo = np.clip(np.arange(len(x)) - k // 2, 0, len(x))
    hi = np.clip(np.arange(len(x)) + k // 2 + 1, 0, len(x))
    return (c[hi] - c[lo]) / (hi - lo)
