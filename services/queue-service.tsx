import React, { createContext, useContext, useState, useRef, useEffect, ReactNode } from 'react';
import { Track } from '../components/PlayerBar';
import { getCompatibleKeys } from './smart-dj-service';
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
  private isAutoMixEnabled: boolean = true;
  private bpmTolerance: number = 3;
  private isSessionAutoMixForced: boolean = false;

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
      this.history.push(this.currentTrack);
    }
    this.currentTrack = track;
    this.recalculateAutoMix();
    this.notifyChange();
  }

  public getNextTrack(): VertexTrack | null {
    if (this.currentTrack) {
      this.history.push(this.currentTrack);
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
    if ((this.isAutoMixEnabled || this.isSessionAutoMixForced) && this.autoMixQueue.length > 0) {
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
      this.priorityQueue[this.priorityQueue.length - 1] || 
      this.currentTrack || 
      this.history[this.history.length - 1];

    if (!referenceTrack || this.fullCatalog.length === 0) return;

    const excludedIds = new Set([
      ...this.history.slice(-15).map(t => t.id),
      ...this.priorityQueue.map(t => t.id),
      referenceTrack.id
    ]);

    const candidates = this.fullCatalog.filter(t => !excludedIds.has(t.id));

    const scoredCandidates = candidates.map(candidate => ({
      track: candidate,
      score: this.calculateMixScore(referenceTrack, candidate)
    }));

    scoredCandidates.sort((a, b) => b.score - a.score);
    this.autoMixQueue = scoredCandidates.slice(0, 5).map(sc => sc.track);
  }

  private calculateMixScore(current: VertexTrack, next: VertexTrack): number {
    let score = 100;

    const currentBpm = current.bpm || 100;
    const nextBpm = next.bpm || 100;
    const bpmDiff = Math.abs(currentBpm - nextBpm);
    const bpmDiffPercent = bpmDiff / currentBpm;
    
    if (bpmDiff > this.bpmTolerance) {
      score -= 60;
    } else if (bpmDiffPercent > 0.05) {
      score -= 30;
    } else {
      score += (this.bpmTolerance - bpmDiff) * 10;
    }

    const currentKey = current.camelotKey || current.key || '';
    const nextKey = next.camelotKey || next.key || '';
    const harmonicDistance = this.getCamelotDistance(currentKey, nextKey);
    
    if (harmonicDistance === 0) score += 40;
    else if (harmonicDistance === 1) score += 25;
    else if (harmonicDistance === 2) score += 5;
    else score -= 40;

    if (current.hasVocalOutro && next.hasVocalIntro) {
      score -= 60;
    } else if (!current.hasVocalOutro && !next.hasVocalIntro) {
      score += 20;
    }

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
