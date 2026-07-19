import React, { createContext, useContext, useState, useRef, useEffect, ReactNode } from 'react';
import { Track } from '../components/PlayerBar';
import { getAutoMixSettings } from './database-service';

export interface VertexTrack extends Track {
  fileHash?: string;
  bpm?: number;
  camelotKey?: string;
  introStartTime?: number;
  outroStartTime?: number;
  hasVocalIntro?: boolean;
  hasVocalOutro?: boolean;
  replayGainDb?: number;
}

export class VertexQueueManager {
  private priorityQueue: VertexTrack[] = [];
  private autoMixQueue: VertexTrack[] = [];
  private history: VertexTrack[] = [];
  private currentTrack: VertexTrack | null = null;
  private fullCatalog: VertexTrack[] = [];
  private onQueueChangeCallback: (() => void) | null = null;
  private isAutoMixEnabled: boolean = false;
  private bpmTolerance: number = 3;
  private isSessionAutoMixForced: boolean = false;
  private harmonicMode: 'strict' | 'energy' | 'free' = 'strict';
  private transitionSeconds: number = 6;
  private crossOutEnabled: boolean = true;
  private volumeNormalizationEnabled: boolean = false;

  constructor(catalog: VertexTrack[] = []) {
    this.fullCatalog = catalog;
    this.syncSettings();
  }

  public setSessionAutoMixForced(forced: boolean): void {
    this.isSessionAutoMixForced = forced;
    if (forced || this.isAutoMixEnabled) {
      this.recalculateAutoMix();
    } else {
      this.autoMixQueue = [];
    }
    this.notifyChange();
  }

  public getIsSessionAutoMixForced(): boolean {
    return this.isSessionAutoMixForced;
  }

  public async syncSettings(): Promise<void> {
    try {
      const settings = await getAutoMixSettings();
      this.isAutoMixEnabled = settings.enabled;
      this.bpmTolerance = settings.bpm_tolerance;
      this.harmonicMode = settings.harmonic_mode;
      this.transitionSeconds = settings.crossfade_seconds > 0
        ? Math.min(Math.max(settings.crossfade_seconds, 1), 12)
        : 0;
      this.crossOutEnabled = settings.cross_out_enabled;
      this.volumeNormalizationEnabled = Boolean(settings.volume_normalization);
      if (!this.isAutoMixEnabled && !this.isSessionAutoMixForced) {
        this.autoMixQueue = [];
      } else {
        this.recalculateAutoMix();
      }
      this.notifyChange();
    } catch (e) {
      console.warn('[VertexQueueManager] Error sincronizando ajustes de AutoMix:', e);
    }
  }

  public setAutoMixEnabled(enabled: boolean): void {
    this.isAutoMixEnabled = enabled;
    if (!enabled && !this.isSessionAutoMixForced) {
      this.autoMixQueue = [];
    } else {
      this.recalculateAutoMix();
    }
    this.notifyChange();
  }

  public isAutoMixActive(): boolean {
    return this.isAutoMixEnabled || this.isSessionAutoMixForced;
  }

  public getTransitionSeconds(): number {
    return this.transitionSeconds;
  }

  public isCrossOutEnabled(): boolean {
    return this.crossOutEnabled;
  }

  public isVolumeNormalizationEnabled(): boolean {
    return this.volumeNormalizationEnabled;
  }

  public getCatalogTrack(trackId: string): VertexTrack | null {
    return this.fullCatalog.find((track) => track.id === trackId) ?? null;
  }

  public getSequentialTracksAfter(trackId: string, count = 24, excludedIds: Set<string> = new Set()): VertexTrack[] {
    if (this.fullCatalog.length === 0) return [];
    const startIndex = this.fullCatalog.findIndex((track) => track.id === trackId);
    if (startIndex < 0) return [];
    const result: VertexTrack[] = [];
    for (let step = 1; step < this.fullCatalog.length && result.length < count; step++) {
      const candidate = this.fullCatalog[(startIndex + step) % this.fullCatalog.length];
      if (candidate.id !== trackId && !excludedIds.has(candidate.id)) result.push(candidate);
    }
    return result;
  }

  public setCatalog(catalog: VertexTrack[]): void {
    this.fullCatalog = catalog;
    this.recalculateAutoMix();
    this.notifyChange();
  }

