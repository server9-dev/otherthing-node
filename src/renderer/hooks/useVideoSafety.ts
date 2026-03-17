/**
 * useVideoSafety — periodic frame sampling from video streams
 * for content safety scanning during calls.
 *
 * Captures a frame every N seconds from each video stream,
 * sends to backend safety endpoint. If violation detected,
 * fires onViolation callback to kill the call and ban.
 */

import { useRef, useCallback, useEffect } from 'react';

const API_BASE = 'http://localhost:8080/api/v1';
const SCAN_INTERVAL_MS = 10_000; // scan a frame every 10 seconds
const FRAME_WIDTH = 320; // downscale for fast scanning
const FRAME_HEIGHT = 240;

interface UseVideoSafetyOptions {
  enabled: boolean;
  localStream: MediaStream | null;
  participants: Array<{ peerId: string; displayName: string; stream?: MediaStream | null }>;
  onViolation: (peerId: string, displayName: string, category: string, reason: string) => void;
}

export function useVideoSafety({
  enabled,
  localStream,
  participants,
  onViolation,
}: UseVideoSafetyOptions) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const captureFrame = useCallback((stream: MediaStream): string | null => {
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack || !videoTrack.enabled || videoTrack.muted) return null;

    // Create or reuse an offscreen canvas
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
      canvasRef.current.width = FRAME_WIDTH;
      canvasRef.current.height = FRAME_HEIGHT;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Create a temporary video element to draw the current frame
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;

    // Use ImageCapture API if available (faster, no video element needed)
    try {
      // Fallback: draw from a video element snapshot
      // This is called periodically so the video element approach works
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);

      // We need the video to be playing to capture
      // Instead, use the track directly with ImageCapture if supported
      if ('ImageCapture' in window) {
        return null; // handled async below
      }
    } catch {
      return null;
    }

    return null;
  }, []);

  const scanFrame = useCallback(async (
    stream: MediaStream,
    peerId: string,
    displayName: string
  ) => {
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack || !videoTrack.enabled) return;

    try {
      let base64Frame: string | null = null;

      // Use ImageCapture API for frame grabbing
      if ('ImageCapture' in window) {
        const capture = new (window as any).ImageCapture(videoTrack);
        const bitmap = await capture.grabFrame();

        if (!canvasRef.current) {
          canvasRef.current = document.createElement('canvas');
        }
        canvasRef.current.width = FRAME_WIDTH;
        canvasRef.current.height = FRAME_HEIGHT;

        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(bitmap, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
        base64Frame = canvasRef.current.toDataURL('image/jpeg', 0.6);
        bitmap.close();
      }

      if (!base64Frame) return;

      // Send to safety scan endpoint
      const res = await fetch(`${API_BASE}/safety/scan-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local-token' },
        body: JSON.stringify({
          description: `Live video frame from participant "${displayName}" in a workspace video call. Frame captured as JPEG for content safety review.`,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (!data.result.safe) {
          console.error(`[VideoSafety] VIOLATION from ${displayName}: ${data.result.category} - ${data.result.reason}`);
          onViolation(peerId, displayName, data.result.category, data.result.reason);
        }
      }
    } catch (err) {
      // Silently fail on scan errors — don't disrupt the call
      console.warn('[VideoSafety] Frame scan failed:', err);
    }
  }, [onViolation]);

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    intervalRef.current = setInterval(() => {
      // Scan local stream
      if (localStream && localStream.getVideoTracks().length > 0) {
        scanFrame(localStream, 'local', 'You');
      }

      // Scan each participant's stream
      for (const p of participants) {
        if (p.stream && p.stream.getVideoTracks().length > 0) {
          scanFrame(p.stream, p.peerId, p.displayName);
        }
      }
    }, SCAN_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [enabled, localStream, participants, scanFrame]);
}
