import { useSyncExternalStore } from 'react';
import type { AudioPlayer, AudioStatus } from 'expo-audio';

export interface PlayerTrack {
  id: string | number;
  url?: string;
  title?: string;
  artist?: string;
  album?: string;
  artwork?: string;
  duration?: number;
  [key: string]: unknown;
}

export enum State {
  None = 0,
  Ready = 1,
  Playing = 2,
  Paused = 3,
  Stopped = 4,
  Buffering = 6,
  Error = 7,
}

export enum RepeatMode {
  Off = 0,
  Track = 1,
  Queue = 2,
}

export enum Event {
  RemotePlay = 'remote-play',
  RemotePause = 'remote-pause',
  RemoteNext = 'remote-next',
  RemotePrevious = 'remote-previous',
  RemoteSeek = 'remote-seek',
  PlaybackProgressUpdated = 'playback-progress-updated',
  PlaybackQueueEnded = 'playback-queue-ended',
  PlaybackActiveTrackChanged = 'playback-active-track-changed',
}

type PlaybackSnapshot = {
  state: State;
  position: number;
  duration: number;
  buffered: number;
  activeTrack?: PlayerTrack;
};

type Listener = (payload?: any) => void;
type PlayerOptions = {
  progressUpdateEventInterval?: number;
  [key: string]: unknown;
};

let player: AudioPlayer | null = null;
type ExpoAudioModule = typeof import('expo-audio');
let expoAudioModule: ExpoAudioModule | null = null;
let nativeStatusSubscription: { remove: () => void } | null = null;
type PlaybackService = () => void | Promise<void>;

let playbackServiceFactory: (() => PlaybackService) | null = null;
let playbackServiceStarted = false;
let queue: PlayerTrack[] = [];
let activeIndex = -1;
let repeatMode = RepeatMode.Off;
let volume = 1;
let finishedTrackId: string | null = null;
let completionInFlight = false;
let progressUpdateIntervalMs = 250;
let progressTicker: ReturnType<typeof setInterval> | null = null;

let snapshot: PlaybackSnapshot = {
  state: State.None,
  position: 0,
  duration: 0,
  buffered: 0,
};

const storeListeners = new Set<() => void>();
const eventListeners = new Map<Event, Set<Listener>>();

function getExpoAudioModule(): ExpoAudioModule {
  if (expoAudioModule) return expoAudioModule;
  try {
    const module = require('expo-audio') as ExpoAudioModule;
    if (!module?.createAudioPlayer || !module?.setAudioModeAsync) {
      throw new Error('MODULO_NATIVO_NO_DISPONIBLE');
    }
    expoAudioModule = module;
    return module;
  } catch (error) {
    throw new Error(
      'Esta version de Milla necesita instalar el APK actualizado antes de reproducir audio.'
    );
  }
}

function notifyStore() {
  storeListeners.forEach((listener) => listener());
}

function publish(next: Partial<PlaybackSnapshot> = {}) {
  snapshot = { ...snapshot, ...next };
  notifyStore();
}

function emit(event: Event, payload?: any) {
  eventListeners.get(event)?.forEach((listener) => {
    try {
      listener(payload);
    } catch (error) {
      console.warn(`[PlayerEngine] Listener failed for ${event}:`, error);
    }
  });
}

function currentTrack(): PlayerTrack | undefined {
  return activeIndex >= 0 ? queue[activeIndex] : undefined;
}

function toState(status: AudioStatus): State {
  if (status.error) return State.Error;
  if (status.isBuffering) return State.Buffering;
  if (status.playing) return State.Playing;
  if (status.isLoaded) return State.Paused;
  return State.None;
}

