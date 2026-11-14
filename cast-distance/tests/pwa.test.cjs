// Run with Node.js 18+: node cast-distance/tests/pwa.test.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?: src="\.\/([^"]+)")?>([\s\S]*?)<\/script>/g)]
  .map(match => match[1] ? fs.readFileSync(path.join(root,match[1]),'utf8') : match[2]);
const HISTORY='fishing-distance-log-v1',CACHE='cast-distance-master-v1',ENDPOINT='cast-distance-master-endpoint-v1';
const endpoint='https://script.google.com/macros/s/test-deployment/exec';
const fixture=()=>({version:1,lures:[
  {id:'1',name:'ミノー 11g / 青',weight:11,color:'青',state:'良好',maker:'メーカー'},
  {id:'2',name:'ミノー 11g / 赤',weight:11,color:'赤',state:'新品',maker:'メーカー'}
],reels:[{id:'REEL-01',name:'エクスセンス BB C3000MHG',rate:89,basis:'メーカー公称'},
  {id:'REEL-02',name:'P Prospec C3000SDH',rate:75,basis:'暫定推定（未実測）'}]});

function app(saved,seed={}) {
  const nodes = new Map();
  class Element {
    constructor() {this.value='';this.textContent='';this.children=[];this.style={};this.listeners={};}
    addEventListener(event, callback) {(this.listeners[event]??=[]).push(callback);}
    emit(event) {for(const callback of this.listeners[event]||[])callback();}
    append(...children) {this.children.push(...children);}
    replaceChildren(...children) {this.children=children;this.textContent='';}
    click() {this.emit('click');}
    remove() {}
  }
  for (const [,id] of html.matchAll(/id="([^"]+)"/g)) nodes.set(id,new Element());
  const get = id => nodes.get(id);
  get('rate').value='89';get('correction').value='100';
  const storage=new Map(Object.entries(seed));if(saved)storage.set(HISTORY,saved);
  let fail = false, download;
  const localStorage = {getItem:key=>storage.get(key)??null,setItem:(key,value)=>{if(fail===true||fail===key)throw Error('quota');storage.set(key,value);}};
  const document = {getElementById:get,body:new Element(),head:new Element(),createElement:tag=>{
    const node = new Element();
    if (tag==='a') node.click=()=>{download=node;};
    return node;
  }};
  const timers=new Map();let timerId=0;
  const context = vm.createContext({document,localStorage,crypto:require('node:crypto').webcrypto,
    Blob,URL,Date,console,setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),
    confirm:()=>true,navigator:{},isSecureContext:false});
  context.window=context;
  scripts.forEach(script=>vm.runInContext(script,context));
  return {get,storage,context,document,stored:()=>storage.get(HISTORY)??null,fail:(key=true)=>{fail=key;},download:()=>download,
    input:(id,value)=>{get(id).value=value;get(id).emit('input');},
    change:(id,value)=>{get(id).value=value;get(id).emit('change');},
    respond:data=>{const script=document.head.children.at(-1);const callback=new URL(script.src).searchParams.get('callback');context[callback](data);},
    networkError:()=>document.head.children.at(-1).onerror(),
    timeout:()=>{for(const {fn,ms} of [...timers.values()])if(ms===12000)fn();}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('45 turns at 89 cm estimates 40.1 m; correction and bounds',()=>{
  const a=app();a.input('turns','45');assert.equal(a.get('estimate').textContent,'40.1 m');
  a.input('correction','80');assert.equal(a.get('estimate').textContent,'32.0 m');
  for(const [id,value] of [['turns','0'],['turns','1001'],['rate','151'],['correction','111']]) {
    const b=app();b.input('turns','45');b.input(id,value);assert.equal(b.get('estimate').textContent,'— m');
    b.get('save').click();assert.equal(b.stored(),null);
  }
});

test('save, reload, group averages and CSV quoting',async()=>{
  const a=app();a.input('turns','45');a.get('memo').value='風,"弱い"\n2行';a.get('save').click();
  a.input('turns','50');a.get('save').click();
  a.input('turns','20');a.change('lure','initial:X-80SW');a.get('save').click();
  assert.equal(a.get('count').textContent,3);assert.equal(a.get('average').textContent,'34.1');
  assert.equal(a.get('best').textContent,'44.5');assert.equal(a.get('groups').children.length,2);
  const b=app(a.stored());assert.equal(b.get('count').textContent,3);
  let blob;
  const create=URL.createObjectURL;
  URL.createObjectURL=value=>{blob=value;return 'blob:test';};
  try {b.get('export').click();} finally {URL.createObjectURL=create;}
  assert.match(b.download().download,/^cast_distance_.*\.csv$/);
  const csv=await blob.text();assert.match(csv,/"風,""弱い""\n2行"/);
  assert.match(csv,/"40.1"/);
});

test('failed writes never alter saved or displayed history',()=>{
  const a=app();a.input('turns','45');a.get('save').click();const before=a.stored();
  a.fail();a.input('turns','70');a.get('save').click();
  assert.equal(a.stored(),before);assert.equal(a.get('count').textContent,1);
  a.get('entries').children[0].children.at(-1).children[0].click();
  assert.equal(a.get('count').textContent,1);assert.equal(a.stored(),before);
  a.get('clear').click();assert.equal(a.get('count').textContent,1);assert.equal(a.stored(),before);
});

test('single deletion and clear persist',()=>{
  const a=app();a.input('turns','45');a.get('save').click();a.input('turns','50');a.get('save').click();
  a.get('entries').children[0].children.at(-1).children[0].click();
  assert.equal(JSON.parse(a.stored()).length,1);assert.equal(a.get('best').textContent,'40.1');
  a.get('clear').click();assert.equal(a.stored(),'[]');assert.equal(a.get('count').textContent,0);
});

test('manifest resolves within GitHub Pages subpath; icons are real PNGs',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest')));
  const base='https://aki-lua87.github.io/utility_html/cast-distance/';
  assert.equal(new URL(manifest.scope,base).href,base);assert.equal(new URL(manifest.id,base).href,base);
  assert.equal(new URL(manifest.start_url,base).href,base+'index.html');assert.equal(manifest.display,'standalone');
  for(const icon of manifest.icons) {
    const bytes=fs.readFileSync(path.join(root,icon.src));
    assert.equal(bytes.subarray(1,4).toString(),'PNG');
    assert.equal(icon.sizes,`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`);
  }
});

