/* =====================================================================
   ЛОНИКА — движок v5
   Ё=Е · популярные 90% / непопулярные 9.5% / знаки 0.5%
   бонусы ×5 и ×10 · уровень каждые 3000 очков · ускорение +10%
   анимации ускорены на 30%
   ===================================================================== */

window.onerror = function(msg, url, line, col){
  var el = document.getElementById('errbox');
  if (!el){
    el = document.createElement('div');
    el.id = 'errbox';
    el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;background:#8b0000;color:#fff;' +
      'padding:8px;font:12px monospace;z-index:99999;white-space:pre-wrap;max-height:50%;overflow:auto';
    document.body.appendChild(el);
  }
  el.textContent += msg + ' @ ' + (url || '?') + ':' + line + '\n';
};

(function(){
  'use strict';

  /* ---------- CONFIG ---------- */
  var CONFIG = {
    N: 11,
    SPAWN_COL: 5,
    BASE_INTERVAL: 1440,
    SPEED_FACTOR: 1.1,            // +10% за уровень
    MAX_SPEED_LEVEL: 15,
    MIN_WORD_LEN: 3,
    SCORE_MULT: 10,
    MAX_SCORE: 1000000,
    COMBO: { 1:1, 2:1.2, 3:1.5, 4:2, 5:3 },

    LEVEL_STEP: 3000,

    DIR_GROUPS: [
      { max: 4,     dirs: ['left','right','up','down'] },
      { max: 9,     dirs: ['right','up','down'] },
      { max: 19,    dirs: ['right','down'] },
      { max: 99999, dirs: ['right'] }
    ],

    /* Сумма = 10000 (шаг ×100).
       Популярные:  9000 = 90%
       Непопулярные: 950 = 9.5%
       Знаки:         50 = 0.5% */
    LETTER_WEIGHTS: {
      // популярные (90%)
      'а':1100,'е':800,'о':800,'и':700,'н':600,'т':500,
      'у':375,'я':375,'б':375,'в':375,'г':375,'д':375,
      'к':375,'л':375,'м':375,'п':375,'р':375,'с':375,
      // непопулярные (9.5%)
      'ы':87,'э':87,'ю':87,'з':87,
      'й':86,'ф':86,'х':86,'ц':86,'ч':86,'ш':86,'щ':86,
      // знаки (0.5%)
      'ь':45,'ъ':5
    },

    UNPOPULAR: ['ы','э','ю','з','й','ф','х','ц','ч','ш','щ'],
    SIGNS:     ['ь','ъ'],

    BONUS_UNPOPULAR: 5,
    BONUS_SIGN:      10,

    SOFT_DROP: 0.06,
    HIGHLIGHT_REFRESH_MS: 140     // было 200 — сокращено на 30%
  };

  /* ---------- Производные структуры ---------- */
  var LETTER_BONUS = Object.create(null);
  (function(){
    for (var ch in CONFIG.LETTER_WEIGHTS) LETTER_BONUS[ch] = 1;
    for (var i=0;i<CONFIG.UNPOPULAR.length;i++) LETTER_BONUS[CONFIG.UNPOPULAR[i]] = CONFIG.BONUS_UNPOPULAR;
    for (var j=0;j<CONFIG.SIGNS.length;j++)     LETTER_BONUS[CONFIG.SIGNS[j]]     = CONFIG.BONUS_SIGN;
  })();

  /* ---------- СЛОВАРЬ (Ё → Е) ---------- */
  var DICT_RAW = (window.LONIKA_DICT || [])
    .filter(function(w){
      return typeof w === 'string' && /^[А-ЯЁа-яё]+$/.test(w) && w.length >= CONFIG.MIN_WORD_LEN;
    })
    .map(function(w){ return w.replace(/Ё/g, 'Е').replace(/ё/g, 'е'); });
  if (!DICT_RAW.length){
    console.error('Словарь пуст или не загружен. Проверь dictionary.js');
  }

  /* ---------- Trie ---------- */
  function Trie(){ this.root = Object.create(null); }
  Trie.prototype.insert = function(w){
    var n = this.root;
    for (var i=0;i<w.length;i++){
      var ch = w.charAt(i);
      if (!n[ch]) n[ch] = Object.create(null);
      n = n[ch];
    }
    n.$ = 1;
  };
  Trie.prototype.has = function(w){
    var n = this.root;
    for (var i=0;i<w.length;i++){
      n = n[w.charAt(i)];
      if (!n) return false;
    }
    return !!n.$;
  };
  Trie.prototype.hasPrefix = function(p){
    var n = this.root;
    for (var i=0;i<p.length;i++){
      n = n[p.charAt(i)];
      if (!n) return false;
    }
    return true;
  };
  var trie = new Trie();
  for (var di=0; di<DICT_RAW.length; di++){
    trie.insert(DICT_RAW[di].toUpperCase());
  }

  /* ---------- Генератор букв ---------- */
  var ALL_LETTERS = Object.keys(CONFIG.LETTER_WEIGHTS);
  var VOWELS_SET = { 'а':1,'е':1,'и':1,'о':1,'у':1,'ы':1,'э':1,'ю':1,'я':1 }; // без ё
  var VOWEL_LIST = [], CONSONANT_LIST = [];
  for (var li=0; li<ALL_LETTERS.length; li++){
    if (VOWELS_SET[ALL_LETTERS[li]]) VOWEL_LIST.push(ALL_LETTERS[li]);
    else CONSONANT_LIST.push(ALL_LETTERS[li]);
  }
  var VOWEL_TOTAL = 0, CONSONANT_TOTAL = 0;
  for (var vi=0; vi<VOWEL_LIST.length; vi++)     VOWEL_TOTAL     += CONFIG.LETTER_WEIGHTS[VOWEL_LIST[vi]];
  for (var ci=0; ci<CONSONANT_LIST.length; ci++) CONSONANT_TOTAL += CONFIG.LETTER_WEIGHTS[CONSONANT_LIST[ci]];

  var typeHistory = [];
  function pickType(){
    var n = typeHistory.length;
    if (n >= 2 && typeHistory[n-1] === typeHistory[n-2]){
      return typeHistory[n-1] === 'v' ? 'c' : 'v';
    }
    return Math.random() < 0.55 ? 'c' : 'v';
  }
  function recordType(t){
    typeHistory.push(t);
    if (typeHistory.length > 3) typeHistory.shift();
  }

  function randomLetter(){
    var type = pickType();
    var list  = type === 'c' ? CONSONANT_LIST : VOWEL_LIST;
    var total = type === 'c' ? CONSONANT_TOTAL : VOWEL_TOTAL;
    var r = Math.random() * total;
    var chosen = list[0];
    for (var i=0;i<list.length;i++){
      r -= CONFIG.LETTER_WEIGHTS[list[i]];
      if (r <= 0){ chosen = list[i]; break; }
    }
    recordType(type);
    return chosen.toUpperCase();
  }

  function letterBonus(ch){
    if (!ch) return 1;
    return LETTER_BONUS[ch.toLowerCase()] || 1;
  }
  function wordBonus(word){
    var b = 1;
    for (var i=0;i<word.length;i++){
      var lb = letterBonus(word.charAt(i));
      if (lb > b) b = lb;
    }
    return b;
  }

  /* ---------- Поле ---------- */
  var N = CONFIG.N;
  var board = [];
  var nextCellId = 1;
  function newBoard(){
    board = [];
    for (var r=0;r<N;r++){
      var row = [];
      for (var c=0;c<N;c++) row.push(null);
      board.push(row);
    }
  }
  function canPlace(r,c){ return r>=0 && r<N && c>=0 && c<N && !board[r][c]; }
  function canMoveTo(c,r){ return r<N && canPlace(r,c); }

  /* ---------- Направления ---------- */
  function getDirs(level){
    for (var i=0;i<CONFIG.DIR_GROUPS.length;i++){
      if (level <= CONFIG.DIR_GROUPS[i].max) return CONFIG.DIR_GROUPS[i].dirs;
    }
    return ['right'];
  }
  function getDirVectors(level){
    var v = [];
    var d = getDirs(level);
    if (d.indexOf('right') >= 0) v.push([0, 1]);
    if (d.indexOf('left')  >= 0) v.push([0,-1]);
    if (d.indexOf('down')  >= 0) v.push([1, 0]);
    if (d.indexOf('up')    >= 0) v.push([-1,0]);
    return v;
  }

  /* ---------- Поиск слов ---------- */
  function findWords(level){
    var vecs = getDirVectors(level);
    var all = [];
    var seen = Object.create(null);

    for (var r=0;r<N;r++){
      for (var c=0;c<N;c++){
        if (!board[r][c]) continue;
        for (var vi=0; vi<vecs.length; vi++){
          var dr = vecs[vi][0], dc = vecs[vi][1];
          var word = '';
          var cells = [];
          var rr = r, cc = c;
          while (rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr][cc]){
            var next = word + board[rr][cc].letter;
            if (!trie.hasPrefix(next)) break;
            word = next;
            cells.push([rr, cc]);
            if (word.length >= CONFIG.MIN_WORD_LEN && trie.has(word)){
              var sig = r + ',' + c + '|' + dr + ',' + dc + '|' + word;
              if (!seen[sig]){
                seen[sig] = 1;
                all.push({
                  word: word,
                  cells: cells.slice(),
                  bonus: wordBonus(word)
                });
              }
            }
            rr += dr; cc += dc;
          }
        }
      }
    }

    all.sort(function(a,b){ return b.cells.length - a.cells.length; });
    var result = [];
    for (var i=0; i<all.length; i++){
      var a = all[i];
      var dominated = false;
      for (var j=0; j<result.length; j++){
        if (a.cells.length < result[j].cells.length && isCellSubset(a.cells, result[j].cells)){
          dominated = true;
          break;
        }
      }
      if (!dominated) result.push(a);
    }
    return result;
  }
  function isCellSubset(small, big){
    var keys = Object.create(null);
    for (var i=0;i<big.length;i++) keys[big[i][0] + ',' + big[i][1]] = 1;
    for (var i=0;i<small.length;i++){
      if (!keys[small[i][0] + ',' + small[i][1]]) return false;
    }
    return true;
  }

  /* ---------- Очки ---------- */
  function comboFor(n){
    if (n >= 5) return CONFIG.COMBO[5];
    return CONFIG.COMBO[n] || 1;
  }
  function scoreWords(words){
    var sum = 0;
    for (var i=0;i<words.length;i++){
      var w = words[i];
      var len = w.word.length;
      sum += len * len * CONFIG.SCORE_MULT * w.bonus;
    }
    return Math.round(sum * comboFor(words.length));
  }

  /* ---------- Уровни ---------- */
  function levelForScore(s){
    return Math.floor(s / CONFIG.LEVEL_STEP) + 1;
  }
  function effectiveLevel(lv){
    return Math.min(lv, CONFIG.MAX_SPEED_LEVEL);
  }
  function fallInterval(level){
    return CONFIG.BASE_INTERVAL / Math.pow(CONFIG.SPEED_FACTOR, effectiveLevel(level) - 1);
  }
  function speedDeltaPercent(oldLv, newLv){
    var oldEff = effectiveLevel(oldLv);
    var newEff = effectiveLevel(newLv);
    if (newEff <= oldEff) return 0;
    return Math.round((Math.pow(CONFIG.SPEED_FACTOR, newEff - oldEff) - 1) * 100);
  }

  /* ---------- Звук ---------- */
  var Audio8 = (function(){
    var ctx = null, enabled = true, unlocked = false;
    function ac(){
      if (!ctx){
        var C = window.AudioContext || window.webkitAudioContext;
        if (!C) throw new Error('no audio');
        ctx = new C();
      }
      return ctx;
    }
    function unlock(){
      if (unlocked) return;
      unlocked = true;
      try{ var a = ac(); if (a.state === 'suspended' && a.resume) a.resume(); }catch(e){}
    }
    ['pointerdown','touchstart','keydown'].forEach(function(ev){
      window.addEventListener(ev, unlock, { once:true, passive:true });
    });
    function beep(freq, dur, type, vol){
      if (!enabled || !unlocked) return;
      try{
        var a = ac();
        if (a.state === 'suspended' && a.resume) a.resume();
        var o = a.createOscillator();
        var g = a.createGain();
        o.type = type || 'square';
        o.frequency.value = freq;
        g.gain.value = vol || 0.08;
        o.connect(g); g.connect(a.destination);
        var t = a.currentTime;
        g.gain.setValueAtTime(vol || 0.08, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.08));
        o.start(t); o.stop(t + (dur || 0.08) + 0.02);
      }catch(e){}
    }
    return {
      move:  function(){ beep(440, 0.04, 'square', 0.04); },
      lock:  function(){ beep(200, 0.08, 'triangle', 0.06); },
      go:    function(){ beep(520, 0.09, 'square', 0.08); },
      score: function(){ beep(880, 0.06, 'sine', 0.07); setTimeout(function(){ beep(1180,0.07,'sine',0.07); }, 60); },
      bonus: function(){
        beep(880, 0.07, 'sine', 0.09);
        setTimeout(function(){ beep(1175, 0.08, 'sine', 0.09); }, 70);
        setTimeout(function(){ beep(1568, 0.10, 'sine', 0.10); }, 150);
      },
      superBonus: function(){
        [784, 988, 1175, 1568, 1976].forEach(function(f,i){
          setTimeout(function(){ beep(f, 0.11, 'sine', 0.10); }, i*80);
        });
      },
      levelup: function(){
        [523,659,784,1046].forEach(function(f,i){ setTimeout(function(){ beep(f,0.1,'triangle',0.09); }, i*70); });
      },
      gameover: function(){
        [400,300,200,140].forEach(function(f,i){ setTimeout(function(){ beep(f,0.18,'sawtooth',0.07); }, i*130); });
      },
      victory: function(){
        [523,659,784,1046,1318].forEach(function(f,i){ setTimeout(function(){ beep(f,0.16,'sine',0.09); }, i*100); });
      }
    };
  })();

  /* ---------- Состояние ---------- */
  var G = {
    state: 'READY',
    score: 0,
    level: 1,
    piece: null,
    queue: [],
    highlight: [],
    busy: false,
    phase: null,
    fallMoves: [],
    deleting: []
  };

  /* ---------- Рендер ---------- */
  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');
  var cellSize = 32, boardPx = 416;
  var lastFrameTs = performance.now();

  function resize(){
    var controlsEl = document.getElementById('controls');
    var previewsEl = document.getElementById('previews');
    var headerEl = document.querySelector('header');
    var controlsH = controlsEl ? controlsEl.offsetHeight : 80;
    var previewsH = previewsEl ? previewsEl.offsetHeight : 40;
    var headerH = headerEl ? headerEl.offsetHeight : 50;
    var availW = Math.min(window.innerWidth - 24, 560);
    var availH = window.innerHeight - headerH - previewsH - controlsH - 60;
    boardPx = Math.max(220, Math.min(availW, availH));
    var dpr = window.devicePixelRatio || 1;
    canvas.style.width = boardPx + 'px';
    canvas.style.height = boardPx + 'px';
    canvas.width  = Math.round(boardPx * dpr);
    canvas.height = Math.round(boardPx * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cellSize = boardPx / N;
  }
  window.addEventListener('resize', resize);

  function roundRect(x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
  }

  function paletteFor(tier, mode){
    if (mode === 'falling'){
      if (tier >= 10) return ['#ff9ea8', '#d02040'];
      if (tier >= 5)  return ['#c8a0ff', '#7c2ecc'];
      return ['#7cc0ff', '#4a6cf7'];
    }
    if (tier >= 10) return ['#6a4048', '#3a1520'];
    if (tier >= 5)  return ['#5a4078', '#2e1a4a'];
    return ['#4b5d95', '#2b3560'];
  }
  function paletteForHighlight(tier){
    if (tier >= 10) return ['#ffb0c0', '#e02050'];
    if (tier >= 5)  return ['#dfb0ff', '#8030d0'];
    return ['#ffe28a', '#f7a93c'];
  }
  function glowColorFor(tier){
    if (tier >= 10) return '#ff5070';
    if (tier >= 5)  return '#c88bff';
    return '#ffd66b';
  }

  function drawCell(x, y, letter, opts){
    opts = opts || {};
    var pad = cellSize * 0.06;
    var s = cellSize - pad * 2;
    var r = s * 0.22;
    var alpha = opts.alpha != null ? opts.alpha : 1;
    var scale = opts.scale != null ? opts.scale : 1;
    var ox = x + cellSize/2, oy = y + cellSize/2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    ctx.translate(-cellSize/2, -cellSize/2);

    var tier = opts.tier || 1;
    var colors;
    if (opts.highlight) colors = paletteForHighlight(tier);
    else if (opts.falling) colors = paletteFor(tier, 'falling');
    else colors = paletteFor(tier, 'fixed');

    var g = ctx.createLinearGradient(0, 0, 0, cellSize);
    g.addColorStop(0, colors[0]);
    g.addColorStop(1, colors[1]);
    ctx.fillStyle = g;
    roundRect(pad, pad, s, s, r);
    ctx.fill();

    ctx.strokeStyle = opts.highlight ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (opts.highlight){
      var glow = glowColorFor(tier);
      ctx.shadowColor = glow;
      ctx.shadowBlur = tier >= 10 ? 28 : (tier >= 5 ? 24 : 18);
      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.fillStyle = opts.highlight ? (tier >= 5 ? '#2a0030' : '#2a1a00') : '#ffffff';
    ctx.font = '800 ' + (cellSize * 0.52) + 'px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(letter, cellSize/2, cellSize/2 + 1);
    ctx.restore();
  }

  function render(){
    ctx.clearRect(0, 0, boardPx, boardPx);
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    ctx.fillRect(0, 0, boardPx, boardPx);
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    for (var i=1; i<N; i++){
      ctx.beginPath(); ctx.moveTo(i*cellSize, 0); ctx.lineTo(i*cellSize, boardPx); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i*cellSize); ctx.lineTo(boardPx, i*cellSize); ctx.stroke();
    }

    var hl = Object.create(null);
    for (var hi=0; hi<G.highlight.length; hi++){
      var hw = G.highlight[hi];
      var hcells = hw.cells;
      var htier = hw.bonus || 1;
      for (var hj=0; hj<hcells.length; hj++){
        var key = hcells[hj][0]*N + hcells[hj][1];
        if (!hl[key] || hl[key] < htier) hl[key] = htier;
      }
    }

    var delSet = Object.create(null);
    var now = performance.now();
    if (G.phase && G.phase.type === 'delete'){
      var dt1 = Math.min(1, (now - G.phase.start) / G.phase.dur);
      for (var dI=0; dI<G.deleting.length; dI++){
        delSet[G.deleting[dI].r*N + G.deleting[dI].c] = dt1;
      }
    }
    var fallMap = Object.create(null);
    if (G.phase && G.phase.type === 'fall'){
      var dt2 = Math.min(1, (now - G.phase.start) / G.phase.dur);
      var ease = 1 - Math.pow(1 - dt2, 3);
      for (var fI=0; fI<G.fallMoves.length; fI++){
        var m = G.fallMoves[fI];
        fallMap[m.id] = { fromR: m.fromR, toR: m.toR, t: ease };
      }
    }

    for (var r=0;r<N;r++){
      for (var c=0;c<N;c++){
        var cell = board[r][c];
        if (!cell) continue;
        var y = r * cellSize;
        var x = c * cellSize;
        if (fallMap[cell.id]){
          var fm = fallMap[cell.id];
          y = (fm.fromR + (fm.toR - fm.fromR) * fm.t) * cellSize;
        }
        var delT = delSet[r*N + c];
        var mark = hl[r*N + c];
        var opts = {
          highlight: !!mark,
          tier: mark || 1
        };
        if (delT != null){
          opts.alpha = 1 - delT;
          opts.scale = 1 - delT * 0.35;
        }
        drawCell(x, y, cell.letter, opts);
      }
    }
    if (G.piece && (G.state === 'PLAYING') && !G.busy){
      var p = G.piece;
      drawCell(p.col * cellSize, p.visualRow * cellSize, p.letter, {
        falling: true,
        tier: letterBonus(p.letter)
      });
    }
  }

  /* ---------- UI ---------- */
  var el = {
    score:   document.getElementById('score'),
    level:   document.getElementById('level'),
    dirs:    document.getElementById('dirs'),
    pv0:     document.getElementById('pv0'),
    pv1:     document.getElementById('pv1'),
    overlay: document.getElementById('overlay'),
    toast:   document.getElementById('toast')
  };

  var DIR_SYMBOL = { left:'←', right:'→', up:'↑', down:'↓' };
  var DIR_ORDER  = ['left','right','up','down'];

  function updateDirs(){
    if (!el.dirs) return;
    var active = getDirs(G.level);
    var html = '';
    for (var i=0;i<DIR_ORDER.length;i++){
      var d = DIR_ORDER[i];
      var on = active.indexOf(d) >= 0 ? ' class="on"' : '';
      html += '<span' + on + '>' + DIR_SYMBOL[d] + '</span>';
    }
    el.dirs.innerHTML = html;
  }
  function updateUI(){
    if (el.score) el.score.textContent = G.score.toLocaleString('ru-RU');
    if (el.level) el.level.textContent = G.level;
    updateDirs();
  }
  function previewColor(letter){
    var b = letterBonus(letter);
    if (b >= 10) return { bg:'linear-gradient(160deg,#5a2030,#3a1020)', fg:'#ff9ea8', sh:'inset 0 0 0 1px rgba(255,120,140,.6)' };
    if (b >= 5)  return { bg:'linear-gradient(160deg,#4a2a6a,#2a1a4a)', fg:'#d8b0ff', sh:'inset 0 0 0 1px rgba(200,140,255,.55)' };
    return { bg:'', fg:'', sh:'' };
  }
  function updatePreviews(){
    if (el.pv0){
      el.pv0.textContent = G.queue[0] || '·';
      var c0 = previewColor(G.queue[0]);
      el.pv0.style.background = c0.bg;
      el.pv0.style.color = c0.fg;
      el.pv0.style.boxShadow = c0.sh;
    }
    if (el.pv1){
      el.pv1.textContent = G.queue[1] || '·';
      var c1 = previewColor(G.queue[1]);
      el.pv1.style.background = c1.bg;
      el.pv1.style.color = c1.fg;
      el.pv1.style.boxShadow = c1.sh;
    }
  }
  var toastTimer = null;
  function toast(text, ms, color){
    if (!el.toast) return;
    el.toast.textContent = text;
    el.toast.style.color = color || '#ffd66b';
    el.toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ el.toast.classList.remove('on'); }, ms || 900);
  }
  function showOverlay(html){
    if (!el.overlay) return;
    el.overlay.innerHTML = html;
    el.overlay.classList.add('on');
  }
  function hideOverlay(){
    if (!el.overlay) return;
    el.overlay.classList.remove('on');
    el.overlay.innerHTML = '';
  }

  /* ---------- Баннер перехода на новый уровень ---------- */
  var levelupEl = null;
  var levelupTimer = null;
  function ensureLevelupEl(){
    if (levelupEl) return levelupEl;
    levelupEl = document.createElement('div');
    levelupEl.id = 'levelup';
    levelupEl.style.cssText =
      'position:fixed;left:50%;top:44%;transform:translate(-50%,-50%) scale(0.85);' +
      'padding:18px 36px;border-radius:22px;' +
      'background:linear-gradient(135deg,rgba(255,210,90,.98),rgba(255,150,40,.98));' +
      'color:#2a1400;font-weight:900;text-align:center;z-index:9998;' +
      'box-shadow:0 20px 70px rgba(255,180,60,.55),0 0 0 2px rgba(255,255,255,.4);' +
      'opacity:0;transition:opacity .25s ease, transform .25s cubic-bezier(.34,1.56,.64,1);' +
      'pointer-events:none;font-family:-apple-system,"Segoe UI",Roboto,sans-serif';
    document.body.appendChild(levelupEl);
    return levelupEl;
  }
  function showLevelUp(newLevel, delta){
    var el2 = ensureLevelupEl();
    var body = '<div style="font-size:11px;letter-spacing:4px;opacity:.75;margin-bottom:2px">УРОВЕНЬ</div>' +
               '<div style="font-size:46px;letter-spacing:2px;line-height:1">' + newLevel + '</div>';
    if (delta > 0){
      body += '<div style="font-size:13px;margin-top:8px;font-weight:800;letter-spacing:1px">' +
              'СКОРОСТЬ +' + delta + '%</div>';
    } else {
      body += '<div style="font-size:12px;margin-top:8px;font-weight:700;letter-spacing:1px;opacity:.65">' +
              'МАКС. СКОРОСТЬ</div>';
    }
    el2.innerHTML = body;
    el2.style.opacity = '1';
    el2.style.transform = 'translate(-50%,-50%) scale(1)';
    clearTimeout(levelupTimer);
    levelupTimer = setTimeout(function(){
      el2.style.opacity = '0';
      el2.style.transform = 'translate(-50%,-50%) scale(0.9)';
    }, 1400);
  }

  el.overlay.addEventListener('pointerdown', function(e){
    if (e.target.closest('button')) return;
    if (G.state === 'PAUSED') togglePause();
  });

  /* ---------- Логика ---------- */
  function startGame(){
    newBoard();
    G.score = 0;
    G.level = 1;
    G.piece = null;
    typeHistory = [];
    G.queue = [randomLetter(), randomLetter()];
    G.highlight = [];
    G.busy = false;
    G.phase = null;
    G.deleting = [];
    G.fallMoves = [];
    G.state = 'PLAYING';
    updateUI();
    updatePreviews();
    hideOverlay();
    spawnPiece();
  }
  function spawnPiece(){
    if (board[0][CONFIG.SPAWN_COL]){ gameOver(); return; }
    var letter = G.queue.shift();
    G.queue.push(randomLetter());
    updatePreviews();
    G.piece = { col: CONFIG.SPAWN_COL, row: 0, visualRow: 0, letter: letter, timer: 0 };
  }
  function lockPiece(){
    var p = G.piece;
    board[p.row][p.col] = { letter: p.letter, id: nextCellId++ };
    G.piece = null;
    Audio8.lock();
    refreshHighlight();
    spawnPiece();
  }
  function refreshHighlight(){ G.highlight = findWords(G.level); }
  function moveHorizontal(dir){
    if (G.state !== 'PLAYING' || !G.piece || G.busy) return;
    var nc = G.piece.col + dir;
    if (nc < 0 || nc >= N) return;
    if (!canPlace(G.piece.row, nc)) return;
    G.piece.col = nc;
    Audio8.move();
  }
  function softDropStep(){
    if (G.state !== 'PLAYING' || !G.piece || G.busy) return;
    if (canMoveTo(G.piece.col, G.piece.row + 1)){
      G.piece.row++; G.piece.timer = 0; Audio8.move();
    } else {
      lockPiece();
    }
  }
  function doGO(){
    if (G.state !== 'PLAYING' || G.busy) return;
    var words = findWords(G.level);
    if (words.length === 0){ toast('НЕТ СЛОВ'); return; }

    Audio8.go();
    var gain = scoreWords(words);

    var maxBonus = 1;
    for (var mb=0; mb<words.length; mb++){
      if (words[mb].bonus > maxBonus) maxBonus = words[mb].bonus;
    }
    if (maxBonus >= 10) Audio8.superBonus();
    else if (maxBonus >= 5) Audio8.bonus();

    if (maxBonus >= 10){
      toast('БОНУС ×' + maxBonus + '  +' + gain, 1500, '#ff8aa6');
    } else if (maxBonus >= 5){
      toast('БОНУС ×' + maxBonus + '  +' + gain, 1400, '#d8b0ff');
    } else {
      toast('+' + gain, 900, '#ffd66b');
    }

    var cellSet = Object.create(null);
    for (var i=0;i<words.length;i++){
      var cs = words[i].cells;
      for (var j=0;j<cs.length;j++) cellSet[cs[j][0]*N + cs[j][1]] = 1;
    }
    var keys = Object.keys(cellSet);
    G.deleting = [];
    for (var k=0;k<keys.length;k++){
      var kk = +keys[k];
      var r = Math.floor(kk/N), c = kk%N;
      G.deleting.push({ r: r, c: c, letter: board[r][c].letter });
    }
    G.highlight = words;
    G.busy = true;
    G.phase = { type: 'delete', start: performance.now(), dur: 155 };   // было 220

    setTimeout(function(){
      Audio8.score();
      for (var i=0;i<keys.length;i++){
        var kk = +keys[i];
        var r = Math.floor(kk/N), c = kk%N;
        board[r][c] = null;
      }
      var oldLv = G.level;
      G.score = Math.min(CONFIG.MAX_SCORE, G.score + gain);
      var newLv = levelForScore(G.score);
      updateUI();

      if (newLv > oldLv){
        G.level = newLv;
        Audio8.levelup();
        updateUI();
        var delta = speedDeltaPercent(oldLv, newLv);
        showLevelUp(newLv, delta);
      }

      G.fallMoves = applyGravity();
      G.phase = { type: 'fall', start: performance.now(), dur: 170 };   // было 240
      setTimeout(function(){
        G.phase = null;
        G.fallMoves = [];
        G.deleting = [];
        G.busy = false;
        refreshHighlight();
        if (G.score >= CONFIG.MAX_SCORE) victory();
      }, 170);
    }, 155);
  }
  function applyGravity(){
    var moves = [];
    for (var c=0;c<N;c++){
      var writeRow = N-1;
      for (var r=N-1;r>=0;r--){
        var cell = board[r][c];
        if (cell){
          if (writeRow !== r){
            board[writeRow][c] = cell;
            board[r][c] = null;
            moves.push({ id: cell.id, c: c, fromR: r, toR: writeRow });
          }
          writeRow--;
        }
      }
    }
    return moves;
  }
  function gameOver(){
    G.state = 'GAMEOVER';
    Audio8.gameover();
    showOverlay('<h1>ИГРА ОКОНЧЕНА</h1>' +
      '<p>Новый кубик не может появиться в центральной колонке.</p>' +
      '<p style="color:#fff;font-size:20px;font-weight:800">СЧЁТ: ' +
      G.score.toLocaleString('ru-RU') + '</p>' +
      '<p style="color:#a8b6d4;font-size:14px">УРОВЕНЬ: ' + G.level + '</p>' +
      '<button id="againBtn">ЗАНОВО</button>');
    document.getElementById('againBtn').onclick = startGame;
  }
  function victory(){
    G.state = 'VICTORY';
    Audio8.victory();
    showOverlay('<h1>ПОБЕДА!</h1>' +
      '<p>Ты набрал 1 000 000 очков!</p>' +
      '<p style="color:#fff;font-size:20px;font-weight:800">СЧЁТ: ' +
      G.score.toLocaleString('ru-RU') + '</p>' +
      '<p style="color:#a8b6d4;font-size:14px">УРОВЕНЬ: ' + G.level + '</p>' +
      '<button id="againBtn">ЕЩЁ РАЗ</button>');
    document.getElementById('againBtn').onclick = startGame;
  }
  function togglePause(){
    if (G.state === 'PLAYING'){
      G.state = 'PAUSED';
      showOverlay('<h1>ПАУЗА</h1><p>Нажми Space, коснись поля или затемнения — продолжить</p>');
    } else if (G.state === 'PAUSED'){
      G.state = 'PLAYING';
      hideOverlay();
      lastFrameTs = performance.now();
    }
  }

  /* ---------- Управление ---------- */
  var keys = { down: false };
  document.addEventListener('keydown', function(e){
    if (e.repeat && e.key !== 'ArrowDown') return;
    switch (e.key){
      case 'ArrowLeft':  moveHorizontal(-1); e.preventDefault(); break;
      case 'ArrowRight': moveHorizontal(1);  e.preventDefault(); break;
      case 'ArrowDown':  keys.down = true; e.preventDefault(); break;
      case 'Enter':      doGO(); e.preventDefault(); break;
      case ' ':          togglePause(); e.preventDefault(); break;
      case 'r': case 'R': if (G.state === 'GAMEOVER' || G.state === 'VICTORY') startGame(); break;
    }
  });
  document.addEventListener('keyup', function(e){
    if (e.key === 'ArrowDown') keys.down = false;
  });

  var allKeys = document.querySelectorAll('.key');
  for (var b=0;b<allKeys.length;b++){
    (function(btn){
      var act = btn.getAttribute('data-act');
      btn.addEventListener('pointerdown', function(e){
        e.preventDefault();
        if (G.state === 'READY'){ startGame(); return; }
        if (G.state !== 'PLAYING') return;
        if (act === 'left')  moveHorizontal(-1);
        if (act === 'right') moveHorizontal(1);
        if (act === 'down')  softDropStep();
        if (act === 'go')    doGO();
      });
    })(allKeys[b]);
  }

  var downHold = null;
  var downBtn = document.querySelector('.key[data-act="down"]');
  if (downBtn){
    downBtn.addEventListener('pointerdown', function(){
      clearInterval(downHold);
      downHold = setInterval(softDropStep, 60);
    });
    ['pointerup','pointerleave','pointercancel'].forEach(function(ev){
      downBtn.addEventListener(ev, function(){
        clearInterval(downHold); downHold = null;
      });
    });
  }

  canvas.addEventListener('pointerdown', function(e){
    if (G.state === 'READY'){ startGame(); return; }
    if (e.pointerType === 'touch' && (G.state === 'PLAYING' || G.state === 'PAUSED')) togglePause();
  });

  /* ---------- Главный цикл ---------- */
  function update(dt){
    var lv = levelForScore(G.score);
    if (lv !== G.level){ G.level = lv; updateUI(); }
    if (G.state !== 'PLAYING') return;
    if (G.busy) return;
    if (!G.piece) return;
    var base = fallInterval(G.level);
    var eff = keys.down ? base * CONFIG.SOFT_DROP : base;
    G.piece.timer += dt;
    var safety = 8;
    while (G.piece.timer >= eff && safety-- > 0){
      G.piece.timer -= eff;
      if (canMoveTo(G.piece.col, G.piece.row + 1)){
        G.piece.row++;
      } else {
        lockPiece();
        return;
      }
    }
    var frac = G.piece.timer / eff;
    if (!canMoveTo(G.piece.col, G.piece.row + 1)) frac = 0;
    G.piece.visualRow = G.piece.row + Math.min(1, Math.max(0, frac));
  }
  function loop(ts){
    var dt = Math.min(60, ts - lastFrameTs);
    lastFrameTs = ts;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  /* ---------- Постоянное обновление подсветки ---------- */
  setInterval(function(){
    if (G.state === 'PLAYING' && !G.busy){
      refreshHighlight();
    }
  }, CONFIG.HIGHLIGHT_REFRESH_MS);

  /* ---------- Старт ---------- */
  function boot(){
    newBoard();
    resize();
    updateUI();
    var count = DICT_RAW.length;
    showOverlay('<h1>ЛОНИКА</h1>' +
      '<p>Составляй слова из падающих букв. Слова НЕ удаляются сами — нажми GO, когда готов.</p>' +
      '<p style="font-size:12px;color:#7c8db3">← → двигать · ↓ ускорить · Enter = GO · Space = пауза</p>' +
      '<p style="font-size:13px;color:#d8b0ff;margin-top:6px">' +
        '<b style="color:#ffd66b">Золотые</b> — обычные · ' +
        '<b style="color:#d8b0ff">фиолетовые ×5</b> — с буквой <b>ы э ю з й ф х ц ч ш щ</b> · ' +
        '<b style="color:#ff8aa6">малиновые ×10</b> — с <b>ь</b> или <b>ъ</b>' +
      '</p>' +
      '<p style="font-size:11px;color:#5a6b8f">Словарь: ' + count + ' слов · Новый уровень каждые 3000 очков</p>' +
      '<button id="startBtn">НАЧАТЬ</button>');
    document.getElementById('startBtn').onclick = startGame;
    requestAnimationFrame(loop);
  }

  boot();
})();