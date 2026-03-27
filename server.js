'use strict';
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const os       = require('os');
const path     = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });
const PORT   = process.env.PORT || 3000;

// ─── CONSTANTS ──────────────────────────────────────────────────────────────
const HEX_SIZE  = 75;
const CENTER_X  = 500;
const CENTER_Y  = 395;
const WIN_VP    = 10;

const PLAYER_COLORS = ['#ef4444','#3b82f6','#10b981','#f59e0b','#a855f7','#f97316'];

const RESOURCE_META = {
  data:       { label:'Data Capital',      color:'#3b82f6', dim:'#1e3a8a', abbr:'DATA' },
  human:      { label:'Human Capital',     color:'#f59e0b', dim:'#78350f', abbr:'HUMAN' },
  compute:    { label:'Compute Credits',   color:'#10b981', dim:'#064e3b', abbr:'COMPUTE' },
  trust:      { label:'Trust Tokens',      color:'#ef4444', dim:'#7f1d1d', abbr:'TRUST' },
  innovation: { label:'Innovation Points', color:'#a855f7', dim:'#4c1d95', abbr:'INNOV' },
  neutral:    { label:'Disruption Zone',   color:'#475569', dim:'#1e293b', abbr:'DISRUPT' },
};

const BUILD_COSTS = {
  pathway:  { data:1, human:1 },
  position: { data:1, human:1, compute:1, trust:1 },
  coe:      { innovation:2, data:2, compute:1 },
  card:     { innovation:1 },
};

const OPPORTUNITY_CARDS = [
  { id:'breakthrough',  name:'Breakthrough',           emoji:'💡', effect:'instant_vp',       desc:'Gain 1 Victory Point immediately.' },
  { id:'partnership',   name:'Strategic Partnership',  emoji:'🤝', effect:'bonus_resources',  desc:'Gain +1 of every resource type.' },
  { id:'talent',        name:'Talent Acquisition',     emoji:'🧲', effect:'steal_human',      desc:'Steal 2 Human Capital from any company.' },
  { id:'platform',      name:'Platform Play',          emoji:'🌐', effect:'data_from_paths',  desc:'Gain 1 Data Capital per Pathway you own.' },
  { id:'foundation',    name:'Foundation Model',       emoji:'🤖', effect:'free_position',    desc:'Place a Capability Position for free.' },
  { id:'iterate',       name:'Rapid Iteration',        emoji:'🔄', effect:'free_pathway',     desc:'Build a Pathway for free this round.' },
  { id:'moat',          name:'Data Moat',              emoji:'🔒', effect:'collect_per_opp',  desc:'Collect 1 Data Capital per opponent Capability Position.' },
  { id:'audit',         name:'Regulatory Audit',       emoji:'⚖️', effect:'all_lose_trust',  desc:'All opponents lose 1 Trust Token.' },
];

const DISRUPTION_CARDS = [
  { id:'regulatory',  name:'Regulatory Crackdown', emoji:'⚠️',  desc:'All companies lose 1 Trust Token.' },
  { id:'talent_war',  name:'AI Talent War',         emoji:'🧠',  desc:'All companies lose 1 Human Capital.' },
  { id:'outage',      name:'Cloud Outage',          emoji:'☁️',  desc:'All companies lose 1 Compute Credit.' },
  { id:'breach',      name:'Data Breach',           emoji:'🔓',  desc:'All companies lose 2 Data Capital.' },
  { id:'gold_rush',   name:'AI Gold Rush',          emoji:'🏆',  desc:'All companies gain +2 Innovation Points.' },
  { id:'mandate',     name:'AI Mandate',            emoji:'📋',  desc:'All companies gain +2 Trust Tokens.' },
];

const ARCHETYPES = [
  { id:'enterprise', name:'Enterprise Giant',         emoji:'🏦', bonus:'data' },
  { id:'disruptor',  name:'Tech Disruptor',           emoji:'🚀', bonus:'innovation' },
  { id:'regulated',  name:'Regulated Player',         emoji:'🛡️', bonus:'trust' },
  { id:'talent',     name:'Talent House',             emoji:'🧠', bonus:'human' },
  { id:'infra',      name:'Infrastructure Specialist',emoji:'☁️', bonus:'compute' },
  { id:'pioneer',    name:'Data Pioneer',             emoji:'📊', bonus:'data' },
];

