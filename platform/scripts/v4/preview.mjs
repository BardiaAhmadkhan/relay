import http from 'node:http';
import {readPublicVision} from '../../server/v4/public-vision.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
const stage=process.env.RELAY_V4_PREVIEW_BUILD??'relay-v4-event-preview';
if(!/^relay-v4-(?:event-preview|preview-[a-z0-9-]+)$/.test(stage))throw Error('Invalid local presenter build.');
const proofName=process.env.RELAY_V4_PREVIEW_PROOF??'walkthrough';
if(!/^[a-z0-9-]{1,64}$/.test(proofName))throw Error('Invalid recorded walkthrough.');
const root=path.resolve('.cache',stage),proof=path.resolve('.local/walkthroughs',proofName);
const port=Number(process.env.RELAY_V4_PREVIEW_PORT??8793);
const apiPort=Number(process.env.RELAY_V4_PREVIEW_API_PORT??(port===8792?8804:port===8802?8806:8794));
if(![8794,8804,8806].includes(apiPort))throw Error('Unknown private event API.');
const slides=existsSync(proof)?(await fs.readdir(proof)).filter(n=>/^[a-z0-9-]{1,80}\.png$/.test(n)).sort().map(n=>[n.slice(0,-4),n.slice(0,-4).replaceAll('-',' ')]):[];
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const frame=(title,content,script='')=>'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><style>*{box-sizing:border-box}body{margin:0;color:#21392e;background:#f6f4ee;font-family:system-ui,sans-serif}main{max-width:970px;margin:0 auto;padding:20px 25px 45px}header,nav{display:flex;justify-content:space-between;align-items:center;gap:16px}header{padding:8px 0 16px;border-bottom:1px solid #bcc4b8}h1,h2,h3{font-family:Georgia,serif;font-weight:normal}h1{font-size:clamp(30px,4vw,52px);margin:16px 0}h2{margin-top:1.4em}p,li,td{line-height:1.5}a,button{color:#214834}button,a.action{border:1px solid #768c7a;border-radius:22px;background:#fff;padding:9px 15px;font:inherit;text-decoration:none}img{display:block;max-height:70vh;max-width:100%;margin:10px auto;border:1px solid #c7cec6}table{width:100%;border-collapse:collapse}td,th{padding:8px;text-align:left;border-bottom:1px solid #ccd2c8}small{color:#4c6054}figure{margin:0}@media(min-width:900px){body{background:#dfe6dc}figure img{border:5px solid #233c30;border-radius:28px;box-shadow:0 14px 46px #1f3a2a30;max-height:73vh;background:#f6f5f1}}#caption{text-align:center}nav{justify-content:center;margin:10px}</style><main><header><b>relay</b><div>Moto Reloaded</div></header>'+content+'</main>'+script+'</html>';
const clean=s=>esc(s.replace(/\[([^\]]+)\]\([^)]+\)/g,'$1')).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\x60/g,'');
function vision(md){const out=[];let table=false;for(const line of md.split(/\r?\n/)){const v=line.trim();if(v.startsWith('|')){if(/^\|[ :|-]+\|$/.test(v))continue;if(!table){out.push('<table>');table=true;}out.push('<tr>'+v.slice(1,-1).split('|').map(c=>'<td>'+clean(c.trim())+'</td>').join('')+'</tr>');continue;}if(table){out.push('</table>');table=false;}if(!v)continue;if(/^#{1,3} /.test(v)){const n=v.match(/^#+/)[0].length;out.push('<h'+n+'>'+clean(v.slice(n+1))+'</h'+n+'>');}else out.push('<p>'+clean(v.replace(/^[-*] /,'• '))+'</p>');}if(table)out.push('</table>');return frame('Complete vision',out.join('')+'<a class="action" href="/fallback">Recorded screens</a>');}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.css':'text/css','.ttf':'font/ttf','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
const app=http.createServer(async(req,res)=>{try{
 if(!['GET','HEAD'].includes(req.method??'')){res.writeHead(405).end();return;}
 const url=new URL(req.url??'/','http://127.0.0.1');let body,type;
 if(url.pathname==='/health'){body=JSON.stringify({status:'ok',eventBundle:existsSync(path.join(root,'index.html')),screenshots:slides.filter(([f])=>existsSync(path.join(proof,f+'.png'))).length});type='application/json';}
 else if(url.pathname==='/previous'&&stage==='relay-v4-event-preview'){const previous=path.resolve('.cache/relay-v4-preview-navigate/index.html');body=await fs.readFile(previous);type=mime['.html'];}
 else if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 else if(url.pathname==='/vision'){try{body=vision(readPublicVision());type=mime['.html'];}catch{res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8'}).end('The presentation copy is awaiting review.');return;}}
 else if(url.pathname==='/fallback'){
   const ready=slides.filter(([f])=>existsSync(path.join(proof,f+'.png')));if(!ready.length){res.writeHead(404).end('No recorded screens.');return;}
   body=frame('Recorded mobile walkthrough','<p><small>Recorded local mobile rehearsal</small></p><figure><img id="screen" alt=""><figcaption id="caption"></figcaption></figure><nav><button id="prev">Previous</button><button id="next">Next</button><a class="action" href="/vision">Complete vision</a></nav>', '<script>const shots='+JSON.stringify(ready)+';let i=0;const picture=document.getElementById("screen"),label=document.getElementById("caption");function show(n){i=(n+shots.length)%shots.length;picture.src="/recorded/"+shots[i][0]+".png";picture.alt=shots[i][1];label.textContent=(i+1)+" / "+shots.length+" · "+shots[i][1];}document.getElementById("prev").onclick=()=>show(i-1);document.getElementById("next").onclick=()=>show(i+1);document.onkeydown=e=>{if(e.key==="ArrowRight")show(i+1);if(e.key==="ArrowLeft")show(i-1);};show(0)</script>');type=mime['.html'];
 }else if(url.pathname.startsWith('/recorded/')){
   const target=url.pathname.slice(10);if(!slides.some(([f])=>target===f+'.png')){res.writeHead(404).end();return;}body=await fs.readFile(path.join(proof,target));type='image/png';
 }else{
   const rel=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\/+/,''),file=path.resolve(root,rel);
   if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
   body=await fs.readFile(file);type=mime[path.extname(file)]??'application/octet-stream';
   if(rel==='index.html')body=body.toString('utf8').replace('<head>','<head><script>globalThis.__RELAY_EVENT_API_PORT__='+apiPort+'</script>').replace(/<title>[^<]*<\/title>/i,'<title>Relay · Moto Reloaded</title>');
 }
 res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:body);
 }catch{res.writeHead(404).end('Unavailable.');}});
app.listen(port,'127.0.0.1',()=>console.log('Relay mobile preview and offline presenter material: http://127.0.0.1:'+port));
