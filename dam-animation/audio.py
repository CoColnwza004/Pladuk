"""Procedural nature soundtrack for the Pladuk dam animation (50 s, 48 kHz stereo).

Layers are timed to the camera path in main.js:
  0-8.6s   photo of the model: soft wind, faint birds, warm pad, rising swell
  8.6s     model becomes "real": soft impact, nature blooms in
  9-22s    river + birds + cicadas, spillway roar grows as we approach the dam
  22-28s   close to the spillway: full roar + mist hiss
  28-42s   over the reservoir: lapping water, morning-glory spillway gurgle, birds
  40-50s   turbines whoosh, wind at altitude, pad swells under the title, fade out
"""
import numpy as np
from scipy import signal
import wave, sys

SR = 48000
DUR = 50.0
N = int(SR * DUR)
rng = np.random.default_rng(1118)
T = np.arange(N) / SR


def env(keys):
    k = np.array(keys, dtype=float)
    return np.interp(T, k[:, 0], k[:, 1])


def white(n=N):
    return rng.standard_normal(n)


def colored(n, power):
    """1/f^power noise (power=1 pink, 2 brown), normalized."""
    X = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1]
    X /= f ** (power / 2)
    x = np.fft.irfft(X, n)
    return x / (np.std(x) + 1e-12)


def bp(x, lo, hi, order=4):
    sos = signal.butter(order, [lo, hi], btype='band', fs=SR, output='sos')
    return signal.sosfilt(sos, x)


def lp(x, fc, order=4):
    return signal.sosfilt(signal.butter(order, fc, btype='low', fs=SR, output='sos'), x)


def hp(x, fc, order=4):
    return signal.sosfilt(signal.butter(order, fc, btype='high', fs=SR, output='sos'), x)


def smooth_noise(rate, n=N, seed_scale=1.0):
    """slow random modulation in [0,1] (interpolated random points at `rate` Hz)."""
    pts = int(DUR * rate) + 3
    v = rng.random(pts)
    return np.interp(T * rate, np.arange(pts), v)


def pan(x, p):
    """equal-power pan, p in [-1,1] (scalar or array)."""
    a = (np.asarray(p) + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)])


L = np.zeros((2, N))


def add(st, gain=1.0):
    global L
    L += st * gain

# ------------------------------------------------------------------ wind
wind_env = env([[0, 0.16], [6, 0.2], [9, 0.22], [20, 0.12], [30, 0.18], [40, 0.32], [43, 0.5], [47, 0.62], [50, 0.45]])
for ch, sd in ((0, 0.0), (1, 0.37)):
    w = colored(N, 2.0)
    gust = 0.55 + 0.45 * smooth_noise(0.35)
    w = lp(hp(w, 60), 650) * gust
    L[ch] += w * wind_env * 0.10
# airy high wind layer
for ch in (0, 1):
    a = bp(white(), 1500, 5000) * (0.4 + 0.6 * smooth_noise(0.5))
    L[ch] += a * wind_env * 0.012

# ------------------------------------------------------------------ river flow (downstream)
river_env = env([[0, 0], [7.5, 0], [9.5, 0.30], [12, 0.48], [16, 0.55], [19, 0.42], [22, 0.22], [27, 0.1], [31, 0.04], [42, 0.03], [47, 0.08], [50, 0.06]])
for ch in (0, 1):
    base = bp(colored(N, 1.0), 180, 1600) * (0.6 + 0.4 * smooth_noise(1.3))
    L[ch] += base * river_env * 0.16
# gurgles: short resonant blips
grg = np.zeros((2, N))
for _ in range(1600):
    t0 = rng.uniform(0, DUR - 0.1)
    d = rng.uniform(0.02, 0.08)
    n = int(d * SR)
    f = rng.uniform(250, 900) * np.exp(np.linspace(0, rng.uniform(0.2, 0.8), n))
    blip = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.hanning(n) * rng.uniform(0.2, 1.0)
    i = int(t0 * SR)
    p = rng.uniform(-0.8, 0.8)
    grg[:, i:i + n] += pan(blip, p)
L += grg * (river_env * 0.07)