// ─── HEX BOARD DEFINITION ───────────────────────────────────────────────────
const HEX_DEFS = [
  {q: 0, r: 0,  resource:'neutral',    number:0 },  // centre disruption zone
  {q: 1, r: 0,  resource:'data',       number:9 },
  {q: 0, r: 1,  resource:'human',      number:6 },
  {q:-1, r: 1,  resource:'compute',    number:5 },
  {q:-1, r: 0,  resource:'trust',      number:10},
  {q: 0, r:-1,  resource:'innovation', number:4 },
  {q: 1, r:-1,  resource:'data',       number:8 },
];

function hexToPixel(q, r) {
  return {
    x: CENTER_X + HEX_SIZE * Math.sqrt(3) * (q + r / 2),
    y: CENTER_Y + HEX_SIZE * 1.5 * r,
  };
}

function hexCorners(cx, cy, size) {
  return Array.from({length:6}, (_,i) => {
    const a = Math.PI / 180 * (-90 + 60 * i);
    return { x: Math.round((cx + size * Math.cos(a))*10)/10,
             y: Math.round((cy + size * Math.sin(a))*10)/10 };
  });
}

function buildBoard() {
  const hexes = HEX_DEFS.map((h, id) => {
    const {x,y} = hexToPixel(h.q, h.r);
    const corners = hexCorners(x, y, HEX_SIZE);
    return { id, q:h.q, r:h.r, x, y, corners, resource:h.resource, number:h.number };
  });

  const vMap = new Map(), verts = [];
  hexes.forEach(hex => {
    hex.corners.forEach(c => {
      const key = `${Math.round(c.x*2)},${Math.round(c.y*2)}`;
      if (!vMap.has(key)) {
        const id = verts.length;
        vMap.set(key, id);
        verts.push({ id, x:c.x, y:c.y, adjHexes:[], adjVerts:[], adjEdges:[], owner:null, type:null });
      }
      const vid = vMap.get(key);
      if (!verts[vid].adjHexes.includes(hex.id)) verts[vid].adjHexes.push(hex.id);
    });
    hex.vIds = hex.corners.map(c => vMap.get(`${Math.round(c.x*2)},${Math.round(c.y*2)}`));
  });

  const eMap = new Map(), edges = [];
  hexes.forEach(hex => {
    for (let i=0;i<6;i++) {
      const v1=hex.vIds[i], v2=hex.vIds[(i+1)%6];
      const key=[v1,v2].sort((a,b)=>a-b).join('-');
      if (!eMap.has(key)) {
        const id = edges.length; eMap.set(key,id);
        edges.push({id, v1, v2, x1:verts[v1].x, y1:verts[v1].y, x2:verts[v2].x, y2:verts[v2].y, owner:null});
      }
    }
  });
  edges.forEach(e => {
    verts[e.v1].adjVerts.push(e.v2); verts[e.v2].adjVerts.push(e.v1);
    verts[e.v1].adjEdges.push(e.id); verts[e.v2].adjEdges.push(e.id);
  });

  return { hexes, verts, edges };
}

const BOARD = buildBoard();

// Pre-compute 6 well-spaced perimeter vertices for starting positions
function findStartingVertices() {
  const cx = CENTER_X, cy = CENTER_Y;
  // Pick the 12 true outer tips (adj to exactly 1 hex) sorted by angle,
  // then choose every other one → 6 evenly-spaced positions around the board
  const tips = BOARD.verts
    .filter(v => v.adjHexes.length === 1)
    .sort((a,b) => Math.atan2(a.y-cy,a.x-cx) - Math.atan2(b.y-cy,b.x-cx));
  const step = Math.max(1, Math.floor(tips.length / 6));
  return Array.from({length:6}, (_,i) => tips[(i * step) % tips.length].id);
}
const STARTING_VERTS = findStartingVertices();

