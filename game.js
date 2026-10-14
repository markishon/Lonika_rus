/* =====================================================================
   ЛОНИКА — движок v13
   + фиксация буквы ускорена в 2 раза (BASE_INTERVAL: 936)
   + сложные буквы растут с уровнем: 1% на ур.1 → 10% на ур.30
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

  var CONFIG = {
    N: 11,
    SPAWN_COL: 5,
    BASE_INTERVAL: 936,          // было 1872 → в 2 раза быстрее
    SPEED_FACTOR: 1.1,
    MAX_SPEED_LEVEL: 20,
    MIN_WORD_LEN: 3,
    SCORE_MULT: 10,
    MAX_LEVEL: 30,
    LEVEL_STEP: 10000,
    LEVELUP_PAUSE_MS: 3500,

    COMBO_STEP: 0.3,
    COMBO_MAX:  3.0,

    /* Сложные буквы:
       COMPLEX_MIN_FRAC — доля на ур. 1 (минимум)
       COMPLEX_MAX_FRAC — доля на ур. 30 (= MAX_LEVEL)
       Внутри сложных: SIGNS_FRACTION от общего числа сложных — на знаки. */
    COMPLEX_MIN_FRAC: 0.01,     // 1% на ур. 1
    COMPLEX_MAX_FRAC: 0.10,     // 10% на ур. 30 (как раньше)
    SIGNS_FRACTION:   0.05,     // 5% от сложных — знаки, 95% — непопулярные

    DIR_GROUPS: [
      { max: 8,     dirs: ['right','left','up','down'] },
      { max: 9,     dirs: ['right','left','up','down','upRight'] },
      { max: 10,    dirs: ['right','left','up','down','upRight','downRight'] },
      { max: 11,    dirs: ['right','left','up','down','upRight','downRight','upLeft'] },
      { max: 99999, dirs: ['right','left','up','down','upRight','downRight','upLeft','downLeft'] }
    ],

    PLANETS: [
      'Меркурий','Венера','Земля','Марс','Юпитер','Сатурн','Уран','Нептун','Плутон','Харон',
      'Луна','Фобос','Деймос','Ио','Европа','Ганимед','Каллисто','Титан','Энцелад','Мимас',
      'Тритон','Церера','Веста','Паллада','Юнона','Гигея','Эрида','Макемаке','Хаумеа','Селена'
    ],

    /* Базовые веса — задают СООТНОШЕНИЕ между буквами внутри каждой группы.
       Абсолютные значения пересчитываются на каждом уровне. */
    LETTER_WEIGHTS: {
      'а':1100,'е':800,'о':800,'и':700,'н':600,'т':500,
      'у':375,'я':375,'б':375,'в':375,'г':375,'д':375,
      'к':375,'л':375,'м':375,'п':375,'р':375,'с':375,
      'ы':87,'э':87,'ю':87,'з':87,
      'й':86,'ф':86,'х':86,'ц':86,'ч':86,'ш':86,'щ':86,
      'ь':45,'ъ':5
    },

    SIMPLE_LETTERS: ['а','е','о','и','н','т','у','я','б','в','г','д','к','л','м','п','р','с'],
    UNPOPULAR:      ['ы','э','ю','з','й','ф','х','ц','ч','ш','щ'],
    SIGNS:          ['ь','ъ'],

    BONUS_UNPOPULAR: 5,
    BONUS_SIGN:      10,

    SOFT_DROP: 0.06,
    HIGHLIGHT_REFRESH_MS: 140
  };

  var LETTER_BONUS = Object.create(null);
  (function(){
    for (var ch in CONFIG.LETTER_WEIGHTS) LETTER_BONUS[ch] = 1;
    for (var i=0;i<CONFIG.UNPOPULAR.length;i++) LETTER_BONUS[CONFIG.UNPOPULAR[i]] = CONFIG.BONUS_UNPOPULAR;
    for (var j=0;j<CONFIG.SIGNS.length;j++)     LETTER_BONUS[CONFIG.SIGNS[j]]     = CONFIG.BONUS_SIGN;
  })();

  var DICT_RAW = (window.LONIKA_DICT || [])
    .filter(function(w){
      return typeof w === 'string' && /^[А-ЯЁа-яё]+$/.test(w) && w.length >= CONFIG.MIN_WORD_LEN;
    })
    .map(function(w){ return w.replace(/Ё/g, 'Е').replace(/ё/g, 'е'); });
  if (!DICT_RAW.length){
    console.error('Словарь пуст или не загружен. Проверь dictionary.js');
  }

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

  /* ---------- Веса букв по уровням ----------
     На каждом уровне пересчитываем абсолютные веса так,
     чтобы доля сложных букв плавно росла от COMPLEX_MIN_FRAC до COMPLEX_MAX_FRAC. */
  var VOWELS_SET = { 'а':1,'е':1,'и':1,'о':1,'у':1,'ы':1,'э':1,'ю':1,'я':1 };
  var LEVEL_WEIGHTS = [];

  function computeLevelWeights(level){
    var maxLv = CONFIG.MAX_LEVEL;
    var t = maxLv > 1 ? (Math.min(Math.max(level,1), maxLv) - 1) / (maxLv - 1) : 0;
    var complexFrac = CONFIG.COMPLEX_MIN_FRAC + t * (CONFIG.COMPLEX_MAX_FRAC - CONFIG.COMPLEX_MIN_FRAC);
    var simpleFrac  = 1 - complexFrac;
    var signFrac    = complexFrac * CONFIG.SIGNS_FRACTION;
    var unpopFrac   = complexFrac * (1 - CONFIG.SIGNS_FRACTION);

    var weights = {};

    // Простые буквы
    var simpleTotal = 0;
    for (var i=0;i<CONFIG.SIMPLE_LETTERS.length;i++){
      simpleTotal += CONFIG.LETTER_WEIGHTS[CONFIG.SIMPLE_LETTERS[i]];
    }
    var simpleScale = simpleTotal > 0 ? (simpleFrac * 10000) / simpleTotal : 0;
    for (var i=0;i<CONFIG.SIMPLE_LETTERS.length;i++){
      var ch = CONFIG.SIMPLE_LETTERS[i];
      weights[ch] = CONFIG.LETTER_WEIGHTS[ch] * simpleScale;
    }

    // Непопулярные
    var unpopTotal = 0;
    for (var i=0;i<CONFIG.UNPOPULAR.length;i++){
      unpopTotal += CONFIG.LETTER_WEIGHTS[CONFIG.UNPOPULAR[i]];
    }
    var unpopScale = unpopTotal > 0 ? (unpopFrac * 10000) / unpopTotal : 0;
    for (var i=0;i<CONFIG.UNPOPULAR.length;i++){
      var ch = CONFIG.UNPOPULAR[i];
      weights[ch] = CONFIG.LETTER_WEIGHTS[ch] * unpopScale;
    }

    // Знаки
    var signTotal = 0;
    for (var i=0;i<CONFIG.SIGNS.length;i++){
      signTotal += CONFIG.LETTER_WEIGHTS[CONFIG.SIGNS[i]];
    }
    var signScale = signTotal > 0 ? (signFrac * 10000) / signTotal : 0;
    for (var i=0;i<CONFIG.SIGNS.length;i++){
      var ch = CONFIG.SIGNS[i];
      weights[ch] = CONFIG.LETTER_WEIGHTS[ch] * signScale;
    }

    // Разбиваем на гласные/согласные для чередования
    var vowelList = [], consonantList = [];
    var vowelTotal = 0, consonantTotal = 0;
    for (var ch in weights){
      if (VOWELS_SET[ch]){ vowelList.push(ch); vowelTotal += weights[ch]; }
      else { consonantList.push(ch); consonantTotal += weights[ch]; }
    }

    return {
      weights: weights,
      vowelList: vowelList,
      consonantList: consonantList,
      vowelTotal: vowelTotal,
      consonantTotal: consonantTotal
    };
  }

  for (var lv0 = 1; lv0 <= CONFIG.MAX_LEVEL; lv0++){
    LEVEL_WEIGHTS[lv0] = computeLevelWeights(lv0);
  }
  function getLevelWeights(level){
    if (!level || level < 1) level = 1;
    if (level > CONFIG.MAX_LEVEL) level = CONFIG.MAX_LEVEL;
    return LEVEL_WEIGHTS[level];
  }

  /* ---------- Генератор букв ---------- */
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
    var lw = getLevelWeights(G.level || 1);
    var type = pickType();
    var list, total;
    if (type === 'c'){ list = lw.consonantList; total = lw.consonantTotal; }
    else { list = lw.vowelList; total = lw.vowelTotal; }
    var r = Math.random() * total;
    var chosen = list[0];
    for (var i=0;i<list.length;i++){
      r -= lw.weights[list[i]];
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

  function getDirs(level){
    for (var i=0;i<CONFIG.DIR_GROUPS.length;i++){
      if (level <= CONFIG.DIR_GROUPS[i].max) return CONFIG.DIR_GROUPS[i].dirs;
    }
    return ['right'];
  }
  function getDirVectors(level){
    var v = [];
    var d = getDirs(level);
    if (d.indexOf('right')     >= 0) v.push([0, 1]);
    if (d.indexOf('left')      >= 0) v.push([0,-1]);
    if (d.indexOf('up')        >= 0) v.push([-1,0]);
    if (d.indexOf('down')      >= 0) v.push([1, 0]);
    if (d.indexOf('upRight')   >= 0) v.push([-1,1]);
    if (d.indexOf('downRight') >= 0) v.push([1, 1]);
    if (d.indexOf('upLeft')    >= 0) v.push([-1,-1]);
    if (d.indexOf('downLeft')  >= 0) v.push([1, -1]);
    return v;
  }

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
                all.push({ word: word, cells: cells.slice(), bonus: wordBonus(word) });
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
          dominated = true; break;
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

  function comboMultiplier(n){
    if (n <= 1) return 1;
    var m = 1 + CONFIG.COMBO_STEP * (n - 1);
    return Math.min(CONFIG.COMBO_MAX, m);
  }
  function scoreWords(words){
    var sum = 0;
    for (var i=0;i<words.length;i++){
      var w = words[i];
      var len = w.word.length;
      sum += len * len * CONFIG.SCORE_MULT * w.bonus;
    }
    var combo = comboMultiplier(words.length);
    return Math.round(sum * combo);
  }

  function levelForScore(s){ return Math.floor(s / CONFIG.LEVEL_STEP) + 1; }
  function effectiveLevel(lv){ return Math.min(lv, CONFIG.MAX_SPEED_LEVEL); }
  function fallInterval(level){
    return CONFIG.BASE_INTERVAL / Math.pow(CONFIG.SPEED_FACTOR, effectiveLevel(level) - 1);
  }
  function speedDeltaPercent(oldLv, newLv){
    var oldEff = effectiveLevel(oldLv);
    var newEff = effectiveLevel(newLv);
    if (newEff <= oldEff) return 0;
    return Math.round((Math.pow(CONFIG.SPEED_FACTOR, newEff - oldEff) - 1) * 100);
  }
  function planetForLevel(lv){
    var i = Math.max(0, Math.min(CONFIG.PLANETS.length - 1, lv - 1));
    return CONFIG.PLANETS[i];
  }

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
      lock:  function(){ beep(220, 0.07, 'triangle', 0.06); },
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
        var notes = [523, 659, 784, 1046, 1318, 1568, 2093];
        notes.forEach(function(f,i){
          setTimeout(function(){ beep(f, 0.14, 'triangle', 0.10); }, i*110);
        });
        setTimeout(function(){
          beep(523, 0.6, 'sine', 0.09);
          beep(659, 0.6, 'sine', 0.09);
          beep(784, 0.6, 'sine', 0.09);
          beep(1046, 0.6, 'sine', 0.09);
        }, 900);
      },
      gameover: function(){
        [400,300,200,140].forEach(function(f,i){ setTimeout(function(){ beep(f,0.18,'sawtooth',0.07); }, i*130); });
      },
      victory: function(){
        var notes = [523,659,784,1046,1318,1568,2093];
        notes.forEach(function(f,i){ setTimeout(function(){ beep(f,0.16,'sine',0.10); }, i*130); });
        setTimeout(function(){
          beep(523, 0.8, 'sine', 0.10);
          beep(659, 0.8, 'sine', 0.10);
          beep(784, 0.8, 'sine', 0.10);
          beep(1046, 0.8, 'sine', 0.10);
          beep(1318, 0.8, 'sine', 0.10);
        }, 1100);
      }
    };
  })();

  var G = {
    state: 'READY', score: 0, level: 1, piece: null, queue: [],
    highlight: [], busy: false, phase: null, fallMoves: [], deleting: [],
    lockFx: null, goFx: null, pulseT: 0
  };

  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');
  var cellSize = 32, boardPx = 416;
  var lastFrameTs = performance.now();

  function resize(){
    var controlsEl = document.getElementById('controls');
    var previewsEl = document.getElementById('previews');
    var headerEl = document.querySelector('header');
    var controlsH = controlsEl ? controlsEl.offsetHeight : 80;
    var previewsH = previewsEl ? previewsEl.offsetHeight : 50;
    var headerH = headerEl ? headerEl.offsetHeight : 60;
    var availW = Math.min(window.innerWidth - 24, 480);
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

  function tilePalette(tier, mode){
    if (mode === 'highlight'){
      return { top:'#FFE28A', bottom:'#F0A83A', edge:'#C67D18', shadow:'#8F5608', letter:'#3A2400' };
    }
    if (mode === 'falling'){
      if (tier >= 10) return { top:'#FF7BA8', bottom:'#D02050', edge:'#A01030', shadow:'#7A0828', letter:'#FFFFFF' };
      if (tier >= 5)  return { top:'#C471FF', bottom:'#8A2EE6', edge:'#5A1A9A', shadow:'#3A0E6A', letter:'#FFFFFF' };
      return               { top:'#5DA8FF', bottom:'#2E6FE6', edge:'#1D4AB8', shadow:'#0E2A8A', letter:'#FFFFFF' };
    }
    if (tier >= 10) return { top:'#FFD5E0', bottom:'#E8B0C0', edge:'#C890A0', shadow:'#A07080', letter:'#5A0A28' };
    if (tier >= 5)  return { top:'#E8D5FF', bottom:'#C8AAE8', edge:'#A88AD0', shadow:'#8870B0', letter:'#3A1560' };
    return               { top:'#FFFFFF', bottom:'#DCE4F0', edge:'#C8D0E0', shadow:'#9AA5BF', letter:'#1E2A4A' };
  }
  function glowColorFor(tier){
    if (tier >= 10) return '#FF3E7F';
    if (tier >= 5)  return '#B44CFF';
    return '#FFD66B';
  }
  function fallingGlowFor(tier){
    if (tier >= 10) return '#FF3E7F';
    if (tier >= 5)  return '#B44CFF';
    return '#4A90FF';
  }

  function drawCell(x, y, letter, opts){
    opts = opts || {};
    var pad = cellSize * 0.07;
    var s = cellSize - pad * 2;
    var r = s * 0.22;
    var alpha = opts.alpha != null ? opts.alpha : 1;
    var scale = opts.scale != null ? opts.scale : 1;
    var ox = x + cellSize/2, oy = y + cellSize/2;
    var tier = opts.tier || 1;

    var mode = opts.highlight ? 'highlight' : (opts.falling ? 'falling' : 'fixed');
    var pal = tilePalette(tier, mode);
    var shadowH = s * 0.10;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    ctx.translate(-cellSize/2, -cellSize/2);

    if (mode === 'falling'){
      var glowCol = fallingGlowFor(tier);
      ctx.shadowColor = glowCol;
      ctx.shadowBlur = tier >= 5 ? 22 : 18;
    }

    ctx.fillStyle = pal.shadow;
    roundRect(pad, pad + shadowH, s, s, r);
    ctx.fill();

    ctx.shadowBlur = 0;
    var g = ctx.createLinearGradient(0, pad, 0, pad + s);
    g.addColorStop(0, pal.top);
    g.addColorStop(1, pal.bottom);
    ctx.fillStyle = g;
    roundRect(pad, pad, s, s, r);
    ctx.fill();

    ctx.strokeStyle = pal.edge;
    ctx.lineWidth = 1;
    ctx.stroke();

    if (mode === 'highlight'){
      var pulse = 0.5 + 0.5 * Math.sin(G.pulseT / 220);
      var glow = glowColorFor(tier);
      ctx.shadowColor = glow;
      ctx.shadowBlur = 18 + pulse * 14;
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.7 + pulse * 0.3) + ')';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.fillStyle = pal.letter;
    ctx.font = '800 ' + (cellSize * 0.54) + 'px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(letter, cellSize/2, cellSize/2 + 1);
    ctx.restore();
  }

  function render(){
    ctx.fillStyle = 'rgba(10, 14, 30, 0.9)';
    ctx.fillRect(0, 0, boardPx, boardPx);

    var pad = cellSize * 0.07;
    var s = cellSize - pad * 2;
    var r = s * 0.22;
    for (var rr0=0; rr0<N; rr0++){
      for (var cc0=0; cc0<N; cc0++){
        if (board[rr0][cc0]) continue;
        ctx.fillStyle = '#151a30';
        roundRect(cc0*cellSize + pad, rr0*cellSize + pad, s, s, r);
        ctx.fill();
        ctx.strokeStyle = 'rgba(120,150,220,0.06)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    ctx.strokeStyle = 'rgba(100,130,200,0.04)';
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
          tier: mark || letterBonus(cell.letter)
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
      var spawnT = 1;
      if (p.spawnStart){
        spawnT = Math.min(1, (now - p.spawnStart) / 220);
      }
      var easeSpawn = 1 - Math.pow(1 - spawnT, 3);
      var scale = 0.5 + 0.5 * easeSpawn;
      drawCell(p.col * cellSize, p.visualRow * cellSize, p.letter, {
        falling: true,
        tier: letterBonus(p.letter),
        scale: scale,
        alpha: easeSpawn
      });
    }

    if (G.lockFx){
      var lt = (now - G.lockFx.start) / 350;
      if (lt >= 1){ G.lockFx = null; }
      else {
        var lx = G.lockFx.c * cellSize + cellSize / 2;
        var ly = G.lockFx.r * cellSize + cellSize / 2;
        var radius = cellSize * (0.6 + lt * 0.9);
        var alphaL = (1 - lt) * 0.7;
        var grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, radius);
        grad.addColorStop(0, 'rgba(255,255,255,' + alphaL + ')');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(lx - radius, ly - radius, radius * 2, radius * 2);
      }
    }

    if (G.goFx){
      var gt = (now - G.goFx) / 400;
      if (gt >= 1){ G.goFx = null; }
      else {
        ctx.fillStyle = 'rgba(255,240,180,' + ((1 - gt) * 0.25) + ')';
        ctx.fillRect(0, 0, boardPx, boardPx);
      }
    }
  }

  var el = {
    score:   document.getElementById('score'),
    level:   document.getElementById('level'),
    planet:  document.getElementById('planet'),
    dirs:    document.getElementById('dirs'),
    pv0:     document.getElementById('pv0'),
    pv1:     document.getElementById('pv1'),
    overlay: document.getElementById('overlay'),
    toast:   document.getElementById('toast')
  };

  var DIR_SYMBOL = {
    right:'→', left:'←', up:'↑', down:'↓',
    upRight:'↗', downRight:'↘', upLeft:'↖', downLeft:'↙'
  };
  var DIR_ORDER = ['right','left','up','down','upRight','downRight','upLeft','downLeft'];

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
    if (el.planet) el.planet.textContent = planetForLevel(G.level);
    updateDirs();
  }
  function previewColor(letter){
    var b = letterBonus(letter);
    if (b >= 10) return { bg:'linear-gradient(to bottom,#FF7BA8,#D02050)', fg:'#fff', sh:'0 3px 0 #A01030,0 6px 12px rgba(0,0,0,.4)' };
    if (b >= 5)  return { bg:'linear-gradient(to bottom,#C471FF,#8A2EE6)', fg:'#fff', sh:'0 3px 0 #5A1A9A,0 6px 12px rgba(0,0,0,.4)' };
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

  var levelupEl = null;
  var levelupTimer1 = null;
  var levelupTimer2 = null;
  function ensureLevelupEl(){
    if (levelupEl) return levelupEl;
    levelupEl = document.createElement('div');
    levelupEl.id = 'levelup';
    levelupEl.style.cssText =
      'position:fixed;left:50%;top:45%;transform:translate(-50%,-50%) scale(0.4);' +
      'padding:34px 46px 28px;border-radius:32px;' +
      'background:radial-gradient(circle at 50% 30%, rgba(60,40,110,.98), rgba(20,12,45,.98));' +
      'color:#fff;font-weight:900;text-align:center;z-index:9998;' +
      'border:2px solid rgba(255,210,120,.7);' +
      'box-shadow:0 30px 120px rgba(160,120,255,.7),0 0 0 6px rgba(255,200,80,.25),0 0 100px rgba(255,180,80,.5);' +
      'opacity:0;transition:opacity .5s ease, transform .55s cubic-bezier(.34,1.56,.64,1);' +
      'pointer-events:none;font-family:-apple-system,"Segoe UI",Roboto,sans-serif;min-width:280px';
    document.body.appendChild(levelupEl);
    return levelupEl;
  }
  function showLevelUp(newLevel, delta){
    var el2 = ensureLevelupEl();
    var planetName = planetForLevel(newLevel);
    var speedText = delta > 0
      ? '<div style="margin-top:14px;font-size:14px;font-weight:800;letter-spacing:1.5px;color:#ffd66b">⚡ СКОРОСТЬ +' + delta + '%</div>'
      : '<div style="margin-top:14px;font-size:13px;font-weight:700;letter-spacing:1.5px;color:#a8b6d4;opacity:.8">МАКС. СКОРОСТЬ</div>';
    var body =
      '<div style="font-size:11px;letter-spacing:6px;color:#b8c2dc;opacity:.7">НОВАЯ ПЛАНЕТА</div>' +
      '<div style="margin:14px auto 0;width:110px;height:110px;border-radius:50%;' +
        'background:radial-gradient(circle at 35% 30%, #ffd66b 0%, #f0a83a 40%, #8a4a20 100%);' +
        'box-shadow:0 0 60px rgba(255,180,80,.9),inset -10px -10px 30px rgba(80,40,0,.6),inset 8px 8px 20px rgba(255,240,200,.6);' +
        'position:relative">' +
        '<div style="position:absolute;inset:-18px;border:1.5px solid rgba(180,140,255,.4);border-radius:50%;' +
          'border-top-color:rgba(255,214,107,.9);transform:rotate(25deg)"></div>' +
      '</div>' +
      '<div style="margin-top:16px;font-size:34px;letter-spacing:3px;font-weight:900;' +
        'background:linear-gradient(90deg,#ffd66b,#ff9ec0);-webkit-background-clip:text;background-clip:text;color:transparent;' +
        'filter:drop-shadow(0 0 20px rgba(255,180,80,.6))">' + planetName.toUpperCase() + '</div>' +
      '<div style="margin-top:14px;font-size:16px;letter-spacing:4px;color:#fff;font-weight:900">НОВЫЙ УРОВЕНЬ ' + newLevel + '</div>' +
      speedText;
    el2.innerHTML = body;
    el2.style.opacity = '1';
    el2.style.transform = 'translate(-50%,-50%) scale(1)';

    clearTimeout(levelupTimer1);
    clearTimeout(levelupTimer2);
    levelupTimer1 = setTimeout(function(){
      el2.style.opacity = '0';
      el2.style.transform = 'translate(-50%,-50%) scale(1.15)';
    }, 3000);
    levelupTimer2 = setTimeout(function(){
      el2.style.transform = 'translate(-50%,-50%) scale(0.9)';
    }, 3300);
  }

  el.overlay.addEventListener('pointerdown', function(e){
    if (e.target.closest('button')) return;
    if (G.state === 'PAUSED') togglePause();
  });

  function startGame(){
    newBoard();
    G.score = 0; G.level = 1; G.piece = null;
    typeHistory = [];
    G.queue = [randomLetter(), randomLetter()];
    G.highlight = []; G.busy = false; G.phase = null;
    G.deleting = []; G.fallMoves = [];
    G.lockFx = null; G.goFx = null;
    G.state = 'PLAYING';
    updateUI(); updatePreviews();
    hideOverlay();
    spawnPiece();
  }
  function spawnPiece(){
    if (board[0][CONFIG.SPAWN_COL]){ gameOver(); return; }
    var letter = G.queue.shift();
    G.queue.push(randomLetter());
    updatePreviews();
    G.piece = {
      col: CONFIG.SPAWN_COL, row: 0, visualRow: 0, letter: letter, timer: 0,
      spawnStart: performance.now()
    };
  }
  function lockPiece(){
    var p = G.piece;
    board[p.row][p.col] = { letter: p.letter, id: nextCellId++ };
    G.lockFx = { r: p.row, c: p.col, start: performance.now() };
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
    G.goFx = performance.now();
    var gain = scoreWords(words);
    var maxBonus = 1;
    for (var mb=0; mb<words.length; mb++){
      if (words[mb].bonus > maxBonus) maxBonus = words[mb].bonus;
    }
    if (maxBonus >= 10) Audio8.superBonus();
    else if (maxBonus >= 5) Audio8.bonus();

    var combo = comboMultiplier(words.length);
    var comboTag = combo > 1 ? ' ×' + combo.toFixed(1) + ' комбо' : '';
    if (maxBonus >= 10){
      toast('БОНУС ×' + maxBonus + comboTag + '  +' + gain, 1500, '#ff8aa6');
    } else if (maxBonus >= 5){
      toast('БОНУС ×' + maxBonus + comboTag + '  +' + gain, 1400, '#d8b0ff');
    } else if (combo > 1){
      toast('КОМБО ×' + combo.toFixed(1) + '  +' + gain, 1100, '#ffd66b');
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
    G.phase = { type: 'delete', start: performance.now(), dur: 155 };

    setTimeout(function(){
      Audio8.score();
      for (var i=0;i<keys.length;i++){
        var kk = +keys[i];
        var r = Math.floor(kk/N), c = kk%N;
        board[r][c] = null;
      }
      var oldLv = G.level;
      G.score = G.score + gain;
      var newLv = levelForScore(G.score);
      if (newLv > CONFIG.MAX_LEVEL) newLv = CONFIG.MAX_LEVEL;
      updateUI();

      var leveledUp = newLv > oldLv;
      if (leveledUp){
        G.level = newLv;
        Audio8.levelup();
        updateUI();
        var delta = speedDeltaPercent(oldLv, newLv);
        showLevelUp(newLv, delta);
      }

      G.fallMoves = applyGravity();
      G.phase = { type: 'fall', start: performance.now(), dur: 170 };
      var releaseDelay = 170 + (leveledUp ? CONFIG.LEVELUP_PAUSE_MS : 0);

      setTimeout(function(){
        G.phase = null; G.fallMoves = []; G.deleting = [];
        G.busy = false; refreshHighlight();
        if (G.level >= CONFIG.MAX_LEVEL) victory();
      }, releaseDelay);
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
            board[writeRow][c] = cell; board[r][c] = null;
            moves.push({ id: cell.id, c: c, fromR: r, toR: writeRow });
          }
          writeRow--;
        }
      }
    }
    return moves;
  }
  function gameOver(){
    G.state = 'GAMEOVER'; Audio8.gameover();
    var best = 0;
    try { best = parseInt(localStorage.getItem('lonika_best') || '0', 10) || 0; } catch(e){}
    var isRecord = G.score > best;
    if (isRecord){
      try { localStorage.setItem('lonika_best', String(G.score)); } catch(e){}
    }
    var recordBadge = isRecord
      ? '<div style="display:inline-block;padding:6px 16px;border-radius:999px;' +
        'background:linear-gradient(to bottom,#ffd66b,#f0a83a);color:#3a2400;' +
        'font-weight:900;font-size:12px;letter-spacing:2px;margin-top:8px;' +
        'box-shadow:0 3px 0 #a06f18,0 0 24px rgba(255,200,80,.6)">НОВЫЙ РЕКОРД!</div>'
      : '<div style="margin-top:8px;font-size:12px;color:#7a86a8;letter-spacing:1px">лучший: ' + best.toLocaleString('ru-RU') + '</div>';
    showOverlay(
      '<h1 style="font-size:32px;letter-spacing:6px">ИГРА ОКОНЧЕНА</h1>' +
      '<div style="margin-top:12px;padding:18px 32px;border-radius:20px;' +
        'background:rgba(20,16,50,.85);border:1px solid rgba(120,140,220,.25);' +
        'box-shadow:0 12px 40px rgba(0,0,0,.5)">' +
        '<div style="font-size:11px;letter-spacing:4px;color:#7a86a8">СЧЁТ</div>' +
        '<div style="font-size:38px;font-weight:900;color:#fff;margin-top:4px;font-variant-numeric:tabular-nums">' + G.score.toLocaleString('ru-RU') + '</div>' +
        '<div style="font-size:12px;color:#b8c2dc;margin-top:8px">Планета: <b>' + planetForLevel(G.level) + '</b></div>' +
        recordBadge +
      '</div>' +
      '<p style="margin-top:12px">Отлично получается, попробуй ещё раз!</p>' +
      '<button id="againBtn">ИГРАТЬ ЕЩЁ</button>'
    );
    document.getElementById('againBtn').onclick = startGame;
  }
  function victory(){
    G.state = 'VICTORY'; Audio8.victory();
    showOverlay(
      '<h1>ПОБЕДА!</h1>' +
      '<p style="margin-top:8px">Ты прошёл все 30 планет — от Меркурия до Селены!</p>' +
      '<div style="margin-top:12px;padding:18px 32px;border-radius:20px;' +
        'background:rgba(20,16,50,.85);border:1px solid rgba(255,200,80,.35);' +
        'box-shadow:0 12px 40px rgba(0,0,0,.5),0 0 60px rgba(255,200,80,.3)">' +
        '<div style="font-size:11px;letter-spacing:4px;color:#7a86a8">ФИНАЛЬНЫЙ СЧЁТ</div>' +
        '<div style="font-size:38px;font-weight:900;color:#ffd66b;margin-top:4px;font-variant-numeric:tabular-nums">' + G.score.toLocaleString('ru-RU') + '</div>' +
      '</div>' +
      '<button id="againBtn">ЕЩЁ РАЗ</button>'
    );
    document.getElementById('againBtn').onclick = startGame;
  }
  function togglePause(){
    if (G.state === 'PLAYING'){
      G.state = 'PAUSED';
      showOverlay('<h1 style="font-size:34px">ПАУЗА</h1><p>Нажми Space, коснись поля или затемнения — продолжить</p>');
    } else if (G.state === 'PAUSED'){
      G.state = 'PLAYING'; hideOverlay();
      lastFrameTs = performance.now();
    }
  }

  var keys = { down: false };

  document.addEventListener('keydown', function(e){
    if (e.key === 'Enter'){
      e.preventDefault();
      e.stopPropagation();
      doGO();
      return;
    }
    if (e.repeat && e.key !== 'ArrowDown') return;
    switch (e.key){
      case 'ArrowLeft':  moveHorizontal(-1); e.preventDefault(); break;
      case 'ArrowRight': moveHorizontal(1);  e.preventDefault(); break;
      case 'ArrowDown':  keys.down = true; e.preventDefault(); break;
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
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
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

  function update(dt){
    G.pulseT += dt;
    var lv = levelForScore(G.score);
    if (lv > CONFIG.MAX_LEVEL) lv = CONFIG.MAX_LEVEL;
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

  setInterval(function(){
    if (G.state === 'PLAYING' && !G.busy) refreshHighlight();
  }, CONFIG.HIGHLIGHT_REFRESH_MS);

  function boot(){
    newBoard(); resize(); updateUI();
    var count = DICT_RAW.length;
    showOverlay(
      '<h1>ЛОНИКА</h1>' +
      '<p style="margin-top:10px">Собирай слова из падающих букв.<br>Слова НЕ удаляются сами — нажми <b style="color:#ffd66b">GO</b>, когда готов.</p>' +
      '<div style="margin-top:16px;display:flex;gap:14px;font-size:12px;color:#b8c2dc;flex-wrap:wrap;justify-content:center">' +
        '<span><b style="color:#5DA8FF">●</b> синие — обычные</span>' +
        '<span><b style="color:#B44CFF">●</b> фиолетовые ×5</span>' +
        '<span><b style="color:#FF3E7F">●</b> малиновые ×10</span>' +
      '</div>' +
      '<p style="font-size:12px;color:#7a86a8;margin-top:14px">← → двигать · ↓ ускорить · Enter = GO · Space = пауза</p>' +
      '<p style="font-size:11px;color:#5a6b8f;margin-top:6px">30 планет · Победа на Селене · Словарь: ' + count + ' слов</p>' +
      '<button id="startBtn">ИГРАТЬ</button>'
    );
    document.getElementById('startBtn').onclick = startGame;
    requestAnimationFrame(loop);
  }

  boot();
})();