# ------------------------------------------------------------------ spillway roar
roar_env = env([[0, 0], [8, 0], [10, 0.07], [14, 0.18], [18, 0.42], [21, 0.78], [23, 1.0], [26, 0.95], [28.5, 0.55], [31, 0.24], [34, 0.13], [40, 0.07], [44, 0.05], [50, 0.03]])
for ch in (0, 1):
    body = lp(colored(N, 1.0), 2600) * (0.8 + 0.2 * smooth_noise(2.0))
    rumble = lp(colored(N, 2.0), 140) * 1.6
    hiss = bp(white(), 3500, 9000) * (0.5 + 0.5 * smooth_noise(6.0)) * 0.35
    L[ch] += (body * 0.22 + rumble * 0.20 + hiss * 0.10) * roar_env
# splash bursts near the chutes
spl = np.zeros((2, N))
for _ in range(900):
    t0 = rng.uniform(15, 31)
    n = int(rng.uniform(0.03, 0.18) * SR)
    s = bp(white(n), 900, 6000) * np.exp(-np.linspace(0, 6, n))
    i = int(t0 * SR)
    spl[:, i:i + n] += pan(s, rng.uniform(-0.9, 0.9)) * rng.uniform(0.2, 1.0)
L += spl * roar_env * 0.05

# ------------------------------------------------------------------ reservoir lapping + morning-glory gurgle
lap_env = env([[0, 0], [27, 0], [30, 0.35], [33, 0.45], [38, 0.42], [42, 0.25], [46, 0.1], [50, 0.06]])
lap = np.zeros((2, N))
for _ in range(500):
    t0 = rng.uniform(26, 50)
    n = int(rng.uniform(0.15, 0.45) * SR)
    s = lp(white(n), rng.uniform(500, 1400)) * np.hanning(n) ** 1.5
    i = int(t0 * SR)
    if i + n < N:
        lap[:, i:i + n] += pan(s, rng.uniform(-0.9, 0.9)) * rng.uniform(0.3, 1.0)
L += lap * lap_env * 0.22
glory_env = env([[0, 0], [31, 0], [33, 0.5], [35, 0.62], [37.5, 0.3], [40, 0]])
for ch in (0, 1):
    g = bp(colored(N, 1.5), 120, 900)
    swirl = 0.6 + 0.4 * np.sin(2 * np.pi * 0.7 * T + ch * 1.3)
    L[ch] += g * swirl * glory_env * 0.16

# ------------------------------------------------------------------ birds
birds = np.zeros((2, N))
birds_far = np.zeros((2, N))


def tone(freqs, amp_env, harm=0.15):
    ph = 2 * np.pi * np.cumsum(freqs) / SR
    return (np.sin(ph) + harm * np.sin(2 * ph)) * amp_env


def note(f0, f1, dur, vib=0.0, vibf=0.0, curve=1.0):
    n = max(8, int(dur * SR))
    u = np.linspace(0, 1, n)
    f = f0 + (f1 - f0) * u ** curve
    if vib:
        f = f * (1 + vib * np.sin(2 * np.pi * vibf * u * dur))
    a = np.sin(np.pi * u) ** 0.8
    return tone(f, a)


def concat(parts):
    return np.concatenate(parts)


def gap(d):
    return np.zeros(int(d * SR))


def sp_sparrow():
    out = []
    for _ in range(rng.integers(3, 7)):
        f0 = rng.uniform(4200, 6200)
        out += [note(f0, f0 * rng.uniform(0.6, 0.8), rng.uniform(0.05, 0.09)), gap(rng.uniform(0.04, 0.09))]
    return concat(out)


def sp_bulbul():
    out = []
    base = rng.uniform(1500, 2000)
    for _ in range(rng.integers(4, 7)):
        f0 = base * rng.uniform(0.85, 1.5)
        f1 = f0 * rng.uniform(0.75, 1.35)
        out += [note(f0, f1, rng.uniform(0.09, 0.2), vib=0.02, vibf=30), gap(rng.uniform(0.02, 0.07))]
    return concat(out)