  public setOnQueueChange(callback: () => void): void {
    this.onQueueChangeCallback = callback;
  }

  private notifyChange(): void {
    if (this.onQueueChangeCallback) {
      this.onQueueChangeCallback();
    }
  }

  public getPriorityQueue(): VertexTrack[] {
    return [...this.priorityQueue];
  }

  public getAutoMixQueue(): VertexTrack[] {
    return [...this.autoMixQueue];
  }

  public getHistory(): VertexTrack[] {
    return [...this.history];
  }

  public getCurrentTrack(): VertexTrack | null {
    return this.currentTrack;
  }

  public playNext(track: VertexTrack): void {
    this.priorityQueue.unshift(track);
    this.recalculateAutoMix();
    this.notifyChange();
  }

  public addToQueue(track: VertexTrack): void {
    this.priorityQueue.push(track);
    this.recalculateAutoMix();
    this.notifyChange();
  }

  public clearQueue(): void {
    this.priorityQueue = [];
    this.autoMixQueue = [];
    this.notifyChange();
  }

  public removeFromQueue(trackId: string): void {
    this.priorityQueue = this.priorityQueue.filter(t => t.id !== trackId);
    this.autoMixQueue = this.autoMixQueue.filter(t => t.id !== trackId);
    this.notifyChange();
  }

  public setCurrentTrack(track: VertexTrack | null): void {
    if (this.currentTrack && this.currentTrack.id !== track?.id) {
      if (this.history[this.history.length - 1]?.id !== this.currentTrack.id) {
        this.history.push(this.currentTrack);
        this.history = this.history.slice(-100);
      }
    }
    this.currentTrack = track;
    if (track) {
      this.priorityQueue = this.priorityQueue.filter((item) => item.id !== track.id);
      this.autoMixQueue = this.autoMixQueue.filter((item) => item.id !== track.id);
    }
    this.recalculateAutoMix();
    this.notifyChange();
  }

  public peekNextTrack(): VertexTrack | null {
    if (this.priorityQueue.length > 0) return this.priorityQueue[0];
    if (this.isAutoMixActive() && this.autoMixQueue.length > 0) return this.autoMixQueue[0];
    return null;
  }

  public getNextTrack(): VertexTrack | null {
    if (this.currentTrack && this.history[this.history.length - 1]?.id !== this.currentTrack.id) {
      this.history.push(this.currentTrack);
      this.history = this.history.slice(-100);
    }

    // Capa 1: Cola de prioridad / selección manual
    if (this.priorityQueue.length > 0) {
      this.currentTrack = this.priorityQueue.shift()!;
      this.recalculateAutoMix();
      this.notifyChange();
      return this.currentTrack;
    }

    // Capa 2: Cola calculada dinámicamente por IA / AutoMix (Rueda de Camelot & BPM)
    // Solo si el Auto Mix está activado en Configuración o forzado temporalmente en la sesión de escucha
    if (this.isAutoMixActive() && this.autoMixQueue.length > 0) {
      this.currentTrack = this.autoMixQueue.shift()!;
      this.recalculateAutoMix();
      this.notifyChange();
      return this.currentTrack;
    }

    this.notifyChange();
    return null;
  }

  private recalculateAutoMix(): void {
    if (!this.isAutoMixEnabled && !this.isSessionAutoMixForced) {
      this.autoMixQueue = [];
      return;
    }

    const referenceTrack = 
      this.currentTrack ||
      this.history[this.history.length - 1];

    if (!referenceTrack || this.fullCatalog.length === 0) {
      this.autoMixQueue = [];
      return;
    }

    const excludedIds = new Set([
      ...this.history.slice(-15).map(t => t.id),
      ...this.priorityQueue.map(t => t.id),
      referenceTrack.id
    ]);

    let allCandidates = this.fullCatalog.filter(t => !excludedIds.has(t.id));
    // In a small playlist, excluding the recent history can remove the whole
    // catalog. Reuse the least-recent candidates instead of ending playback.
    if (allCandidates.length === 0) {
      allCandidates = this.fullCatalog.filter(t =>
        t.id !== referenceTrack.id && !this.priorityQueue.some((queued) => queued.id === t.id)
      );
    }
    if (allCandidates.length === 0) {
      this.autoMixQueue = [];
      return;
    }
    const analyzedCandidates = allCandidates.filter((track) =>
      track.analysis_status === 'ready' && Boolean(track.bpm) && Boolean(track.camelot_key || track.key)
    );
    // Once enough tracks have DSP data, do not let unanalysed files outrank a
    // verified BPM/key transition. Before that point the queue still degrades
    // gracefully to metadata-based selection.
    const candidates = analyzedCandidates.length >= 3 ? analyzedCandidates : allCandidates;

    const scoredCandidates = candidates.map(candidate => ({
      track: candidate,
      score: this.calculateMixScore(referenceTrack, candidate) + Math.random() * 0.35
    }));

    scoredCandidates.sort((a, b) => b.score - a.score);
    this.autoMixQueue = scoredCandidates.slice(0, 5).map(sc => sc.track);
  }