// ─── GAME STATE ─────────────────────────────────────────────────────────────
let state = freshState();

function freshState() {
  return {
    phase:'lobby', round:0, diceResult:null, dice:[null,null],
    hexes:  BOARD.hexes.map(h=>({...h,corners:h.corners.map(c=>({...c})),vIds:[...h.vIds],disrupted:false})),
    verts:  BOARD.verts.map(v=>({...v,adjHexes:[...v.adjHexes],adjVerts:[...v.adjVerts],adjEdges:[...v.adjEdges],owner:null,type:null})),
    edges:  BOARD.edges.map(e=>({...e,owner:null})),
    players:{}, submissions:{}, actionOpen:false, actionEnd:null,
    longestPath:{pid:null,len:0}, log:[], activatedHexes:[],
  };
}

// ─── HELPERS ────────────────────────────────────────────────────────────────
function localIP() {
  for (const ifaces of Object.values(os.networkInterfaces()))
    for (const i of ifaces)
      if (i.family==='IPv4'&&!i.internal) return i.address;
  return 'localhost';
}

function log(msg) {
  state.log.push({t:Date.now(),msg});
  if (state.log.length>60) state.log.shift();
}

function pubState() {
  return {
    phase:state.phase, round:state.round, diceResult:state.diceResult, dice:state.dice,
    hexes: state.hexes.map(h=>({id:h.id,q:h.q,r:h.r,x:h.x,y:h.y,corners:h.corners,resource:h.resource,number:h.number,disrupted:h.disrupted})),
    verts: state.verts.map(v=>({id:v.id,x:v.x,y:v.y,adjHexes:v.adjHexes,adjVerts:v.adjVerts,adjEdges:v.adjEdges,owner:v.owner,type:v.type})),
    edges: state.edges.map(e=>({id:e.id,v1:e.v1,v2:e.v2,x1:e.x1,y1:e.y1,x2:e.x2,y2:e.y2,owner:e.owner})),
    players: Object.fromEntries(Object.entries(state.players).map(([id,p])=>[id,pubPlayer(p)])),
    actionOpen:state.actionOpen, actionEnd:state.actionEnd,
    longestPath:state.longestPath, submittedCount:Object.keys(state.submissions).length,
    playerCount:Object.keys(state.players).length,
    log:state.log.slice(-20), activatedHexes:state.activatedHexes,
    winVP:WIN_VP,
  };
}

function pubPlayer(p) {
  return {id:p.id,name:p.name,company:p.company,archetype:p.archetype,color:p.color,
    resources:p.resources,vp:p.vp,posture:p.posture,cards:p.cards,hasLongest:p.hasLongest};
}

function canAfford(p,costs){ return Object.entries(costs).every(([r,n])=>(p.resources[r]||0)>=n); }
function spend(p,costs){ Object.entries(costs).forEach(([r,n])=>p.resources[r]=Math.max(0,(p.resources[r]||0)-n)); }

function calcVP(p) {
  let vp=0;
  state.verts.forEach(v=>{ if(v.owner===p.id) vp+=v.type==='coe'?2:1; });
  if(state.longestPath.pid===p.id) vp+=2;
  vp+=(p.cardVP||0);
  p.vp=vp; return vp;
}
function recalcVP(){ Object.values(state.players).forEach(calcVP); }

function longestPath(pid) {
  const myEdges=state.edges.filter(e=>e.owner===pid);
  if(!myEdges.length) return 0;
  let best=0;
  const sv=new Set(); myEdges.forEach(e=>{sv.add(e.v1);sv.add(e.v2);});
  function dfs(vid,used,d){
    best=Math.max(best,d);
    state.verts[vid].adjEdges.forEach(eid=>{
      if(used.has(eid)||state.edges[eid].owner!==pid) return;
      const e=state.edges[eid],nv=e.v1===vid?e.v2:e.v1;
      const nxt=state.verts[nv];
      if(nxt.owner!==null&&nxt.owner!==pid) return;
      used.add(eid); dfs(nv,used,d+1); used.delete(eid);
    });
  }
  sv.forEach(v=>dfs(v,new Set(),0));
  return best;
}

