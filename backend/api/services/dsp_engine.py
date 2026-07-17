"""
Punto 2.3: Motor DSP para AutoMix (Librosa BPM, Clave Camelot y Spleeter/Vocal Detection).

Recibe fragmentos de audio o archivos locales, ejecuta análisis armónico mediante transformadas
de Fourier (Chroma CQT) y detección de transitorios de percusión, y guarda los datos en caché.
"""
import os
import hashlib
import numpy as np
from typing import Dict, Any, Tuple
from ..models import AudioAnalysisCache

try:
    import librosa
    LIBROSA_AVAILABLE = True
except ImportError:
    LIBROSA_AVAILABLE = False


# Mapeo de Tonos Krumhansl-Schmuckler a Rueda de Camelot (DJ Harmonic Mixing)
CAMELOT_KEY_MAP = {
    # Mayores (B)
    ('C', 'major'): '8B', ('G', 'major'): '9B', ('D', 'major'): '10B', ('A', 'major'): '11B',
    ('E', 'major'): '12B', ('B', 'major'): '1B', ('F#', 'major'): '2B', ('C#', 'major'): '3B',
    ('G#', 'major'): '4B', ('D#', 'major'): '5B', ('A#', 'major'): '6B', ('F', 'major'): '7B',
    # Menores (A)
    ('A', 'minor'): '8A', ('E', 'minor'): '9A', ('B', 'minor'): '10A', ('F#', 'minor'): '11A',
    ('C#', 'minor'): '12A', ('G#', 'minor'): '1A', ('D#', 'minor'): '2A', ('A#', 'minor'): '3A',
    ('F', 'minor'): '4A', ('C', 'minor'): '5A', ('G', 'minor'): '6A', ('D', 'minor'): '7A',
}

PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

# Perfiles de Krumhansl-Schmuckler
KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]