  private calculateMixScore(current: VertexTrack, next: VertexTrack): number {
    let score = 100;

    const currentBpm = current.bpm;
    const nextBpm = next.bpm;
    if (currentBpm && nextBpm) {
      const tempoCandidates = [nextBpm, nextBpm * 2, nextBpm / 2];
      const normalizedNextBpm = tempoCandidates.reduce((best, candidate) =>
        Math.abs(candidate - currentBpm) < Math.abs(best - currentBpm) ? candidate : best
      );
      const bpmDiff = Math.abs(currentBpm - normalizedNextBpm);
      const bpmDiffPercent = bpmDiff / currentBpm;
      if (bpmDiff > this.bpmTolerance) score -= 60;
      else if (bpmDiffPercent > 0.05) score -= 30;
      else score += (this.bpmTolerance - bpmDiff) * 10;
    } else {
      score -= 32;
    }

    const currentKey = current.camelotKey || current.camelot_key || current.key || '';
    const nextKey = next.camelotKey || next.camelot_key || next.key || '';
    if (currentKey && nextKey && this.harmonicMode !== 'free') {
      const harmonicDistance = this.getCamelotDistance(currentKey, nextKey);
      if (harmonicDistance === 0) score += 40;
      else if (harmonicDistance === 1) score += this.harmonicMode === 'energy' ? 35 : 25;
      else if (harmonicDistance === 2) score += this.harmonicMode === 'energy' ? 15 : 5;
      else score -= this.harmonicMode === 'strict' ? 40 : 15;
    }

    if (current.hasVocalOutro === true && next.hasVocalIntro === true) {
      score -= 60;
    } else if (current.hasVocalOutro === false && next.hasVocalIntro === false) {
      score += 20;
    }

    if (current.outro_energy != null && next.intro_energy != null) {
      const energyDifference = Math.abs(current.outro_energy - next.intro_energy);
      score += Math.max(-20, 24 - energyDifference * 60);
    }

    const currentGenre = String(current.genre || '').trim().toLocaleLowerCase('es');
    const nextGenre = String(next.genre || '').trim().toLocaleLowerCase('es');
    if (currentGenre && nextGenre) {
      const currentGenres = new Set(currentGenre.split(/[;,/|]/).map((value) => value.trim()).filter(Boolean));
      const nextGenres = new Set(nextGenre.split(/[;,/|]/).map((value) => value.trim()).filter(Boolean));
      const sharesGenre = [...currentGenres].some((genre) => nextGenres.has(genre));
      score += sharesGenre ? 18 : -4;
    }

    // Prefer a natural exit and a short, energetic entrance when DSP data exists.
    if (current.outro_start_ms && current.duration) {
      const outroSeconds = Math.max(0, current.duration - current.outro_start_ms / 1000);
      score += outroSeconds >= 3 && outroSeconds <= 16 ? 8 : -3;
    }
    if (next.intro_duration_ms != null) {
      score += next.intro_duration_ms <= 12000 ? 6 : 0;
    }

    if (next.analysis_status === 'ready') score += 22;
    else score -= 24;
    if (!next.camelot_key && !next.camelotKey && !next.key) score -= 18;

    return score;
  }

