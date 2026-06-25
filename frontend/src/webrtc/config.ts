function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [];

  const stunEnv = import.meta.env.VITE_STUN_SERVERS as string | undefined;
  if (stunEnv) {
    for (const url of stunEnv.split(",").map((s) => s.trim()).filter(Boolean)) {
      servers.push({ urls: url });
    }
  } else {
    servers.push({ urls: "stun:stun.l.google.com:19302" });
  }

  const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined;
  const turnUsername = import.meta.env.VITE_TURN_USERNAME as string | undefined;
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined;
  if (turnUrl && turnUsername && turnCredential) {
    servers.push({ urls: turnUrl, username: turnUsername, credential: turnCredential });
  }

  return servers;
}

export const iceServers: RTCIceServer[] = buildIceServers();

export const rtcConfig: RTCConfiguration = {
  iceServers,
  iceTransportPolicy: "all",
  bundlePolicy: "max-bundle",
};

export const ICE_GATHERING_TIMEOUT_MS = 4_000;
export const ICE_CONNECTION_TIMEOUT_MS = 10_000;
export const CALL_RENEGOTIATION_WINDOW_MS = 20_000;

export const AUDIO_ONLY_FALLBACK_MIN_BITRATE_BPS = 50_000;
export const AUDIO_ONLY_FALLBACK_HOLD_DURATION_MS = 3_000;