test('service worker caches all launch assets, isolates cleanup, starts offline',async()=>{
  const scope='https://aki-lua87.github.io/utility_html/cast-distance/';
  const prefix=`cast-distance:${scope}:`,cacheName=prefix+'v3';
  const stores=new Map([['other-app-v1',new Map()],[prefix+'v1',new Map()],['cast-distance:https://example.com/:v1',new Map()]]);
  const events={};let network=false,claimed=false;
  const caches={keys:async()=>[...stores.keys()],delete:async key=>stores.delete(key),open:async key=>{
    if(!stores.has(key))stores.set(key,new Map());const store=stores.get(key);
    return {addAll:async urls=>{for(const url of urls) {
      const file=new URL(url).pathname.slice(new URL(scope).pathname.length)||'index.html';
      assert.ok(fs.existsSync(path.join(root,file)),file);store.set(url,'cached:'+file);
    }},match:async req=>store.get(typeof req==='string'?req:req.url)};
  }};
  vm.runInNewContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),{
    URL,caches,self:{registration:{scope},addEventListener:(name,callback)=>events[name]=callback,
      skipWaiting:async()=>{},clients:{claim:async()=>{claimed=true;}}},
    fetch:async()=>{network=true;throw Error('offline');}
  });
  async function lifecycle(name){let pending;events[name]({waitUntil:p=>pending=p});await pending;}
  await lifecycle('install');await lifecycle('activate');assert.ok(claimed);
  assert.ok(stores.has('other-app-v1'));assert.ok(!stores.has(prefix+'v1'));
  assert.ok(stores.has('cast-distance:https://example.com/:v1'));assert.ok(stores.has(cacheName));
  for(const suffix of ['', 'index.html', '?installed=1','index.html?installed=1','icon-192.png','master-config.js','master.js','tackle.js']) {
    let pending;events.fetch({request:{url:scope+suffix,method:'GET',mode:suffix.endsWith('.png')?'no-cors':'navigate'},respondWith:p=>pending=p});
    assert.match(await pending,/^cached:/);assert.equal(network,false);
  }
  for(const request of [{url:'https://other.example/file',method:'GET'},{url:scope+'data',method:'POST'},
    {url:'https://aki-lua87.github.io/utility_html/to-lower.html',method:'GET'}]) {
    events.fetch({request,respondWith:()=>assert.fail('Unrelated request intercepted')});
  }
});