function updateLongest() {
  let bestLen=Math.max(4,state.longestPath.len), bestPid=state.longestPath.pid;
  Object.values(state.players).forEach(p=>{ const l=longestPath(p.id); if(l>bestLen){bestLen=l;bestPid=p.id;} });
  if(bestPid!==state.longestPath.pid){
    state.longestPath={pid:bestPid,len:bestLen};
    if(bestPid) log(`${state.players[bestPid]?.company} claims Longest Pathway! (${bestLen} segments)`);
    recalcVP();
  }
}

// BFS distance from player's network along player-owned edges
function minDistFromNetwork(vid, pid) {
  const starts = state.verts.filter(v => v.owner===pid).map(v => v.id);
  if (!starts.length) return Infinity;
  const dist = new Map();
  const queue = [...starts];
  starts.forEach(v => dist.set(v, 0));
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    const d = dist.get(cur);
    state.verts[cur].adjEdges.forEach(eid => {
      if (state.edges[eid].owner !== pid) return;
      const e = state.edges[eid];
      const nv = e.v1===cur ? e.v2 : e.v1;
      if (!dist.has(nv)) { dist.set(nv, d+1); queue.push(nv); }
    });
  }
  return dist.has(vid) ? dist.get(vid) : Infinity;
}

function canPlaceVert(vid, pid, setup=false){
  const v = state.verts[vid];
  if (!v || v.owner !== null) return false;
  if (v.adjVerts.some(av => state.verts[av].owner !== null)) return false;
  if (setup) return true;
  // Must be reachable via at least 2 own pathway edges from existing network
  return minDistFromNetwork(vid, pid) >= 2;
}

function canPlaceEdge(eid,pid){
  const e=state.edges[eid]; if(!e||e.owner!==null) return false;
  const v1=state.verts[e.v1],v2=state.verts[e.v2];
  if(v1.owner===pid||v2.owner===pid) return true;
  const check=v=>{ if(v.owner!==null&&v.owner!==pid) return false; return v.adjEdges.some(ae=>ae!==eid&&state.edges[ae].owner===pid); };
  return check(v1)||check(v2);
}

function distribute(diceVal) {
  const activated=[];
  state.hexes.forEach(h=>{
    if(h.number!==diceVal||h.disrupted||h.resource==='neutral') return;
    activated.push(h.id);
    state.verts.forEach(v=>{
      if(!v.adjHexes.includes(h.id)||!v.owner) return;
      const p=state.players[v.owner]; if(!p) return;
      const amt=v.type==='coe'?2:1;
      p.resources[h.resource]=(p.resources[h.resource]||0)+amt;
    });
  });
  state.activatedHexes=activated;
}