function clampTime(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function startProgressTicker() {
  if (progressTicker) clearInterval(progressTicker);
  progressTicker = setInterval(() => {
    if (!player || !currentTrack()) return;
    const position = clampTime(player.currentTime);
    const duration = clampTime(player.duration) || snapshot.duration;
    publish({ position, duration, buffered: duration });
    emit(Event.PlaybackProgressUpdated, { position, duration });
  }, progressUpdateIntervalMs);
}

function updateLockScreenMetadata(track: PlayerTrack | undefined) {
  if (!player || !track) return;
  try {
    player.setActiveForLockScreen(true, {
      title: track.title || 'Milla',
      artist: track.artist || 'Artista desconocido',
      albumTitle: track.album || 'Biblioteca local',
      artworkUrl: typeof track.artwork === 'string' ? track.artwork : undefined,
    });
  } catch (error) {
    // Lock-screen metadata must never prevent local playback.
    console.warn('[PlayerEngine] Lock-screen metadata unavailable:', error);
  }
}

async function handleCompletion() {
  if (completionInFlight) return;
  const completed = currentTrack();
  if (!completed || finishedTrackId === String(completed.id)) return;

  completionInFlight = true;
  finishedTrackId = String(completed.id);
  try {
    if (repeatMode === RepeatMode.Track) {
      await seekTo(0);
      await play();
      return;
    }

    if (activeIndex + 1 < queue.length) {
      await skip(activeIndex + 1);
      await play();
      return;
    }

    if (repeatMode === RepeatMode.Queue && queue.length > 0) {
      await skip(0);
      await play();
      return;
    }

    publish({ state: State.Stopped, position: snapshot.duration });
    emit(Event.PlaybackQueueEnded, {});
  } finally {
    completionInFlight = false;
  }
}

function handleNativeStatus(status: AudioStatus) {
  const position = clampTime(status.currentTime);
  const duration = clampTime(status.duration) || currentTrack()?.duration || 0;
  publish({
    state: toState(status),
    position,
    duration,
    buffered: duration,
    activeTrack: currentTrack(),
  });
  emit(Event.PlaybackProgressUpdated, { position, duration });

  if (status.didJustFinish) {
    void handleCompletion();
  }
}

async function ensurePlayer(): Promise<AudioPlayer> {
  if (player) return player;

  const expoAudio = getExpoAudioModule();
  await expoAudio.setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'doNotMix',
  });

  player = expoAudio.createAudioPlayer(null, {
    updateInterval: 250,
    preferredForwardBufferDuration: 12,
  });
  player.volume = volume;
  nativeStatusSubscription = player.addListener('playbackStatusUpdate', handleNativeStatus);
  startProgressTicker();

  if (!playbackServiceStarted && playbackServiceFactory) {
    playbackServiceStarted = true;
    const service = playbackServiceFactory();
    Promise.resolve(service()).catch((error) => {
      console.warn('[PlayerEngine] Playback service failed to start:', error);
    });
  }

  return player;
}

async function loadTrack(index: number, resume: boolean): Promise<void> {
  if (index < 0 || index >= queue.length) throw new Error('Indice de cola invalido.');
  const nextTrack = queue[index];
  const uri = String(nextTrack.url || '');
  if (!uri) throw new Error(`La pista "${nextTrack.title || nextTrack.id}" no tiene una ruta reproducible.`);

  const nativePlayer = await ensurePlayer();
  const previousIndex = activeIndex;
  activeIndex = index;
  finishedTrackId = null;
  nativePlayer.replace({ uri, name: nextTrack.title || String(nextTrack.id) });
  nativePlayer.loop = repeatMode === RepeatMode.Track;
  updateLockScreenMetadata(nextTrack);
  publish({
    state: resume ? State.Playing : State.Ready,
    position: 0,
    duration: Number(nextTrack.duration || 0),
    buffered: 0,
    activeTrack: nextTrack,
  });
  if (previousIndex !== index) {
    emit(Event.PlaybackActiveTrackChanged, {
      track: nextTrack,
      index,
      lastIndex: previousIndex,
    });
  }
  if (resume) nativePlayer.play();
}

async function setupPlayer(_options?: Record<string, unknown>): Promise<boolean> {
  await ensurePlayer();
  return true;
}

async function play(): Promise<void> {
  const nativePlayer = await ensurePlayer();
  if (activeIndex < 0 && queue.length > 0) {
    await loadTrack(0, false);
  }
  if (!currentTrack()) throw new Error('No hay una pista preparada para reproducir.');
  nativePlayer.play();
  publish({ state: State.Playing });
}

async function pause(): Promise<void> {
  if (!player) return;
  player.pause();
  publish({ state: State.Paused });
}

async function reset(): Promise<void> {
  if (player) {
    player.pause();
    player.replace(null);
    try {
      player.clearLockScreenControls();
    } catch {
      // Clearing metadata is cosmetic and may be unavailable on web.
    }
  }
  queue = [];
  activeIndex = -1;
  finishedTrackId = null;
  publish({ state: State.None, position: 0, duration: 0, buffered: 0, activeTrack: undefined });
}

async function add(tracks: PlayerTrack | PlayerTrack[], insertBeforeIndex?: number): Promise<void> {
  const additions = (Array.isArray(tracks) ? tracks : [tracks]).filter((track) => Boolean(track?.id));
  if (additions.length === 0) return;
  const destination = insertBeforeIndex === undefined
    ? queue.length
    : Math.max(0, Math.min(insertBeforeIndex, queue.length));
  queue.splice(destination, 0, ...additions);
  if (activeIndex >= destination) activeIndex += additions.length;
  publish({ activeTrack: currentTrack() });
}

async function remove(indexOrIndexes: number | number[]): Promise<void> {
  const indexes = (Array.isArray(indexOrIndexes) ? indexOrIndexes : [indexOrIndexes])
    .filter((index) => Number.isInteger(index) && index >= 0 && index < queue.length)
    .sort((a, b) => b - a);
  if (indexes.length === 0) return;

  const wasPlaying = snapshot.state === State.Playing;
  let activeWasRemoved = false;
  indexes.forEach((index) => {
    if (index === activeIndex) activeWasRemoved = true;
    if (index < activeIndex) activeIndex -= 1;
    queue.splice(index, 1);
  });

  if (queue.length === 0) {
    await reset();
    return;
  }

  if (activeWasRemoved) {
    activeIndex = Math.min(Math.max(activeIndex, 0), queue.length - 1);
    await loadTrack(activeIndex, wasPlaying);
  } else {
    publish({ activeTrack: currentTrack() });
  }
}

