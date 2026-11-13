(()=>{
  'use strict';
  const byId=id=>document.getElementById(id);
  const steps=[...document.querySelectorAll('.step')];
  const prog=[...document.querySelectorAll('.progress i')];
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  let active=0,kind='sequence',mode='classify',playing=!reduced.matches,timer=null;
  const notes=[
    ['01 / OBSERVE','One sample enters the system','An observation is converted to the agreed atomic symbol convention. It may be a character stream, a graded time window, or a quantized image. This is the only place where the chosen sensor representation matters.','Input identities must agree before their derived pattern keys can be merged across machines.'],
    ['02 / MASK','A sample becomes a population','Apply a decomposition mask: contiguous, skipped, spatial or other admissible combinations. Enumerate all candidates when feasible; otherwise select a subset. Each resulting pattern has a reproducible symbolic identity.','Mask parameters, grades, atomic IDs, and key construction belong to the pattern namespace.'],
    ['03 / INFER','Compare first, if inference is wanted','Compare the test population with resident trained populations. For classification, compare class-associated populations. For sequence generation, compare candidate (context + next-token) populations. Then keep learning independently of whether a prediction was requested.','The bars are schematic similarity scores, not probabilities or benchmark measurements.'],
    ['04 / LEARN','Dictionary merge, not graph traversal','Look up each test pattern by symbolic key in RAM. If present, update its attributes (frequency, associations, age, class evidence…). Otherwise insert a new entry. Supervised learning may choose a class-specific destination.','A dictionary can store graph-like relationships as attributes; explicit keys simplify keyed merges.'],
    ['05 / SPILL & MERGE','RAM is the working set, not the universe','When the RAM working set reaches its budget, flush a delta or sorted chunk to persistent storage. Merge matching IDs and their attributes; insert missing keys. Apply salience-based retention/pruning during the merge, in an offline “sleep” phase, or both. Deletions and negative deltas need explicit merge rules.','Multiple clients can contribute compatible chunks if they share atomic encodings, key schemes, and merge rules. The networked workflow is an architectural extension.'],
    ['06 / RECALL','Retrieve a working community, not fixed modules','A prompt, task, or memory context selects relevant regions of a global pattern repository by population similarity. Load an affordable mixture of patterns across complexity levels into local RAM. These “experts” overlap; no hard partition is required.','Large-scale retrieval requires an efficient candidate index or hierarchical narrowing before full similarity scoring. The adaptive recall policy remains a proposal.']
  ];
  function renderSample(){
    if(kind==='sequence'){
      byId('sampleBody').innerHTML='<span class="seq">A <b>B R A</b> C A D A B R A</span><span class="smallnote mono">atomic symbols · example sequence</span>';
    }else{
      const map=['00111100','01100110','00000110','00001100','00011000','00110000','01111110','00000000'];
      byId('sampleBody').innerHTML='<span class="sampleGrid" aria-label="Quantized 8 by 8 image of digit two">'+map.join('').split('').map(b=>'<i class="'+(b==='1'?'lit':'')+'"></i>').join('')+'</span><span class="smallnote mono" style="text-align:center">8 × 8 quantized image</span>';
    }
  }
  function renderPatterns(){
    const vals=kind==='sequence'?['ABR','BRA','ACA','CAD','DAB','ABRA','A·R·A','BRA·A']:['01/11','011/110','110/001','001/011','011/111','100/011','11/01','001/110'];
    byId('patternBody').innerHTML=vals.map((v,i)=>'<span class="pattern '+(i===0||i===3?'emph':i>5?'softer':'')+'">'+v+'</span>').join('');
    byId('patternNote').textContent=kind==='sequence'?'substrings / skips · symbolic IDs':'local masks / patches · symbolic IDs';
  }
  function renderInference(){
    const items= mode==='classify'?(kind==='sequence'?[['class α',78],['class β',46]]:[['digit 2',84],['digit 3',42]]):(kind==='sequence'?[['next A',73],['next B',29]]:[['next row 01',70],['next row 10',38]]);
    byId('inferBody').innerHTML='<div class="pstat">'+(mode==='classify'?'CLASS SIMILARITY':'CANDIDATE-CONTEXT SIMILARITY')+'</div>'+items.map((d,i)=>'<div class="barlabel"><span>'+d[0]+'</span><span>'+d[1]+' / 100</span></div><div class="track '+(i?'second':'')+'"><i style="width:'+d[1]+'%"></i></div>').join('')+'<span class="smallnote mono">schematic similarities only</span>';
  }
  function renderRam(){
    const keys=kind==='sequence'?['ABR','BRA','ACA','A·R·A']:['011/110','110/001','001/011','100/011'];
    const acts=[['matched · count ↑','up'],['matched · weight ↑','up'],['new key · insert','add'],['low salience · prune','drop']];
    byId('ramBody').innerHTML=keys.map((k,i)=>'<div><code>'+k+'</code><span class="action '+acts[i][1]+'">'+acts[i][0]+'</span></div>').join('');
  }
  function renderExperts(){
    const names=kind==='sequence'?['strings','prefixes','context']:['strokes','curves','digits'];
    byId('expertBody').innerHTML='<span class="expert a">'+names[0]+'</span><span class="expert b">'+names[1]+'</span><span class="expert c"><span>'+names[2]+'</span></span><span class="shared">shared IDs</span>';
  }
  function redrawLinks(){
    const d=byId('diagram'),svg=byId('links');
    if(innerWidth<=740){svg.innerHTML='';return;}
    const box=d.getBoundingClientRect();
    const rects=steps.map(s=>{let r=s.getBoundingClientRect();return{x:r.left-box.left,y:r.top-box.top,w:r.width,h:r.height};});
    const point=(i,side,shift=0)=>{const r=rects[i];if(side==='right')return[r.x+r.w,r.y+r.h*.5+shift];if(side==='left')return[r.x,r.y+r.h*.5+shift];if(side==='top')return[r.x+r.w*.5+shift,r.y];return[r.x+r.w*.5+shift,r.y+r.h];};
    const path=(a,b)=>`M${a[0]} ${a[1]} L${b[0]} ${b[1]}`;
    const btm=Math.max(...rects.map(r=>r.y+r.h))+34;
    const retA=point(5,'bottom'),retB=point(3,'bottom');
    const returnPath=`M${retA[0]} ${retA[1]} C${retA[0]} ${btm},${retB[0]} ${btm},${retB[0]} ${retB[1]}`;
    const feedbackA=point(3,'top',40),feedbackB=point(2,'bottom',40);
    const defs='<defs><marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L6 3 L0 6" fill="none" stroke="#597793" stroke-width="1.4"/></marker><marker id="arrOn" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L6 3 L0 6" fill="none" stroke="#3fcaff" stroke-width="1.8"/></marker></defs>';
    const paths=[path(point(0,'right'),point(1,'left')),path(point(1,'right'),point(2,'left')),path(point(2,'bottom',-35),point(3,'top',-35)),path(point(3,'left'),point(4,'right')),path(point(4,'left'),point(5,'right')),returnPath];
    svg.setAttribute('viewBox',`0 0 ${box.width} ${box.height}`);
    svg.innerHTML=defs+paths.map((p,i)=>`<path class="pipe ${i===active?'active':''}" d="${p}" marker-end="url(#${i===active?'arrOn':'arr'})"/>`).join('')+`<path class="pipe feedback ${active===2?'active':''}" d="${path(feedbackA,feedbackB)}" marker-end="url(#${active===2?'arrOn':'arr'})"/>`;
  }
  function render(){
    renderSample();renderPatterns();renderInference();renderRam();renderExperts();
    steps.forEach((s,i)=>{s.classList.toggle('current',i===active);s.setAttribute('aria-current',i===active?'step':'false');});
    prog.forEach((s,i)=>s.classList.toggle('on',i<=active));
    const n=notes[active];byId('detailStep').textContent='STEP '+n[0];byId('detailTitle').textContent=n[1];byId('detailText').textContent=n[2];byId('detailAside').textContent=n[3];
    byId('sequence').setAttribute('aria-pressed',String(kind==='sequence'));byId('image').setAttribute('aria-pressed',String(kind==='image'));
    byId('classify').setAttribute('aria-pressed',String(mode==='classify'));byId('predict').setAttribute('aria-pressed',String(mode==='predict'));
    byId('play').textContent=playing?'Pause animation':'Play animation';
    requestAnimationFrame(redrawLinks);
  }
  function setTimer(){if(timer)clearInterval(timer);timer=playing?setInterval(()=>{active=(active+1)%6;render()},3600):null;}
  function setActive(i){active=(i+6)%6;render();setTimer();}
  steps.forEach((s,i)=>s.addEventListener('click',()=>setActive(i)));
  byId('sequence').addEventListener('click',()=>{kind='sequence';render()});
  byId('image').addEventListener('click',()=>{kind='image';render()});
  byId('classify').addEventListener('click',()=>{mode='classify';render()});
  byId('predict').addEventListener('click',()=>{mode='predict';render()});
  byId('play').addEventListener('click',()=>{playing=!playing;render();setTimer()});
  byId('next').addEventListener('click',()=>setActive(active+1));
  byId('prev').addEventListener('click',()=>setActive(active-1));
  window.addEventListener('resize',redrawLinks);
  reduced.addEventListener('change',e=>{if(e.matches){playing=false;render();setTimer()}});
  render();setTimer();
})();
