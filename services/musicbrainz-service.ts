export interface MusicBrainzResult {
  id: string;
  title: string;
  artist: string;
  album: string;
  score: number;
}

export interface ArtistSocialLink {
  label: string;
  url: string;
}

export interface ArtistProfile {
  id: string;
  name: string;
  type?: string;
  country?: string;
  area?: string;
  begin?: string;
  end?: string;
  disambiguation?: string;
  tags: string[];
  socialLinks: ArtistSocialLink[];
  musicBrainzUrl: string;
}

const MUSICBRAINZ_HEADERS = {
  'User-Agent': 'MillaMusicPlayer/1.0.0 (contact@milla.app)',
  Accept: 'application/json',
};

const artistProfileCache = new Map<string, ArtistProfile | null>();
let lastRequestAt = 0;
let requestChain = Promise.resolve();

async function musicBrainzFetch(url: string): Promise<Response> {
  const run = async () => {
    const waitMs = Math.max(0, 1050 - (Date.now() - lastRequestAt));
    if (waitMs) await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    lastRequestAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      return await fetch(url, { headers: MUSICBRAINZ_HEADERS, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  };
  const responsePromise = requestChain.then(run, run);
  requestChain = responsePromise.then(() => undefined, () => undefined);
  return responsePromise;
}

export const searchRecording = async (query: string): Promise<MusicBrainzResult | null> => {
  try {
    const encodedQuery = encodeURIComponent(query);
    const response = await musicBrainzFetch(
      `https://musicbrainz.org/ws/2/recording?query=${encodedQuery}&fmt=json&limit=5`
    );
    if (!response.ok) return null;
    const data = await response.json();
    const bestMatch = data.recordings?.[0];
    if (!bestMatch) return null;
    return {
      id: bestMatch.id,
      title: bestMatch.title,
      artist: bestMatch['artist-credit']?.[0]?.name || 'Desconocido',
      album: bestMatch.releases?.[0]?.title || 'Sencillo/Desconocido',
      score: Number(bestMatch.score || 0),
    };
  } catch (error) {
    console.warn('[MusicBrainz] Error buscando grabacion:', error);
    return null;
  }
};

function linkLabel(url: string, relationType?: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const known: Record<string, string> = {
      'instagram.com': 'Instagram',
      'facebook.com': 'Facebook',
      'x.com': 'X',
      'twitter.com': 'X',
      'youtube.com': 'YouTube',
      'youtu.be': 'YouTube',
      'tiktok.com': 'TikTok',
      'soundcloud.com': 'SoundCloud',
      'bandcamp.com': 'Bandcamp',
      'spotify.com': 'Spotify',
      'music.apple.com': 'Apple Music',
      'wikidata.org': 'Wikidata',
      'wikipedia.org': 'Wikipedia',
    };
    const match = Object.entries(known).find(([domain]) => host === domain || host.endsWith(`.${domain}`));
    return match?.[1] || relationType || host;
  } catch {
    return relationType || 'Sitio web';
  }
}

export const getArtistProfile = async (artistName: string): Promise<ArtistProfile | null> => {
  const cacheKey = artistName.trim().toLocaleLowerCase('es');
  if (!cacheKey || cacheKey.includes('desconocido') || cacheKey.includes('unknown')) return null;
  if (artistProfileCache.has(cacheKey)) return artistProfileCache.get(cacheKey) ?? null;

  try {
    const escapedName = artistName.replace(/([+\-&|!(){}\[\]^"~*?:\\/])/g, '\\$1');
    const query = encodeURIComponent(`artist:"${escapedName}"`);
    const searchResponse = await musicBrainzFetch(
      `https://musicbrainz.org/ws/2/artist?query=${query}&fmt=json&limit=3`
    );
    if (!searchResponse.ok) throw new Error(`HTTP_${searchResponse.status}`);
    const searchData = await searchResponse.json();
    const best = searchData.artists?.[0];
    if (!best || Number(best.score || 0) < 75) {
      artistProfileCache.set(cacheKey, null);
      return null;
    }

    const lookupResponse = await musicBrainzFetch(
      `https://musicbrainz.org/ws/2/artist/${best.id}?inc=url-rels+tags&fmt=json`
    );
    const details = lookupResponse.ok ? await lookupResponse.json() : best;
    const seenUrls = new Set<string>();
    const socialLinks: ArtistSocialLink[] = (details.relations || [])
      .map((relation: any) => ({
        label: linkLabel(relation?.url?.resource || '', relation?.type),
        url: String(relation?.url?.resource || ''),
      }))
      .filter((link: ArtistSocialLink) => {
        if (!link.url.startsWith('http') || seenUrls.has(link.url)) return false;
        seenUrls.add(link.url);
        return true;
      })
      .slice(0, 8);

    const profile: ArtistProfile = {
      id: best.id,
      name: details.name || best.name || artistName,
      type: details.type || best.type,
      country: details.country || best.country,
      area: details.area?.name || best.area?.name,
      begin: details['life-span']?.begin || best['life-span']?.begin,
      end: details['life-span']?.end || best['life-span']?.end,
      disambiguation: details.disambiguation || best.disambiguation,
      tags: (details.tags || [])
        .sort((a: any, b: any) => Number(b.count || 0) - Number(a.count || 0))
        .slice(0, 6)
        .map((tag: any) => String(tag.name)),
      socialLinks,
      musicBrainzUrl: `https://musicbrainz.org/artist/${best.id}`,
    };
    artistProfileCache.set(cacheKey, profile);
    return profile;
  } catch (error) {
    console.warn('[MusicBrainz] No se pudo cargar el perfil del artista:', error);
    return null;
  }
};