test('online master is validated, cached and selectable with stable IDs and snapshots',async()=>{
  const a=app(null,{[ENDPOINT]:JSON.stringify(endpoint)});
  assert.match(a.get('master-status').textContent,/更新中/);
  const script=a.document.head.children.at(-1);
  assert.equal(new URL(script.src).origin,'https://script.google.com');
  assert.equal(new URL(script.src).searchParams.has('callback'),true);
  a.respond(fixture());await settle();
  assert.match(a.get('master-status').textContent,/更新済み/);
  assert.equal(JSON.parse(a.storage.get(CACHE)).data.lures.length,2);
  a.change('lure','master:2');a.change('gear','master:REEL-02');
  assert.equal(a.get('rate').value,'75');assert.match(a.get('rate-basis').textContent,/暫定推定（未実測）/);
  assert.match(a.get('lure-detail').textContent,/11g \/ 赤 \/ ID: 2/);
  a.input('turns','45');assert.equal(a.get('estimate').textContent,'33.8 m');a.get('save').click();
  const entry=JSON.parse(a.stored())[0];
  assert.equal(entry.lureId,'2');assert.equal(entry.reelId,'REEL-02');assert.equal(entry.lureColor,'赤');
  assert.equal(entry.lure,'ミノー 11g / 赤');assert.equal(entry.lureSource,'master');
  assert.equal(entry.rateBasis,'暫定推定（未実測）');
});

test('offline reload keeps cached options, last selection, manual rate and history unchanged',async()=>{
  const a=app(null,{[ENDPOINT]:JSON.stringify(endpoint)});a.respond(fixture());await settle();
  a.change('lure','master:1');a.change('gear','master:REEL-02');a.input('rate','77');
  a.input('turns','45');a.get('save').click();
  const before=a.stored(),b=app(null,Object.fromEntries(a.storage));b.networkError();await settle();
  assert.match(b.get('master-status').textContent,/キャッシュ使用中.*更新に失敗/);
  assert.equal(b.get('lure').value,'master:1');assert.equal(b.get('gear').value,'master:REEL-02');
  assert.equal(b.get('rate').value,'77');assert.match(b.get('rate-basis').textContent,/手動変更中/);
  b.input('turns','45');assert.equal(b.get('estimate').textContent,'34.7 m');
  assert.equal(b.stored(),before);
  b.change('gear','master:REEL-01');assert.equal(b.get('rate').value,'89');
  assert.match(b.get('rate-basis').textContent,/メーカー公称/);
});

test('first launch failure, timeout and a late response retain usable initial data',async()=>{
  for(const error of ['networkError','timeout']) {
    const a=app(null,{[ENDPOINT]:JSON.stringify(endpoint)});a[error]();await settle();
    assert.match(a.get('master-status').textContent,/初期マスター使用中.*更新に失敗/);
    a.respond(fixture());await settle();assert.equal(a.storage.has(CACHE),false);
    a.change('gear','initial:REEL-02');assert.equal(a.get('rate').value,'75');
    a.input('turns','45');a.get('save').click();assert.equal(JSON.parse(a.stored())[0].distance,33.8);
    a.get('master-refresh').click();a.respond(fixture());await settle();
    assert.match(a.get('master-status').textContent,/更新済み/);
  }
});

