'use strict';

// ============ CONFIG ============
const TMDB_API_KEY = '1865f43a0549ca50d341dd9ab8b29f49';
const PIRATEBAY_API = 'https://apibay.org';
const DEFAULT_PROVIDER = 'ThePirateBay';

const KNOWN_PROVIDERS = ['YTS','EZTV','RARBG','Torrentio','Bitmagnet','Prowlarr','1337x','ThePirateBay','KickassTorrents','Torlock','Zooqle','Torrentz2','BitSearch','LimeTorrents'];

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

// TPB category IDs
const TPB_CATEGORY_MOVIES = 207;  // HD Movies
const TPB_CATEGORY_TV = 205;      // TV Shows

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

function parseSizeBytes(sizeStr, torrent) {
  if (typeof torrent?.size === 'number' && torrent.size > 0) return Math.floor(torrent.size);
  const m = String(sizeStr).match(/([0-9.]+)\s*([KMGT]?B)/i);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  if (unit === 'TB') return Math.floor(val * 1099511627776);
  if (unit === 'GB') return Math.floor(val * 1073741824);
  if (unit === 'MB') return Math.floor(val * 1048576);
  if (unit === 'KB') return Math.floor(val * 1024);
  return 0;
}

function getQualityRank(str) {
  const s = String(str).toUpperCase();
  if (s.includes('2160') || s.includes('4K') || s.includes('UHD')) return 4;
  if (s.includes('1080') || s.includes('FHD')) return 3;
  if (s.includes('720') || s.includes('HD')) return 2;
  if (s.includes('480') || s.includes('SD')) return 1;
  return 0;
}

function getInvertedSortTag(num, max) {
  max = max || 999999;
  const n = Math.max(0, parseInt(num, 10) || 0);
  const inverted = Math.max(0, max - n);
  const bin = inverted.toString(2).padStart(20, '0');
  return bin.split('').map(b => b === '1' ? '\uFEFF' : '\u200B').join('');
}

// I-parse ang TPB response (flat array) at i-filter para sa target quality
function parseTpbResults(torrents, title, year, season, episode, isSeries) {
  const results = [];
  const titleLower = title.toLowerCase();
  const titleWords = titleLower.split(/\s+/).filter(w => w.length > 2);
  const yearStr = String(year);
  const seasonStr = season ? String(season).padStart(2, '0') : null;
  const episodeStr = episode ? String(episode).padStart(2, '0') : null;

  for (const t of torrents) {
    if (!t || !t.name || !t.info_hash || t.info_hash === '0000000000000000000000000000000000000000') continue;

    const name = String(t.name);
    const nameUpper = name.toUpperCase();
    const nameLower = name.toLowerCase();

    // Quality filter — dapat 1080p
    if (!/\b1080p\b/i.test(name)) continue;

    // Title match — dapat may kahit ilang salita mula sa title
    const matchedWords = titleWords.filter(w => nameLower.includes(w));
    if (matchedWords.length < Math.max(1, Math.floor(titleWords.length * 0.6))) continue;

    // Year match (kung may year sa name)
    const yearInName = name.match(/\b(19|20)\d{2}\b/);
    if (yearInName && yearInName[0] !== yearStr) {
      // Payagan ang +/- 1 year (release year discrepancies)
      const diff = Math.abs(parseInt(yearInName[0]) - parseInt(yearStr));
      if (diff > 1) continue;
    }

    // Season/Episode filter para sa series
    if (isSeries && seasonStr && episodeStr) {
      const sePattern = new RegExp('S' + seasonStr + '[ ._-]?E' + episodeStr, 'i');
      const altPattern = new RegExp(seasonStr + 'x' + episodeStr, 'i');
      if (!sePattern.test(name) && !altPattern.test(name)) continue;
    }

    // I-exclude ang obvious fake/cam
    if (/\b(CAM|TS|HDTS|TC|R5|DVDSCR)\b/i.test(nameUpper)) continue;

    const seeds = parseInt(t.seeders) || 0;
    const leechers = parseInt(t.leechers) || 0;
    const sizeBytes = parseInt(t.size) || 0;
    const sizeGB = (sizeBytes / 1073741824).toFixed(2);
    const magnet = buildMagnet(t.info_hash, name);

    // Codec/audio detection mula sa filename
    const extras = [];
    if (/\bX265\b|\bH\.?265\b|\bHEVC\b/i.test(name)) extras.push('X265');
    else if (/\bX264\b|\bH\.?264\b|\bAVC\b/i.test(name)) extras.push('X264');
    if (/\bHDR10\+?\b/i.test(name)) extras.push('HDR10');
    else if (/\bHDR\b/i.test(name)) extras.push('HDR');
    if (/\bDV\b|\bDOLBY ?VISION\b/i.test(name)) extras.push('DV');
    if (/\bATMOS\b/i.test(name)) extras.push('ATMOS');
    if (/\bDTS\b/i.test(name)) extras.push('DTS');
    if (/\b5\.1\b/i.test(name)) extras.push('5.1');
    if (/\b7\.1\b/i.test(name)) extras.push('7.1');

    const uploader = t.username || 'anonymous';

    const titleLine = isSeries
      ? '\uD83C\uDFA6 ' + title + ' S' + (season || 1) + ' E' + (episode || 1)
      : '\uD83C\uDFAC ' + title + ' - ' + year;
    const qualityLine = '\uD83D\uDD25 ' + QUALITY_LABEL + (extras.length ? ' | ' + extras.join(' | ') : '');
    const statsLine = '\uD83C\uDF31 ' + seeds + ' | \uD83D\uDCBE ' + sizeGB + ' GB | \uD83D\uDD17 TPB';
    const description = titleLine + '\n' + qualityLine + '\n' + statsLine;

    results.push({
      seeders: seeds,
      leechers,
      sizeBytes,
      qualityRank: QUALITY_RANK,
      uploader,
      data: {
        name: 'TPB | ' + QUALITY_LABEL.toUpperCase() + ' | \uD83C\uDF31 ' + seeds,
        title: description,
        size: description,
        description,
        url: magnet
      }
    });
  }

  return results;
}