def sp_magpie_robin():
    out = []
    for _ in range(rng.integers(6, 11)):
        r = rng.random()
        if r < 0.25:   # trill
            f = rng.uniform(2800, 3800)
            for _ in range(rng.integers(4, 9)):
                out += [note(f, f * 0.9, 0.025), gap(0.018)]
        else:
            f0 = rng.uniform(1800, 3600)
            out += [note(f0, f0 * rng.uniform(0.8, 1.3), rng.uniform(0.08, 0.26), vib=0.01, vibf=12)]
        out.append(gap(rng.uniform(0.03, 0.12)))
    return concat(out)


def sp_koel():
    out = []
    k = rng.uniform(0.95, 1.05)
    for i in range(rng.integers(3, 6)):
        s = 1 + 0.06 * i
        out += [note(650 * k * s, 760 * k * s, 0.22), gap(0.06), note(820 * k * s, 1150 * k * s, 0.42, curve=0.6), gap(0.55)]
    return concat(out)


def sp_dove():
    out = []
    for _ in range(rng.integers(2, 4)):
        out += [note(520, 480, 0.35), gap(0.12), note(560, 500, 0.22), gap(0.1), note(500, 440, 0.5), gap(0.9)]
    return concat(out)


bird_density = env([[0, 0.25], [6, 0.35], [8.6, 1.0], [14, 1.0], [20, 0.7], [24, 0.4], [28, 0.7], [36, 0.9], [42, 1.0], [48, 0.8], [50, 0.5]])
species = [(sp_sparrow, 0.30), (sp_bulbul, 0.25), (sp_magpie_robin, 0.22), (sp_koel, 0.07), (sp_dove, 0.06)]
names = [s for s, _ in species]
wts = np.array([w for _, w in species]); wts /= wts.sum()
t = 0.2
while t < DUR - 1:
    d = bird_density[int(t * SR)]
    t += rng.exponential(0.75 / max(d, 0.05))
    if t > DUR - 1.5:
        break
    if rng.random() > d:
        continue
    fn = names[rng.choice(len(names), p=wts)]
    ph = fn()
    i = int(t * SR)
    n = min(len(ph), N - i)
    far = rng.random() < (0.55 if fn in (sp_koel, sp_dove) else 0.35)
    p = rng.uniform(-0.95, 0.95)
    g = rng.uniform(0.35, 1.0) * (0.5 if far else 1.0)
    (birds_far if far else birds)[:, i:i + n] += pan(ph[:n], p) * g
birds_far = np.stack([lp(birds_far[0], 3500), lp(birds_far[1], 3500)])

# ------------------------------------------------------------------ cicadas / insects
cic_env = env([[0, 0.05], [8, 0.05], [11, 0.30], [18, 0.34], [20, 0.12], [30, 0.04], [36, 0.06], [40, 0.25], [46, 0.32], [50, 0.2]])
for ch, f0 in ((0, 4700), (1, 5300)):
    c = bp(white(), f0 - 600, f0 + 600)
    pulse = 0.5 + 0.5 * np.sign(np.sin(2 * np.pi * (58 + ch * 7) * T))
    swell = 0.4 + 0.6 * smooth_noise(0.15) ** 2
    L[ch] += c * (0.35 + 0.65 * pulse) * swell * cic_env * 0.035
# crickets (high, intermittent)
for ch in (0, 1):
    cr = np.sin(2 * np.pi * (6800 + 150 * ch) * T) * (np.sin(2 * np.pi * 28 * T) > 0.3) * (np.sin(2 * np.pi * 0.9 * T + ch) > 0.2)
    L[ch] += cr * cic_env * 0.004

# ------------------------------------------------------------------ wind turbines
turb_env = env([[0, 0], [39, 0], [41.5, 0.5], [44, 0.62], [46.5, 0.2], [49, 0]])
blade = 0.5 + 0.5 * np.sin(2 * np.pi * 0.55 * T) ** 2
for ch in (0, 1):
    w = bp(colored(N, 1.0), 300, 1400)
    L[ch] += w * blade * turb_env * 0.07 * (1.0 if ch else 0.8)

