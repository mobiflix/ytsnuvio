'use strict';

// ============ CONFIG ============
const TMDB_API_KEY = '1865f43a0549ca50d341dd9ab8b29f49';
const DEFAULT_PROVIDER = 'MultiTV';

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

const TARGET_QUALITY = '1080p';
const QUALITY_RANK = 3;
const QUALITY_LABEL = '1080p';

// ============ HELPERS ============
function resolveSettings(userSettings) {
  let settings = { debridProvider: 'none', debridKey: '', language: 'any', minQuality: TARGET_QUALITY, sortBy: 'seeders' };
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
  } catch (e) { console.error('[' + DEFAULT_PROVIDER + '] settings error:', e); }
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

// ============ SOURCE 1: EZTV ============
async function fetchEztv(imdbId, season, episode) {
  try {
    const url = 'https://eztvx.to/api/get-torrents?imdb_id=' + imdbId + '&limit=100';
    const data = await fetch(url, { headers: HEADERS }).then(r => r.json()).catch(() => null);
    if (!data?.torrents || !Array.isArray(data.torrents)) return [];
    const seasonStr = String(season);
    const episodeStr = String(episode);
    return data.torrents
      .filter(t => t && t.hash && t.filename)
      .filter(t => /\b1080p\b/i.test(t.filename))
      .filter(t => String(t.season) === seasonStr && String(t.episode) === episodeStr)
      .map(t => ({
        source: 'EZTV',
        hash: t.hash,
        filename: t.filename,
        seeds: parseInt(t.seeds) || 0,
        peers: parseInt(t.peers) || 0,
        sizeBytes: parseInt(t.size_bytes) || 0,
        magnet: t.magnet_url || buildMagnet(t.hash, t.filename)
      }));
  } catch (e) {
    console.error('[EZTV] error:', e?.message || e);
    return [];
  }
}

// ============ SOURCE 2: The Pirate Bay ============
async function fetchTpb(title, season, episode) {
  try {
    const s = String(season).padStart(2, '0');
    const e = String(episode).padStart(2, '0');
    const queries = [
      title + ' S' + s + 'E' + e,
      title + ' ' + season + 'x' + e,
      title + ' Season ' + season
    ];
    const seen = new Set();
    const all = [];
    for (const q of queries) {
      try {
        const url = 'https://apibay.org/q.php?q=' + encodeURIComponent(q) + '&cat=205';
        const arr = await fetch(url, { headers: HEADERS }).then(r => r.json()).catch(() => null);
        if (Array.isArray(arr)) {
          for (const t of arr) {
            if (t && t.info_hash && !seen.has(t.info_hash) && t.info_hash !== '0000000000000000000000000000000000000000') {
              seen.add(t.info_hash);
              all.push(t);
            }
          }
        }
      } catch (_) {}
    }
    const seasonStr = String(season);
    const episodeStr = String(episode);
    const sePattern = new RegExp('S' + String(season).padStart(2, '0') + '[ ._-]?E' + String(episode).padStart(2, '0'), 'i');
    const xPattern = new RegExp('\\b' + season + 'x' + String(episode).padStart(2, '0') + '\\b', 'i');

    return all
      .filter(t => /\b1080p\b/i.test(t.name))
      .filter(t => sePattern.test(t.name) || xPattern.test(t.name))
      .map(t => ({
        source: 'TPB',
        hash: t.info_hash,
        filename: t.name,
        seeds: parseInt(t.seeders) || 0,
        peers: parseInt(t.leechers) || 0,
        sizeBytes: parseInt(t.size) || 0,
        magnet: buildMagnet(t.info_hash, t.name)
      }));
  } catch (e) {
    console.error('[TPB] error:', e?.message || e);
    return [];
  }
}

// ============ SOURCE 3: 1337x (via apibay-style fallback) ============
// (Optional — kailangan ng HTML scraping, hindi kasama sa test)

