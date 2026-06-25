// Chuong cuoc goi tong hop bang Web Audio API (khong can file asset).
// Tu nuot loi neu trinh duyet chan autoplay (callee chua tuong tac trang).

type RingVariant = "incoming" | "outgoing";

let audioCtx: AudioContext | null = null;
let ringTimer: ReturnType<typeof setInterval> | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!audioCtx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

function beep(ctx: AudioContext, freq: number, startAt: number, durationSec: number, peak: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + 0.03);
  gain.gain.setValueAtTime(peak, startAt + durationSec - 0.06);
  gain.gain.linearRampToValueAtTime(0, startAt + durationSec);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + durationSec);
}

export function startRingtone(variant: RingVariant = "incoming"): void {
  stopRingtone();
  const ctx = getCtx();
  if (!ctx) return;

  const playOnce = () => {
    const t = ctx.currentTime + 0.02;
    if (variant === "incoming") {
      // Double-ring: hai hoi chuong ngan
      beep(ctx, 480, t, 0.4, 0.18);
      beep(ctx, 480, t + 0.6, 0.4, 0.18);
    } else {
      // Ringback nhe khi minh goi di
      beep(ctx, 420, t, 0.5, 0.08);
    }
  };

  playOnce();
  ringTimer = setInterval(playOnce, variant === "incoming" ? 2400 : 3500);
}

export function stopRingtone(): void {
  if (ringTimer) {
    clearInterval(ringTimer);
    ringTimer = null;
  }
}
