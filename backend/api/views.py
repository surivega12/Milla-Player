import os
import tempfile
import uuid
from pathlib import Path
from django.utils.text import get_valid_filename
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .services.lyrics_engine import LyricsEngine
from .services.dsp_engine import DSPEngine
from .models import AudioAnalysisCache

MAX_BATCH_TRACKS = 50
MAX_DSP_UPLOAD_BYTES = int(os.environ.get('DSP_MAX_UPLOAD_BYTES', str(750 * 1024 * 1024)))
SUPPORTED_AUDIO_SUFFIXES = {'.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.mp4', '.dsf', '.dff'}


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
            if len(tracks) > MAX_BATCH_TRACKS:
                return Response(
                    {"error": f"El lote no puede superar {MAX_BATCH_TRACKS} pistas."},
                    status=status.HTTP_400_BAD_REQUEST
                )
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
                    res["success"] = bool(res.get("lyrics_lrc") or res.get("lyrics_json"))
                    if not res["success"]:
                        res["reason"] = "Lyrics not found"
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

        return Response(
            DSPEngine._cached_payload(cached, track_id),
            status=status.HTTP_200_OK
        )

    def post(self, request, *args, **kwargs):
        tracks = request.data.get('tracks')
        if isinstance(tracks, list):
            if len(tracks) > MAX_BATCH_TRACKS:
                return Response(
                    {"error": f"El lote no puede superar {MAX_BATCH_TRACKS} pistas."},
                    status=status.HTTP_400_BAD_REQUEST
                )
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
                    results.append(DSPEngine._cached_payload(cached, track_id))
                else:
                    # Sin audio real no se inventan valores: el cliente debe subir un archivo para analizarlo.
                    results.append({
                        "track_id": track_id,
                        "cached": False,
                        "success": False,
                        "reason": "AUDIO_REQUIRED"
                    })
            return Response({"results": results}, status=status.HTTP_200_OK)

        track_id = str(request.data.get('track_id', 'unknown_track'))[:255]
        audio_file = request.FILES.get('audio_file')

        if not audio_file:
            return Response(
                {"error": "Debe enviar un archivo o fragmento de audio bajo la clave 'audio_file' o un arreglo 'tracks'."},
                status=status.HTTP_400_BAD_REQUEST
            )

        if audio_file.size > MAX_DSP_UPLOAD_BYTES:
            return Response(
                {"error": "El archivo de audio supera el limite permitido para analisis."},
                status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
            )

        # El nombre enviado por el cliente nunca se usa como ruta. Conservamos sólo una extensión
        # validada y un nombre seguro para evitar path traversal en el directorio temporal.
        safe_track_id = get_valid_filename(str(track_id))[:100] or 'unknown_track'
        safe_filename = get_valid_filename(Path(audio_file.name).name)[:120] or 'audio.mp3'
        suffix = Path(safe_filename).suffix.lower() or '.mp3'
        if suffix not in SUPPORTED_AUDIO_SUFFIXES:
            return Response(
                {"error": "Formato de audio no compatible."},
                status=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE
            )
        temp_dir = os.path.join(tempfile.gettempdir(), 'vertex_dsp_uploads')
        os.makedirs(temp_dir, exist_ok=True)
        temp_path = os.path.join(temp_dir, f"upload_{safe_track_id}_{uuid.uuid4().hex}{suffix}")

        try:
            with open(temp_path, 'wb+') as dest:
                for chunk in audio_file.chunks():
                    dest.write(chunk)

            # Analizar el archivo temporal con DSPEngine
            result = DSPEngine.analyze_fragment(temp_path, track_id=track_id)

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
