// Run with Node.js 18+: node cast-distance/tests/pwa.test.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);

function app(saved) {
  const nodes = new Map();
  class Element {
    constructor() {this.value='';this.textContent='';this.children=[];this.style={};this.listeners={};}
    addEventListener(event, callback) {this.listeners[event]=callback;}
    append(...children) {this.children.push(...children);}
    replaceChildren(...children) {this.children=children;this.textContent='';}
    click() {this.listeners.click?.();}
    remove() {}
  }
  for (const [,id] of html.matchAll(/id="([^"]+)"/g)) nodes.set(id,new Element());
  const get = id => nodes.get(id);
  Object.assign(get('gear'), {value:'ex',selectedOptions:[{text:'エクスセンスBB C3000MHG'}]});
  get('lure').value='NOYD 16g';get('rate').value='89';get('correction').value='100';
  let stored = saved || null, fail = false, download;
  const localStorage = {getItem:()=>stored,setItem:(key,value)=>{if(fail)throw Error('quota');stored=value;}};
  const document = {getElementById:get,body:new Element(),createElement:tag=>{
    const node = new Element();
    if (tag==='a') node.click=()=>{download=node;};
    return node;
  }};
  const context = vm.createContext({document,localStorage,crypto:require('node:crypto').webcrypto,
    Blob,URL,Date,console,setTimeout:()=>{},confirm:()=>true,navigator:{},window:{isSecureContext:false}});
  scripts.forEach(script=>vm.runInContext(script,context));
  return {get,stored:()=>stored,fail:()=>{fail=true;},download:()=>download,
    input:(id,value)=>{get(id).value=value;get(id).listeners.input?.();}};
}

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
  a.input('turns','20');a.get('lure').value='X-80SW';a.get('save').click();
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
  const prefix=`cast-distance:${scope}:`,cacheName=prefix+'v2';
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
  for(const suffix of ['', 'index.html', '?installed=1','index.html?installed=1','icon-192.png']) {
    let pending;events.fetch({request:{url:scope+suffix,method:'GET',mode:suffix.endsWith('.png')?'no-cors':'navigate'},respondWith:p=>pending=p});
    assert.match(await pending,/^cached:/);assert.equal(network,false);
  }
  for(const request of [{url:'https://other.example/file',method:'GET'},{url:scope+'data',method:'POST'},
    {url:'https://aki-lua87.github.io/utility_html/to-lower.html',method:'GET'}]) {
    events.fetch({request,respondWith:()=>assert.fail('Unrelated request intercepted')});
  }
});
