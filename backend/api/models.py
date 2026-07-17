import hashlib
from django.db import models


class LyricsCache(models.Model):
    """
    Punto 2.2: Caché de Letras Sincronizadas (.LRC y JSON).
    Evita consultas repetidas a LyricsPlus / LRCLIB guardando de forma permanente en PostgreSQL/SQLite.
    """
    query_hash = models.CharField(max_length=64, unique=True, db_index=True)
    track_id = models.CharField(max_length=255, db_index=True)
    title = models.CharField(max_length=255)
    artist = models.CharField(max_length=255)
    album = models.CharField(max_length=255, null=True, blank=True)
    lyrics_lrc = models.TextField(blank=True, default='')
    lyrics_json = models.JSONField(default=list)
    source = models.CharField(max_length=100, default='lrclib_synced')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'api_lyrics_cache'
        ordering = ['-updated_at']

    def __str__(self):
        return f"{self.artist} - {self.title} ({self.source})"

    @staticmethod
    def generate_hash(artist: str, title: str) -> str:
        clean_artist = (artist or '').strip().lower()
        clean_title = (title or '').strip().lower()
        key_str = f"{clean_artist}|{clean_title}"
        return hashlib.sha256(key_str.encode('utf-8')).hexdigest()


class AudioAnalysisCache(models.Model):
    """
    Punto 2.3: Caché del Motor DSP para AutoMix (Librosa BPM/Key y Spleeter Silencio Vocal).
    Almacena los cálculos espectrales complejos hechos sobre fragmentos de intro/outro de 30 segundos.
    """
    file_hash = models.CharField(max_length=64, unique=True, db_index=True)
    track_id = models.CharField(max_length=255, db_index=True)
    bpm = models.FloatField(default=120.0)
    camelot_key = models.CharField(max_length=10, default='8A')
    
    # Análisis vocales (Spleeter / Librosa Energy Spectral Threshold)
    vocal_silence_start_ms = models.FloatField(default=0.0)
    vocal_silence_end_ms = models.FloatField(default=0.0)
    intro_duration_ms = models.FloatField(default=0.0)
    outro_duration_ms = models.FloatField(default=0.0)
    
    analysis_metadata = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'api_audio_analysis_cache'
        ordering = ['-created_at']

    def __str__(self):
        return f"DSP Analysis {self.track_id}: {self.bpm} BPM [{self.camelot_key}]"