function applyAction(pid,action){
  const p=state.players[pid]; if(!p) return {ok:false,err:'No player'};
  if(action.type==='build_pathway'){
    if(!canPlaceEdge(action.edgeId,pid)) return {ok:false,err:'Invalid pathway location'};
    if(!canAfford(p,BUILD_COSTS.pathway)) return {ok:false,err:'Need 1 Data + 1 Human Capital'};
    spend(p,BUILD_COSTS.pathway); state.edges[action.edgeId].owner=pid;
    updateLongest(); log(`${p.company} built a Pathway`); return {ok:true};
  }
  if(action.type==='build_position'){
    if(!canPlaceVert(action.vertId,pid,action.setup)) return {ok:false,err:'Invalid or blocked location'};
    if(!action.setup&&!canAfford(p,BUILD_COSTS.position)) return {ok:false,err:'Need 1 Data+Human+Compute+Trust'};
    if(!action.setup) spend(p,BUILD_COSTS.position);
    state.verts[action.vertId].owner=pid; state.verts[action.vertId].type='position';
    recalcVP(); log(`${p.company} placed a Capability Position`); return {ok:true};
  }
  if(action.type==='upgrade_coe'){
    const v=state.verts[action.vertId];
    if(!v||v.owner!==pid||v.type!=='position') return {ok:false,err:'Must upgrade your own Capability Position'};
    if(!canAfford(p,BUILD_COSTS.coe)) return {ok:false,err:'Need 2 Innovation + 2 Data + 1 Compute'};
    spend(p,BUILD_COSTS.coe); v.type='coe';
    recalcVP(); log(`${p.company} upgraded to Centre of Excellence! 🏛️`); return {ok:true};
  }
  if(action.type==='buy_card'){
    if(!canAfford(p,BUILD_COSTS.card)) return {ok:false,err:'Need 1 Innovation Point'};
    spend(p,BUILD_COSTS.card);
    const card={...OPPORTUNITY_CARDS[Math.floor(Math.random()*OPPORTUNITY_CARDS.length)],uid:`${Date.now()}_${Math.random()}`};
    p.cards.push(card); log(`${p.company} drew an Opportunity Card`); return {ok:true};
  }
  if(action.type==='play_card'){
    const ci=p.cards.findIndex(c=>c.uid===action.cardUid); if(ci===-1) return {ok:false,err:'Card not found'};
    const card=p.cards.splice(ci,1)[0];
    switch(card.effect){
      case 'instant_vp': p.cardVP=(p.cardVP||0)+1; recalcVP(); log(`${p.company} played Breakthrough! +1 VP 💡`); break;
      case 'bonus_resources': ['data','human','compute','trust','innovation'].forEach(r=>p.resources[r]=(p.resources[r]||0)+1); log(`${p.company} played Strategic Partnership! 🤝`); break;
      case 'steal_human': if(action.targetId&&state.players[action.targetId]){const t=state.players[action.targetId];const s=Math.min(2,t.resources.human||0);t.resources.human-=s;p.resources.human=(p.resources.human||0)+s;log(`${p.company} acquired ${s} Human Capital from ${t.company} 🧲`);} break;
      case 'data_from_paths': {const c=state.edges.filter(e=>e.owner===pid).length;p.resources.data=(p.resources.data||0)+c;log(`${p.company} gained ${c} Data via Platform Play 🌐`);} break;
      case 'free_position': p.freePosition=true; log(`${p.company} has a free Position to place (Foundation Model) 🤖`); break;
      case 'free_pathway': p.freePathway=true; log(`${p.company} has a free Pathway to build (Rapid Iteration) 🔄`); break;
      case 'collect_per_opp': {let c=0;Object.values(state.players).forEach(op=>{if(op.id===pid)return;state.verts.forEach(v=>{if(v.owner===op.id)c++;})});c=Math.min(c,6);p.resources.data=(p.resources.data||0)+c;log(`${p.company} activated Data Moat! +${c} Data Capital 🔒`);} break;
      case 'all_lose_trust': Object.values(state.players).forEach(op=>{if(op.id!==pid&&(op.resources.trust||0)>0)op.resources.trust--;});log(`${p.company} triggered Regulatory Audit! Opponents lose Trust ⚖️`); break;
    }
    return {ok:true};
  }
  if(action.type==='pass') return {ok:true};
  return {ok:false,err:'Unknown action'};
}