test('invalid responses never replace the last good master cache',async()=>{
  const cached=JSON.stringify({data:fixture(),at:'2026-11-01T00:00:00Z'});
  const invalid=[{error:'Master unavailable'},{version:1,lures:'bad',reels:[]},fixture(),fixture(),fixture()];
  invalid[2].reels[0].rate=NaN;invalid[3].lures.push(invalid[3].lures[0]);invalid[4].lures[0].id=1;
  for(const data of invalid) {
    const a=app(null,{[CACHE]:cached,[ENDPOINT]:JSON.stringify(endpoint)});a.respond(data);await settle();
    assert.match(a.get('master-status').textContent,/キャッシュ使用中.*更新に失敗/);
    assert.equal(a.storage.get(CACHE),cached);assert.ok(a.get('lure').children.some(option=>option.value==='master:1'));
  }
  const b=app(null,{[CACHE]:'invalid JSON'});assert.match(b.get('master-status').textContent,/初期マスター/);
});

test('custom lure and reel are registered locally once, reused after reload, and saved with IDs',()=>{
  const a=app();a.change('lure','custom');a.input('custom-lure','ジグ 20g / 銀');
  assert.equal(a.get('custom-lure-field').className,'field');
  a.change('gear','custom');assert.equal(a.get('rate').value,'');
  a.input('custom-gear','手持ちリール');a.input('rate','82');a.input('turns','45');a.get('save').click();
  const entry=JSON.parse(a.stored())[0],customs=JSON.parse(a.storage.get('cast-distance-custom-tackle-v1'));
  assert.equal(entry.distance,36.9);assert.equal(entry.lureSource,'custom');assert.equal(entry.reelSource,'custom');
  assert.equal(entry.lureId,customs.lures[0].id);assert.equal(entry.reelId,customs.reels[0].id);
  const b=app(null,Object.fromEntries(a.storage));
  assert.equal(b.get('lure').value,'custom:'+entry.lureId);assert.equal(b.get('gear').value,'custom:'+entry.reelId);
  assert.equal(b.get('rate').value,'82');assert.equal(b.get('custom-lure-field').className,'field hidden');
  b.change('lure','custom');b.input('custom-lure',' ジグ 20g / 銀 ');b.input('turns','10');b.get('save').click();
  assert.equal(JSON.parse(b.storage.get('cast-distance-custom-tackle-v1')).lures.length,1);
  assert.equal(JSON.parse(b.stored())[0].lureId,entry.lureId);
});

test('blank custom lure does not save or register; draft text survives a restart',()=>{
  const a=app();a.change('lure','custom');a.input('custom-lure','   ');a.input('turns','45');a.get('save').click();
  assert.equal(a.stored(),null);assert.equal(a.storage.has('cast-distance-custom-tackle-v1'),false);
  a.input('custom-lure','作成中の名前');
  const b=app(null,Object.fromEntries(a.storage));assert.equal(b.get('lure').value,'custom');
  assert.equal(b.get('custom-lure').value,'作成中の名前');
});

test('custom names matching master names are resolved to the master without duplicates',async()=>{
  const a=app(null,{[ENDPOINT]:JSON.stringify(endpoint)});a.respond(fixture());await settle();
  a.change('lure','custom');a.input('custom-lure','ミノー 11g / 青');a.input('turns','45');a.get('save').click();
  assert.equal(JSON.parse(a.stored())[0].lureId,'1');assert.equal(JSON.parse(a.stored())[0].lureSource,'master');
  assert.equal(JSON.parse(a.storage.get('cast-distance-custom-tackle-v1')).lures.length,0);
  assert.equal(a.get('lure').value,'master:1');
});

test('master arriving later hides duplicate local names and preserves their historical snapshots',async()=>{
  const a=app();a.change('lure','custom');a.input('custom-lure','ミノー 11g / 青');a.input('turns','45');a.get('save').click();
  const before=a.stored();a.get('master-url').value=endpoint;a.get('master-connect').click();a.respond(fixture());await settle();
  assert.equal(a.get('lure').value,'master:1');
  assert.equal(a.get('lure').children.filter(option=>option.textContent.startsWith('ミノー 11g / 青')).length,1);
  assert.equal(a.stored(),before);
});

