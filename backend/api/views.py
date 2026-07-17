import os
import tempfile
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .services.lyrics_engine import LyricsEngine
from .services.dsp_engine import DSPEngine
from .models import LyricsCache, AudioAnalysisCache
from .serializers import LyricsCacheSerializer, AudioAnalysisSerializer


class LyricsEndpointView(APIView):
    """
    Punto 2.2: API de Letras Sincronizadas (/api/lyrics/).
    
    Admite GET individual o POST por lote (batch) para el Worker de Sincronización:
    - POST body: { "tracks": [ { "track_id": "1", "title": "Song", "artist": "Artist", "album": "..." }, ... ] }
    Devuelve JSON estructurado con resultados listos para cachearse en SQLite del celular.
    """
    def get(self, request, *args, **kwargs):
        title = request.query_params.get('title', '').strip()
        artist = request.query_params.get('artist', '').strip()
        album = request.query_params.get('album', '').strip()
        track_id = request.query_params.get('track_id', '').strip()
        
        try:
            duration = float(request.query_params.get('duration', 0.0))
        except (ValueError, TypeError):
            duration = 0.0

        if not title or not artist:
            return Response(
                {"error": "Los parámetros 'title' y 'artist' son obligatorios."},
                status=status.HTTP_400_BAD_REQUEST
            )

        result = LyricsEngine.get_or_fetch_lyrics(
            track_id=track_id,
            title=title,
            artist=artist,
            album=album,
            duration=duration
        )

        return Response(result, status=status.HTTP_200_OK)

    def post(self, request, *args, **kwargs):
        tracks = request.data.get('tracks')
        if isinstance(tracks, list):
            results = []
            for t in tracks:
                title = (t.get('title') or '').strip()
                artist = (t.get('artist') or '').strip()
                album = (t.get('album') or '').strip()
                track_id = str(t.get('track_id') or t.get('id') or '')
                try:
                    duration = float(t.get('duration', 0.0))
                except (ValueError, TypeError):
                    duration = 0.0

                if not title or not artist or artist.lower() == 'unknown':
                    results.append({"track_id": track_id, "success": False, "reason": "Missing metadata"})
                    continue

                try:
                    res = LyricsEngine.get_or_fetch_lyrics(track_id, title, artist, album, duration)
                    res["success"] = True
                    results.append(res)
                except Exception as e:
                    results.append({"track_id": track_id, "success": False, "error": str(e)})
            return Response({"results": results}, status=status.HTTP_200_OK)

        # Fallback para un solo objeto POST
        title = request.data.get('title', '').strip()
        artist = request.data.get('artist', '').strip()
        if not title or not artist:
            return Response({"error": "Formato inválido. Envíe { tracks: [...] } o { title, artist }."}, status=status.HTTP_400_BAD_REQUEST)
        res = LyricsEngine.get_or_fetch_lyrics(str(request.data.get('track_id', '')), title, artist, request.data.get('album', ''))
        return Response(res, status=status.HTTP_200_OK)


class AudioDSPAnalyzeView(APIView):
    """
    Punto 2.3: Motor DSP para AutoMix (/api/analyze/).
    
    Admite POST por lote (batch) para consultar o calcular estimaciones acústicas:
    - POST body: { "tracks": [ { "track_id": "1", "bpm": 124, "camelot_key": "8A" }, ... ] }
    O POST multipart/form-data con un archivo de audio ('audio_file').
    """
    def get(self, request, *args, **kwargs):
        track_id = request.query_params.get('track_id', '').strip()
        file_hash = request.query_params.get('file_hash', '').strip()

        if not track_id and not file_hash:
            return Response(
                {"error": "Especifique 'track_id' o 'file_hash' para buscar en caché de análisis."},
                status=status.HTTP_400_BAD_REQUEST
            )

        if file_hash:
            cached = AudioAnalysisCache.objects.filter(file_hash=file_hash).first()
        else:
            cached = AudioAnalysisCache.objects.filter(track_id=track_id).first()

        if not cached:
            return Response(
                {"error": "Análisis no encontrado en caché.", "cached": False},
                status=status.HTTP_404_NOT_FOUND
            )

        serializer = AudioAnalysisSerializer(cached)
        data = serializer.data
        data["cached"] = True
        return Response(data, status=status.HTTP_200_OK)

    def post(self, request, *args, **kwargs):
        tracks = request.data.get('tracks')
        if isinstance(tracks, list):
            results = []
            for t in tracks:
                track_id = str(t.get('track_id') or t.get('id') or '')
                file_hash = str(t.get('file_hash') or '')
                cached = None
                if file_hash:
                    cached = AudioAnalysisCache.objects.filter(file_hash=file_hash).first()
                if not cached and track_id:
                    cached = AudioAnalysisCache.objects.filter(track_id=track_id).first()

                if cached:
                    results.append({
                        "track_id": track_id or cached.track_id,
                        "bpm": round(cached.bpm, 2),
                        "camelot_key": cached.camelot_key,
                        "vocal_silence_start_ms": cached.vocal_silence_start_ms,
                        "vocal_silence_end_ms": cached.vocal_silence_end_ms,
                        "intro_duration_ms": cached.intro_duration_ms,
                        "outro_duration_ms": cached.outro_duration_ms,
                        "cached": True,
                        "success": True
                    })
                else:
                    # Si no está cacheado en servidor, estimamos BPM heurístico o por defecto audiófilo
                    fallback_bpm = float(t.get('bpm') or 120.0)
                    fallback_key = str(t.get('camelot_key') or '8A')
                    results.append({
                        "track_id": track_id,
                        "bpm": fallback_bpm,
                        "camelot_key": fallback_key,
                        "vocal_silence_start_ms": 0.0,
                        "vocal_silence_end_ms": 0.0,
                        "intro_duration_ms": 0.0,
                        "outro_duration_ms": 0.0,
                        "cached": False,
                        "success": True
                    })
            return Response({"results": results}, status=status.HTTP_200_OK)

        track_id = request.data.get('track_id', 'unknown_track')
        audio_file = request.FILES.get('audio_file')

        if not audio_file:
            return Response(
                {"error": "Debe enviar un archivo o fragmento de audio bajo la clave 'audio_file' o un arreglo 'tracks'."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Guardar en archivo temporal seguro para que Librosa lo procese
        suffix = os.path.splitext(audio_file.name)[1] or '.mp3'
        temp_dir = os.path.join(tempfile.gettempdir(), 'vertex_dsp_uploads')
        os.makedirs(temp_dir, exist_ok=True)
        temp_path = os.path.join(temp_dir, f"upload_{track_id}_{audio_file.name}")

        try:
            with open(temp_path, 'wb+') as dest:
                for chunk in audio_file.chunks():
                    dest.write(chunk)

            # Analizar el archivo temporal con DSPEngine
            result = DSPEngine.analyze_fragment(temp_path, track_id=str(track_id))

            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except Exception:
                    pass

            return Response(result, status=status.HTTP_200_OK)

        except Exception as e:
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except Exception:
                    pass
            return Response(
                {"error": f"Error durante el análisis DSP: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