// ─── SOCKET.IO ──────────────────────────────────────────────────────────────
io.on('connection', socket=>{
  const role=socket.handshake.query.role||'player';

  socket.emit('init',{
    resourceMeta:RESOURCE_META, buildCosts:BUILD_COSTS,
    opportunityCards:OPPORTUNITY_CARDS, disruptionCards:DISRUPTION_CARDS,
    archetypes:ARCHETYPES, winVP:WIN_VP,
  });
  socket.emit('state',pubState());

  // ── PLAYER ──
  socket.on('player:join',({company,archetype})=>{
    if(state.phase!=='lobby')
      return socket.emit('join_error',{err:'The game has already started — you cannot join now.'});
    if(Object.keys(state.players).length>=6)
      return socket.emit('join_error',{err:'The game is full — maximum 6 companies.'});
    if(!company||!company.trim())
      return socket.emit('join_error',{err:'Please enter a company name.'});
    const usedColors=Object.values(state.players).map(p=>p.color);
    const color=PLAYER_COLORS.find(c=>!usedColors.includes(c))||PLAYER_COLORS[0];
    const arch=ARCHETYPES.find(a=>a.id===archetype)||ARCHETYPES[0];
    const startRes={data:2,human:2,compute:1,trust:1,innovation:1};
    if(arch.bonus) startRes[arch.bonus]=(startRes[arch.bonus]||0)+1;
    state.players[socket.id]={
      id:socket.id,name:company.trim(),company:company.trim(),archetype:archetype||'enterprise',color,
      resources:startRes,vp:0,posture:'balanced',cards:[],cardVP:0,hasLongest:false,
    };
    log(`${company.trim()} joined the game!`);
    io.emit('state',pubState());
    socket.emit('join_ok',{});
  });

  socket.on('player:posture',({posture})=>{ const p=state.players[socket.id]; if(p){p.posture=posture;io.emit('state',pubState());} });

  socket.on('player:action',action=>{
    if(!state.actionOpen) return socket.emit('action_result',{ok:false,err:'Action window is closed'});
    if(state.submissions[socket.id]) return socket.emit('action_result',{ok:false,err:'Already submitted this round'});
    state.submissions[socket.id]={action,ts:Date.now()};
    socket.emit('action_queued',{});
    io.emit('state',pubState());
  });

  // ── ADMIN ──
  socket.on('admin:add_player',({company,archetype})=>{
    if(role!=='admin') return;
    const id='p_'+Date.now();
    const usedColors=Object.values(state.players).map(p=>p.color);
    const color=PLAYER_COLORS.find(c=>!usedColors.includes(c))||PLAYER_COLORS[0];
    const arch=ARCHETYPES.find(a=>a.id===archetype)||ARCHETYPES[0];
    const startRes={data:2,human:2,compute:1,trust:1,innovation:1};
    if(arch.bonus) startRes[arch.bonus]=(startRes[arch.bonus]||0)+1;
    state.players[id]={id,name:company,company,archetype,color,resources:startRes,vp:0,posture:'balanced',cards:[],cardVP:0,hasLongest:false};
    log(`${company} added to game.`);
    io.emit('state',pubState());
  });

  socket.on('admin:remove_player',({pid})=>{
    if(role!=='admin') return;
    if(state.players[pid]) log(`${state.players[pid].company} removed.`);
    delete state.players[pid]; delete state.submissions[pid];
    io.emit('state',pubState());
  });

  socket.on('admin:start',()=>{
    if(role!=='admin') return;
    state.phase='playing'; state.round=1;
    // Auto-assign one starting Capability Position to each player
    const players = Object.values(state.players);
    players.forEach((p, i) => {
      const vid = STARTING_VERTS[i % STARTING_VERTS.length];
      if (state.verts[vid] && state.verts[vid].owner === null) {
        state.verts[vid].owner = p.id;
        state.verts[vid].type = 'position';
      }
    });
    recalcVP();
    log('🚀 AI Frontier has begun! Each company has received a starting Capability Position. Build 2 Pathways to claim a new one.');
    io.emit('state',pubState()); io.emit('game_started',{});
  });

  socket.on('admin:roll',()=>{
    if(role!=='admin'||state.phase!=='playing') return;
    const d1=Math.ceil(Math.random()*6),d2=Math.ceil(Math.random()*6);
    state.dice=[d1,d2]; state.diceResult=d1+d2;
    distribute(state.diceResult);
    log(`🎲 Roll: ${d1}+${d2}=${state.diceResult} — resources distributed to adjacent positions!`);
    io.emit('dice_rolled',{dice:state.dice,result:state.diceResult,activated:state.activatedHexes});
    io.emit('state',pubState());
  });

  socket.on('admin:open_actions',({duration=90}={})=>{
    if(role!=='admin') return;
    state.actionOpen=true; state.actionEnd=Date.now()+duration*1000; state.submissions={};
    state.activatedHexes=[];
    log(`⏱ Action window open — ${duration} seconds! Make your moves.`);
    io.emit('state',pubState()); io.emit('action_window',{open:true,duration,endsAt:state.actionEnd});
  });

  socket.on('admin:close_actions',()=>{
    if(role!=='admin') return;
    state.actionOpen=false; state.actionEnd=null;
    const sorted=Object.entries(state.submissions).sort(([,a],[,b])=>a.ts-b.ts);
    sorted.forEach(([pid,sub])=>{ const res=applyAction(pid,sub.action); if(!res.ok) io.to(pid).emit('action_result',{ok:false,err:res.err}); });
    state.submissions={}; recalcVP();
    const winner=Object.values(state.players).find(p=>p.vp>=WIN_VP);
    if(winner){ state.phase='game-over'; log(`🏆 ${winner.company} wins with ${winner.vp} Victory Points!`); io.emit('game_over',{winner:pubPlayer(winner),players:Object.values(state.players).map(pubPlayer)}); }
    else { state.round++; log(`Round ${state.round} begins.`); }
    io.emit('state',pubState()); io.emit('action_window',{open:false});
  });

  socket.on('admin:disrupt',({cardId})=>{
    if(role!=='admin') return;
    const card=DISRUPTION_CARDS.find(c=>c.id===cardId); if(!card) return;
    switch(cardId){
      case 'regulatory': Object.values(state.players).forEach(p=>{if((p.resources.trust||0)>0)p.resources.trust--;}); break;
      case 'talent_war': Object.values(state.players).forEach(p=>{if((p.resources.human||0)>0)p.resources.human--;}); break;
      case 'outage':     Object.values(state.players).forEach(p=>{if((p.resources.compute||0)>0)p.resources.compute--;}); break;
      case 'breach':     Object.values(state.players).forEach(p=>{p.resources.data=Math.max(0,(p.resources.data||0)-2);}); break;
      case 'gold_rush':  Object.values(state.players).forEach(p=>{p.resources.innovation=(p.resources.innovation||0)+2;}); break;
      case 'mandate':    Object.values(state.players).forEach(p=>{p.resources.trust=(p.resources.trust||0)+2;}); break;
    }
    log(`⚡ DISRUPTION: ${card.emoji} ${card.name} — ${card.desc}`);
    io.emit('state',pubState()); io.emit('disruption',{card});
  });

  socket.on('admin:reset',()=>{
    if(role!=='admin') return;
    state=freshState(); io.emit('state',pubState()); io.emit('reset',{}); log('Game reset.');
  });

  socket.on('disconnect',()=>{
    if(state.players[socket.id]){ log(`${state.players[socket.id].company} disconnected.`); delete state.players[socket.id]; delete state.submissions[socket.id]; io.emit('state',pubState()); }
  });
});

