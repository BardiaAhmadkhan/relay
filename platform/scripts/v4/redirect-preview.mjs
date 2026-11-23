import http from 'node:http';
// Keep old local presenter bookmarks on the single qualified application.
http.createServer((req,res)=>{const p=new URL(req.url??'/','http://127.0.0.1').pathname;
 const page=['/vision','/fallback','/previous'].includes(p)?p:'/';
 res.writeHead(307,{Location:'http://127.0.0.1:8793'+page,'Cache-Control':'no-store'}).end();
}).listen(8792,'127.0.0.1');
