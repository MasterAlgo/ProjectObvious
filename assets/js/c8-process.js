const E=i=>document.getElementById(i),stg=E('stg'),wp=E('wp');
const SEQ='ABRACADABRA',EM=[];for(let i=0;i<10;i++)EM.push([i,2]);EM.push([0,4],[7,4]);
const LD=[['AB',41,3,.6,2,5],['BR',37,3,.5,2,4],['RA',35,4,.4,2,4],['AC',12,9,.1,2,2],['CA',9,11,.1,2,2],['DA',7,14,.2,2,2]].map(a=>({id:a[0],n:a[1],a:a[2],r:a[3],c:a[4],k:a[5]}));
const CA=['AB','BR','RA','AC','CA','DA'],CB=['XY','YZ','ZX','QZ','AB','RA'];
const CAP=[
['Cut it into small pieces.','A mask slides over the input and cuts out sub-patterns. Together they form the test population. The mask can take every piece or only some.'],
['Have I seen pieces like these before?','Similarity between the test population and each trained population picks the class. For sequences, it picks the next token that fits the context.'],
['Add them to the tally.','Merge by ID: a known pattern updates its row (count, age, reward, links); a new pattern gets a new row. Dictionary attributes can represent graph relationships; key lookup and graph traversal remain different operations.'],
['Desk full? Move the pile to the warehouse.','When RAM fills, the RAM dictionaries are treated as a small test population and merged into a larger, finite disk repository. Many clients can do this together if they agree on the atomic patterns.'],
['Borrow only what the question needs.','Similarity to the prompt and the memories selects a soft, overlapping set of experts from the global repository. Only that set is loaded into the small device.']];
const NAMES=['1 Cut','2 Compare','3 Tally','4 Warehouse','5 Borrow'];
let k=1,run=0,auto=!matchMedia("(prefers-reduced-motion: reduce)").matches,T=new Map(),L=[],D=[];
const sleep=(ms,t)=>new Promise((a,b)=>setTimeout(()=>t===run?a():b(0),ms));
function box(el){const r=el.getBoundingClientRect(),s=stg.getBoundingClientRect();return{x:(r.left-s.left)/k,y:(r.top-s.top)/k}}
function fly(a,b,h,c,t){const A=box(a),B=box(b),g=document.createElement('div');g.className='chip ghost '+(c||'');g.innerHTML=h;g.style.left=A.x+'px';g.style.top=A.y+'px';stg.appendChild(g);g.getBoundingClientRect();g.style.transform='translate('+(B.x-A.x)+'px,'+(B.y-A.y)+'px)';return new Promise((r,j)=>setTimeout(()=>{g.remove();t===run?r():j(0)},580))}
function fit(){k=Math.min(1,wp.clientWidth/880);stg.style.transform='scale('+k+')';wp.style.height='';E('cap').style.marginTop=(500*k+12)+'px'}
function add(id){let e=T.get(id);if(e){e.cnt++;e.i.textContent=e.cnt;e.el.classList.remove('pop');void e.el.offsetWidth;e.el.classList.add('pop')}else{const el=document.createElement('span');el.className='chip pop';el.dataset.id=id;el.innerHTML=id+'<i>1</i>';E('tray').appendChild(el);T.set(id,{cnt:1,el,i:el.querySelector('i')})}}
function fillTray(){EM.forEach(([p,l])=>add(SEQ.substr(p,l)))}
function upd(el,o){el.innerHTML=[o.id,o.n,o.a,o.r.toFixed(1),o.c,o.k].map(x=>'<span>'+x+'</span>').join('')}
function newRow(o){const el=document.createElement('div');el.className='row';upd(el,o);E('ledg').appendChild(el);return el}
function mini(box,name,ids){box.innerHTML='<div class="t">'+name+'</div><div>'+ids.map(i=>'<span class="chip" data-id="'+i+'">'+i+'</span>').join('')+'</div><div class="m"><b></b></div><small>shared: 0</small>';box.classList.remove('win')}
function build(){
 stg.querySelectorAll('.ghost').forEach(g=>g.remove());T=new Map();
 E('strip').innerHTML=[...SEQ].map((c,i)=>'<span class="cell" style="left:'+i*22+'px">'+c+'</span>').join('')+'<div id="br"></div>';
 E('tray').innerHTML='';E('mk').textContent='';
 mini(E('la'),'class A',CA.concat(['...']));mini(E('lbb'),'class B',CB);
 L=LD.map(o=>Object.assign({},o));
 E('ledg').innerHTML='<div class="row h"><span>piece</span><span>seen</span><span>age</span><span>reward</span><span>size</span><span>links</span></div>';
 L.forEach(newRow);
 E('ram').style.width='25%';E('rcn').textContent='0.2 billion patterns';E('rcn').style.color='';E('zz').classList.remove('on');E('df').style.height='30%';
 let s=7;const rnd=()=>(s=(s*16807)%2147483647)/2147483647;D=[];E('fld').innerHTML='';
 for(let i=0;i<120;i++){const x=rnd()*248+2,y=rnd()*150+2,d1=Math.hypot(x-90,y-70)<52,d2=Math.hypot(x-150,y-95)<52,el=document.createElement('div');el.className='d';el.style.left=x+'px';el.style.top=y+'px';E('fld').appendChild(el);D.push({el,d1,d2})}
 E('dfl').style.width='0';E('dn').textContent='nothing loaded'}
