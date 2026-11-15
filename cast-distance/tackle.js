'use strict';
window.CastTackle = {
  create({$, calculate}) {
    const master = window.CastMaster;
    const customKey = 'cast-distance-custom-tackle-v1', selectionKey = 'cast-distance-selection-v1';
    const saved = master.read(customKey, {});
    const validCustom = items => Array.isArray(items) ? items.filter(item => item &&
      typeof item.id === 'string' && typeof item.name === 'string' && item.name.trim() && item.source === 'custom') : [];
    let customs = {lures: validCustom(saved?.lures), reels: validCustom(saved?.reels)};
    let preference = master.read(selectionKey, {}) || {};
    let cache = master.cached(), pending;
    let data = cache?.data || master.initial, lists = {lures: [], reels: []}, updating = false;
    const normalized = value => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ja');
    const key = item => item.source + ':' + (item.id ?? item.name);
    const matches = (item, previous) => key(item) === key(previous) ||
      (previous.source !== 'custom' && item.source !== 'custom' && previous.id && item.id === previous.id) ||
      (previous.source !== 'master' && normalized(item.name) === normalized(previous.name));
    const find = type => lists[type].find(item => key(item) === $(type === 'lures' ? 'lure' : 'gear').value);
    function option(select, value, label) {
      const node = document.createElement('option');
      node.value = value;
      node.textContent = label;
      select.append(node);
    }
    function build(type, previous) {
      const select = $(type === 'lures' ? 'lure' : 'gear');
      const names = new Set(data[type].map(item => normalized(item.name)));
      lists[type] = [...data[type], ...customs[type].filter(item => !names.has(normalized(item.name)))];
      // Reels can retain a removed selection. Lures must belong to the current
      // owned master or local custom list; never resurrect a previous master row.
      if (type === 'reels' && previous && typeof previous.name === 'string' && !lists[type].some(item => matches(item, previous))) {
        lists[type].push({...previous, unavailable: true});
      }
      select.replaceChildren();
      for (const item of lists[type]) {
        const duplicate = lists[type].filter(other => other.name === item.name).length > 1;
        let label = item.name;
        if (duplicate && type === 'lures') label += `（${item.weight ?? '?'}g / ${item.color || '色不明'} / ID:${item.id}）`;
        if (item.source === 'custom') label += '（端末登録）';
        if (item.unavailable) label += '（前回の選択）';
        option(select, key(item), label);
      }
      option(select, 'custom', type === 'lures' ? 'その他（自由入力）' : 'その他（カスタム）');
      const match = previous && typeof previous.name === 'string' && lists[type].find(item => matches(item, previous));
      select.value = match ? key(match) : lists[type][0] ? key(lists[type][0]) : 'custom';
    }
    function showFields() {
      $('custom-lure-field').className = $('lure').value === 'custom' ? 'field' : 'field hidden';
      $('custom-gear-field').className = $('gear').value === 'custom' ? 'field' : 'field hidden';
      const reel = find('reels');
      $('rate-basis').textContent = reel ? `${reel.basis} · 基準 ${reel.rate}cm/回` +
        (Number($('rate').value) !== reel.rate ? '（手動変更中）' : '') : 'カスタム値（手動入力）';
      const lure = find('lures');
      $('lure-detail').textContent = lure?.source === 'master' ?
        [lure.weight === null ? '' : `${lure.weight}g`, lure.color, `ID: ${lure.id}`].filter(Boolean).join(' / ') : '';
    }
    function remember() {
      preference = {lure: find('lures') || null, reel: find('reels') || null,
        customLure: $('lure').value === 'custom', customReel: $('gear').value === 'custom',
        lureName: $('custom-lure').value, reelName: $('custom-gear').value, rate: $('rate').value};
      master.write(selectionKey, preference);
    }
    function render(previous = {}) {
      build('lures', previous.lure);
      build('reels', previous.reel);
      if (previous.customLure) $('lure').value = 'custom';
      if (previous.customReel) $('gear').value = 'custom';
      showFields();
    }
    function status(message) { $('master-status').textContent = message; }
    render(preference);
    $('custom-lure').value = typeof preference.lureName === 'string' ? preference.lureName : '';
    $('custom-gear').value = typeof preference.reelName === 'string' ? preference.reelName : '';
    $('rate').value = typeof preference.rate === 'string' ? preference.rate : String(find('reels')?.rate ?? '');
    showFields();
    const cachedMessage = () => data === master.initial ? '初期マスター使用中' : cache?.data === data ?
      `キャッシュ使用中（${new Date(cache.at).toLocaleString('ja-JP')}）` : '取得済みマスター使用中（端末保存なし）';
    status(cachedMessage());
    $('lure').addEventListener('change', () => { showFields(); remember(); });
    $('gear').addEventListener('change', () => {
      $('rate').value = String(find('reels')?.rate ?? '');
      showFields(); remember(); calculate();
    });
    for (const id of ['custom-lure', 'custom-gear', 'rate']) $(id).addEventListener('input', () => { showFields(); remember(); });
    $('master-url').value = master.endpoint();
    async function refresh() {
      if (updating) return;
      const endpoint = master.endpoint();
      if (!endpoint) { status(cachedMessage() + ' · 接続先未設定'); return; }
      updating = true;
      $('master-refresh').disabled = true;
      $('master-connect').disabled = true;
      status('マスター更新中…（現在の一覧を利用できます）');
      try {
        const next = await master.request(endpoint);
        const previous = {lure: find('lures'), reel: find('reels'),
          customLure: $('lure').value === 'custom', customReel: $('gear').value === 'custom'};
        const oldReel = previous.reel, oldRate = $('rate').value;
        const stored = master.store(next);
        data = next;
        if (stored) cache = {data, at: new Date().toISOString()};
        render(previous);
        const reel = find('reels');
        // Respect manual overrides even when an update arrives during input.
        if (oldReel && reel && Number(oldRate) === oldReel.rate) $('rate').value = String(reel.rate);
        showFields(); remember(); calculate();
        status(stored ? '更新済み（' + new Date().toLocaleString('ja-JP') + '）' : '取得済み · 端末へのキャッシュ保存に失敗');
      } catch {
        status(cachedMessage() + ' · 更新に失敗（通信・接続先の設定を確認）');
      } finally {
        updating = false;
        $('master-refresh').disabled = false;
        $('master-connect').disabled = false;
      }
    }
    $('master-refresh').addEventListener('click', refresh);
    $('master-connect').addEventListener('click', () => {
      if (updating) return;
      const url = $('master-url').value.trim();
      if (url && !master.validEndpoint(url)) { status('Apps Scriptの https://script.google.com/macros/s/…/exec URLを入力してください'); return; }
      if (!master.write(master.endpointKey, url)) { status('接続先を保存できませんでした'); return; }
      refresh();
    });
    refresh();
    function selection() {
      function selected(type, input, fallback) {
        const current = find(type);
        if (current) return current;
        const name = $(input).value.trim() || fallback;
        const existing = lists[type].find(item => normalized(item.name) === normalized(name));
        if (existing) return existing;
        const item = {id: crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random(), name, source: 'custom'};
        if (type === 'reels') Object.assign(item, {rate: Number($('rate').value), basis: 'カスタム（手動入力）'});
        return item;
      }
      const lure = selected('lures', 'custom-lure', '');
      const reel = selected('reels', 'custom-gear', 'カスタム');
      pending = {lure, reel};
      const override = Number($('rate').value) !== reel.rate;
      return {lure: lure.name, lureId: lure.id, lureSource: lure.source,
        lureWeight: lure.weight ?? null, lureColor: lure.color || '',
        gear: reel.name, reelId: reel.id, reelSource: reel.source,
        rateBasis: override ? '手動変更（基準：' + reel.basis + '）' : reel.basis,
        reelBaseRate: reel.rate};
    }
    function commit() {
      const next = {lures: [...customs.lures], reels: [...customs.reels]};
      const previous = pending;
      for (const type of ['lures', 'reels']) {
        const select = $(type === 'lures' ? 'lure' : 'gear');
        if (select.value !== 'custom') continue;
        const item = previous[type === 'lures' ? 'lure' : 'reel'];
        if (!lists[type].some(row => key(row) === key(item))) {
          next[type].push(item);
        }
      }
      const stored = master.write(customKey, next);
      if (stored) { customs = next; render(previous); }
      remember();
      return stored;
    }
    return {selection, commit, refresh};
  }
};
