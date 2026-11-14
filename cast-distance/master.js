'use strict';
// Only master data uses this cache. Never migrate or rewrite the cast history.
window.CastMaster = (() => {
  const cacheKey = 'cast-distance-master-v1';
  const endpointKey = 'cast-distance-master-endpoint-v1';
  const initial = {
    version: 1,
    lures: ['NOYD 16g', 'NOYD 30g', '冷音 14g', '冷音 24g', 'X-80SW',
      'スイッチヒッター65S', 'ジェット天秤＋イソメ'].map(name =>
      ({id: null, name, weight: null, color: '', state: '', maker: '', source: 'initial'})),
    reels: [
      {id: 'REEL-01', name: 'エクスセンスBB C3000MHG', rate: 89, basis: 'メーカー公称', source: 'initial'},
      {id: 'REEL-02', name: 'SEASIR P Prospec C3000SDH', rate: 75, basis: '暫定推定（未実測）', source: 'initial'}
    ]
  };
  const read = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  };
  const write = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  };
  const validEndpoint = value => /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(value);
  const text = (value, required = false) => {
    if (typeof value !== 'string' || value.length > 500 || (required && !value.trim())) throw Error('Invalid text');
    return value.trim();
  };
  function validate(data) {
    if (!data || data.version !== 1 || !Array.isArray(data.lures) || !Array.isArray(data.reels) ||
        data.lures.length > 5000 || data.reels.length > 5000) throw Error('Invalid master');
    function rows(items, type) {
      const ids = new Set();
      return items.map(item => {
        const id = text(item.id, true), name = text(item.name, true);
        if (ids.has(id)) throw Error('Duplicate ID');
        ids.add(id);
        if (type === 'lure') {
          if (item.weight !== null && (typeof item.weight !== 'number' || !Number.isFinite(item.weight) || item.weight < 0)) throw Error('Invalid weight');
          return {id, name, weight: item.weight, color: text(item.color), state: text(item.state), maker: text(item.maker), source: 'master'};
        }
        if (typeof item.rate !== 'number' || !Number.isFinite(item.rate) || item.rate < 1 || item.rate > 150) throw Error('Invalid rate');
        return {id, name, rate: item.rate, basis: text(item.basis, true), source: 'master'};
      }).filter(item => !['ロスト', '廃棄'].includes(item.state));
    }
    return {version: 1, lures: rows(data.lures, 'lure'), reels: rows(data.reels, 'reel')};
  }
  function cached() {
    try {
      const value = read(cacheKey, null);
      if (!value || !Number.isFinite(Date.parse(value.at))) return null;
      return {data: validate(value.data), at: value.at};
    } catch { return null; }
  }
  // Script tags implement Google's documented JSONP transport without CORS fetch.
  // Only a deployment owned/trusted by the user should be configured.
  function request(endpoint) {
    return new Promise((resolve, reject) => {
      if (!validEndpoint(endpoint)) { reject(Error('Invalid endpoint')); return; }
      const callback = 'castMaster_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      let settled = false;
      const finish = (error, data) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        script.remove();
        // A timed-out response may still arrive; don't let it change the cache/UI.
        window[callback] = () => {};
        setTimeout(() => { delete window[callback]; }, 60000);
        if (error) reject(error); else resolve(data);
      };
      window[callback] = data => {
        try { finish(null, validate(data)); } catch (error) { finish(error); }
      };
      const timer = setTimeout(() => finish(Error('Master timeout')), 12000);
      script.onerror = () => finish(Error('Master unavailable'));
      script.referrerPolicy = 'no-referrer';
      script.src = endpoint + '?callback=' + callback + '&t=' + Date.now();
      document.head.append(script);
    });
  }
  return {initial, read, write, cached, validate, request, validEndpoint, endpointKey,
    endpoint: () => read(endpointKey, window.CAST_MASTER_ENDPOINT || ''),
    store: data => write(cacheKey, {data, at: new Date().toISOString()})};
})();
