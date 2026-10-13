'use strict';

// ============ CONFIG ============
const TMDB_API_KEY = '1865f43a0549ca50d341dd9ab8b29f49';
const EZTV_API = 'https://eztv.re/api/get-torrents';
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

// I-pad ang IMDb ID sa 7 digits (kailangan ng EZTV API)
function padImdbId(imdbId) {
  if (!imdbId) return '';
  const digits = String(imdbId).replace(/^tt/i, '').replace(/\D/g, '');
  return digits.padStart(7, '0');
}

// ============ MAIN: getStreams ============
function getStreams(mediaId, mediaType = 'movie', season = null, episode = null, userSettings = null) {
  return (async function () {
    // === TV SERIES ONLY ===
    if (mediaType !== 'tv' && mediaType !== 'series') {
      return [];
    }

    const settings = resolveSettings(userSettings);
    const seasonNum = parseInt(season) || 1;
    const episodeNum = parseInt(episode) || 1;

    try {
      // 1. TMDB → IMDb ID + title
      const tmdbUrl = 'https://api.themoviedb.org/3/tv/' + mediaId + '?api_key=' + TMDB_API_KEY + '&append_to_response=external_ids';
      const tmdb = await fetch(tmdbUrl).then(r => r.json()).catch(() => null);
      const rawImdbId = tmdb?.external_ids?.imdb_id || tmdb?.imdb_id || '';
      const title = tmdb?.name || tmdb?.original_name || 'Unknown';
      const imdbId = padImdbId(rawImdbId);

      if (!imdbId) return [];

      // 2. EZTV API call — gamit ang IMDb ID
      const url = EZTV_API + '?limit=100&imdb_id=' + imdbId;
      const data = await fetch(url, { headers: HEADERS }).then(r => r.json()).catch(() => null);

      if (!data?.torrents || !Array.isArray(data.torrents)) return [];

      // 3. Filter: 1080p + tamang season + tamang episode
      const seasonStr = String(seasonNum);
      const episodeStr = String(episodeNum);

      const results = [];

      for (const t of data.torrents) {
        if (!t || !t.hash || !t.filename) continue;

        // 1080p filter (strict)
        if (!/\b1080p\b/i.test(t.filename)) continue;

        // Season + Episode filter (strict)
        if (String(t.season) !== seasonStr) continue;
        if (String(t.episode) !== episodeStr) continue;

        const seeds = parseInt(t.seeds) || 0;
        const peers = parseInt(t.peers) || 0;
        const sizeBytes = parseInt(t.size_bytes) || 0;
        const sizeGB = (sizeBytes / 1073741824).toFixed(2);
        const magnet = t.magnet_url || buildMagnet(t.hash, t.filename);

        // Codec/audio detection mula sa filename
        const extras = [];
        if (/\bX265\b|\bH\.?265\b|\bHEVC\b/i.test(t.filename)) extras.push('X265');
        else if (/\bX264\b|\bH\.?264\b|\bAVC\b/i.test(t.filename)) extras.push('X264');
        if (/\bHDR10\+?\b/i.test(t.filename)) extras.push('HDR10');
        else if (/\bHDR\b/i.test(t.filename)) extras.push('HDR');
        if (/\bATMOS\b/i.test(t.filename)) extras.push('ATMOS');
        if (/\bDTS\b/i.test(t.filename)) extras.push('DTS');
        if (/\b5\.1\b/i.test(t.filename)) extras.push('5.1');

        const titleLine = '\uD83C\uDFA6 ' + title + ' S' + String(seasonNum).padStart(2, '0') + ' E' + String(episodeNum).padStart(2, '0');
        const qualityLine = '\uD83D\uDD25 ' + QUALITY_LABEL + (extras.length ? ' | ' + extras.join(' | ') : '');
        const statsLine = '\uD83C\uDF31 ' + seeds + ' | \uD83D\uDCBE ' + sizeGB + ' GB | \uD83D\uDD17 EZTV';
        const description = titleLine + '\n' + qualityLine + '\n' + statsLine;

        results.push({
          seeders: seeds,
          peers,
          sizeBytes,
          qualityRank: QUALITY_RANK,
          data: {
            name: 'EZTV | ' + QUALITY_LABEL.toUpperCase() + ' | \uD83C\uDF31 ' + seeds,
            title: description,
            size: description,
            description,
            url: magnet
          }
        });
      }

      if (!results.length) return [];

      // 4. Sort
      results.sort((a, b) => {
        if (settings.sortBy === 'size') return b.sizeBytes - a.sizeBytes;
        if (settings.sortBy === 'quality') {
          if (b.qualityRank !== a.qualityRank) return b.qualityRank - a.qualityRank;
          return b.seeders - a.seeders;
        }
        return b.seeders - a.seeders;
      });

      // 5. Apply inverted sort tag
      return results.map(r => {
        let sortTag;
        if (settings.sortBy === 'size') sortTag = getInvertedSortTag(Math.floor(r.sizeBytes / 1073741824));
        else if (settings.sortBy === 'quality') sortTag = getInvertedSortTag(r.qualityRank * 10000 + r.seeders);
        else sortTag = getInvertedSortTag(r.seeders);
        return {
          ...r.data,
          name: sortTag + r.data.name
        };
      });

    } catch (err) {
      console.error('[' + DEFAULT_PROVIDER + '] Execution error:', err);
      return [];
    }
  })();
}