test('master removal or a name reused with a different ID cannot rewrite history or selection',async()=>{
  const a=app(null,{[ENDPOINT]:JSON.stringify(endpoint)});a.respond(fixture());await settle();
  a.change('lure','master:1');a.input('turns','45');a.get('save').click();const before=a.stored();
  const changed=fixture();changed.lures[0].id='3';
  a.get('master-refresh').click();a.respond(changed);await settle();
  assert.equal(a.get('lure').value,'master:1');assert.equal(a.stored(),before);
  assert.match(a.get('lure').children.find(option=>option.value==='master:1').textContent,/前回の選択/);
  const b=app(null,Object.fromEntries(a.storage));b.networkError();await settle();
  assert.equal(b.get('lure').value,'master:1');assert.equal(b.stored(),before);
});

test('a refreshed rate follows the master until manually overridden; in-flight input survives',async()=>{
  const a=app(null,{[ENDPOINT]:JSON.stringify(endpoint)});a.respond(fixture());await settle();
  // Initial reel IDs match the master even when the display name changes.
  assert.equal(a.get('gear').value,'master:REEL-01');
  a.change('gear','master:REEL-02');
  const changed=fixture();changed.reels[1].rate=76;changed.reels[1].basis='実測';
  a.get('master-refresh').click();a.respond(changed);await settle();assert.equal(a.get('rate').value,'76');
  a.get('master-refresh').click();a.input('rate','80');a.change('lure','custom');a.input('custom-lure','途中の入力');
  a.respond(fixture());await settle();
  assert.equal(a.get('rate').value,'80');assert.equal(a.get('lure').value,'custom');assert.equal(a.get('custom-lure').value,'途中の入力');
  a.input('turns','45');a.get('save').click();assert.match(JSON.parse(a.stored())[0].rateBasis,/手動変更/);
});

test('legacy records load byte-for-byte without migration; mixed CSV retains old columns and adds empty fields',async()=>{
  const legacy=JSON.stringify([{id:'old',at:'2025-10-01T12:34:56Z',gear:'旧リール',lure:'旧ルアー',turns:45,
    rate:89,correction:100,distance:40.1,place:'秘密の場所',memo:'旧メモ,"引用"\n2行'}]);
  const a=app(legacy,{[ENDPOINT]:JSON.stringify(endpoint)});a.respond(fixture());await settle();
  assert.equal(a.stored(),legacy);assert.equal(a.get('count').textContent,1);
  a.change('lure','master:2');a.input('turns','10');a.get('save').click();
  assert.deepEqual(JSON.parse(a.stored())[1],JSON.parse(legacy)[0]);
  let blob;const create=URL.createObjectURL;URL.createObjectURL=value=>{blob=value;return 'blob:test';};
  try {a.get('export').click();} finally {URL.createObjectURL=create;}
  const csv=await blob.text();
  assert.ok(csv.startsWith('"日時","リール","ルアー","回転数","巻上長cm","補正率%","推定距離m","釣り場","メモ",'));
  assert.match(csv,/"旧リール","旧ルアー","45","89","100","40.1","秘密の場所","旧メモ,""引用""\n2行","","","","","","","",""/);
  assert.match(csv,/"ルアー管理ID","リール管理ID"/);
});

test('storage failure keeps online data usable, and never overwrites existing history',async()=>{
  const a=app(null,{[ENDPOINT]:JSON.stringify(endpoint)});a.fail(CACHE);a.respond(fixture());await settle();
  assert.match(a.get('master-status').textContent,/キャッシュ保存に失敗/);
  a.change('lure','master:1');a.input('turns','45');a.get('save').click();const before=a.stored();
  a.fail();a.get('master-refresh').click();a.respond(fixture());await settle();
  assert.equal(a.stored(),before);assert.equal(a.get('count').textContent,1);
});

