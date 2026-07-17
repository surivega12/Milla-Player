import { useState, useEffect } from 'react';

export const Capability = {
  Play: 'play',
  Pause: 'pause',
  SkipToNext: 'skip-to-next',
  SkipToPrevious: 'skip-to-previous',
  SeekTo: 'seek-to',
};

export const Event = {
  PlaybackActiveTrackChanged: 'playback-track-changed',
  PlaybackProgressUpdated: 'playback-progress-updated',
};

export const State = {
  None: 'none',
  Ready: 'ready',
  Playing: 'playing',
  Paused: 'paused',
  Stopped: 'stopped',
  Buffering: 'buffering',
  Connecting: 'connecting',
  Error: 'error',
};

export const RepeatMode = {
  Off: 0,
  Track: 1,
  Queue: 2,
};

export const AppKilledPlaybackBehavior = {
  ContinuePlayback: 'continue-playback',
  PausePlayback: 'pause-playback',
  StopPlaybackAndRemoveNotification: 'stop-playback-and-remove-notification',
};

// --- GLOBAL STATE FOR WEB AUDIO ---
let audioElement: HTMLAudioElement | null = null;
let activeTrack: any = null;
let playbackState = State.None;
let progress = { position: 0, duration: 0, buffered: 0 };

const listeners = new Set<() => void>();
const emitChange = () => listeners.forEach(l => l());

// --- MOCK HOOKS ---
export const usePlaybackState = () => {
  const [state, setState] = useState({ state: playbackState });
  useEffect(() => {
    const fn = () => setState({ state: playbackState });
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return state;
};

export const useProgress = () => {
  const [prog, setProg] = useState(progress);
  useEffect(() => {
    const fn = () => setProg({ ...progress });
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return prog;
};

export const useActiveTrack = () => {
  const [track, setTrack] = useState(activeTrack);
  useEffect(() => {
    const fn = () => setTrack(activeTrack);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return track;
};

// --- TRACK PLAYER MOCK IMPLEMENTATION ---
const TrackPlayer = {
  setupPlayer: async () => {
    if (typeof window !== 'undefined' && !audioElement) {
      audioElement = new window.Audio();
      audioElement.ontimeupdate = () => {
        progress.position = audioElement!.currentTime;
        progress.duration = audioElement!.duration || 0;
        emitChange();
      };
      audioElement.onplay = () => { playbackState = State.Playing; emitChange(); };
      audioElement.onpause = () => { playbackState = State.Paused; emitChange(); };
      audioElement.onended = () => { playbackState = State.Stopped; emitChange(); };
    }
  },
  registerPlaybackService: () => () => {},
  addEventListener: () => ({ remove: () => {} }),
  add: async (trackOrTracks: any) => {
    const track = Array.isArray(trackOrTracks) ? trackOrTracks[0] : trackOrTracks;
    activeTrack = track;
    if (audioElement && track.url) {
      audioElement.src = track.url;
      audioElement.load();
    }
    emitChange();
  },
  play: async () => { if (audioElement) await audioElement.play(); },
  pause: async () => { if (audioElement) audioElement.pause(); },
  skip: async () => {},
  skipToNext: async () => {},
  skipToPrevious: async () => {},
  seekTo: async (sec: number) => { if (audioElement) audioElement.currentTime = sec; },
  setRepeatMode: async () => {},
  getQueue: async () => [activeTrack].filter(Boolean),
  updateOptions: async () => {},
  updateNowPlayingMetadata: async () => {},
  reset: async () => {
    if (audioElement) {
      audioElement.pause();
      audioElement.src = '';
    }
    activeTrack = null;
    playbackState = State.None;
    emitChange();
  },
};

export default TrackPlayer;