// ============ SETTINGS ============
function onSettings() {
  return (async function () {
    return [
      { type: 'header', label: 'EZTV — TV Series Only' },
      {
        type: 'select',
        key: 'debridProvider',
        label: 'Debrid provider',
        options: [
          { label: 'None', value: 'none' },
          { label: 'TorBox — recommended', value: 'torbox' },
          { label: 'Torrin', value: 'torrin' },
          { label: 'AllDebrid', value: 'alldebrid' },
          { label: 'Premiumize', value: 'premiumize' },
          { label: 'RealDebrid', value: 'realdebrid' }
        ],
        default: 'none'
      },
      {
        type: 'password',
        isPassword: true,
        key: 'debridKey',
        label: 'Debrid API key',
        placeholder: 'Paste your provider API key',
        description: 'Free. Your key is encrypted on server — it never travels in clear.'
      },
      { type: 'header', label: 'Basics' },
      {
        type: 'select',
        key: 'language',
        label: 'Preferred Language',
        description: 'Streams in your language appear first with \u2B50\uFE0F',
        options: [
          { label: 'Any', value: 'any' },
          { label: '\uD83C\uDDEC\uD83C\uDDE7 English', value: 'en' },
          { label: '\uD83C\uDDFA\uD83C\uDDF8 English (US)', value: 'en-us' },
          { label: '\uD83C\uDDEC\uD83C\uDDE7 English (UK)', value: 'en-uk' },
          { label: '\uD83C\uDDEA\uD83C\uDDF8 Español', value: 'es' },
          { label: '\uD83C\uDDEA\uD83C\uDDF8 Español (España)', value: 'es-es' },
          { label: '\uD83C\uDDEA\uD83C\uDDF8 Español (LatAm)', value: 'es-la' },
          { label: '\uD83C\uDDEB\uD83C\uDDF7 Français', value: 'fr' },
          { label: '\uD83C\uDDEB\uD83C\uDDF7 Français (France)', value: 'fr-fr' },
          { label: '\uD83C\uDDEB\uD83C\uDDF7 Français (Canada)', value: 'fr-ca' },
          { label: '\uD83C\uDDF5\uD83C\uDDF9 Português', value: 'pt' },
          { label: '\uD83C\uDDE7\uD83C\uDDF7 Português (Brasil)', value: 'pt-br' },
          { label: '\uD83C\uDDF5\uD83C\uDDF9 Português (Portugal)', value: 'pt-pt' },
          { label: '\uD83C\uDDE9\uD83C\uDDEA Deutsch', value: 'de' },
          { label: '\uD83C\uDDEE\uD83C\uDDF9 Italiano', value: 'it' },
          { label: '\uD83C\uDDF7\uD83C\uDDFA Русский', value: 'ru' },
          { label: '\uD83C\uDDEF\uD83C\uDDF5 日本語', value: 'ja' },
          { label: '\uD83C\uDDF0\uD83C\uDDF7 한국어', value: 'ko' },
          { label: '\uD83C\uDDE8\uD83C\uDDF3 中文', value: 'zh' },
          { label: '\uD83C\uDDF8\uD83C\uDDE6 العربية', value: 'ar' },
          { label: '\uD83C\uDDEE\uD83C\uDDF3 हिन्दी', value: 'hi' },
          { label: '\uD83C\uDDF3\uD83C\uDDF1 Nederlands', value: 'nl' },
          { label: '\uD83C\uDDF5\uD83C\uDDF1 Polski', value: 'pl' },
          { label: '\uD83C\uDDF9\uD83C\uDDF7 Türkçe', value: 'tr' },
          { label: '\uD83C\uDDF8\uD83C\uDDEA Svenska', value: 'sv' }
        ],
        default: 'any'
      },
      {
        type: 'select',
        key: 'sortBy',
        label: 'Sort results by',
        options: [
          { label: 'Seeders', value: 'seeders' },
          { label: 'Quality', value: 'quality' },
          { label: 'Size', value: 'size' }
        ],
        default: 'seeders'
      }
    ];
  })();
}

module.exports = { getStreams, onSettings };