// ─── HTTP ────────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));

// / and /player → player join screen (what phones open via QR)
app.get('/',      (_,res)=>res.sendFile(path.join(__dirname,'public','player.html')));
app.get('/player',(_,res)=>res.sendFile(path.join(__dirname,'public','player.html')));

// /board → big host/display screen
app.get('/board', (_,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

// /admin → facilitator panel
app.get('/admin', (_,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));

app.get('/api/state',(_,res)=>res.json(pubState()));
app.get('/api/info', (_,res)=>res.json({ip:localIP(),port:PORT}));

function startServer(port) {
  server.listen(port, '0.0.0.0', () => {
    const ip = localIP();
    console.log('');
    console.log('  AI FRONTIER - Enterprise AI Strategy Game');
    console.log('  ==========================================');
    console.log('  📱 Players (scan QR or type on phone):');
    console.log('     http://' + ip + ':' + port + '/');
    console.log('  🖥️  Board display (big screen):');
    console.log('     http://localhost:' + port + '/board');
    console.log('  👑 Admin / Facilitator:');
    console.log('     http://localhost:' + port + '/admin');
    console.log('');
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const nextPort = server.address()?.port + 1 || PORT + 1;
    console.warn(`⚠️  Port ${err.port || PORT} is in use — trying port ${nextPort}...`);
    server.close();
    startServer(nextPort);
  } else {
    throw err;
  }
});

startServer(PORT);
