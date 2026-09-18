/**
 * Workspace voice/video over LiveKit (livekit.otherthing.ai).
 *
 * One room per workspace. The `livekit-token` edge function only issues a
 * token to members of the workspace, so joining the room is the access check.
 * Media goes through the LiveKit server (SFU), which scales past the handful
 * of peers a browser mesh can handle.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Room, RoomEvent, Track, ConnectionState,
  type RemoteParticipant, type Participant as LkParticipant,
} from 'livekit-client';
import { getSupabase } from '../lib/supabase';

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

/** Media tracks a participant currently has (subscribed, for remote ones). */
function streamOf(p: LkParticipant): MediaStream | undefined {
  const tracks = Array.from(p.trackPublications.values())
    .map(pub => pub.track?.mediaStreamTrack)
    .filter((t): t is MediaStreamTrack => !!t && t.readyState === 'live');
  return tracks.length ? new MediaStream(tracks) : undefined;
}

function toParticipant(p: RemoteParticipant): Participant {
  return {
    peerId: p.identity,
    displayName: p.name || p.identity.slice(0, 8),
    stream: streamOf(p),
    audioEnabled: p.isMicrophoneEnabled,
    videoEnabled: p.isCameraEnabled,
  };
}

async function fetchToken(workspaceId: string): Promise<{ url: string; token: string }> {
  const sb = await getSupabase();
  const { data, error } = await sb.functions.invoke('livekit-token', { body: { workspaceId } });
  if (error) {
    let message = error.message;
    try { message = (await (error as any).context.json()).error || message; } catch {}
    throw new Error(message);
  }
  return data;
}

// displayName is kept for API compatibility; LiveKit uses the account's name
// from the token, so every client sees the same name.
export function useVoiceVideo({ workspaceId }: UseVoiceVideoOptions) {
  const [inCall, setInCall] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roomRef = useRef<Room | null>(null);

  const refresh = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    setParticipants(Array.from(room.remoteParticipants.values()).map(toParticipant));
    setLocalStream(streamOf(room.localParticipant) ?? null);
    setAudioEnabled(room.localParticipant.isMicrophoneEnabled);
    setVideoEnabled(room.localParticipant.isCameraEnabled);
  }, []);

  const leaveCall = useCallback(() => {
    const room = roomRef.current;
    roomRef.current = null;
    room?.disconnect();
    setInCall(false);
    setParticipants([]);
    setLocalStream(null);
    setVideoEnabled(false);
  }, []);

  const joinCall = useCallback(async (withVideo = false) => {
    if (roomRef.current) return;
    setError(null);
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    room
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.TrackSubscribed, refresh)
      .on(RoomEvent.TrackUnsubscribed, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        if (state === ConnectionState.Disconnected && roomRef.current === room) leaveCall();
      });
    try {
      const { url, token } = await fetchToken(workspaceId);
      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);
      if (withVideo) await room.localParticipant.setCameraEnabled(true);
      setInCall(true);
      refresh();
    } catch (err) {
      console.error('[Voice] Could not join call:', err);
      setError((err as Error).message);
      leaveCall();
      throw err;
    }
  }, [workspaceId, refresh, leaveCall]);

  const toggleAudio = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled);
    refresh();
  }, [refresh]);

  const toggleVideo = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled);
    refresh();
  }, [refresh]);

  // Leave when switching workspaces or unmounting
  useEffect(() => leaveCall, [workspaceId, leaveCall]);

  return {
    inCall,
    participants,
    localStream,
    audioEnabled,
    videoEnabled,
    error,
    joinCall,
    leaveCall,
    toggleAudio,
    toggleVideo,
  };
}
