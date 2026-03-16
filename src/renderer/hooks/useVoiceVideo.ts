import { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL = 'ws://localhost:8080/ws/agents';
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

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

  const wsRef = useRef<WebSocket | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerIdRef = useRef<string>(`peer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const inCallRef = useRef(false);

  // Keep refs in sync
  useEffect(() => { inCallRef.current = inCall; }, [inCall]);

  const createPeerConnection = useCallback((remotePeerId: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // Add local tracks
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        pc.addTrack(track, localStreamRef.current);
      }
    }

    // Handle incoming tracks
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

    // Send ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'ice-candidate',
          workspaceId,
          peerId: peerIdRef.current,
          targetPeerId: remotePeerId,
          candidate: event.candidate.toJSON(),
        }));
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
  }, [workspaceId]);

  const handleSignalingMessage = useCallback(async (msg: any) => {
    if (!inCallRef.current) return;

    if (msg.type === 'call-peers') {
      // Got list of existing peers — initiate connections to each
      for (const peer of msg.peers) {
        setParticipants(prev => {
          const next = new Map(prev);
          next.set(peer.peerId, { peerId: peer.peerId, displayName: peer.displayName });
          return next;
        });
        const pc = createPeerConnection(peer.peerId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        wsRef.current?.send(JSON.stringify({
          type: 'sdp-offer',
          workspaceId,
          peerId: peerIdRef.current,
          targetPeerId: peer.peerId,
          sdp: offer,
        }));
      }
    }

    if (msg.type === 'call-peer-joined') {
      setParticipants(prev => {
        const next = new Map(prev);
        next.set(msg.peerId, { peerId: msg.peerId, displayName: msg.displayName });
        return next;
      });
      // Wait for their offer — they'll initiate since they joined after us
    }

    if (msg.type === 'call-peer-left') {
      const pc = peersRef.current.get(msg.peerId);
      if (pc) { pc.close(); peersRef.current.delete(msg.peerId); }
      setParticipants(prev => {
        const next = new Map(prev);
        next.delete(msg.peerId);
        return next;
      });
    }

    if (msg.type === 'sdp-offer' && msg.fromPeerId) {
      let pc = peersRef.current.get(msg.fromPeerId);
      if (!pc) pc = createPeerConnection(msg.fromPeerId);
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      wsRef.current?.send(JSON.stringify({
        type: 'sdp-answer',
        workspaceId,
        peerId: peerIdRef.current,
        targetPeerId: msg.fromPeerId,
        sdp: answer,
      }));
    }

    if (msg.type === 'sdp-answer' && msg.fromPeerId) {
      const pc = peersRef.current.get(msg.fromPeerId);
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    }

    if (msg.type === 'ice-candidate' && msg.fromPeerId) {
      const pc = peersRef.current.get(msg.fromPeerId);
      if (pc && msg.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
      }
    }
  }, [workspaceId, createPeerConnection]);

  // Set up WebSocket for signaling
  useEffect(() => {
    if (!inCall) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'call-join',
        workspaceId,
        peerId: peerIdRef.current,
        displayName,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleSignalingMessage(msg);
      } catch {}
    };

    ws.onclose = () => {
      // If still in call, the connection dropped
      if (inCallRef.current) {
        console.warn('[VoiceVideo] WebSocket disconnected');
      }
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'call-leave',
          workspaceId,
          peerId: peerIdRef.current,
        }));
      }
      ws.close();
      wsRef.current = null;
    };
  }, [inCall, workspaceId, displayName, handleSignalingMessage]);

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
      setInCall(true);
    } catch (err) {
      console.error('[VoiceVideo] Failed to get media:', err);
    }
  }, []);

  const leaveCall = useCallback(() => {
    // Close all peer connections
    for (const pc of Array.from(peersRef.current.values())) {
      pc.close();
    }
    peersRef.current.clear();

    // Stop local media
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop();
      }
      localStreamRef.current = null;
    }

    setLocalStream(null);
    setParticipants(new Map());
    setInCall(false);
  }, []);

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
      // Turn off video
      currentVideoTrack.stop();
      localStreamRef.current.removeTrack(currentVideoTrack);
      // Replace track in all peer connections
      for (const pc of Array.from(peersRef.current.values())) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(null);
      }
      setVideoEnabled(false);
    } else {
      // Turn on video
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const videoTrack = videoStream.getVideoTracks()[0];
        localStreamRef.current.addTrack(videoTrack);
        // Add/replace track in all peer connections
        for (const pc of Array.from(peersRef.current.values())) {
          const sender = pc.getSenders().find(s => s.track === null || s.track?.kind === 'video');
          if (sender) {
            sender.replaceTrack(videoTrack);
          } else {
            pc.addTrack(videoTrack, localStreamRef.current!);
          }
        }
        setVideoEnabled(true);
      } catch (err) {
        console.error('[VoiceVideo] Failed to enable video:', err);
      }
    }
    // Update the stream reference for re-render
    setLocalStream(localStreamRef.current);
  }, []);

  // Cleanup on unmount
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