async function b1(t){const w=ms=>sleep(ms,t),br=E('br');await w(400);
 for(const [p,l] of EM){br.style.opacity=1;br.style.left=p*22+'px';br.style.width=l*22+'px';E('mk').textContent=l==2?'mask: 2 letters, slides':'mask: 4 letters, sparse';await w(l==2?260:800);add(SEQ.substr(p,l));await w(l==2?60:500)}
 br.style.opacity=0;E('mk').textContent=''}
async function b2(t){const w=ms=>sleep(ms,t);fillTray();let a=0,b=0;const n=T.size;await w(600);
 for(const [id,e] of T){await w(260);const x=E('la').querySelector('[data-id="'+id+'"]'),y=E('lbb').querySelector('[data-id="'+id+'"]');
  if(x||y)e.el.classList.add('hit');
  if(x){x.classList.add('hit');a++;E('la').querySelector('.m b').style.width=a/n*100+'%';E('la').querySelector('small').textContent='shared: '+a+' of '+n}
  if(y){y.classList.add('hit');b++;E('lbb').querySelector('.m b').style.width=b/n*100+'%';E('lbb').querySelector('small').textContent='shared: '+b+' of '+n}}
 await w(700);E('la').classList.add('win');await w(900)}
async function b3(t){const w=ms=>sleep(ms,t);fillTray();await w(700);
 for(const [id,e] of T){const o=L.find(r=>r.id===id);let el;
  if(o){el=E('ledg').children[1+L.indexOf(o)]}else{const n={id,n:e.cnt,a:0,r:0,c:id.length,k:id.length>2?2:0};L.push(n);el=newRow(n);el.classList.add('n');el.style.visibility='hidden'}
  const tg=el;fly(e.el,tg,id,'',t).then(()=>{e.el.classList.add('used');if(o){o.n+=e.cnt;o.a=0;o.r=Math.min(1,o.r+.1);o.k+=1;upd(tg,o);tg.classList.add('f');setTimeout(()=>tg.classList.remove('f'),700)}else{tg.style.visibility='visible'}}).catch(()=>{});
  await w(300)}
 await w(1600)}
async function b4(t){const w=ms=>sleep(ms,t),r=E('ram'),c=E('rcn'),dk=E('df');await w(500);
 for(let i=0;i<=20;i++){r.style.width=(25+i*3.15)+'%';c.textContent=(0.2+i*.09).toFixed(1)+' billion patterns';await w(110)}
 c.textContent='RAM is full';c.style.color='var(--rd)';await w(900);
 E('zz').classList.add('on');for(let i=0;i<=8;i++){r.style.width=(88-i)+'%';await w(130)}
 await w(600);E('zz').classList.remove('on');c.style.color='';c.textContent='merging as a "test" population';
 await fly(r,dk,'RAM pile','',t);dk.style.height='46%';r.style.width='8%';c.textContent='0.1 billion patterns';await w(900);
 const cb=E('cl').children;
 for(let j=0;j<2;j++)for(let i=0;i<3;i++){fly(cb[i],dk,'','dg',t).catch(()=>{});await w(200)}
 await w(700);dk.style.height='60%';await w(900)}
async function b5(t){const w=ms=>sleep(ms,t);await w(500);
 D.filter(d=>d.d1).forEach((d,i)=>setTimeout(()=>{if(t===run)d.el.className='d d1'},i*20));await w(1400);
 D.filter(d=>d.d2).forEach((d,i)=>setTimeout(()=>{if(t===run)d.el.className='d '+(d.d1?'d3':'d2')},i*20));await w(1500);
 const lit=D.filter(d=>d.d1||d.d2);E('dfl').style.width=(lit.length/D.length*100)+'%';
 for(const d of lit.slice(0,26)){fly(d.el,E('dev'),'','dg',t).catch(()=>{});await w(90)}
 E('dn').textContent='loaded '+lit.length+' of '+D.length;await w(1200)}
const B=[b1,b2,b3,b4,b5];
function mark(i){document.querySelectorAll('.st').forEach((s,j)=>s.classList.toggle('on',j===i));E('ch').textContent=CAP[i][0];E('cp').textContent=CAP[i][1];document.querySelectorAll('#ctl button[data-i]').forEach(b=>b.classList.toggle('on',+b.dataset.i===i))}
async function go(i){const t=++run;build();mark(i);try{await B[i](t);if(auto&&i<4){await sleep(1300,t);go(i+1)}}catch(e){}}
E('ctl').innerHTML=NAMES.map((n,i)=>'<button data-i="'+i+'">'+n+'</button>').join('')+'<button id="rp">Replay</button><label><input type="checkbox" id="au" checked> Auto-play</label>';
document.querySelectorAll('#ctl button[data-i]').forEach(b=>b.onclick=()=>go(+b.dataset.i));
E('rp').onclick=()=>go(cur());
E('au').checked=auto;
E('au').onchange=e=>auto=e.target.checked;
function cur(){const b=document.querySelector('#ctl button.on');return b?+b.dataset.i:0}
addEventListener('resize',fit);fit();
const h=parseInt(location.hash.slice(1));go(h>=1&&h<=5?h-1:0);
