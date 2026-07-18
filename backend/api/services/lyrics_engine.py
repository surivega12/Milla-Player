"""
Punto 2.2: Motor y API de Letras Sincronizadas (Reemplazo de am-lyrics).

Consulta servicios de letras abiertas (LRCLIB / LyricsPlus), transforma y parsea el formato LRC
a estructuras JSON optimizadas para el lector de React Native Reanimated, y lo cachea en la base de datos.
"""
import re
import requests
import unicodedata
from difflib import SequenceMatcher
from typing import Dict, Any, List, Optional
from ..models import LyricsCache


class LyricsEngine:
    LRCLIB_SEARCH_URL = "https://lrclib.net/api/search"
    LRCLIB_GET_URL = "https://lrclib.net/api/get"
    USER_AGENT = "VertexMusicEngine/2.0.0 ( contact@milla.app )"

    @staticmethod
    def _normalize_match_value(value: Any) -> str:
        normalized = unicodedata.normalize('NFKD', str(value or '')).encode('ascii', 'ignore').decode('ascii')
        return re.sub(r'[^a-z0-9]+', ' ', normalized.lower()).strip()

    @classmethod
    def _score_search_result(
        cls,
        result: Dict[str, Any],
        title: str,
        artist: str,
        album: str,
        duration: float,
    ) -> float:
        requested_title = cls._normalize_match_value(title)
        requested_artist = cls._normalize_match_value(artist)
        candidate_title = cls._normalize_match_value(result.get('trackName'))
        candidate_artist = cls._normalize_match_value(result.get('artistName'))
        if not requested_title or not requested_artist or not candidate_title or not candidate_artist:
            return -1.0

        title_ratio = SequenceMatcher(None, requested_title, candidate_title).ratio()
        artist_ratio = SequenceMatcher(None, requested_artist, candidate_artist).ratio()
        if title_ratio < 0.52 or artist_ratio < 0.45:
            return -1.0

        score = title_ratio * 55.0 + artist_ratio * 30.0
        if album and result.get('albumName'):
            score += SequenceMatcher(
                None,
                cls._normalize_match_value(album),
                cls._normalize_match_value(result.get('albumName')),
            ).ratio() * 7.0
        try:
            candidate_duration = float(result.get('duration') or 0.0)
            if duration > 0 and candidate_duration > 0:
                difference = abs(duration - candidate_duration)
                score += 12.0 if difference <= 2.0 else 7.0 if difference <= 5.0 else -12.0 if difference > 15.0 else 0.0
        except (TypeError, ValueError):
            pass
        if result.get('syncedLyrics'):
            score += 6.0
        return score

    @classmethod
    def get_or_fetch_lyrics(cls, track_id: str, title: str, artist: str, album: str = "", duration: float = 0.0) -> Dict[str, Any]:
        """
        Obtiene letras desde caché local o consulta proveedores externos si no existen.
        """
        query_hash = LyricsCache.generate_hash(artist, title)
        
        # 1. Intentar buscar en caché local (PostgreSQL / SQLite)
        cached = LyricsCache.objects.filter(query_hash=query_hash).first()
        if cached and (cached.lyrics_lrc or cached.lyrics_json):
            return {
                "track_id": track_id or cached.track_id,
                "title": cached.title,
                "artist": cached.artist,
                "album": cached.album,
                "lyrics_lrc": cached.lyrics_lrc,
                "lyrics_json": cached.lyrics_json,
                "source": f"{cached.source}_cached",
                "cached": True
            }

        # 2. Consultar LRCLIB / LyricsPlus en vivo
        headers = {"User-Agent": cls.USER_AGENT}
        lrc_content = ""
        source_used = "lrclib"

        try:
            # Primero intento GET por coincidencia exacta si tenemos duración
            if duration > 0 and album:
                params = {
                    "track_name": title,
                    "artist_name": artist,
                    "album_name": album,
                    "duration": int(duration)
                }
                resp = requests.get(cls.LRCLIB_GET_URL, params=params, headers=headers, timeout=5)
                if resp.status_code == 200:
                    data = resp.json()
                    lrc_content = data.get("syncedLyrics") or data.get("plainLyrics") or ""
            
            # Si no hubo coincidencia exacta, hacer búsqueda abierta
            if not lrc_content:
                search_query = f"{artist} {title}".strip()
                resp = requests.get(cls.LRCLIB_SEARCH_URL, params={"q": search_query}, headers=headers, timeout=5)
                if resp.status_code == 200:
                    results = resp.json()
                    if isinstance(results, list) and len(results) > 0:
                        ranked_results = sorted(
                            (
                                (cls._score_search_result(result, title, artist, album, duration), result)
                                for result in results
                            ),
                            key=lambda item: item[0],
                            reverse=True,
                        )
                        if ranked_results and ranked_results[0][0] >= 48.0:
                            best_match = ranked_results[0][1]
                            lrc_content = best_match.get("syncedLyrics") or best_match.get("plainLyrics") or ""
        except Exception as e:
            # Fallback tolerante a fallos de red
            print(f"[LyricsEngine] Error consultando servicio externo para '{title} - {artist}': {e}")
            lrc_content = ""

        # 3. Parsear texto LRC a JSON array de líneas y milisegundos
        parsed_json = cls.parse_lrc_to_json(lrc_content)

        # 4. Guardar en caché local de Django
        if not cached:
            cached = LyricsCache.objects.create(
                query_hash=query_hash,
                track_id=track_id or query_hash[:16],
                title=title,
                artist=artist,
                album=album,
                lyrics_lrc=lrc_content,
                lyrics_json=parsed_json,
                source=source_used
            )
        else:
            cached.lyrics_lrc = lrc_content
            cached.lyrics_json = parsed_json
            cached.source = source_used
            cached.save()

        return {
            "track_id": track_id or cached.track_id,
            "title": title,
            "artist": artist,
            "album": album,
            "lyrics_lrc": lrc_content,
            "lyrics_json": parsed_json,
            "source": source_used,
            "cached": False
        }

    @staticmethod
    def parse_lrc_to_json(lrc_text: str) -> List[Dict[str, Any]]:
        """
        Convierte texto formato .LRC con marcas temporales ([MM:SS.cs] Verso)
        a una lista estructurada: [{"time": 12.34, "text": "Verso..."}]
        """
        if not lrc_text or not isinstance(lrc_text, str):
            return []

        lines: List[Dict[str, Any]] = []
        # Regex para [mm:ss.cs] o [mm:ss:cs]
        pattern = re.compile(r'\[(\d{1,2}):(\d{2})[\.:](\d{2,3})\](.*)')

        for raw_line in lrc_text.splitlines():
            line = raw_line.strip()
            match = pattern.match(line)
            if match:
                minutes = int(match.group(1))
                seconds = int(match.group(2))
                millis = match.group(3)
                if len(millis) == 2:
                    millis_sec = int(millis) / 100.0
                else:
                    millis_sec = int(millis) / 1000.0

                time_sec = (minutes * 60) + seconds + millis_sec
                text_content = match.group(4).strip()
                if text_content:
                    lines.append({
                        "time": round(time_sec, 3),
                        "text": text_content
                    })

        lines.sort(key=lambda x: x["time"])
        return lines
