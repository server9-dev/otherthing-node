/**
 * useTranscription — records audio from peer MediaStreams,
 * sends 15s chunks to backend for transcription
 */

import { useState, useRef, useCallback, useEffect } from 'react';

const API_BASE = 'http://localhost:8080/api/v1';
const CHUNK_INTERVAL_MS = 15_000;

export interface TranscriptionSegment {
  speaker: string;
  peerId: string;
  text: string;
  startTime: string;
  endTime: string;
}

interface UseTranscriptionOptions {
  workspaceId: string;
  localStream: MediaStream | null;
  localPeerId: string;
  localDisplayName: string;
  participants: Array<{ peerId: string; displayName: string; stream?: MediaStream | null }>;
}

export function useTranscription({
  workspaceId,
  localStream,
  localPeerId,
  localDisplayName,
  participants,
}: UseTranscriptionOptions) {
  const [transcribing, setTranscribing] = useState(false);
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const recordersRef = useRef<Map<string, MediaRecorder>>(new Map());
  const intervalsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const sendChunk = useCallback(async (audioBlob: Blob, speaker: string, peerId: string) => {
    try {
      const buffer = await audioBlob.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));

      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/transcription/chunk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local-token' },
        body: JSON.stringify({ audio: base64, speaker, peerId }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.segment) {
          setSegments(prev => [...prev, data.segment]);
        }
      }
    } catch {
      // Silently fail on chunk send errors
    }
  }, [workspaceId]);

  const startRecording = useCallback((stream: MediaStream, peerId: string, displayName: string) => {
    try {
      // Try multiple formats — not all are supported in every Electron build
      const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', ''];
      let mimeType = '';
      for (const mt of mimeTypes) {
        if (!mt || MediaRecorder.isTypeSupported(mt)) {
          mimeType = mt;
          break;
        }
      }

      const options: MediaRecorderOptions = mimeType ? { mimeType } : {};
      const recorder = new MediaRecorder(stream, options);
      let chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        if (chunks.length > 0) {
          const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
          sendChunk(blob, displayName, peerId);
          chunks = [];
        }
      };

      recorder.start();
      recordersRef.current.set(peerId, recorder);

      const interval = setInterval(() => {
        try {
          if (recorder.state === 'recording') {
            recorder.stop();
            recorder.start();
          }
        } catch {}
      }, CHUNK_INTERVAL_MS);

      intervalsRef.current.set(peerId, interval);
    } catch (err) {
      console.warn('[useTranscription] MediaRecorder not supported for', peerId, '— transcription disabled');
    }
  }, [sendChunk]);

  const stopAllRecorders = useCallback(() => {
    for (const [peerId, recorder] of recordersRef.current) {
      if (recorder.state === 'recording') {
        recorder.stop();
      }
    }
    recordersRef.current.clear();

    for (const interval of intervalsRef.current.values()) {
      clearInterval(interval);
    }
    intervalsRef.current.clear();
  }, []);

  const start = useCallback(() => {
    setTranscribing(true);
    setSegments([]);

    // Record local stream
    if (localStream) {
      startRecording(localStream, localPeerId, localDisplayName);
    }

    // Record each participant's stream
    for (const p of participants) {
      if (p.stream) {
        startRecording(p.stream, p.peerId, p.displayName);
      }
    }
  }, [localStream, localPeerId, localDisplayName, participants, startRecording]);

  const stop = useCallback(async () => {
    stopAllRecorders();
    setTranscribing(false);

    // Finalize session on backend
    try {
      await fetch(`${API_BASE}/workspaces/${workspaceId}/transcription/finalize`, {
        method: 'POST',
        headers: { Authorization: 'Bearer local-token' },
      });
    } catch {}
  }, [workspaceId, stopAllRecorders]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopAllRecorders();
    };
  }, [stopAllRecorders]);

  // Record new participants that join while transcribing
  useEffect(() => {
    if (!transcribing) return;
    for (const p of participants) {
      if (p.stream && !recordersRef.current.has(p.peerId)) {
        startRecording(p.stream, p.peerId, p.displayName);
      }
    }
  }, [participants, transcribing, startRecording]);

  return { transcribing, segments, start, stop };
}
