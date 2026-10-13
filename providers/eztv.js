'use strict';

// ============ CONFIG ============
const TMDB_API_KEY = '1865f43a0549ca50d341dd9ab8b29f49';
const EZTV_API = 'https://eztvx.to/api/get-torrents';
const DEFAULT_PROVIDER = 'EZTV';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  'Accept': 'application/json'
};

const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://exodus.desync.com:6969/announce'
];

// ============ TARGET QUALITY ============
const TARGET_QUALITY = '1080p';
const QUALITY_RANK = 3;
const QUALITY_LABEL = '1080p';
// ========================================

// ============ HELPERS ============
function resolveSettings(userSettings) {
  let settings = {
    debridProvider: 'none',
    debridKey: '',
    language: 'any',
    minQuality: TARGET_QUALITY,
    sortBy: 'seeders'
  };
  try {
    let src = userSettings;
    if (!src && typeof globalThis !== 'undefined') src = globalThis.SCRAPER_SETTINGS || globalThis.SETTINGS || globalThis.settings;
    if (!src && typeof global !== 'undefined') src = global.SCRAPER_SETTINGS || global.SETTINGS || global.settings;
    if (!src && typeof window !== 'undefined') src = window.SCRAPER_SETTINGS || window.SETTINGS || window.settings;
    if (src) {
      if (src.debridProvider) settings.debridProvider = String(src.debridProvider).toLowerCase().trim();
      if (src.debridKey) settings.debridKey = String(src.debridKey).trim();
      if (src.language) settings.language = String(src.language).trim();
      if (src.minQuality) settings.minQuality = String(src.minQuality).trim();
      if (src.sortBy) settings.sortBy = String(src.sortBy).trim();
    }
  } catch (e) {
    console.error('[' + DEFAULT_PROVIDER + '] settings error:', e);
  }
  return settings;
}

function buildMagnet(hash, name) {
  if (!hash) return '';
  const trackers = TRACKERS.map(t => '&tr=' + encodeURIComponent(t)).join('');
  const dn = name ? '&dn=' + encodeURIComponent(name) : '';
  return 'magnet:?xt=urn:btih:' + hash + dn + trackers;
}

function getInvertedSortTag(num, max) {
  max = max || 999999;
  const n = Math.max(0, parseInt(num, 10) || 0);
  const inverted = Math.max(0, max - n);
  const bin = inverted.toString(2).padStart(20, '0');
  return bin.split('').map(b => b === '1' ? '\uFEFF' : '\u200B').join('');
}

function normalizeImdbId(imdbId) {
  if (!imdbId) return '';
  return String(imdbId).replace(/^tt/i, '').replace(/\D/g, '');
}

// ============ MAIN: getStreams (TEST VERSION) ============
function getStreams(mediaId, mediaType = 'movie', season = null, episode = null, userSettings = null) {
  return (async function () {
    // === STEP 0: CHECK ENVIRONMENT ===
    const fetchType = typeof fetch;
    const hasXHR = typeof XMLHttpRequest !== 'undefined';
    const hasRequire = typeof require !== 'undefined';
    const envInfo = 'fetch=' + fetchType + ' | XHR=' + hasXHR + ' | require=' + hasRequire;

    // Kung hindi TV, ibalik agad ang test result
    if (mediaType !== 'tv' && mediaType !== 'series') {
      return [{
        name: 'TEST | Not TV',
        title: 'mediaType=' + mediaType + '\n' + envInfo,
        url: 'magnet:?xt=urn:btih:0000000000000000000000000000000000000000'
      }];
    }

    // === TEST 1: TMDB ===
    let tmdbInfo = 'TMDB: not called';
    let imdbId = '';
    let title = 'Unknown';

    try {
      const tmdbUrl = 'https://api.themoviedb.org/3/tv/' + mediaId + '?api_key=' + TMDB_API_KEY + '&append_to_response=external_ids';
      const tmdbRes = await fetch(tmdbUrl);
      const tmdb = await tmdbRes.json();
      title = tmdb?.name || 'Unknown';
      imdbId = normalizeImdbId(tmdb?.external_ids?.imdb_id || '');
      tmdbInfo = 'TMDB: ' + title + ' | IMDb: ' + (imdbId || 'NONE');
    } catch (e) {
      tmdbInfo = 'TMDB ERROR: ' + (e?.message || String(e));
    }

    if (!imdbId) {
      return [{
        name: 'TEST | No IMDb',
        title: tmdbInfo + '\n' + envInfo,
        url: 'magnet:?xt=urn:btih:0000000000000000000000000000000000000000'
      }];
    }

    // === TEST 2: EZTV ===
    let eztvInfo = 'EZTV: not called';
    let torrentCount = 0;
    let matchCount = 0;

    try {
      const eztvUrl = EZTV_API + '?imdb_id=' + imdbId + '&limit=100';
      const eztvRes = await fetch(eztvUrl, { headers: HEADERS });
      const eztvData = await eztvRes.json();
      torrentCount = eztvData?.torrents?.length || 0;

      // Bilangin ang 1080p matches para sa target season/episode
      const seasonStr = String(parseInt(season) || 1);
      const episodeStr = String(parseInt(episode) || 1);
      if (Array.isArray(eztvData?.torrents)) {
        for (const t of eztvData.torrents) {
          if (!t?.filename) continue;
          if (!/\b1080p\b/i.test(t.filename)) continue;
          if (String(t.season) !== seasonStr) continue;
          if (String(t.episode) !== episodeStr) continue;
          matchCount++;
        }
      }
      eztvInfo = 'EZTV: ' + torrentCount + ' total | ' + matchCount + ' matched S' + seasonStr + 'E' + episodeStr;
    } catch (e) {
      eztvInfo = 'EZTV ERROR: ' + (e?.message || String(e));
    }

    // === TEST 3: RETURN TEST STREAM ===
    return [{
      name: 'TEST | EZTV | 1080p',
      title: tmdbInfo + '\n' + eztvInfo + '\n' + envInfo,
      url: 'magnet:?xt=urn:btih:0000000000000000000000000000000000000000'
    }];

  })();
}

// ============ SETTINGS ============
function onSettings() {
  return (async function () {
    return [
      { type: 'header', label: 'EZTV — TV Series Only (TEST)' }
    ];
  })();
}

module.exports = { getStreams, onSettings };