// ============ MAIN: getStreams ============
function getStreams(mediaId, mediaType = 'movie', season = null, episode = null, userSettings = null) {
  return (async function () {
    if (mediaType !== 'tv' && mediaType !== 'series') return [];

    const settings = resolveSettings(userSettings);
    const seasonNum = parseInt(season) || 1;
    const episodeNum = parseInt(episode) || 1;

    try {
      // 1. TMDB → IMDb ID + title
      const tmdbUrl = 'https://api.themoviedb.org/3/tv/' + mediaId + '?api_key=' + TMDB_API_KEY + '&append_to_response=external_ids';
      const tmdb = await fetch(tmdbUrl).then(r => r.json()).catch(() => null);
      const rawImdbId = tmdb?.external_ids?.imdb_id || tmdb?.imdb_id || '';
      const title = tmdb?.name || tmdb?.original_name || 'Unknown';
      const imdbId = normalizeImdbId(rawImdbId);

      // 2. Kunin mula sa LAHAT ng sources — sabay-sabay
      const promises = [];

      if (imdbId) {
        promises.push(fetchEztv(imdbId, seasonNum, episodeNum));
      }
      if (title && title !== 'Unknown') {
        promises.push(fetchTpb(title, seasonNum, episodeNum));
      }

      const settled = await Promise.allSettled(promises);
      const merged = [];
      for (const s of settled) {
        if (s.status === 'fulfilled' && Array.isArray(s.value)) {
          merged.push(...s.value);
        }
      }

      // 3. Dedupe ayon sa hash
      const seen = new Set();
      const unique = [];
      for (const item of merged) {
        if (!item.hash || seen.has(item.hash)) continue;
        seen.add(item.hash);
        unique.push(item);
      }

      if (!unique.length) return [];

      // 4. Build results
      const results = unique.map(item => {
        const sizeGB = (item.sizeBytes / 1073741824).toFixed(2);
        const extras = [];
        if (/\bX265\b|\bH\.?265\b|\bHEVC\b/i.test(item.filename)) extras.push('X265');
        else if (/\bX264\b|\bH\.?264\b|\bAVC\b/i.test(item.filename)) extras.push('X264');
        if (/\bHDR10\+?\b/i.test(item.filename)) extras.push('HDR10');
        else if (/\bHDR\b/i.test(item.filename)) extras.push('HDR');
        if (/\bATMOS\b/i.test(item.filename)) extras.push('ATMOS');
        if (/\b5\.1\b/i.test(item.filename)) extras.push('5.1');

        const titleLine = '\uD83C\uDFA6 ' + title + ' S' + String(seasonNum).padStart(2, '0') + ' E' + String(episodeNum).padStart(2, '0');
        const qualityLine = '\uD83D\uDD25 ' + QUALITY_LABEL + (extras.length ? ' | ' + extras.join(' | ') : '');
        const statsLine = '\uD83C\uDF31 ' + item.seeds + ' | \uD83D\uDCBE ' + sizeGB + ' GB | \uD83D\uDD17 ' + item.source;
        const description = titleLine + '\n' + qualityLine + '\n' + statsLine;

        return {
          seeders: item.seeds,
          sizeBytes: item.sizeBytes,
          qualityRank: QUALITY_RANK,
          data: {
            name: item.source + ' | ' + QUALITY_LABEL.toUpperCase() + ' | \uD83C\uDF31 ' + item.seeds,
            title: description,
            size: description,
            description,
            url: item.magnet
          }
        };
      });

      // 5. Sort
      results.sort((a, b) => {
        if (settings.sortBy === 'size') return b.sizeBytes - a.sizeBytes;
        if (settings.sortBy === 'quality') {
          if (b.qualityRank !== a.qualityRank) return b.qualityRank - a.qualityRank;
          return b.seeders - a.seeders;
        }
        return b.seeders - a.seeders;
      });

      // 6. Apply inverted sort tag
      return results.map(r => {
        let sortTag;
        if (settings.sortBy === 'size') sortTag = getInvertedSortTag(Math.floor(r.sizeBytes / 1073741824));
        else if (settings.sortBy === 'quality') sortTag = getInvertedSortTag(r.qualityRank * 10000 + r.seeders);
        else sortTag = getInvertedSortTag(r.seeders);
        return { ...r.data, name: sortTag + r.data.name };
      });

    } catch (err) {
      console.error('[' + DEFAULT_PROVIDER + '] Fatal error:', err);
      return [];
    }
  })();
}

// ============ SETTINGS ============
function onSettings() {
  return (async function () {
    return [
      { type: 'header', label: 'Multi-Source TV — EZTV + TPB' },
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