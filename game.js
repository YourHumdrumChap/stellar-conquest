/* Galactic Conquest — RTS Prototype
   Single-file game logic: procedural galaxy, sectors, starlanes, fleets, economy, UI.
   Save as game.js and open index.html in browser.
*/
(() => {
  'use strict';

  // ==== Constants ====
  const PLAYER_ID = 1;
  const AI_ID = 2;
  const NEUTRAL = 0;

  const COLORS = {
    [PLAYER_ID]: '#4DA6FF',
    [AI_ID]: '#FF6666',
    [NEUTRAL]: '#9aa6b2'
  };

  // Element refs
  const canvas = document.getElementById('galaxyCanvas');
  const ctx = canvas.getContext('2d', {alpha:false});
  const creditsEl = document.getElementById('credits');
  const incomeEl = document.getElementById('income');
  const selNameEl = document.getElementById('selName');
  const selOwnerEl = document.getElementById('selOwner');
  const selProdEl = document.getElementById('selProd');
  const selFleetsEl = document.getElementById('selFleets');
  const messagesEl = document.getElementById('messages');
  const timeEl = document.getElementById('time');

  const mainMenu = document.getElementById('mainMenu');
  const startBtn = document.getElementById('startBtn');
  const seedBtn = document.getElementById('seedBtn');
  const toMenuBtn = document.getElementById('toMenu');
  const resultOverlay = document.getElementById('resultOverlay');
  const resultMenuBtn = document.getElementById('resultMenuBtn');
  const buildSmallBtn = document.getElementById('buildSmall');
  const buildLargeBtn = document.getElementById('buildLarge');
  const pauseBtn = document.getElementById('pauseBtn');
  const speedBtn = document.getElementById('speedBtn');
  const instructionsBtn = document.getElementById('instructionsBtn');
  const surrenderBtn = document.getElementById('surrender');

  // Game state container
  let Game = {
    width: canvas.width,
    height: canvas.height,
    systems: [],     // nodes
    edges: [],       // starlanes
    sectors: [],     // sectors
    fleets: [],      // moving fleets (not stationed)
    nextFleetId: 1,
    credits: 300,
    time: 0,
    paused: false,
    speed: 1,
    selectedSystemId: null,
    selectedFleetId: null,
    msgs: [],
    seed: Math.floor(Math.random()*1000000)
  };

  // ==== Util helpers ====
  function rand(seedless=false){
    // simple RNG seeded by Game.seed (deterministic per start)
    if(seedless) return Math.random();
    return (function() {
      let s = Game.seed;
      // xorshift
      s ^= s << 13;
      s ^= s >> 17;
      s ^= s << 5;
      Game.seed = s >>> 0;
      return (Game.seed % 1000000) / 1000000;
    })();
  }
  function rrange(a,b){ return a + rand()* (b-a); }
  function rint(a,b){ return Math.floor(rrange(a,b+1)); }

  function addMessage(txt){
    const t = document.createElement('div');
    t.textContent = (new Date()).toLocaleTimeString() + ' — ' + txt;
    messagesEl.prepend(t);
  }

  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  // Random name generator (syllable combinator)
  const sylls = ["nor","tar","ven","kle","ri","mar","sol","zen","dax","quu","lor","bel","tra","sal","ion","aer","yr","ul","fen","gyr","oth","rex","cer","val"];
  function randomName(parts=2){
    let n = '';
    for(let i=0;i<parts;i++){
      n += sylls[Math.floor(rand()*sylls.length)];
    }
    // Capitalize
    return n.charAt(0).toUpperCase() + n.slice(1);
  }

  // Convex hull (Graham scan)
  function convexHull(points){
    if(points.length <= 3) return points.slice();
    const sorted = points.slice().sort((a,b) => a.x === b.x ? a.y - b.y : a.x - b.x);
    const cross = (o,a,b) => (a.x-o.x)*(b.y-o.y) - (a.y-o.y)*(b.x-o.x);
    const lower = [];
    for(const p of sorted) {
      while(lower.length >=2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for(let i=sorted.length-1;i>=0;i--){
      const p = sorted[i];
      while(upper.length >=2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) upper.pop();
      upper.push(p);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }

  // Distance
  function dist(a,b){
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx*dx + dy*dy);
  }

  // ==== Galaxy generation ====
  function generateGalaxy(seedVal) {
    Game.seed = (seedVal !== undefined) ? seedVal : Math.floor(Math.random()*999999);
    Game.systems = [];
    Game.edges = [];
    Game.sectors = [];
    Game.fleets = [];
    Game.nextFleetId = 1;
    Game.time = 0;
    Game.credits = 300;

    const W = Game.width = canvas.width;
    const H = Game.height = canvas.height;

    const sectorCount = rint(4,7);
    // generate sector centers
    for(let i=0;i<sectorCount;i++){
      const center = { x: rrange(150, W-150), y: rrange(120, H-120), color: `hsla(${Math.floor(rand()*360)},60%,50%,0.15)` };
      const sector = { id:i, center, systems: [], hull: [] , name: randomName(rint(1,2)) };
      const count = rint(4, 10);
      for(let s=0;s<count;s++){
        // place systems around center with elliptical jitter
        const angle = rrange(0, Math.PI*2);
        const radius = rrange(10, 110);
        const x = center.x + Math.cos(angle) * radius + rrange(-18,18);
        const y = center.y + Math.sin(angle) * radius + rrange(-14,14);
        const sys = {
          id: Game.systems.length,
          x: clamp(x, 40, W-40),
          y: clamp(y, 40, H-40),
          name: randomName(rint(1,2)),
          sectorId: i,
          ownerId: NEUTRAL,
          production: rrange(0.5, 3.5), // credits per second
          stationed: [], // fleet ids stationed here
          defense: rint(0,2) // some defense baseline
        };
        Game.systems.push(sys);
        sector.systems.push(sys);
      }
      Game.sectors.push(sector);
    }

    // compute hulls for sectors
    for(const sector of Game.sectors){
      sector.hull = convexHull(sector.systems.map(s=>({x:s.x,y:s.y})));
    }

    // Create starlanes (connect each system to its k nearest neighbors)
    const k = 3;
    for(const s of Game.systems){
      const neighbors = Game.systems.slice().filter(x => x !== s).sort((a,b)=> dist(s,a) - dist(s,b)).slice(0,k);
      for(const n of neighbors){
        // avoid duplicate edges
        if(!Game.edges.some(e => (e.a===s.id && e.b===n.id) || (e.a===n.id && e.b===s.id))){
          Game.edges.push({ a: s.id, b: n.id });
        }
      }
    }
    // ensure connectivity by connecting components
    const comp = getComponents();
    if(comp.length > 1){
      for(let i=0;i<comp.length-1;i++){
        const aSys = Game.systems[comp[i][0]];
        const bSys = Game.systems[comp[i+1][0]];
        Game.edges.push({ a: aSys.id, b: bSys.id });
      }
    }

    // Random initial ownership: pick 2 systems for factions
    const available = Game.systems.slice();
    const playerStart = available.splice(Math.floor(rand()*available.length),1)[0];
    playerStart.ownerId = PLAYER_ID;
    playerStart.production += 1.5; // nice start
    const aiStart = available.splice(Math.floor(rand()*available.length),1)[0];
    aiStart.ownerId = AI_ID;
    aiStart.production += 1.0;

    // assign a few other nearby systems to factions to start
    for(const s of Game.systems){
      const dP = dist(s,playerStart);
      const dA = dist(s,aiStart);
      if(s !== playerStart && s !== aiStart){
        if(dP < 80 && rand() < 0.35) s.ownerId = PLAYER_ID;
        if(dA < 80 && rand() < 0.35) s.ownerId = AI_ID;
      }
    }

    // ensure at least some neutral systems exist
    Game.systems.forEach(s => {
      if(s.ownerId === NEUTRAL && rand() < 0.07){
        // give small neutral defense
        s.defense += rint(0,2);
      }
    });

    // spawn initial fleets at starting systems
    spawnFleetAtSystem(playerStart.id, PLAYER_ID, rint(1,2));
    spawnFleetAtSystem(aiStart.id, AI_ID, rint(1,2));

    addMessage("New galaxy generated. Seed: " + Game.seed);
  }

  // Connected components helper (by system indices)
  function getComponents(){
    const n = Game.systems.length;
    const adj = Array.from({length:n}, ()=>[]);
    for(const e of Game.edges){ adj[e.a].push(e.b); adj[e.b].push(e.a); }
    const seen = new Array(n).fill(false), comps=[];
    for(let i=0;i<n;i++){
      if(!seen[i]){
        const q=[i], comp=[];
        seen[i]=true;
        while(q.length){
          const v=q.pop();
          comp.push(v);
          for(const nb of adj[v]) if(!seen[nb]){ seen[nb]=true; q.push(nb); }
        }
        comps.push(comp);
      }
    }
    return comps;
  }

  // Determine lane owner (both endpoints same owner -> that owner)
  function laneOwner(edge){
    const a = Game.systems[edge.a], b = Game.systems[edge.b];
    if(a.ownerId !== NEUTRAL && a.ownerId === b.ownerId) return a.ownerId;
    return NEUTRAL;
  }

  // ==== Fleet logic ====
  function spawnFleetAtSystem(systemId, ownerId, size){
    const id = Game.nextFleetId++;
    const f = {
      id,
      ownerId,
      size,
      // stationed if atSystem != null and path.length==0
      atSystem: systemId,
      path: [],     // list of system ids to traverse (including destination)
      pathIndex: 0,
      progress: 0,  // progress along segment 0..1
      speed: rrange(60, 120) // pixels per second
    };
    Game.fleets.push(f);
    Game.systems[systemId].stationed.push(f.id);
    return f;
  }

  // remove stationed fleet by id from system
  function removeFleetFromSystem(sysId, fleetId){
    const arr = Game.systems[sysId].stationed;
    const idx = arr.indexOf(fleetId);
    if(idx>=0) arr.splice(idx,1);
  }

  // update moving fleets
  function updateFleets(dt){
    const fleets = Game.fleets;
    for(const f of fleets){
      if(f.path && f.path.length > 0){
        // moving
        if(f.pathIndex >= f.path.length - 1) {
          // moving between last-1 and last
          const from = Game.systems[f.path[f.pathIndex]];
          const to = Game.systems[f.path[f.pathIndex+1]];
          // remove from stationed if we were stationed there
          if(f.atSystem !== null){ removeFleetFromSystem(f.atSystem, f.id); f.atSystem = null; }
          const segDist = dist(from, to);
          const move = (f.speed * dt) / segDist;
          f.progress += move;
          if(f.progress >= 1){
            // reach next node
            f.pathIndex++;
            f.progress = 0;
            // arrived at system
            const arrivedSys = Game.systems[f.path[f.pathIndex]];
            resolveArrival(f, arrivedSys);
            // if path finished -> clear
            if(f.pathIndex >= f.path.length -1){
              // path completed (either stationed or destroyed)
              f.path = [];
              f.pathIndex = 0;
              f.progress = 0;
            }
          }
        } else {
          // intermediate segment (shouldn't happen because we increment pathIndex), keep general
          const from = Game.systems[f.path[f.pathIndex]];
          const to = Game.systems[f.path[f.pathIndex+1]];
          const segDist = dist(from, to);
          const move = (f.speed * dt) / segDist;
          f.progress += move;
          if(f.progress >= 1){
            f.pathIndex++;
            f.progress = 0;
          }
        }
      }
    }
    // remove destroyed fleets
    Game.fleets = Game.fleets.filter(f => f.size > 0);
  }

  // Resolve arrival into system (attack or station)
  function resolveArrival(fleet, system){
    // If same owner -> station
    if(system.ownerId === fleet.ownerId){
      fleet.atSystem = system.id;
      system.stationed.push(fleet.id);
      addMessage(`${fleet.ownerId === PLAYER_ID ? 'Player' : 'AI'} fleet arrived at ${system.name}`);
      return;
    }
    // Attack!
    addMessage(`${fleet.ownerId === PLAYER_ID ? 'Player' : 'AI'} fleet attacks ${system.name}`);
    // collect defenders: stationed fleets at system + system.defense
    const defenderFleetIds = system.stationed.slice();
    let defenderPower = system.defense;
    for(const id of defenderFleetIds){
      const df = Game.fleets.find(x => x.id === id);
      if(df) defenderPower += df.size;
    }
    const attackerPower = fleet.size;
    // Simple fight: both lose proportional
    if(attackerPower > defenderPower){
      // attacker wins: compute survivors
      const survivors = Math.max(1, Math.floor(attackerPower - defenderPower * 0.6));
      // remove defender fleets
      for(const id of defenderFleetIds){
        const idx = Game.fleets.findIndex(ff => ff.id === id);
        if(idx>=0) Game.fleets.splice(idx,1);
      }
      system.stationed = [];
      // change ownership
      system.ownerId = fleet.ownerId;
      fleet.size = survivors;
      fleet.atSystem = system.id;
      system.stationed.push(fleet.id);
      addMessage(`${fleet.ownerId === PLAYER_ID ? 'Player' : 'AI'} captured ${system.name} (survivors: ${survivors})`);
    } else {
      // defender wins or tie
      const survivors = Math.max(0, Math.floor(defenderPower - attackerPower * 0.5));
      // reduce defender fleets proportionally (simple)
      // reduce system defense first
      const defBefore = system.defense;
      if(attackerPower >= system.defense){
        system.defense = 0;
      } else {
        system.defense = Math.max(0, system.defense - Math.floor(attackerPower*0.2));
      }
      // attacker destroyed
      fleet.size = 0;
      addMessage(`${fleet.ownerId === PLAYER_ID ? 'Player' : 'AI'} fleet destroyed attacking ${system.name}`);
      // optionally scale-down defenders (not precise)
      // remove fleets with small size
      for(const id of defenderFleetIds){
        const df = Game.fleets.find(x => x.id === id);
        if(df){
          df.size = Math.max(0, df.size - Math.floor(attackerPower*0.3));
        }
      }
      Game.fleets = Game.fleets.filter(ff => ff.size > 0);
      // system.stationed updated
      system.stationed = system.stationed.filter(id => Game.fleets.some(ff => ff.id === id));
    }
  }

  // ==== Movement / Pathfinding ====
  // Returns array of system ids path (including origin and destination) or null
  function findPathWithControlledPrefix(originId, destId, factionId){
    // BFS that requires intermediate edges to be "controlled" by faction (both endpoints owned)
    const n = Game.systems.length;
    const adj = {};
    for(const e of Game.edges){
      if(!adj[e.a]) adj[e.a]=[];
      if(!adj[e.b]) adj[e.b]=[];
      adj[e.a].push(e.b);
      adj[e.b].push(e.a);
    }
    const q = [originId];
    const prev = new Array(n).fill(-1);
    const seen = new Array(n).fill(false);
    seen[originId]=true;
    while(q.length){
      const cur = q.shift();
      if(cur === destId) break;
      const neighbors = adj[cur]||[];
      for(const nb of neighbors){
        if(seen[nb]) continue;
        // edge between cur and nb is controlled if both endpoints owned by faction
        const a = Game.systems[cur];
        const b = Game.systems[nb];
        const controlled = (a.ownerId === factionId && b.ownerId === factionId);
        // allow step into destination regardless of ownership
        if(controlled || nb === destId){
          seen[nb]=true;
          prev[nb]=cur;
          q.push(nb);
        }
      }
    }
    if(!seen[destId]) return null;
    const path = [];
    let cur = destId;
    while(cur !== -1){
      path.push(cur);
      if(cur === originId) break;
      cur = prev[cur];
    }
    return path.reverse();
  }

  // ==== Input handling ====
  canvas.addEventListener('click', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const y = (ev.clientY - rect.top) * (canvas.height / rect.height);
    // click nearest system within threshold
    const hit = Game.systems.reduce((best, s) => {
      const d = Math.hypot(s.x-x, s.y-y);
      if(d < (best.d || 9999)) return {sys:s, d};
      return best;
    }, {d:9999}).sys;
    if(hit && Math.hypot(hit.x - x, hit.y - y) < 18){
      onSystemClicked(hit.id);
    } else {
      // click empty space: deselect system
      Game.selectedSystemId = null;
      Game.selectedFleetId = null;
      updateSelectionUI();
    }
  });

  function onSystemClicked(sysId){
    const sys = Game.systems[sysId];
    if(Game.selectedFleetId){ // if a fleet is selected, attempt to order move there
      const fleet = Game.fleets.find(f => f.id === Game.selectedFleetId);
      if(fleet && fleet.ownerId === PLAYER_ID && fleet.atSystem !== null && fleet.atSystem === fleet.atSystem){
        // compute path from fleet.atSystem to sysId respecting controlled prefix rule
        const origin = fleet.atSystem;
        const path = findPathWithControlledPrefix(origin, sysId, PLAYER_ID);
        if(path){
          fleet.path = path;
          fleet.pathIndex = 0;
          fleet.progress = 0;
          fleet.atSystem = null;
          addMessage(`Fleet ${fleet.id} ordered to ${sys.name}`);
          // deselect fleet
          Game.selectedFleetId = null;
          updateSelectionUI();
        } else {
          addMessage('No controlled route to destination (you need connected controlled starlanes up to adjacent node).');
        }
        return;
      }
    }
    // select system
    Game.selectedSystemId = sysId;
    Game.selectedFleetId = null;
    updateSelectionUI();
  }

  // select fleet by clicking on moving ship - not implemented on click; but user can build and issue moves
  // For simplicity player orders fleets from selected system by building fleets or choosing stationed fleets through UI; clicking moving ships could be added.

  // ==== UI Buttons ====
  startBtn.addEventListener('click', () => {
    mainMenu.classList.remove('show');
    mainMenu.classList.add('hide');
    Game.seed = Math.floor(Math.random()*1000000);
    generateGalaxy(Game.seed);
    hideResult();
    runGameLoop();
  });
  seedBtn.addEventListener('click', () => {
    mainMenu.classList.remove('show');
    mainMenu.classList.add('hide');
    Game.seed = rint(100000,999999);
    generateGalaxy(Game.seed);
    hideResult();
    runGameLoop();
  });
  instructionsBtn.addEventListener('click', () => {
    alert('Instructions:\n- Click owned system to select it.\n- Build fleets (costs credits) then click a fleet or system and choose a destination.\n- Fleets can travel through chains of your controlled starlanes; final jump may be into enemy/neutral to attack.\n- Win by controlling most systems or eliminating enemy.');
  });

  toMenuBtn.addEventListener('click', () => {
    // Show main menu
    mainMenu.classList.remove('hide');
    mainMenu.classList.add('show');
    addMessage('Returned to main menu');
    Game.paused = true;
  });

  resultMenuBtn.addEventListener('click', () => {
    resultOverlay.classList.add('hide');
    mainMenu.classList.remove('show');
    mainMenu.classList.add('show');
    Game.paused = true;
  });

  buildSmallBtn.addEventListener('click', () => {
    const sid = Game.selectedSystemId;
    if(sid === null){ addMessage('No selected system'); return; }
    const sys = Game.systems[sid];
    if(sys.ownerId !== PLAYER_ID){ addMessage('You must own the system to build fleets there'); return; }
    const cost = 100;
    if(Game.credits < cost){ addMessage('Not enough credits'); return; }
    Game.credits -= cost;
    spawnFleetAtSystem(sid, PLAYER_ID, 1);
    addMessage('Built small fleet at ' + sys.name);
    updateSelectionUI();
  });

  buildLargeBtn.addEventListener('click', () => {
    const sid = Game.selectedSystemId;
    if(sid === null){ addMessage('No selected system'); return; }
    const sys = Game.systems[sid];
    if(sys.ownerId !== PLAYER_ID){ addMessage('You must own the system to build fleets there'); return; }
    const cost = 250;
    if(Game.credits < cost){ addMessage('Not enough credits'); return; }
    Game.credits -= cost;
    spawnFleetAtSystem(sid, PLAYER_ID, 3);
    addMessage('Built large fleet at ' + sys.name);
    updateSelectionUI();
  });

  surrenderBtn.addEventListener('click', () => {
    if(confirm('Surrender and return to menu?')){
      Game.paused = true;
      showResult(false, 'You surrendered.');
    }
  });

  pauseBtn.addEventListener('click', () => {
    Game.paused = !Game.paused;
    pauseBtn.textContent = Game.paused ? 'Resume' : 'Pause';
  });

  speedBtn.addEventListener('click', () => {
    if(Game.speed === 1){ Game.speed = 2; speedBtn.textContent = 'Speed x2'; }
    else if(Game.speed === 2){ Game.speed = 4; speedBtn.textContent = 'Speed x4'; }
    else { Game.speed = 1; speedBtn.textContent = 'Speed x1'; }
  });

  // ==== Game loop / economy / AI ====
  let lastT = performance.now();
  let aiTimer = 0;
  function runGameLoop(){
    Game.paused = false;
    lastT = performance.now();
    requestAnimationFrame(gameLoop);
  }

  function gameLoop(t){
    const rawDt = (t - lastT) / 1000;
    lastT = t;
    const dt = rawDt * Game.speed;
    if(!Game.paused){
      // update time
      Game.time += dt;
      // income accrual: for each owned system add production*dt
      let incomePerSec = 0;
      for(const s of Game.systems){
        if(s.ownerId === PLAYER_ID) incomePerSec += s.production;
      }
      Game.credits += incomePerSec * dt;
      // tick fleets
      updateFleets(dt);
      // AI behavior occasionally
      aiTimer += dt;
      if(aiTimer >= 3){ aiTurn(); aiTimer = 0; }
      // check win/lose
      checkWinCondition();
    }
    // draw
    drawScene();
    // update UI
    creditsEl.textContent = Math.floor(Game.credits);
    incomeEl.textContent = (Math.round((Game.systems.filter(s=>s.ownerId===PLAYER_ID).reduce((a,b)=>a+b.production,0))*100)/100).toFixed(2);
    timeEl.textContent = Math.floor(Game.time) + 's';
    lastT = t;
    requestAnimationFrame(gameLoop);
  }

  function aiTurn(){
    // AI will attempt to build a small fleet at a random owned system and send it to nearest player-controlled or neutral system adjacent
    const aiSystems = Game.systems.filter(s => s.ownerId === AI_ID);
    if(aiSystems.length === 0) return;
    const s = aiSystems[Math.floor(rand()*aiSystems.length)];
    // build fleet sometimes
    if(Math.random() < 0.5){
      spawnFleetAtSystem(s.id, AI_ID, rint(1,2));
    }
    // choose target: nearest system that is not owned by AI, reachable via AI's controlled prefix (so they can move)
    const candidates = Game.systems.filter(t => t.ownerId !== AI_ID);
    if(candidates.length === 0) return;
    // choose nearest
    candidates.sort((a,b) => dist(s,a) - dist(s,b));
    for(const target of candidates){
      const path = findPathWithControlledPrefix(s.id, target.id, AI_ID);
      if(path){
        // send smallest stationed fleet if any
        const stationed = s.stationed.map(id => Game.fleets.find(f => f.id === id)).filter(Boolean);
        let fl = stationed.find(f => f.ownerId === AI_ID);
        if(!fl){
          // spawn one if AI has credits (AI credits not tracked), spawn anyway
          spawnFleetAtSystem(s.id, AI_ID, 1);
          fl = Game.fleets[Game.fleets.length-1];
        }
        fl.path = path;
        fl.pathIndex = 0;
        fl.progress = 0;
        fl.atSystem = null;
        break;
      }
    }
  }

  function checkWinCondition(){
    const total = Game.systems.length;
    const playerCount = Game.systems.filter(s => s.ownerId === PLAYER_ID).length;
    const aiCount = Game.systems.filter(s => s.ownerId === AI_ID).length;
    if(playerCount/total >= 0.75 || aiCount === 0){
      showResult(true, `You control ${playerCount}/${total} systems — Victory!`);
      Game.paused = true;
    } else if(aiCount/total >= 0.75 || playerCount === 0){
      showResult(false, `AI controls ${aiCount}/${total} systems — Defeat.`);
      Game.paused = true;
    }
  }

  function showResult(win, text){
    resultOverlay.classList.remove('hide');
    resultOverlay.classList.add('show');
    document.getElementById('resultTitle').textContent = win ? 'Victory!' : 'Defeat';
    document.getElementById('resultText').textContent = text;
  }
  function hideResult(){
    resultOverlay.classList.remove('show');
    resultOverlay.classList.add('hide');
  }

  // ==== Drawing ====
  function drawScene(){
    // background
    ctx.clearRect(0,0,canvas.width, canvas.height);
    ctx.fillStyle = '#040617';
    ctx.fillRect(0,0,canvas.width, canvas.height);

    // draw sector fills
    for(const sector of Game.sectors){
      if(!sector.hull || sector.hull.length < 3) continue;
      ctx.beginPath();
      ctx.moveTo(sector.hull[0].x, sector.hull[0].y);
      for(let p of sector.hull) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      // light fill
      ctx.fillStyle = sector.color || 'rgba(80,120,160,0.06)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.stroke();
    }

    // draw starlanes
    for(const e of Game.edges){
      const a = Game.systems[e.a], b = Game.systems[e.b];
      const owner = laneOwner(e);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineWidth = (owner === NEUTRAL) ? 1 : 2.5;
      ctx.strokeStyle = (owner === NEUTRAL) ? 'rgba(140,150,160,0.12)' : COLORS[owner];
      ctx.stroke();
    }

    // draw systems (nodes)
    for(const s of Game.systems){
      // outer ring if selected
      const isSelected = (Game.selectedSystemId === s.id);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 10, 0, Math.PI*2);
      ctx.fillStyle = '#0a1624';
      ctx.fill();
      // border color by owner
      ctx.lineWidth = isSelected?3:2;
      ctx.strokeStyle = s.ownerId === NEUTRAL ? '#546274' : COLORS[s.ownerId];
      ctx.stroke();
      // small inner circle to indicate production
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, Math.PI*2);
      ctx.fillStyle = '#bcd6ee';
      ctx.fill();

      // label
      ctx.font = '11px system-ui, Roboto, Arial';
      ctx.fillStyle = 'rgba(220,240,255,0.95)';
      ctx.fillText(s.name, s.x + 12, s.y + 4);
    }

    // draw fleets moving + stationed counts icons
    // stationed counts: draw small squares next to system
    for(const s of Game.systems){
      const stationedIds = s.stationed;
      if(stationedIds && stationedIds.length){
        // show small badge
        ctx.fillStyle = '#00000088';
        ctx.fillRect(s.x-12, s.y+12, 28, 16);
        ctx.fillStyle = '#fff';
        ctx.font = '12px system-ui';
        ctx.fillText(String(stationedIds.length), s.x-4, s.y+24);
      }
    }

    // fleet moving: draw triangles along path
    for(const f of Game.fleets){
      if(f.path && f.path.length > 0){
        // compute exact position along segment
        const idx = f.pathIndex;
        const from = Game.systems[f.path[idx]];
        const to = Game.systems[f.path[Math.min(idx+1, f.path.length-1)]];
        const t = f.progress;
        const x = from.x + (to.x - from.x) * t;
        const y = from.y + (to.y - from.y) * t;
        // orientation
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        drawShip(x,y,angle, f.ownerId, f.size);
      } else if(f.atSystem !== null){
        // draw stationed tiny icon overlay
        const s = Game.systems[f.atSystem];
        drawShip(s.x + rrange(-6,6), s.y + rrange(-6,6), 0, f.ownerId, f.size, true);
      }
    }
  }

  function drawShip(x,y,ang,owner,size,small=false){
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(ang);
    ctx.beginPath();
    const scale = small ? 0.6 : 1;
    ctx.moveTo(8*scale,0);
    ctx.lineTo(-6*scale,4*scale);
    ctx.lineTo(-6*scale,-4*scale);
    ctx.closePath();
    ctx.fillStyle = COLORS[owner] || '#ccc';
    ctx.fill();
    // size marker
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = `${10*scale}px system-ui`;
    ctx.fillText(size, -2*scale, 3*scale);
    ctx.restore();
  }

  // Selection UI update
  function updateSelectionUI(){
    const sid = Game.selectedSystemId;
    if(sid === null){
      selNameEl.textContent = '—';
      selOwnerEl.textContent = 'Owner: —';
      selProdEl.textContent = 'Production: —';
      selFleetsEl.textContent = 'Fleets: —';
    } else {
      const s = Game.systems[sid];
      selNameEl.textContent = s.name + ' (Sector ' + Game.sectors[s.sectorId].name + ')';
      selOwnerEl.textContent = 'Owner: ' + (s.ownerId === PLAYER_ID ? 'Player' : s.ownerId === AI_ID ? 'AI' : 'Neutral');
      selProdEl.textContent = 'Production: ' + s.production.toFixed(2) + ' /s';
      selFleetsEl.textContent = 'Stationed fleets: ' + s.stationed.length + (s.defense ? `; Defense: ${s.defense}` : '');
    }
  }

  // initialize UI messages, draw initial empty scene until started
  addMessage('Welcome to Galactic Conquest — press Start New Game');

  // generate initial map for preview (but keep menu showing)
  generateGalaxy(Game.seed);
  drawScene();
})();