async function move(fromIndex: number, toIndex: number): Promise<void> {
  if (fromIndex < 0 || fromIndex >= queue.length) return;
  const destination = Math.max(0, Math.min(toIndex, queue.length - 1));
  if (fromIndex === destination) return;
  const [track] = queue.splice(fromIndex, 1);
  queue.splice(destination, 0, track);
  if (activeIndex === fromIndex) activeIndex = destination;
  else if (fromIndex < activeIndex && destination >= activeIndex) activeIndex -= 1;
  else if (fromIndex > activeIndex && destination <= activeIndex) activeIndex += 1;
  publish({ activeTrack: currentTrack() });
}

async function skip(index: number): Promise<void> {
  const resume = snapshot.state === State.Playing || snapshot.state === State.Buffering;
  await loadTrack(index, resume);
}

async function skipToNext(): Promise<void> {
  if (activeIndex + 1 < queue.length) {
    await skip(activeIndex + 1);
    return;
  }
  if (repeatMode === RepeatMode.Queue && queue.length > 0) {
    await skip(0);
    return;
  }
  throw new Error('No hay una pista siguiente en la cola.');
}

async function skipToPrevious(): Promise<void> {
  if (activeIndex > 0) {
    await skip(activeIndex - 1);
    return;
  }
  if (repeatMode === RepeatMode.Queue && queue.length > 0) {
    await skip(queue.length - 1);
    return;
  }
  throw new Error('No hay una pista anterior en la cola.');
}

async function seekTo(seconds: number): Promise<void> {
  const nativePlayer = await ensurePlayer();
  const duration = clampTime(nativePlayer.duration) || snapshot.duration;
  const target = Math.max(0, duration > 0 ? Math.min(seconds, duration) : seconds);
  await nativePlayer.seekTo(target);
  publish({ position: target });
  emit(Event.PlaybackProgressUpdated, { position: target, duration });
}

async function setVolume(nextVolume: number): Promise<void> {
  volume = Math.max(0, Math.min(1, Number(nextVolume) || 0));
  if (player) player.volume = volume;
}

async function getVolume(): Promise<number> {
  return player ? player.volume : volume;
}

async function setRepeatMode(nextMode: RepeatMode): Promise<void> {
  repeatMode = nextMode;
  if (player) player.loop = repeatMode === RepeatMode.Track;
}

async function getRepeatMode(): Promise<RepeatMode> {
  return repeatMode;
}

async function getQueue(): Promise<PlayerTrack[]> {
  return [...queue];
}

async function getActiveTrack(): Promise<PlayerTrack | undefined> {
  return currentTrack();
}

async function getActiveTrackIndex(): Promise<number | undefined> {
  return activeIndex >= 0 ? activeIndex : undefined;
}

async function updateOptions(options: PlayerOptions): Promise<void> {
  const seconds = Number(options.progressUpdateEventInterval);
  if (Number.isFinite(seconds) && seconds > 0) {
    progressUpdateIntervalMs = Math.max(100, Math.min(Math.round(seconds * 1000), 2000));
    if (player) startProgressTicker();
  }
}

async function updateNowPlayingMetadata(metadata: Partial<PlayerTrack>): Promise<void> {
  if (!player) return;
  const track = currentTrack();
  updateLockScreenMetadata({ ...(track || { id: 'milla' }), ...metadata });
}

function addEventListener(event: Event, listener: Listener) {
  const listeners = eventListeners.get(event) || new Set<Listener>();
  listeners.add(listener);
  eventListeners.set(event, listeners);
  return {
    remove: () => {
      listeners.delete(listener);
      if (listeners.size === 0) eventListeners.delete(event);
    },
  };
}

function registerPlaybackService(factory: () => PlaybackService) {
  playbackServiceFactory = factory;
}

export function usePlaybackState(): { state: State } {
  return useSyncExternalStore(
    (listener) => {
      storeListeners.add(listener);
      return () => storeListeners.delete(listener);
    },
    () => snapshot,
    () => snapshot
  );
}

export function useProgress(_updateInterval?: number): { position: number; duration: number; buffered: number } {
  return useSyncExternalStore(
    (listener) => {
      storeListeners.add(listener);
      return () => storeListeners.delete(listener);
    },
    () => snapshot,
    () => snapshot
  );
}

export function useActiveTrack(): PlayerTrack | undefined {
  return useSyncExternalStore(
    (listener) => {
      storeListeners.add(listener);
      return () => storeListeners.delete(listener);
    },
    () => snapshot.activeTrack,
    () => undefined
  );
}

const TrackPlayer = {
  setupPlayer,
  registerPlaybackService,
  addEventListener,
  add,
  play,
  pause,
  reset,
  skip,
  skipToNext,
  skipToPrevious,
  seekTo,
  setVolume,
  getVolume,
  setRepeatMode,
  getRepeatMode,
  getQueue,
  getActiveTrack,
  getActiveTrackIndex,
  remove,
  move,
  updateOptions,
  updateNowPlayingMetadata,
};

export default TrackPlayer;