# ------------------------------------------------------------------ cinematic pad + swell + impact
pad_env = env([[0, 0], [1.5, 0.30], [6, 0.40], [8.6, 0.55], [10.5, 0.22], [30, 0.18], [42, 0.26], [45, 0.62], [48.3, 0.55], [50, 0]])
pad = np.zeros((2, N))
chord = [73.42, 110.0, 146.83, 185.0, 220.0, 329.63]   # D2 A2 D3 F#3 A3 E4 (Dadd9)
for k, f in enumerate(chord):
    for ch in (0, 1):
        det = 1 + (0.0025 if ch else -0.0025) * (k % 3 - 1)
        ph = 2 * np.pi * f * det * T + rng.uniform(0, 6.28)
        v = np.sin(ph) + 0.3 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)
        trem = 0.85 + 0.15 * np.sin(2 * np.pi * (0.11 + 0.03 * k) * T + k)
        pad[ch] += v * trem / len(chord)
pad = np.stack([lp(pad[0], 1400), lp(pad[1], 1400)]) * pad_env * 0.30
# shimmer (high octave sparkle under title)
sh_env = env([[0, 0], [43.5, 0], [46, 0.5], [48.5, 0.4], [50, 0]])
for f in (587.33, 880.0, 1174.66):
    for ch in (0, 1):
        pad[ch] += np.sin(2 * np.pi * f * T * (1.003 if ch else 0.997)) * (0.6 + 0.4 * np.sin(2 * np.pi * 3.1 * T + f)) * sh_env * 0.012

riser_env = env([[0, 0], [4.8, 0], [8.45, 1.0], [8.75, 0]])
prog = np.clip((T - 4.8) / 3.8, 0, 1)
lo_b = bp(colored(N, 1.0), 200, 900)
mid_b = bp(white(), 800, 2500)
hi_b = bp(white(), 2200, 6000)
rs = lo_b * (1 - prog) + mid_b * np.sin(np.pi * prog) * 0.6 + hi_b * prog ** 2 * 0.5
riser = np.stack([rs, np.roll(rs, 211)]) * riser_env ** 2 * 0.07

impact = np.zeros((2, N))
i0 = int(8.6 * SR)
n = int(3.5 * SR)
u = np.arange(n) / SR
boom = np.sin(2 * np.pi * (46 + 30 * np.exp(-u * 8)) * u) * np.exp(-u * 1.6) * 0.16
air = lp(white(n), 900) * np.exp(-u * 2.8) * 0.05
impact[:, i0:i0 + n] += np.stack([boom + air, boom + np.roll(air, 300)])

# ------------------------------------------------------------------ reverb for birds / pad / impact
def reverb_ir(dur=2.6, decay=0.55):
    n = int(dur * SR)
    u = np.arange(n) / SR
    ir = rng.standard_normal((2, n)) * np.exp(-u / decay)
    ir = np.stack([lp(ir[0], 6000), lp(ir[1], 6000)])
    ir[:, :int(0.012 * SR)] = 0
    return ir / np.sqrt((ir ** 2).sum(axis=1, keepdims=True))


IR = reverb_ir()


def wet(st, amt):
    out = np.zeros_like(st)
    for ch in (0, 1):
        out[ch] = signal.fftconvolve(st[ch], IR[ch])[:N]
    return st * (1 - amt) + out * amt * 1.6


L += wet(birds, 0.25) * 0.15
L += wet(birds_far, 0.55) * 0.09
L += wet(pad, 0.45)
L += wet(riser, 0.4)
L += wet(impact, 0.35) * 0.8

# ------------------------------------------------------------------ master
L = hp(L, 30, order=2)
master = env([[0, 0], [0.8, 1], [48.6, 1], [50, 0]])
L *= master
# gentle soft-knee compression
ref = np.percentile(np.abs(L), 99.9)
L = L / ref * 0.55
L = np.tanh(L * 1.3) / 1.3
L *= 10 ** (-1.0 / 20) / np.max(np.abs(L))
out = (L.T * 32767).astype(np.int16)
path = sys.argv[1] if len(sys.argv) > 1 else 'soundtrack.wav'
with wave.open(path, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(out.tobytes())
print('wrote', path, out.shape)