// ============ MAIN: getStreams ============
function getStreams(mediaId, mediaType = 'movie', season = null, episode = null, userSettings = null) {
  return (async function () {
    const settings = resolveSettings(userSettings);
    const isSeries = mediaType === 'tv' || mediaType === 'series';

    try {
      // 1. TMDB → title, year, IMDb ID
      const tmdbUrl = 'https://api.themoviedb.org/3/' + (isSeries ? 'tv' : 'movie') + '/' + mediaId + '?api_key=' + TMDB_API_KEY + '&append_to_response=external_ids';
      const tmdb = await fetch(tmdbUrl).then(r => r.json()).catch(() => null);
      const title = tmdb?.title || tmdb?.name || 'Unknown';
      const year = (tmdb?.release_date || tmdb?.first_air_date || 'N/A').split('-')[0];
      const imdbId = tmdb?.external_ids?.imdb_id || tmdb?.imdb_id || '';

      // 2. TPB search — subukan ang maraming query para sa mas magandang coverage
      const queries = [];

      if (isSeries) {
        // Para sa series, subukan ang S01E01 format
        const s = String(season || 1).padStart(2, '0');
        const e = String(episode || 1).padStart(2, '0');
        queries.push(title + ' S' + s + 'E' + e);
        queries.push(title + ' ' + s + 'x' + e);
        queries.push(title + ' Season ' + (season || 1));
      } else {
        queries.push(title + ' ' + year);
        queries.push(title + ' ' + year + ' 1080p');
        queries.push(title + ' 1080p');
      }

      const allTorrents = [];
      const seenHashes = new Set();

      for (const q of queries) {
        try {
          const cat = isSeries ? TPB_CATEGORY_TV : TPB_CATEGORY_MOVIES;
          const url = PIRATEBAY_API + '/q.php?q=' + encodeURIComponent(q) + '&cat=' + cat;
          const arr = await fetch(url, { headers: HEADERS }).then(r => r.json()).catch(() => null);
          if (Array.isArray(arr)) {
            for (const t of arr) {
              if (t && t.info_hash && !seenHashes.has(t.info_hash)) {
                seenHashes.add(t.info_hash);
                allTorrents.push(t);
              }
            }
          }
        } catch (_) { /* ignore individual query errors */ }
      }

      if (!allTorrents.length) return [];

      // 3. Parse at filter
      let results = parseTpbResults(allTorrents, title, year, season, episode, isSeries);

      // 4. Fallback: kung walang 1080p results, huwag magbalik ng kahit ano (strict 1080p)
      if (!results.length) return [];

      // 5. Sort
      results.sort((a, b) => {
        if (settings.sortBy === 'size') return b.sizeBytes - a.sizeBytes;
        if (settings.sortBy === 'quality') {
          if (b.qualityRank !== a.qualityRank) return b.qualityRank - a.qualityRank;
          return b.seeders - a.seeders;
        }
        return b.seeders - a.seeders;
      });

      // 6. Apply inverted sort tag para sa Stremio sorting
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
      { type: 'header', label: 'The Pirate Bay Scraper' },
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