"""Audio analysis used by Milla AutoMix.

The engine deliberately analyzes both ends of the file. AutoMix needs the real
outro, so analyzing only the first minute produces unusable transition points.
"""

import hashlib
import os
from typing import Any, Dict, Iterable, Tuple

import numpy as np

from ..models import AudioAnalysisCache

try:
    import librosa

    LIBROSA_AVAILABLE = True
except ImportError:
    librosa = None
    LIBROSA_AVAILABLE = False


ANALYSIS_VERSION = "milla-dsp-2"
TARGET_SAMPLE_RATE = 22050
SEGMENT_SECONDS = 45.0

CAMELOT_KEY_MAP = {
    ('C', 'major'): '8B', ('G', 'major'): '9B', ('D', 'major'): '10B', ('A', 'major'): '11B',
    ('E', 'major'): '12B', ('B', 'major'): '1B', ('F#', 'major'): '2B', ('C#', 'major'): '3B',
    ('G#', 'major'): '4B', ('D#', 'major'): '5B', ('A#', 'major'): '6B', ('F', 'major'): '7B',
    ('A', 'minor'): '8A', ('E', 'minor'): '9A', ('B', 'minor'): '10A', ('F#', 'minor'): '11A',
    ('C#', 'minor'): '12A', ('G#', 'minor'): '1A', ('D#', 'minor'): '2A', ('A#', 'minor'): '3A',
    ('F', 'minor'): '4A', ('C', 'minor'): '5A', ('G', 'minor'): '6A', ('D', 'minor'): '7A',
}

PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
KS_MAJOR = np.asarray([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KS_MINOR = np.asarray([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


class DSPEngine:
    @classmethod
    def analyze_fragment(cls, file_path: str, track_id: str) -> Dict[str, Any]:
        track_id = str(track_id or '')[:255]
        if not LIBROSA_AVAILABLE:
            return cls._failure(track_id, 'LIBROSA_UNAVAILABLE')
        if not os.path.isfile(file_path):
            return cls._failure(track_id, 'AUDIO_NOT_FOUND')

        file_hash = cls._compute_file_hash(file_path)
        cached = AudioAnalysisCache.objects.filter(file_hash=file_hash).first()
        if cached:
            return cls._cached_payload(cached, track_id)

        try:
            duration_seconds = float(librosa.get_duration(path=file_path))
            if not np.isfinite(duration_seconds) or duration_seconds <= 0:
                return cls._failure(track_id, 'INVALID_DURATION')

            segment_length = min(SEGMENT_SECONDS, duration_seconds)
            outro_offset = max(0.0, duration_seconds - segment_length)
            intro, sample_rate = librosa.load(
                file_path,
                sr=TARGET_SAMPLE_RATE,
                mono=True,
                offset=0.0,
                duration=segment_length,
            )
            if outro_offset > 0.5:
                outro, _ = librosa.load(
                    file_path,
                    sr=TARGET_SAMPLE_RATE,
                    mono=True,
                    offset=outro_offset,
                    duration=segment_length,
                )
            else:
                outro = intro

            if intro.size == 0 or outro.size == 0:
                return cls._failure(track_id, 'EMPTY_AUDIO')

            bpm = cls._estimate_tempo((intro, outro), sample_rate)
            key_audio = np.concatenate((intro, outro)) if outro_offset > 0.5 else intro
            camelot_key = cls._estimate_camelot_key(key_audio, sample_rate)
            transitions = cls._estimate_transitions(
                intro,
                outro,
                sample_rate,
                duration_seconds,
                outro_offset,
                bpm,
            )

            if bpm <= 0 and not camelot_key:
                return cls._failure(track_id, 'ANALYSIS_INCONCLUSIVE')

            metadata = {
                'engine': 'librosa/chroma-cqt/hpss',
                'analysis_version': ANALYSIS_VERSION,
                'duration_ms': round(duration_seconds * 1000.0, 1),
                'sample_rate': sample_rate,
                'segments_seconds': segment_length,
                **transitions,
            }
            return cls._save_and_return(
                file_hash,
                track_id,
                bpm,
                camelot_key,
                transitions['vocal_silence_start_ms'],
                transitions['vocal_silence_end_ms'],
                transitions['intro_duration_ms'],
                transitions['outro_duration_ms'],
                metadata,
            )
        except Exception as error:
            print(f"[DSPEngine] Error analyzing '{file_path}': {error}")
            return cls._failure(track_id, 'ANALYSIS_ERROR', str(error))

    @staticmethod
    def _normalize_tempo(value: float) -> float:
        if not np.isfinite(value) or value <= 0:
            return 0.0
        while value < 70.0:
            value *= 2.0
        while value > 190.0:
            value /= 2.0
        return value if 45.0 <= value <= 220.0 else 0.0

    @classmethod
    def _estimate_tempo(cls, segments: Iterable[np.ndarray], sample_rate: int) -> float:
        candidates = []
        for audio in segments:
            try:
                onset_envelope = librosa.onset.onset_strength(y=audio, sr=sample_rate)
                tempo = librosa.feature.tempo(
                    onset_envelope=onset_envelope,
                    sr=sample_rate,
                    aggregate=np.median,
                )
                value = float(np.ravel(tempo)[0]) if np.size(tempo) else 0.0
                value = cls._normalize_tempo(value)
                if value:
                    candidates.append(value)
            except Exception:
                continue
        return round(float(np.median(candidates)), 2) if candidates else 0.0

    @classmethod
    def _estimate_camelot_key(cls, audio: np.ndarray, sample_rate: int) -> str:
        try:
            harmonic, _ = librosa.effects.hpss(audio)
            chroma = librosa.feature.chroma_cqt(y=harmonic, sr=sample_rate)
            chroma_mean = np.mean(chroma, axis=1)
            if not np.all(np.isfinite(chroma_mean)) or float(np.sum(chroma_mean)) <= 0:
                return ''

            best_correlation = -1.0
            best_key = None
            for pitch_index in range(12):
                for mode, profile in (('major', KS_MAJOR), ('minor', KS_MINOR)):
                    correlation = float(np.corrcoef(chroma_mean, np.roll(profile, pitch_index))[0, 1])
                    if np.isfinite(correlation) and correlation > best_correlation:
                        best_correlation = correlation
                        best_key = (PITCH_CLASSES[pitch_index], mode)
            return CAMELOT_KEY_MAP.get(best_key, '') if best_key else ''
        except Exception:
            return ''

    @classmethod
    def _estimate_transitions(
        cls,
        intro: np.ndarray,
        outro: np.ndarray,
        sample_rate: int,
        duration_seconds: float,
        outro_offset: float,
        bpm: float,
    ) -> Dict[str, float]:
        intro_intervals = librosa.effects.split(intro, top_db=36)
        outro_intervals = librosa.effects.split(outro, top_db=36)

        audible_start = float(intro_intervals[0][0] / sample_rate) if len(intro_intervals) else 0.0
        audible_end_local = (
            float(outro_intervals[-1][1] / sample_rate)
            if len(outro_intervals)
            else float(len(outro) / sample_rate)
        )
        audible_end = min(duration_seconds, outro_offset + audible_end_local)

        intro_rms = librosa.feature.rms(y=intro)[0]
        outro_rms = librosa.feature.rms(y=outro)[0]
        energy_reference = max(float(np.percentile(np.concatenate((intro_rms, outro_rms)), 90)), 1e-9)
        intro_energy = min(1.0, float(np.mean(intro_rms)) / energy_reference)
        outro_energy = min(1.0, float(np.mean(outro_rms)) / energy_reference)

        beat_interval_ms = 60000.0 / bpm if bpm > 0 else 0.0
        transition_seconds = min(12.0, max(3.0, (beat_interval_ms * 8.0 / 1000.0) if beat_interval_ms else 6.0))
        target_outro_local = max(0.0, audible_end_local - transition_seconds)

        try:
            _, beat_frames = librosa.beat.beat_track(y=outro, sr=sample_rate)
            beat_times = librosa.frames_to_time(beat_frames, sr=sample_rate)
            eligible = beat_times[beat_times <= target_outro_local + 1.0]
            if eligible.size:
                target_outro_local = float(eligible[-1])
        except Exception:
            pass

        outro_start = min(audible_end, max(outro_offset, outro_offset + target_outro_local))
        outro_duration = max(1000.0, (duration_seconds - outro_start) * 1000.0)
        intro_duration = max(1000.0, (audible_start + transition_seconds) * 1000.0)

        return {
            'vocal_silence_start_ms': round(audible_start * 1000.0, 1),
            'vocal_silence_end_ms': round(audible_end * 1000.0, 1),
            'intro_duration_ms': round(intro_duration, 1),
            'outro_duration_ms': round(outro_duration, 1),
            'outro_start_ms': round(outro_start * 1000.0, 1),
            'intro_energy': round(intro_energy, 4),
            'outro_energy': round(outro_energy, 4),
            'beat_interval_ms': round(beat_interval_ms, 2),
        }

    @classmethod
    def _cached_payload(cls, cached: AudioAnalysisCache, requested_track_id: str) -> Dict[str, Any]:
        metadata = cached.analysis_metadata or {}
        return {
            'track_id': requested_track_id or cached.track_id,
            'bpm': round(cached.bpm, 2),
            'camelot_key': cached.camelot_key,
            'vocal_silence_start_ms': cached.vocal_silence_start_ms,
            'vocal_silence_end_ms': cached.vocal_silence_end_ms,
            'intro_duration_ms': cached.intro_duration_ms,
            'outro_duration_ms': cached.outro_duration_ms,
            'outro_start_ms': metadata.get('outro_start_ms'),
            'intro_energy': metadata.get('intro_energy'),
            'outro_energy': metadata.get('outro_energy'),
            'beat_interval_ms': metadata.get('beat_interval_ms'),
            'duration_ms': metadata.get('duration_ms'),
            'analysis_version': metadata.get('analysis_version', ANALYSIS_VERSION),
            'analysis_status': 'ready',
            'cached': True,
            'success': True,
        }

    @classmethod
    def _save_and_return(
        cls,
        file_hash: str,
        track_id: str,
        bpm: float,
        camelot_key: str,
        vocal_start: float,
        vocal_end: float,
        intro_duration: float,
        outro_duration: float,
        metadata: Dict[str, Any],
    ) -> Dict[str, Any]:
        cached, _ = AudioAnalysisCache.objects.update_or_create(
            file_hash=file_hash,
            defaults={
                'track_id': track_id or file_hash[:16],
                'bpm': bpm,
                'camelot_key': camelot_key,
                'vocal_silence_start_ms': vocal_start,
                'vocal_silence_end_ms': vocal_end,
                'intro_duration_ms': intro_duration,
                'outro_duration_ms': outro_duration,
                'analysis_metadata': metadata,
            },
        )
        payload = cls._cached_payload(cached, track_id)
        payload['cached'] = False
        return payload

    @staticmethod
    def _failure(track_id: str, reason: str, detail: str = '') -> Dict[str, Any]:
        payload = {
            'track_id': track_id,
            'success': False,
            'cached': False,
            'analysis_status': 'failed',
            'reason': reason,
        }
        if detail:
            payload['detail'] = detail[:300]
        return payload

    @staticmethod
    def _compute_file_hash(file_path: str) -> str:
        """Create a stable fingerprint without reading a multi-gigabyte file twice."""
        hasher = hashlib.sha256()
        file_size = os.path.getsize(file_path)
        hasher.update(str(file_size).encode('ascii'))
        chunk_size = 256 * 1024
        offsets = {0, max(0, file_size // 2 - chunk_size // 2), max(0, file_size - chunk_size)}
        with open(file_path, 'rb') as audio_file:
            for offset in sorted(offsets):
                audio_file.seek(offset)
                hasher.update(audio_file.read(chunk_size))
        return hasher.hexdigest()
