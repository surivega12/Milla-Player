'use dom';

import React, { useEffect, useRef } from 'react';
import '@uimaxbai/am-lyrics/am-lyrics.js';

type AmLyricsElement = HTMLElement & {
  currentTime: number;
  duration?: number;
  songTitle?: string;
  songArtist?: string;
  songAlbum?: string;
  songDuration?: number;
  query?: string;
  highlightColor?: string;
  autoscroll?: boolean;
  interpolate?: boolean;
  shadowRoot: ShadowRoot | null;
};

export interface LyricsWaveDomProps {
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  currentTimeMs: number;
  isPlaying: boolean;
  highlightColor?: string;
  onSeek: (seconds: number) => Promise<void>;
  dom?: unknown;
}

export default function LyricsWaveDom({
  title,
  artist,
  album = '',
  durationMs,
  currentTimeMs,
  isPlaying,
  highlightColor = '#f6f4ef',
  onSeek,
}: LyricsWaveDomProps) {
  const lyricsRef = useRef<AmLyricsElement | null>(null);

  useEffect(() => {
    const element = lyricsRef.current;
    if (!element) return;
    element.songTitle = title;
    element.songArtist = artist;
    element.songAlbum = album;
    element.songDuration = durationMs;
    element.duration = durationMs;
    element.query = `${title} ${artist}`.trim();
    element.highlightColor = highlightColor;
    element.autoscroll = true;
    element.interpolate = true;
  }, [album, artist, durationMs, highlightColor, title]);

  useEffect(() => {
    const element = lyricsRef.current;
    if (!element) return;
    const handleLineClick = (event: Event) => {
      const timestamp = Number((event as CustomEvent<{ timestamp?: number }>).detail?.timestamp);
      if (Number.isFinite(timestamp)) onSeek(timestamp / 1000).catch(() => {});
    };
    element.addEventListener('line-click', handleLineClick);
    return () => element.removeEventListener('line-click', handleLineClick);
  }, [onSeek]);

  useEffect(() => {
    const element = lyricsRef.current;
    if (!element) return;
    let frame = 0;
    const anchorMediaTime = currentTimeMs;
    const anchorSystemTime = performance.now();

    const update = (now: number) => {
      element.currentTime = isPlaying
        ? Math.min(anchorMediaTime + (now - anchorSystemTime), durationMs || Number.MAX_SAFE_INTEGER)
        : anchorMediaTime;
      if (isPlaying) frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [currentTimeMs, durationMs, isPlaying]);

  useEffect(() => {
    let attempts = 0;
    let frame = 0;
    let cancelled = false;
    const installStyles = () => {
      if (cancelled) return;
      const root = lyricsRef.current?.shadowRoot;
      if (!root) {
        if (attempts++ < 120) frame = requestAnimationFrame(installStyles);
        return;
      }
      if (root.querySelector('[data-milla-wave-style]')) return;
      const style = document.createElement('style');
      style.dataset.millaWaveStyle = 'true';
      style.textContent = `
        :host { --am-lyrics-highlight-color: ${highlightColor}; --highlight-color: ${highlightColor}; }
        .lyrics-container { padding: 18vh 18px !important; scrollbar-width: none; }
        .lyrics-container::-webkit-scrollbar { display: none; }
        .lyrics-line {
          opacity: .44;
          transition: opacity .42s ease, transform .55s cubic-bezier(.22,1,.36,1), filter .48s ease !important;
        }
        .lyrics-line.active, .lyrics-line.pre-active { opacity: 1; transform: scale(1.015); filter: none; }
        .lyrics-line:not(.active):not(.pre-active) { filter: blur(1.4px); }
        .lyrics-line-container { max-width: 92%; }
      `;
      root.appendChild(style);
    };
    installStyles();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [highlightColor]);

  return (
    <main>
      {React.createElement('am-lyrics', {
        ref: lyricsRef,
        autoscroll: '',
        interpolate: '',
      })}
      <style>{`
        html, body, #root, main { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
        body { color: #f6f4ef; font-family: Inter, system-ui, -apple-system, sans-serif; }
        am-lyrics { display: block; width: 100%; height: 100%; --am-lyrics-highlight-color: ${highlightColor}; }
      `}</style>
    </main>
  );
}
