from rest_framework import serializers
from .models import LyricsCache, AudioAnalysisCache


class LyricsCacheSerializer(serializers.ModelSerializer):
    class Meta:
        model = LyricsCache
        fields = [
            'track_id',
            'title',
            'artist',
            'album',
            'lyrics_lrc',
            'lyrics_json',
            'source',
            'updated_at'
        ]


class AudioAnalysisSerializer(serializers.ModelSerializer):
    class Meta:
        model = AudioAnalysisCache
        fields = [
            'track_id',
            'bpm',
            'camelot_key',
            'vocal_silence_start_ms',
            'vocal_silence_end_ms',
            'intro_duration_ms',
            'outro_duration_ms',
            'analysis_metadata',
            'created_at'
        ]
