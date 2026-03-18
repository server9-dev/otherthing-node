import { useState, useEffect, useRef, useCallback } from 'react';

const API_BASE = 'http://localhost:8080/api/v1';
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
const POLL_INTERVAL = 1000; // Poll for signals every 1s

export interface Participant {
  peerId: string;
  displayName: string;
  stream?: MediaStream;
  audioEnabled?: boolean;
  videoEnabled?: boolean;
}

interface UseVoiceVideoOptions {
  workspaceId: string;
  displayName: string;
}

export function useVoiceVideo({ workspaceId, displayName }: UseVoiceVideoOptions) {
  const [inCall, setInCall] = useState(false);
  const [participants, setParticipants] = useState<Map<string, Participant>>(new Map());
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(false);

  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerIdRef = useRef<string>(`peer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const inCallRef = useRef(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const lastPollRef = useRef<string>(new Date().toISOString());
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer local-token' };

  useEffect(() => { inCallRef.current = inCall; }, [inCall]);

  const sendSignal = useCallback(async (targetPeerId: string, type: string, payload: any) => {
    try {
      await fetch(`${API_BASE}/workspaces/${workspaceId}/signal`, {
        method: 'POST', headers,
        body: JSON.stringify({
          fromPeerId: peerIdRef.current,
          targetPeerId,
          type,
          payload: JSON.stringify(payload),
        }),
      });
    } catch {}
  }, [workspaceId]);

  const broadcastSignal = useCallback(async (type: string, payload: any) => {
    try {
      await fetch(`${API_BASE}/workspaces/${workspaceId}/signal/broadcast`, {
        method: 'POST', headers,
        body: JSON.stringify({
          fromPeerId: peerIdRef.current,
          type,
          payload: JSON.stringify(payload),
        }),
      });
    } catch {}
  }, [workspaceId]);

  const createPeerConnection = useCallback((remotePeerId: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        pc.addTrack(track, localStreamRef.current);
      }
    }

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      if (remoteStream) {
        setParticipants(prev => {
          const next = new Map(prev);
          const existing = next.get(remotePeerId);
          if (existing) {
            next.set(remotePeerId, { ...existing, stream: remoteStream });
          }
          return next;
        });
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(remotePeerId, 'ice-candidate', { candidate: event.candidate.toJSON() });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        pc.close();
        peersRef.current.delete(remotePeerId);
      }
    };

    peersRef.current.set(remotePeerId, pc);
    return pc;
  }, [sendSignal]);

  const handleSignal = useCallback(async (signal: { fromPeerId: string; type: string; payload: string }) => {
    if (!inCallRef.current) return;
    const data = JSON.parse(signal.payload);

    if (signal.type === 'call-join') {
      // New peer joined — add them and send an offer
      setParticipants(prev => {
        const next = new Map(prev);
        next.set(signal.fromPeerId, { peerId: signal.fromPeerId, displayName: data.displayName || 'Unknown' });
        return next;
      });
      const pc = createPeerConnection(signal.fromPeerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal(signal.fromPeerId, 'sdp-offer', { sdp: offer, displayName });
    }

    if (signal.type === 'call-leave') {
      const pc = peersRef.current.get(signal.fromPeerId);
      if (pc) { pc.close(); peersRef.current.delete(signal.fromPeerId); }
      setParticipants(prev => {
        const next = new Map(prev);
        next.delete(signal.fromPeerId);
        return next;
      });
    }

    if (signal.type === 'sdp-offer') {
      setParticipants(prev => {
        const next = new Map(prev);
        if (!next.has(signal.fromPeerId)) {
          next.set(signal.fromPeerId, { peerId: signal.fromPeerId, displayName: data.displayName || 'Unknown' });
        }
        return next;
      });
      let pc = peersRef.current.get(signal.fromPeerId);
      if (!pc) pc = createPeerConnection(signal.fromPeerId);
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal(signal.fromPeerId, 'sdp-answer', { sdp: answer });
    }

    if (signal.type === 'sdp-answer') {
      const pc = peersRef.current.get(signal.fromPeerId);
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    }

    if (signal.type === 'ice-candidate') {
      const pc = peersRef.current.get(signal.fromPeerId);
      if (pc && data.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    }
  }, [createPeerConnection, sendSignal, displayName]);

  // Poll for signaling messages
  useEffect(() => {
    if (!inCall) return;

    const poll = async () => {
      try {
        const res = await fetch(
          `${API_BASE}/workspaces/${workspaceId}/signal/poll?peerId=${peerIdRef.current}&since=${encodeURIComponent(lastPollRef.current)}`,
          { headers: { Authorization: 'Bearer local-token' } }
        );
        const data = await res.json();
        if (data.signals?.length > 0) {
          for (const sig of data.signals) {
            await handleSignal(sig);
          }
          lastPollRef.current = data.signals[data.signals.length - 1].timestamp;
        }
      } catch {}
    };

    poll(); // initial poll
    pollRef.current = setInterval(poll, POLL_INTERVAL);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [inCall, workspaceId, handleSignal]);

  const joinCall = useCallback(async (withVideo = false) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: withVideo,
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setVideoEnabled(withVideo);
      setAudioEnabled(true);
      lastPollRef.current = new Date().toISOString();
      setInCall(true);

      // Broadcast join to all workspace peers
      setTimeout(() => {
        broadcastSignal('call-join', { displayName });
      }, 500);
    } catch (err) {
      console.error('[VoiceVideo] Failed to get media:', err);
    }
  }, [broadcastSignal, displayName]);

  const leaveCall = useCallback(() => {
    broadcastSignal('call-leave', {});

    for (const pc of Array.from(peersRef.current.values())) pc.close();
    peersRef.current.clear();

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) track.stop();
      localStreamRef.current = null;
    }

    // Cleanup old signals
    fetch(`${API_BASE}/workspaces/${workspaceId}/signal/cleanup`, {
      method: 'POST', headers: { Authorization: 'Bearer local-token' },
    }).catch(() => {});

    setLocalStream(null);
    setParticipants(new Map());
    setInCall(false);
  }, [broadcastSignal, workspaceId]);

  const toggleAudio = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setAudioEnabled(audioTrack.enabled);
      }
    }
  }, []);

  const toggleVideo = useCallback(async () => {
    if (!localStreamRef.current) return;
    const currentVideoTrack = localStreamRef.current.getVideoTracks()[0];

    if (currentVideoTrack) {
      currentVideoTrack.stop();
      localStreamRef.current.removeTrack(currentVideoTrack);
      for (const pc of Array.from(peersRef.current.values())) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(null);
      }
      setVideoEnabled(false);
    } else {
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const videoTrack = videoStream.getVideoTracks()[0];
        localStreamRef.current.addTrack(videoTrack);
        for (const pc of Array.from(peersRef.current.values())) {
          const sender = pc.getSenders().find(s => s.track === null || s.track?.kind === 'video');
          if (sender) sender.replaceTrack(videoTrack);
          else pc.addTrack(videoTrack, localStreamRef.current!);
        }
        setVideoEnabled(true);
      } catch (err) {
        console.error('[VoiceVideo] Failed to enable video:', err);
      }
    }
    setLocalStream(localStreamRef.current);
  }, []);

  useEffect(() => {
    return () => {
      if (inCallRef.current) {
        for (const pc of Array.from(peersRef.current.values())) pc.close();
        peersRef.current.clear();
        if (localStreamRef.current) {
          for (const track of localStreamRef.current.getTracks()) track.stop();
        }
      }
    };
  }, []);

  return {
    inCall,
    participants: Array.from(participants.values()),
    localStream,
    audioEnabled,
    videoEnabled,
    joinCall,
    leaveCall,
    toggleAudio,
    toggleVideo,
  };
}
