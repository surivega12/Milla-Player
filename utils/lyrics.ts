export interface LyricLine {
  time: number; // Tiempo en segundos
  text: string; // Contenido de la línea de texto
}

interface TimedLyricLine extends LyricLine {
  wordSegments?: Array<{ time: number; text: string }>;
}

const timestampToSeconds = (minutes: string, seconds: string, fraction = '0'): number =>
  Number(minutes) * 60 + Number(seconds) + Number(fraction) / Math.pow(10, fraction.length);

function parseTimedLrc(lrcText: string): TimedLyricLine[] {
  const offsetMatch = lrcText.match(/\[offset:([+-]?\d+)\]/i);
  const offsetSeconds = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;
  const lines: TimedLyricLine[] = [];

  for (const rawLine of lrcText.split(/\r?\n/)) {
    const lineTimes = Array.from(
      rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g),
      (match) => Math.max(0, timestampToSeconds(match[1], match[2], match[3] || '0') + offsetSeconds)
    );
    const contentWithWordTimes = rawLine.replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g, '');
    const wordSegments = Array.from(
      contentWithWordTimes.matchAll(/<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>([^<]*)/g),
      (match) => ({
        time: Math.max(0, timestampToSeconds(match[1], match[2], match[3] || '0') + offsetSeconds),
        text: match[4],
      })
    ).filter((segment) => segment.text.trim().length > 0);
    const text = contentWithWordTimes
      .replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, '')
      .trim();
    if (!text) continue;

    const effectiveLineTimes = lineTimes.length > 0
      ? lineTimes
      : wordSegments.length > 0 ? [wordSegments[0].time] : [];
    effectiveLineTimes.forEach((time, index) => {
      lines.push({
        time,
        text,
        wordSegments: index === 0 && wordSegments.length > 0 ? wordSegments : undefined,
      });
    });
  }

  return lines.sort((a, b) => a.time - b.time);
}

/**
 * Convierte el contenido de un archivo .lrc a un array ordenado de LyricLines.
 */
export function parseLrc(lrcText: string): LyricLine[] {
  if (!lrcText) return [];
  const lines = lrcText.split(/\r?\n/);
  const timedLines = parseTimedLrc(lrcText);
  if (timedLines.length > 0) return timedLines.map(({ time, text }) => ({ time, text }));
  return lines
    .map((line) => line
      .replace(/^\[[a-z]+:[^\]]*\]\s*/i, '')
      .replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, '')
      .trim())
    .filter(Boolean)
    .map((text) => ({ time: -1, text }));
}

const escapeXml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const formatTtmlTime = (milliseconds: number): string => {
  const safe = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(safe / 3600000);
  const minutes = Math.floor((safe % 3600000) / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const millis = safe % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
};

export function lrcToWaveTtml(lrcText: string, durationMs = 0): string | undefined {
  const lines = parseTimedLrc(lrcText).filter((line) => line.time >= 0);
  if (lines.length === 0) return undefined;
  const body = lines.map((line, index) => {
    const beginMs = Math.round(line.time * 1000);
    const nextMs = index + 1 < lines.length
      ? Math.round(lines[index + 1].time * 1000)
      : (durationMs > beginMs ? durationMs : beginMs + Math.max(2200, line.text.length * 65));
    const endMs = Math.max(beginMs + 350, nextMs - 35);
    const enhancedSegments = line.wordSegments?.filter((segment) => segment.time * 1000 < endMs) || [];
    let spans = '';
    if (enhancedSegments.length > 0) {
      spans = enhancedSegments.map((segment, segmentIndex) => {
        const wordBegin = Math.max(beginMs, Math.round(segment.time * 1000));
        const nextSegmentMs = enhancedSegments[segmentIndex + 1]
          ? Math.round(enhancedSegments[segmentIndex + 1].time * 1000)
          : endMs;
        const wordEnd = Math.min(endMs, Math.max(wordBegin + 30, Math.min(endMs, nextSegmentMs)));
        return `<span begin="${formatTtmlTime(wordBegin)}" end="${formatTtmlTime(wordEnd)}">${escapeXml(segment.text)}</span>`;
      }).join('');
    } else {
      const words = line.text.split(/(\s+)/).filter(Boolean);
      const spokenWords = words.filter((word) => word.trim()).length || 1;
      let spokenIndex = 0;
      spans = words.map((word) => {
        if (!word.trim()) return escapeXml(word);
        const wordBegin = beginMs + ((endMs - beginMs) * spokenIndex) / spokenWords;
        spokenIndex += 1;
        const wordEnd = beginMs + ((endMs - beginMs) * spokenIndex) / spokenWords;
        return `<span begin="${formatTtmlTime(wordBegin)}" end="${formatTtmlTime(wordEnd)}">${escapeXml(word)}</span>`;
      }).join('');
    }
    return `<p begin="${formatTtmlTime(beginMs)}" end="${formatTtmlTime(endMs)}">${spans}</p>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?><tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyrics" xml:space="preserve"><body><div>${body}</div></body></tt>`;
}
