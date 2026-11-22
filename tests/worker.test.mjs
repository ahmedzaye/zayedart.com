import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto as crypto} from 'node:crypto';
import worker,{verifyAccess} from '../admin/src/index.js';
const original={
 categories:[{id:'cairo',name:{en:'Cairo',ar:'Cairo'}},{id:'matrouh',name:{en:'Matrouh',ar:'Matrouh'}}],
 photos:[{src:'/assets/photography/cairo/example.webp',category:'cairo',title:{en:'',ar:''},description:{en:'',ar:''},takenAt:null,uploadedAt:null}]
};
const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);jwk.kid='test';
const env={ACCESS_TEAM_DOMAIN:'test.cloudflareaccess.com',ACCESS_AUD:'test-aud',GITHUB_OWNER:'test',GITHUB_REPO:'site',GITHUB_TOKEN:'mock',SITE_ORIGIN:'https://public.example'};
const claims={iss:'https://test.cloudflareaccess.com',aud:['test-aud'],email:'owner@example.test',exp:Math.floor(Date.now()/1000)+3600};
async function jwt(payload){const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const p=enc({alg:'RS256',kid:'test'})+'.'+enc(payload);return p+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(p))).toString('base64url');}
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
function repoMock({conflict=0,live=null}={}){
 let data=structuredClone(original),head='a'.repeat(40),writes=0,reads=0;const blobs=new Map(),trees=new Map(),commits=new Map();
 return {get data(){return data;},get writes(){return writes;},get reads(){return reads;},fetch:async(url,init={})=>{
  const u=new URL(url);if(u.hostname==='test.cloudflareaccess.com')return response({keys:[jwk]});
  if(u.hostname==='public.example')return response({commit:live});
  const p=u.pathname.replace('/repos/test/site',''),body=init.body?JSON.parse(init.body):{};
  if(p==='/git/ref/heads/main'){reads++;return response({object:{sha:head}});}
  if(p.startsWith('/git/commits/')&&!init.method)return response({tree:{sha:'tree'}});
  if(p==='/contents/data/photography.json')return response(data);
  if(p.startsWith('/contents/'))return response({sha:'old-image'});
  if(p==='/git/blobs'){const sha='blob'+blobs.size;blobs.set(sha,body);return response({sha},201);}
  if(p.startsWith('/git/trees/') && !init.method)return response({tree:data.photos.map(photo=>({path:decodeURIComponent(photo.src.slice(1)),type:'blob',sha:'old-image'})),truncated:false});
  if(p==='/git/trees'){const sha='tree'+trees.size;trees.set(sha,body);return response({sha},201);}
  if(p==='/git/commits'){const sha=String(commits.size+1).padStart(40,'0');commits.set(sha,body);return response({sha},201);}
  if(p==='/git/refs/heads/main'){
   writes++;assert.equal(body.force,false);
   if(conflict){const status=conflict;conflict=0;head='b'.repeat(40);return response({message:'Conflict'},status);}
   const commit=commits.get(body.sha);assert.equal(commit.parents[0],head);
   const entry=trees.get(commit.tree).tree.find(e=>e.path==='data/photography.json');data=JSON.parse(blobs.get(entry.sha).content);head=body.sha;return response({});
  }
  if(p.startsWith('/compare/'))return response({status:'ahead'});
  throw Error('Unexpected mock URL '+url);
 }};
}
async function run(fn,mock=repoMock()) {const saved=globalThis.fetch;globalThis.fetch=mock.fetch;try{return await fn(mock);}finally{globalThis.fetch=saved;}}
const local={...env,DEV_BYPASS_AUTH:'1',ENVIRONMENT:'development'};
async function call(method,path,body,config=local,headers={}){return worker.fetch(new Request('http://localhost:8787'+path,{method,headers:{Origin:'http://localhost:8787',...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},body:body instanceof FormData?body:body?JSON.stringify(body):undefined}),config);}
test('signed valid Access token accepted',()=>run(async()=>assert.equal((await verifyAccess(new Request('https://dashcontrol.zayedart.com/api/state',{headers:{'Cf-Access-Jwt-Assertion':await jwt(claims)}}),env)).email,claims.email)));
for(const [name,change]of [['expired',{exp:1}],['missing exp',{exp:undefined}],['future nbf',{nbf:Math.floor(Date.now()/1000)+3600}],['wrong audience',{aud:['wrong']}]])test(name+' Access token rejected',()=>run(async()=>assert.rejects(()=>jwt({...claims,...change}).then(token=>verifyAccess(new Request('https://dashcontrol.zayedart.com/api/state',{headers:{'Cf-Access-Jwt-Assertion':token}}),env)),e=>e.status===401)));
test('development bypass cannot run on production hosts',()=>run(async()=>{const r=await worker.fetch(new Request('https://dashcontrol.zayedart.com/api/state'),local);assert.equal(r.status,401);}));
test('cross-origin writes rejected',()=>run(async()=>assert.equal((await call('POST','/api/categories',{id:'test',name:{en:'Test',ar:'Test'}},local,{Origin:'https://other.example'})).status,403)));
test('photo metadata saved in one commit',()=>run(async mock=>{const r=await call('PATCH','/api/photos',{items:[{src:mock.data.photos[0].src,title:{en:'New title',ar:''}}]});assert.equal(r.status,200);assert.match((await r.json()).commitSha,/^[a-f0-9]{40}$/);assert.equal(mock.writes,1);assert.equal(mock.data.photos[0].title.en,'New title');}));
for(const status of [409,422])test(status+' conflicts retry a fresh head',()=>run(async mock=>{const r=await call('PATCH','/api/photos',{items:[{src:mock.data.photos[0].src,title:{en:'Retry title',ar:''}}]});assert.equal(r.status,200);assert.equal(mock.writes,2);assert.equal(mock.data.photos[0].title.en,'Retry title');},repoMock({conflict:status})));
test('invalid metadata cannot create a commit',()=>run(async mock=>{const r=await call('PATCH','/api/photos',{items:[{src:mock.data.photos[0].src,takenAt:'2026-02-30'}]});assert.equal(r.status,400);assert.equal(mock.writes,0);}));
test('nonempty categories cannot be deleted',()=>run(async mock=>assert.equal((await call('DELETE','/api/categories',{id:mock.data.categories[0].id})).status,409)));
test('reserved all category cannot be created',()=>run(async()=>assert.equal((await call('POST','/api/categories',{id:'all',name:{en:'All',ar:'All'}})).status,400)));
test('invalid image cannot reach GitHub',()=>run(async mock=>{const f=new FormData();f.append('file',new Blob(['RIFF0000WEBPx'],{type:'image/webp'}),'fake.webp');f.append('meta',JSON.stringify([{category:'cairo'}]));const r=await call('POST','/api/photos',f);assert.equal(r.status,400);assert.equal(mock.writes,0);}));
test('oversized request rejected before reading its body',()=>run(async()=>assert.equal((await call('POST','/api/photos','x',local,{'Content-Length':String(50*1024*1024)})).status,413)));
test('publication stays pending until the expected commit is live',()=>run(async()=>{const r=await call('GET','/api/publication?commit='+'a'.repeat(40));assert.equal((await r.json()).status,'pending');}));
test('publication recognizes the deployed commit',()=>run(async()=>{const r=await call('GET','/api/publication?commit='+'a'.repeat(40));assert.equal((await r.json()).status,'published');},repoMock({live:'a'.repeat(40)})));

test('upload, edit, move and delete stay atomic through the complete content lifecycle',()=>run(async mock=>{
 const form=new FormData();form.append('file',new Blob([Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64')],{type:'image/webp'}),'one.webp');form.append('meta',JSON.stringify([{category:'cairo',title:{en:'Test shot',ar:''},description:{en:'Optional caption',ar:''},takenAt:'2026-11-22'}]));
 let r=await call('POST','/api/photos',form);assert.equal(r.status,200);const added=(await r.json()).photos[0];assert.equal(mock.data.photos.length,original.photos.length+1);assert.equal(mock.writes,1);
 r=await call('PATCH','/api/photos',{items:[{src:added.src,category:'matrouh',title:{en:'Edited title',ar:''}}]});assert.equal(r.status,200);const moved=mock.data.photos.find(p=>p.title.en==='Edited title');assert.ok(moved.src.startsWith('/assets/photography/matrouh/'));assert.equal(mock.writes,2);
 r=await call('DELETE','/api/photos',{srcs:[moved.src]});assert.equal(r.status,200);assert.equal(mock.data.photos.length,original.photos.length);assert.equal(mock.writes,3);
}));