test('lost/discarded rows are excluded; equal display names retain distinct IDs, weight and color',async()=>{
  const data=fixture();data.lures[1].name=data.lures[0].name;data.lures[1].weight=20;
  data.lures.push({...data.lures[0],id:'lost',state:'ロスト'},{...data.lures[0],id:'discard',state:'廃棄'});
  const a=app(null,{[ENDPOINT]:JSON.stringify(endpoint)});a.respond(data);await settle();
  const options=a.get('lure').children;
  assert.match(options.find(option=>option.value==='master:1').textContent,/11g \/ 青 \/ ID:1/);
  assert.match(options.find(option=>option.value==='master:2').textContent,/20g \/ 赤 \/ ID:2/);
  assert.equal(options.some(option=>option.value==='master:lost'||option.value==='master:discard'),false);
  for(const id of ['1','2']) {a.change('lure','master:'+id);a.input('turns','45');a.get('save').click();}
  assert.equal(a.get('groups').children.length,2);
  assert.match(a.get('entries').children[0].children[0].children[0].textContent,/20g \/ 赤 \/ ID:2/);
});

test('empty master lists permit custom-only use and never discard existing history',()=>{
  const a=app(null,{[CACHE]:JSON.stringify({data:{version:1,lures:[],reels:[]},at:'2026-11-01T00:00:00Z'})});
  assert.equal(a.get('lure').value,'custom');assert.equal(a.get('gear').value,'custom');
  a.input('custom-lure','初めてのルアー');a.input('rate','89');a.input('turns','45');a.get('save').click();
  assert.equal(JSON.parse(a.stored())[0].distance,40.1);
});

test('only trusted Apps Script deployment URLs can be configured',()=>{
  for(const url of ['javascript:alert(1)','https://evil.example/exec',endpoint+'?callback=evil','http://script.google.com/macros/s/test/exec']) {
    const a=app();a.get('master-url').value=url;a.get('master-connect').click();
    assert.equal(a.document.head.children.length,0);assert.equal(a.storage.has(ENDPOINT),false);
  }
  const a=app();a.get('master-url').value=endpoint;a.get('master-connect').click();
  assert.equal(JSON.parse(a.storage.get(ENDPOINT)),endpoint);assert.equal(a.document.head.children.length,1);
});

test('Apps Script reads only approved master ranges, preserves IDs, filters lost rows and validates JSONP',()=>{
  const calls=[],data=fixture();
  const source=fs.readFileSync(path.join(root,'apps-script/Code.gs'),'utf8');
  const lureRows=data.lures.map(row=>[Number(row.id),row.name,row.weight,row.color,row.state,row.maker]);
  lureRows.push([3,'ロスト済み',30,'青','ロスト','メーカー'],['','','','','','']);
  const reelRows=data.reels.map(row=>[row.id,row.name,row.rate,row.basis]);
  const context=vm.createContext({Sheets:{Spreadsheets:{Values:{batchGet:(id,options)=>{
    calls.push(JSON.parse(JSON.stringify({id,...options})));
    return {valueRanges:[{values:lureRows},{values:reelRows}]};
  }}}},ContentService:{MimeType:{JSON:'json',JAVASCRIPT:'js'},createTextOutput:body=>({body,setMimeType(type){this.type=type;return this;}})}});
  vm.runInContext(source,context);
  const response=context.doGet({parameter:{callback:'castMaster_test',sheet:'釣果記録',range:'A:Z'}});
  const received=[];vm.runInNewContext(response.body,{castMaster_test:value=>received.push(value)});
  assert.equal(response.type,'js');assert.equal(received[0].lures[0].id,'1');assert.equal(received[0].lures.length,2);
  assert.deepEqual(calls,[{id:'19DyLdg7qiyiPNqQOQqkLfugrKo6Hx3qbI44fa8bFuvc',
    ranges:["'アプリ用マスター'!A2:F","'アプリ用マスター'!H2:K"],valueRenderOption:'UNFORMATTED_VALUE'}]);
  calls.length=0;assert.match(context.doGet({parameter:{callback:'alert(1)//'}}).body,/Invalid callback/);assert.equal(calls.length,0);
  assert.equal(JSON.parse(context.doGet({parameter:{}}).body).reels[1].rate,75);
  lureRows[0][0]='#REF!';assert.deepEqual(JSON.parse(context.doGet({parameter:{}}).body),{error:'Master unavailable'});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'apps-script/appsscript.json'))).oauthScopes,
    ['https://www.googleapis.com/auth/spreadsheets.readonly']);
});
