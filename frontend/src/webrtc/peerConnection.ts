import { rtcConfig } from "./config.js";

export type CallMediaType = "voice" | "video";

export class CallPeerConnection {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteDescriptionSet = false;
  private readonly pendingCandidates: RTCIceCandidateInit[] = [];
  private readonly callType: CallMediaType;
  private readonly onIceCandidate: (candidate: RTCIceCandidateInit) => void;
  private readonly onRemoteStream: (stream: MediaStream) => void;
  private readonly onConnectionStateChange: (state: RTCPeerConnectionState) => void;

  constructor(
    callType: CallMediaType,
    onIceCandidate: (candidate: RTCIceCandidateInit) => void,
    onRemoteStream: (stream: MediaStream) => void,
    onConnectionStateChange: (state: RTCPeerConnectionState) => void,
  ) {
    this.callType = callType;
    this.onIceCandidate = onIceCandidate;
    this.onRemoteStream = onRemoteStream;
    this.onConnectionStateChange = onConnectionStateChange;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  async startLocalMedia(): Promise<MediaStream> {
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: this.callType === "video",
    });
    return this.localStream;
  }

  async createPeerConnection(): Promise<RTCPeerConnection> {
    this.pc = new RTCPeerConnection(rtcConfig);

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.onIceCandidate(event.candidate.toJSON());
      }
    };

    this.pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        this.onRemoteStream(stream);
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc) {
        this.onConnectionStateChange(this.pc.connectionState);
      }
    };

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        this.pc.addTrack(track, this.localStream);
      }
    }

    return this.pc;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) {
      await this.createPeerConnection();
    }
    const offer = await this.pc!.createOffer();
    await this.pc!.setLocalDescription(offer);
    return offer;
  }

  async handleRemoteOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) {
      await this.createPeerConnection();
    }
    await this.pc!.setRemoteDescription(offer);
    this.remoteDescriptionSet = true;
    await this.flushPendingCandidates();
    const answer = await this.pc!.createAnswer();
    await this.pc!.setLocalDescription(answer);
    return answer;
  }

  async handleRemoteAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) return;
    await this.pc.setRemoteDescription(answer);
    this.remoteDescriptionSet = true;
    await this.flushPendingCandidates();
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc || !this.remoteDescriptionSet) {
      this.pendingCandidates.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (err) {
      console.warn("[WebRTC] addIceCandidate failed:", err);
    }
  }

  private async flushPendingCandidates(): Promise<void> {
    if (!this.pc) return;
    const queued = this.pendingCandidates.splice(0);
    for (const candidate of queued) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch (err) {
        console.warn("[WebRTC] flush addIceCandidate failed:", err);
      }
    }
  }

  async restartIce(): Promise<RTCSessionDescriptionInit | null> {
    if (!this.pc) return null;
    const offer = await this.pc.createOffer({ iceRestart: true });
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  getConnectionState(): RTCPeerConnectionState | null {
    return this.pc?.connectionState ?? null;
  }

  setMuted(muted: boolean): void {
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }

  setVideoEnabled(enabled: boolean): void {
    this.localStream?.getVideoTracks().forEach((t) => {
      t.enabled = enabled;
    });
  }

  close(): void {
    this.pc?.close();
    this.pc = null;
    this.remoteDescriptionSet = false;
    this.pendingCandidates.length = 0;
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
  }
}