  private getCamelotDistance(keyA: string, keyB: string): number {
    if (!keyA || !keyB) return 3;
    if (keyA === keyB) return 0;

    const numA = parseInt(keyA.slice(0, -1), 10);
    const letterA = keyA.slice(-1).toUpperCase();
    const numB = parseInt(keyB.slice(0, -1), 10);
    const letterB = keyB.slice(-1).toUpperCase();

    if (isNaN(numA) || isNaN(numB)) return 3;

    if (numA === numB && letterA !== letterB) return 1;

    const numDiff = Math.abs(numA - numB);
    if (letterA === letterB && (numDiff === 1 || numDiff === 11)) return 1;

    if (letterA === letterB && (numDiff === 2 || numDiff === 10)) return 2;

    return 3;
  }
}

// Singleton global de VertexQueueManager para permitir al motor nativo en segundo plano (playback-service)
// consultar e inyectar pistas dinámicas sin necesitar un contexto UI activo.
export const globalVertexQueueManager = new VertexQueueManager();

interface VertexQueueContextType {
  queueManager: VertexQueueManager;
  priorityQueue: VertexTrack[];
  autoMixQueue: VertexTrack[];
  history: VertexTrack[];
  currentTrack: VertexTrack | null;
  playNext: (track: VertexTrack) => void;
  addToQueue: (track: VertexTrack) => void;
  setCatalog: (catalog: VertexTrack[]) => void;
  setCurrentTrack: (track: VertexTrack | null) => void;
  setSessionAutoMixForced: (forced: boolean) => void;
  clearQueue: () => void;
  removeFromQueue: (trackId: string) => void;
}

const VertexQueueContext = createContext<VertexQueueContextType | undefined>(undefined);

export const VertexQueueProvider: React.FC<{ children: ReactNode; initialCatalog?: VertexTrack[] }> = ({
  children,
  initialCatalog = [],
}) => {
  const queueManagerRef = useRef<VertexQueueManager>(globalVertexQueueManager);
  const [priorityQueue, setPriorityQueue] = useState<VertexTrack[]>(globalVertexQueueManager.getPriorityQueue());
  const [autoMixQueue, setAutoMixQueue] = useState<VertexTrack[]>(globalVertexQueueManager.getAutoMixQueue());
  const [history, setHistory] = useState<VertexTrack[]>(globalVertexQueueManager.getHistory());
  const [currentTrack, setCurrentTrackState] = useState<VertexTrack | null>(globalVertexQueueManager.getCurrentTrack());

  useEffect(() => {
    if (initialCatalog.length > 0) {
      globalVertexQueueManager.setCatalog(initialCatalog);
    }
    const manager = queueManagerRef.current;
    manager.setOnQueueChange(() => {
      setPriorityQueue(manager.getPriorityQueue());
      setAutoMixQueue(manager.getAutoMixQueue());
      setHistory(manager.getHistory());
      setCurrentTrackState(manager.getCurrentTrack());
    });
  }, [initialCatalog]);

  const playNext = (track: VertexTrack) => {
    queueManagerRef.current.playNext(track);
  };

  const addToQueue = (track: VertexTrack) => {
    queueManagerRef.current.addToQueue(track);
  };

  const setCatalog = (catalog: VertexTrack[]) => {
    queueManagerRef.current.setCatalog(catalog);
  };

  const setCurrentTrack = (track: VertexTrack | null) => {
    queueManagerRef.current.setCurrentTrack(track);
  };

  const setSessionAutoMixForced = (forced: boolean) => {
    queueManagerRef.current.setSessionAutoMixForced(forced);
  };

  const clearQueue = () => {
    queueManagerRef.current.clearQueue();
  };

  const removeFromQueue = (trackId: string) => {
    queueManagerRef.current.removeFromQueue(trackId);
  };

  return (
    <VertexQueueContext.Provider
      value={{
        queueManager: queueManagerRef.current,
        priorityQueue,
        autoMixQueue,
        history,
        currentTrack,
        playNext,
        addToQueue,
        setCatalog,
        setCurrentTrack,
        setSessionAutoMixForced,
        clearQueue,
        removeFromQueue,
      }}
    >
      {children}
    </VertexQueueContext.Provider>
  );
};

export const useVertexQueue = (): VertexQueueContextType => {
  const context = useContext(VertexQueueContext);
  if (!context) {
    throw new Error('useVertexQueue debe usarse dentro de un VertexQueueProvider');
  }
  return context;
};