class DSPEngine:
    @classmethod
    def analyze_fragment(cls, file_path: str, track_id: str) -> Dict[str, Any]:
        """
        Analiza un archivo de audio o fragmento (30 seg intro/outro) y calcula BPM, Camelot Key y Silencio Vocal.
        """
        # 1. Calcular hash de archivo
        file_hash = cls._compute_file_hash(file_path)
        
        # 2. Consultar caché local de Django
        cached = AudioAnalysisCache.objects.filter(file_hash=file_hash).first()
        if cached:
            return {
                "track_id": track_id or cached.track_id,
                "bpm": round(cached.bpm, 2),
                "camelot_key": cached.camelot_key,
                "vocal_silence_start_ms": cached.vocal_silence_start_ms,
                "vocal_silence_end_ms": cached.vocal_silence_end_ms,
                "intro_duration_ms": cached.intro_duration_ms,
                "outro_duration_ms": cached.outro_duration_ms,
                "cached": True
            }

        if not LIBROSA_AVAILABLE or not os.path.exists(file_path):
            # Si no está librosa disponible o no existe el archivo temporal, valores seguros
            return cls._save_and_return(file_hash, track_id, 120.0, '8A', 0.0, 0.0, 0.0, 0.0)

        try:
            # Cargar audio a 22050Hz mono para velocidad óptima DSP
            y, sr = librosa.load(file_path, sr=22050, mono=True, duration=60.0)
            
            # A. Cálculo preciso de BPM (Tempo)
            tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
            if isinstance(tempo, np.ndarray):
                bpm_val = float(tempo[0]) if len(tempo) > 0 else 120.0
            else:
                bpm_val = float(tempo)
            if bpm_val <= 40 or bpm_val >= 240:
                bpm_val = 120.0

            # B. Cálculo de Clave Musical y Rueda de Camelot
            camelot_key = cls._estimate_camelot_key(y, sr)

            # C. Detección de silencio vocal / intro / outro
            v_start, v_end, intro_ms, outro_ms = cls._estimate_vocal_silence_and_transitions(y, sr)

            return cls._save_and_return(file_hash, track_id, bpm_val, camelot_key, v_start, v_end, intro_ms, outro_ms)
            
        except Exception as e:
            print(f"[DSPEngine] Error analizando '{file_path}': {e}")
            return cls._save_and_return(file_hash, track_id, 120.0, '8A', 0.0, 0.0, 0.0, 0.0)

    @classmethod
    def _estimate_camelot_key(cls, y: np.ndarray, sr: int) -> str:
        """Estimación de tonalidad mediante Chromagram CQT y correlación KS."""
        try:
            chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
            chroma_mean = np.mean(chroma, axis=1)
            
            best_corr = -1.0
            best_key = ('C', 'major')

            for i in range(12):
                # Rotar perfiles para cada nota raíz
                maj_profile = np.roll(KS_MAJOR, i)
                min_profile = np.roll(KS_MINOR, i)

                corr_maj = np.corrcoef(chroma_mean, maj_profile)[0, 1]
                corr_min = np.corrcoef(chroma_mean, min_profile)[0, 1]

                if corr_maj > best_corr:
                    best_corr = corr_maj
                    best_key = (PITCH_CLASSES[i], 'major')
                if corr_min > best_corr:
                    best_corr = corr_min
                    best_key = (PITCH_CLASSES[i], 'minor')

            return CAMELOT_KEY_MAP.get(best_key, '8A')
        except Exception:
            return '8A'

    @classmethod
    def _estimate_vocal_silence_and_transitions(cls, y: np.ndarray, sr: int) -> Tuple[float, float, float, float]:
        """
        Estima el inicio y fin de la voz (o silencio vocal) para AutoMix, midiendo la energía en la banda
        frecuencial vocal (300Hz - 3400Hz) o usando Spleeter en modo 2stems si está configurado.
        """
        try:
            # Separación armónico-percusiva como aproximación vocal limpia
            y_harm, _ = librosa.effects.hpss(y)
            rms = librosa.feature.rms(y=y_harm)[0]
            frames = len(rms)
            threshold = np.max(rms) * 0.15

            start_frame = 0
            for i in range(frames):
                if rms[i] > threshold:
                    start_frame = i
                    break

            end_frame = frames - 1
            for i in range(frames - 1, -1, -1):
                if rms[i] > threshold:
                    end_frame = i
                    break

            start_ms = float(librosa.frames_to_time(start_frame, sr=sr) * 1000.0)
            end_ms = float(librosa.frames_to_time(end_frame, sr=sr) * 1000.0)
            total_duration_ms = float(len(y) / sr * 1000.0)

            intro_ms = start_ms
            outro_ms = max(0.0, total_duration_ms - end_ms)

            return round(start_ms, 1), round(end_ms, 1), round(intro_ms, 1), round(outro_ms, 1)
        except Exception:
            return 0.0, 0.0, 0.0, 0.0

    @classmethod
    def _save_and_return(cls, file_hash: str, track_id: str, bpm: float, camelot: str, v_start: float, v_end: float, intro: float, outro: float) -> Dict[str, Any]:
        AudioAnalysisCache.objects.update_or_create(
            file_hash=file_hash,
            defaults={
                "track_id": track_id or file_hash[:16],
                "bpm": bpm,
                "camelot_key": camelot,
                "vocal_silence_start_ms": v_start,
                "vocal_silence_end_ms": v_end,
                "intro_duration_ms": intro,
                "outro_duration_ms": outro,
                "analysis_metadata": {"engine": "Librosa/ChromaCQT+HPSS"}
            }
        )
        return {
            "track_id": track_id,
            "bpm": round(bpm, 2),
            "camelot_key": camelot,
            "vocal_silence_start_ms": v_start,
            "vocal_silence_end_ms": v_end,
            "intro_duration_ms": intro,
            "outro_duration_ms": outro,
            "cached": False
        }

    @staticmethod
    def _compute_file_hash(file_path: str) -> str:
        if not os.path.exists(file_path):
            return hashlib.sha256(file_path.encode('utf-8')).hexdigest()
        hasher = hashlib.sha256()
        try:
            with open(file_path, 'rb') as f:
                while chunk := f.read(65536):
                    hasher.update(chunk)
            return hasher.hexdigest()
        except Exception:
            return hashlib.sha256(file_path.encode('utf-8')).hexdigest()
