/* =====================================================================
   ЛОНИКА — движок v29
   + "РЕКОРД" вместо звёздочки, число под ним
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
    BASE_INTERVAL: 1872,
    LOCK_DELAY_MS: 1000,
    FLASH_DURATION_MS: 500,
    NEW_WORD_FADE_MS: 900,
    NEW_WORD_STEP_MS: 90,
    SPEED_FACTOR: 1.1,
    MAX_SPEED_LEVEL: 20,
    MIN_WORD_LEN: 3,
    SCORE_MULT: 10,
    MAX_LEVEL: 30,
    LEVEL_STEP: 10000,
    LEVELUP_PAUSE_MS: 3500,

    COMBO_STEP: 0.396,
    COMBO_MAX:  3.96,
    COMBO_BASE: 1.32,

    COMPLEX_MIN_FRAC: 0.01,
    COMPLEX_MAX_FRAC: 0.10,
    SIGNS_FRACTION:   0.05,

    TILE_PAD_FRAC: 0.07,
    TILE_RADIUS_FRAC: 0.22,

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

    LETTER_WEIGHTS: {
      'а':990, 'е':518, 'о':720, 'и':504, 'н':600, 'т':500,
      'у':338, 'я':243, 'б':375, 'в':375, 'г':338, 'д':375,
      'к':375, 'л':375, 'м':375, 'п':375, 'р':375, 'с':375,
      'ы':78,  'э':78,  'ю':78,  'з':87,
      'й':86,  'ф':86,  'х':86,  'ц':86,  'ч':86,  'ш':86,  'щ':86,
      'ь':45,  'ъ':5
    },

    SIMPLE_LETTERS: ['а','е','о','и','н','т','у','я','б','в','г','д','к','л','м','п','р','с'],
    UNPOPULAR:      ['ы','э','ю','з','й','ф','х','ц','ч','ш','щ'],
    SIGNS:          ['ь','ъ'],

    BONUS_UNPOPULAR: 5,
    BONUS_SIGN:      10,

    SOFT_DROP: 0.06,
    HIGHLIGHT_REFRESH_MS: 140,
    RENDER_FPS: 40
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

    var simpleTotal = 0;
    for (var i=0;i<CONFIG.SIMPLE_LETTERS.length;i++) simpleTotal += CONFIG.LETTER_WEIGHTS[CONFIG.SIMPLE_LETTERS[i]];
    var simpleScale = simpleTotal > 0 ? (simpleFrac * 10000) / simpleTotal : 0;
    for (var i=0;i<CONFIG.SIMPLE_LETTERS.length;i++){
      var ch = CONFIG.SIMPLE_LETTERS[i];
      weights[ch] = CONFIG.LETTER_WEIGHTS[ch] * simpleScale;
    }

    var unpopTotal = 0;
    for (var i=0;i<CONFIG.UNPOPULAR.length;i++) unpopTotal += CONFIG.LETTER_WEIGHTS[CONFIG.UNPOPULAR[i]];
    var unpopScale = unpopTotal > 0 ? (unpopFrac * 10000) / unpopTotal : 0;
    for (var i=0;i<CONFIG.UNPOPULAR.length;i++){
      var ch = CONFIG.UNPOPULAR[i];
      weights[ch] = CONFIG.LETTER_WEIGHTS[ch] * unpopScale;
    }

    var signTotal = 0;
    for (var i=0;i<CONFIG.SIGNS.length;i++) signTotal += CONFIG.LETTER_WEIGHTS[CONFIG.SIGNS[i]];
    var signScale = signTotal > 0 ? (signFrac * 10000) / signTotal : 0;
    for (var i=0;i<CONFIG.SIGNS.length;i++){
      var ch = CONFIG.SIGNS[i];
      weights[ch] = CONFIG.LETTER_WEIGHTS[ch] * signScale;
    }

    var vowelList = [], consonantList = [];
    var vowelTotal = 0, consonantTotal = 0;
    for (var ch in weights){
      if (VOWELS_SET[ch]){ vowelList.push(ch); vowelTotal += weights[ch]; }
      else { consonantList.push(ch); consonantTotal += weights[ch]; }
    }

    return { weights: weights, vowelList: vowelList, consonantList: consonantList,
             vowelTotal: vowelTotal, consonantTotal: consonantTotal };
  }

  for (var lv0 = 1; lv0 <= CONFIG.MAX_LEVEL; lv0++){
    LEVEL_WEIGHTS[lv0] = computeLevelWeights(lv0);
  }
  function getLevelWeights(level){
    if (!level || level < 1) level = 1;
    if (level > CONFIG.MAX_LEVEL) level = CONFIG.MAX_LEVEL;
    return LEVEL_WEIGHTS[level];
  }

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

  function wordKey(w){
    var s = '';
    for (var i=0;i<w.cells.length;i++){
      s += w.cells[i][0] + ',' + w.cells[i][1] + '|';
    }
    return s + w.word;
  }
  function collectNewWords(oldHl, newHl){
    var oldKeys = Object.create(null);
    for (var i=0;i<oldHl.length;i++) oldKeys[wordKey(oldHl[i])] = 1;
    var result = [];
    for (var i=0;i<newHl.length;i++){
      var w = newHl[i];
      if (!oldKeys[wordKey(w)]) result.push(w.cells);
    }
    return result.length > 0 ? result : null;
  }

  function comboMultiplier(n){
    if (n <= 0) return 1;
    var m = CONFIG.COMBO_BASE + CONFIG.COMBO_STEP * (n - 1);
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
      newWord: function(){
        beep(1050, 0.08, 'sine', 0.09);
        setTimeout(function(){ beep(1400, 0.10, 'sine', 0.10); }, 70);
      },
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
        notes.forEach(function(f,i){ setTimeout(function(){ beep(f, 0.14, 'triangle', 0.10); }, i*110); });
        setTimeout(function(){
          beep(523, 0.6, 'sine', 0.09); beep(659, 0.6, 'sine', 0.09);
          beep(784, 0.6, 'sine', 0.09); beep(1046, 0.6, 'sine', 0.09);
        }, 900);
      },
      gameover: function(){
        [400,300,200,140].forEach(function(f,i){ setTimeout(function(){ beep(f,0.18,'sawtooth',0.07); }, i*130); });
      },
      victory: function(){
        var notes = [523,659,784,1046,1318,1568,2093];
        notes.forEach(function(f,i){ setTimeout(function(){ beep(f,0.16,'sine',0.10); }, i*130); });
        setTimeout(function(){
          beep(523, 0.8, 'sine', 0.10); beep(659, 0.8, 'sine', 0.10);
          beep(784, 0.8, 'sine', 0.10); beep(1046, 0.8, 'sine', 0.10);
          beep(1318, 0.8, 'sine', 0.10);
        }, 1100);
      }
    };
  })();

  var G = {
    state: 'READY', score: 0, level: 1, piece: null, queue: [],
    highlight: [], busy: false, phase: null, fallMoves: [], deleting: [],
    lockFx: null, goFx: null, pulseT: 0,
    newWordsFx: []
  };

  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
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
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = boardPx + 'px';
    canvas.style.height = boardPx + 'px';
    canvas.width  = Math.round(boardPx * dpr);
    canvas.height = Math.round(boardPx * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cellSize = boardPx / N;

    var pad = cellSize * CONFIG.TILE_PAD_FRAC;
    var s   = cellSize - pad * 2;
    var r   = s * CONFIG.TILE_RADIUS_FRAC;
    var outerRadius = Math.round((pad + r) * 100) / 100;
    canvas.style.borderRadius = outerRadius + 'px';

    var ov = document.getElementById('overlay');
    if (ov) ov.style.borderRadius = outerRadius + 'px';
  }
  window.addEventListener('resize', resize);

  function setMenuMode(on){
    if (on) document.body.classList.add('in-menu');
    else document.body.classList.remove('in-menu');
    requestAnimationFrame(function(){ resize(); });
  }

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
      return { fill:'#F5B93C', shadow:'#8F5608', edge:'#C67D18', letter:'#3A2400' };
    }
    if (mode === 'falling'){
      if (tier >= 10) return { fill:'#E82A5C', shadow:'#7A0828', edge:'#A01030', letter:'#FFFFFF' };
      if (tier >= 5)  return { fill:'#9C40F0', shadow:'#3A0E6A', edge:'#5A1A9A', letter:'#FFFFFF' };
      return               { fill:'#4A8AE8', shadow:'#0E2A8A', edge:'#1D4AB8', letter:'#FFFFFF' };
    }
    if (tier >= 10) return { fill:'#F0C4CE', shadow:'#A07080', edge:'#C890A0', letter:'#5A0A28' };
    if (tier >= 5)  return { fill:'#D8C0EE', shadow:'#8870B0', edge:'#A88AD0', letter:'#3A1560' };
    return               { fill:'#EDF1F8', shadow:'#9AA5BF', edge:'#C8D0E0', letter:'#1E2A4A' };
  }

  function drawCell(x, y, letter, opts){
    opts = opts || {};
    var pad = cellSize * CONFIG.TILE_PAD_FRAC;
    var s = cellSize - pad * 2;
    var r = s * CONFIG.TILE_RADIUS_FRAC;
    var alpha = opts.alpha != null ? opts.alpha : 1;
    var scale = opts.scale != null ? opts.scale : 1;
    var ox = x + cellSize/2, oy = y + cellSize/2;
    var tier = opts.tier || 1;

    var mode = opts.highlight ? 'highlight' : (opts.falling ? 'falling' : 'fixed');
    var pal = tilePalette(tier, mode);
    var shadowH = s * 0.10;

    ctx.save();
    ctx.globalAlpha = alpha;
    if (scale !== 1){
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);
      ctx.translate(-ox, -oy);
    }

    ctx.fillStyle = pal.shadow;
    roundRect(x + pad, y + pad + shadowH, s, s, r);
    ctx.fill();

    ctx.fillStyle = pal.fill;
    roundRect(x + pad, y + pad, s, s, r);
    ctx.fill();

    if (opts.flash){
      ctx.fillStyle = 'rgba(255,255,255,' + (opts.flash * 0.92) + ')';
      roundRect(x + pad, y + pad, s, s, r);
      ctx.fill();
    }

    ctx.strokeStyle = pal.edge;
    ctx.lineWidth = 1;
    ctx.stroke();

    var nw = opts.newWord || 0;
    if (nw > 0){
      ctx.fillStyle = 'rgba(255,240,180,' + (nw * 0.75) + ')';
      roundRect(x + pad, y + pad, s, s, r);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255,255,255,' + (nw * 0.95) + ')';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,220,140,' + (nw * 0.55) + ')';
      ctx.lineWidth = 5;
      roundRect(x + pad - 2, y + pad - 2, s + 4, s + 4, r + 2);
      ctx.stroke();
    }

    var letterColor = pal.letter;
    if (nw > 0.25) letterColor = '#2A1400';
    ctx.fillStyle = letterColor;
    ctx.font = '800 ' + (cellSize * 0.54) + 'px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(letter, x + cellSize/2, y + cellSize/2 + 1);
    ctx.restore();
  }

  function render(){
    ctx.fillStyle = '#0e1428';
    ctx.fillRect(0, 0, boardPx, boardPx);

    var pad = cellSize * CONFIG.TILE_PAD_FRAC;
    var s = cellSize - pad * 2;
    var r = s * CONFIG.TILE_RADIUS_FRAC;
    ctx.fillStyle = '#151a30';
    for (var rr0=0; rr0<N; rr0++){
      for (var cc0=0; cc0<N; cc0++){
        if (board[rr0][cc0]) continue;
        roundRect(cc0*cellSize + pad, rr0*cellSize + pad, s, s, r);
        ctx.fill();
      }
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

    var now = performance.now();

    var newWordAlpha = Object.create(null);
    if (G.newWordsFx.length > 0){
      for (var nwI = G.newWordsFx.length - 1; nwI >= 0; nwI--){
        var fx = G.newWordsFx[nwI];
        var expired = true;
        for (var wi = 0; wi < fx.words.length; wi++){
          var cells = fx.words[wi];
          for (var ci = 0; ci < cells.length; ci++){
            var cellStart = fx.start + ci * fx.step;
            var elapsed = now - cellStart;
            if (elapsed < 0){ expired = false; continue; }
            var t = elapsed / fx.fade;
            if (t < 1){
              expired = false;
              var a = Math.pow(1 - t, 1.5);
              var kk = cells[ci][0]*N + cells[ci][1];
              if (!newWordAlpha[kk] || newWordAlpha[kk] < a) newWordAlpha[kk] = a;
            }
          }
        }
        if (expired) G.newWordsFx.splice(nwI, 1);
      }
    }

    var flashAlpha = 0;
    if (G.phase && G.phase.type === 'flash'){
      var ft = (now - G.phase.start) / G.phase.dur;
      if (ft >= 1) flashAlpha = 0;
      else flashAlpha = Math.sin(ft * Math.PI);
    }

    var delSet = null;
    if (G.phase && G.phase.type === 'delete'){
      delSet = Object.create(null);
      var dt1 = Math.min(1, (now - G.phase.start) / G.phase.dur);
      for (var dI=0; dI<G.deleting.length; dI++){
        delSet[G.deleting[dI].r*N + G.deleting[dI].c] = dt1;
      }
    }

    var fallMap = null;
    if (G.phase && G.phase.type === 'fall'){
      fallMap = Object.create(null);
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
        if (fallMap && fallMap[cell.id]){
          var fm = fallMap[cell.id];
          y = (fm.fromR + (fm.toR - fm.fromR) * fm.t) * cellSize;
        }
        var delT = delSet ? delSet[r*N + c] : null;
        var mark = hl[r*N + c];
        var nwA = newWordAlpha[r*N + c] || 0;

        var opts = {
          highlight: !!mark,
          tier: mark || letterBonus(cell.letter)
        };
        if (mark && flashAlpha > 0) opts.flash = flashAlpha;
        if (nwA > 0) opts.newWord = nwA;
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

      var alpha = easeSpawn;
      if (p.lockStart){
        var lt = (now - p.lockStart) / CONFIG.LOCK_DELAY_MS;
        if (lt < 1){
          alpha = easeSpawn * (0.9 + 0.1 * Math.sin(lt * Math.PI * 8));
        }
      }

      drawCell(p.col * cellSize, p.visualRow * cellSize, p.letter, {
        falling: true,
        tier: letterBonus(p.letter),
        scale: scale,
        alpha: alpha
      });
    }

    if (G.lockFx){
      var ltf = (now - G.lockFx.start) / 350;
      if (ltf >= 1){
        G.lockFx = null;
      } else {
        var aL = 1 - ltf;
        ctx.strokeStyle = 'rgba(255,255,255,' + (aL * 0.8) + ')';
        ctx.lineWidth = 2;
        var lx = G.lockFx.c * cellSize;
        var ly = G.lockFx.r * cellSize;
        roundRect(lx + 2, ly + 2, cellSize - 4, cellSize - 4, 8);
        ctx.stroke();
      }
    }

    if (G.goFx){
      var gt = (now - G.goFx) / 400;
      if (gt >= 1){
        G.goFx = null;
      } else {
        ctx.fillStyle = 'rgba(255,240,180,' + ((1 - gt) * 0.2) + ')';
        ctx.fillRect(0, 0, boardPx, boardPx);
      }
    }
  }

  var el = {
    score:     document.getElementById('score'),
    bestScore: document.getElementById('bestScore'),
    level:     document.getElementById('level'),
    planet:    document.getElementById('planet'),
    dirs:      document.getElementById('dirs'),
    pv0:       document.getElementById('pv0'),
    pv1:       document.getElementById('pv1'),
    overlay:   document.getElementById('overlay'),
    toast:     document.getElementById('toast')
  };

  function readBest(){
    var best = 0;
    try { best = parseInt(localStorage.getItem('lonika_best') || '0', 10) || 0; } catch(e){}
    return best;
  }
  function refreshBest(){
    if (!el.bestScore) return;
    var best = readBest();
    el.bestScore.textContent = best > 0 ? best.toLocaleString('ru-RU') : '—';
  }

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

  function showTitleScreen(){
    setMenuMode(true);
    showOverlay(
      '<div class="title-screen">' +
        '<div class="title-logo-wrap">' +
          '<div class="title-logo-glow"></div>' +
          '<div class="title-orbit"></div>' +
          '<div class="title-orbit-inner"></div>' +
          '<h1 class="title-logo">ЛОНИКА</h1>' +
        '</div>' +
        '<button class="title-play" id="titlePlay" type="button">ИГРАТЬ</button>' +
      '</div>'
    );
    document.getElementById('titlePlay').onclick = function(){ openTutorial(); };
  }

  var TUTORIAL_PAGES = [
    {
      icon: '🎯',
      title: 'Собирай слова',
      text:
        'Буквы падают сверху.<br>' +
        'Двигай <b>←</b> <b>→</b>, ускоряй <b>↓</b>.<br><br>' +
        'Слова читаются в 8 направлениях.<br><br>' +
        'Слова <b>НЕ</b> удаляются сами.<br>' +
        'Готов — жми <b class="gold">GO</b>.'
    },
    {
      icon: '💰',
      title: 'Бонусы букв',
      text:
        '<b class="blue">Обычные</b> — ×1<br>' +
        '<b class="purple">ы э ю з й ф х ц ч ш щ</b> — ×5<br>' +
        '<b class="crimson">ь ъ</b> — ×10<br><br>' +
        'Формула:<br>' +
        '<b>длина² × 10 × бонус × комбо</b>'
    },
    {
      icon: '🔥',
      title: 'Комбо',
      text:
        'Больше слов за один GO — выше множитель:<br><br>' +
        '1 — <b>×1.32</b> &nbsp; 3 — <b>×2.11</b><br>' +
        '2 — <b>×1.72</b> &nbsp; 8+ — <b>×3.96</b>'
    },
    {
      icon: '🪐',
      title: '30 планет',
      text:
        'Каждые <b>10 000</b> очков — новая планета.<br><br>' +
        '<b>Меркурий → Селена</b><br><br>' +
        'Победа — на 30-м уровне.'
    }
  ];

  var tutorialEl = document.getElementById('tutorial');
  var tutStepEl = document.getElementById('tutStep');
  var tutIconEl = document.getElementById('tutIcon');
  var tutTitleEl = document.getElementById('tutTitle');
  var tutTextEl = document.getElementById('tutText');
  var tutDotsEl = document.getElementById('tutDots');
  var tutPrevBtn = document.getElementById('tutPrev');
  var tutNextBtn = document.getElementById('tutNext');
  var tutCloseBtn = document.getElementById('tutClose');
  var tutSkipBtn = document.getElementById('tutSkip');
  var tutIndex = 0;

  function renderTutorial(){
    var page = TUTORIAL_PAGES[tutIndex];
    tutStepEl.textContent = 'Шаг ' + (tutIndex + 1) + ' из ' + TUTORIAL_PAGES.length;
    tutIconEl.textContent = page.icon;
    tutTitleEl.textContent = page.title;
    tutTextEl.innerHTML = page.text;

    var dotsHtml = '';
    for (var i=0;i<TUTORIAL_PAGES.length;i++){
      dotsHtml += '<div class="tut-dot' + (i === tutIndex ? ' active' : '') + '"></div>';
    }
    tutDotsEl.innerHTML = dotsHtml;

    tutPrevBtn.disabled = (tutIndex === 0);
    if (tutIndex === TUTORIAL_PAGES.length - 1){
      tutNextBtn.textContent = 'ИГРАТЬ';
      tutNextBtn.style.background = 'linear-gradient(to bottom,#c88bff,#7c2ecc)';
      tutNextBtn.style.color = '#fff';
      tutNextBtn.style.boxShadow = '0 4px 0 #4f108f';
    } else {
      tutNextBtn.textContent = 'Далее →';
      tutNextBtn.style.background = 'linear-gradient(to bottom,#ffd66b,#f0a83a)';
      tutNextBtn.style.color = '#3a2400';
      tutNextBtn.style.boxShadow = '0 4px 0 #a06f18';
    }
  }

  function openTutorial(){
    setMenuMode(true);
    tutIndex = 0;
    renderTutorial();
    tutorialEl.classList.add('on');
  }
  function closeTutorial(){
    tutorialEl.classList.remove('on');
  }
  function tutPrev(){
    if (tutIndex > 0){ tutIndex--; renderTutorial(); }
  }
  function tutNext(){
    if (tutIndex < TUTORIAL_PAGES.length - 1){
      tutIndex++;
      renderTutorial();
    } else {
      closeTutorial();
      hideOverlay();
      startGame();
    }
  }
  function tutSkip(){
    closeTutorial();
    hideOverlay();
    startGame();
  }
  function tutClose(){
    closeTutorial();
    showTitleScreen();
  }

  tutPrevBtn.addEventListener('click', tutPrev);
  tutNextBtn.addEventListener('click', tutNext);
  tutCloseBtn.addEventListener('click', tutClose);
  if (tutSkipBtn) tutSkipBtn.addEventListener('click', tutSkip);

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
      'background:radial-gradient(circle at 50% 30%, #3c286e, #14082d);' +
      'color:#fff;font-weight:900;text-align:center;z-index:9998;' +
      'border:2px solid rgba(255,210,120,.7);' +
      'box-shadow:0 30px 120px rgba(160,120,255,.5);' +
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
        'position:relative">' +
        '<div style="position:absolute;inset:-18px;border:1.5px solid rgba(180,140,255,.4);border-radius:50%;' +
          'border-top-color:rgba(255,214,107,.9);transform:rotate(25deg)"></div>' +
      '</div>' +
      '<div style="margin-top:16px;font-size:34px;letter-spacing:3px;font-weight:900;' +
        'background:linear-gradient(90deg,#ffd66b,#ff9ec0);-webkit-background-clip:text;background-clip:text;color:transparent">' +
        planetName.toUpperCase() + '</div>' +
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
    setMenuMode(false);
    newBoard();
    G.score = 0; G.level = 1; G.piece = null;
    typeHistory = [];
    G.queue = [randomLetter(), randomLetter()];
    G.highlight = []; G.busy = false; G.phase = null;
    G.deleting = []; G.fallMoves = [];
    G.lockFx = null; G.goFx = null;
    G.newWordsFx = [];
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
      col: CONFIG.SPAWN_COL, row: 0, visualRow: 0, letter: letter,
      timer: 0, spawnStart: performance.now(), lockStart: null
    };
  }
  function lockPiece(){
    var p = G.piece;
    var oldHl = G.highlight;

    board[p.row][p.col] = { letter: p.letter, id: nextCellId++ };
    G.piece = null;
    Audio8.lock();

    refreshHighlight();

    var newWords = collectNewWords(oldHl, G.highlight);
    if (newWords){
      G.newWordsFx.push({
        words: newWords,
        start: performance.now(),
        fade: CONFIG.NEW_WORD_FADE_MS,
        step: CONFIG.NEW_WORD_STEP_MS
      });
      Audio8.newWord();
    } else {
      G.lockFx = { r: p.row, c: p.col, start: performance.now() };
    }

    spawnPiece();
  }
  function refreshHighlight(){ G.highlight = findWords(G.level); }
  function moveHorizontal(dir){
    if (G.state !== 'PLAYING' || !G.piece || G.busy) return;
    var nc = G.piece.col + dir;
    if (nc < 0 || nc >= N) return;
    if (!canPlace(G.piece.row, nc)) return;
    G.piece.col = nc;
    G.piece.lockStart = null;
    Audio8.move();
  }
  function softDropStep(){
    if (G.state !== 'PLAYING' || !G.piece || G.busy) return;
    if (canMoveTo(G.piece.col, G.piece.row + 1)){
      G.piece.row++; G.piece.timer = 0;
      G.piece.lockStart = null;
      Audio8.move();
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
    var comboTag = combo > 1 ? ' ×' + combo.toFixed(2) + ' комбо' : '';
    if (maxBonus >= 10){
      toast('БОНУС ×' + maxBonus + comboTag + '  +' + gain, 1800, '#ff8aa6');
    } else if (maxBonus >= 5){
      toast('БОНУС ×' + maxBonus + comboTag + '  +' + gain, 1700, '#d8b0ff');
    } else if (combo > 1){
      toast('КОМБО ×' + combo.toFixed(2) + '  +' + gain, 1400, '#ffd66b');
    } else {
      toast('+' + gain, 1200, '#ffd66b');
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

    G.phase = { type: 'flash', start: performance.now(), dur: CONFIG.FLASH_DURATION_MS };

    setTimeout(function(){
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

          var oldHlBeforeRefresh = G.highlight;
          refreshHighlight();
          var newAfterFall = collectNewWords(oldHlBeforeRefresh, G.highlight);
          if (newAfterFall){
            G.newWordsFx.push({
              words: newAfterFall,
              start: performance.now(),
              fade: CONFIG.NEW_WORD_FADE_MS,
              step: CONFIG.NEW_WORD_STEP_MS
            });
            Audio8.newWord();
          }

          G.busy = false;
          if (G.level >= CONFIG.MAX_LEVEL) victory();
        }, releaseDelay);
      }, 155);
    }, CONFIG.FLASH_DURATION_MS);
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
    var best = readBest();
    var isRecord = G.score > best;
    if (isRecord){
      try { localStorage.setItem('lonika_best', String(G.score)); } catch(e){}
      refreshBest();
    }
    var recordBadge = isRecord
      ? '<div style="display:inline-block;padding:6px 16px;border-radius:999px;' +
        'background:linear-gradient(to bottom,#ffd66b,#f0a83a);color:#3a2400;' +
        'font-weight:900;font-size:12px;letter-spacing:2px;margin-top:8px">НОВЫЙ РЕКОРД!</div>'
      : '<div style="margin-top:8px;font-size:12px;color:#7a86a8;letter-spacing:1px">лучший: ' + best.toLocaleString('ru-RU') + '</div>';
    showOverlay(
      '<h1 style="font-size:32px;letter-spacing:6px">ИГРА ОКОНЧЕНА</h1>' +
      '<div style="margin-top:12px;padding:18px 32px;border-radius:20px;' +
        'background:rgba(20,16,50,.85);border:1px solid rgba(120,140,220,.25)">' +
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
    var best = readBest();
    if (G.score > best){
      try { localStorage.setItem('lonika_best', String(G.score)); } catch(e){}
      refreshBest();
    }
    showOverlay(
      '<h1>ПОБЕДА!</h1>' +
      '<p style="margin-top:8px">Ты прошёл все 30 планет — от Меркурия до Селены!</p>' +
      '<div style="margin-top:12px;padding:18px 32px;border-radius:20px;' +
        'background:rgba(20,16,50,.85);border:1px solid rgba(255,200,80,.35)">' +
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
    if (tutorialEl.classList.contains('on')){
      if (e.key === 'ArrowLeft'){ tutPrev(); e.preventDefault(); return; }
      if (e.key === 'ArrowRight'){ tutNext(); e.preventDefault(); return; }
      if (e.key === 'Escape'){ tutClose(); e.preventDefault(); return; }
      return;
    }
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
        if (G.state === 'READY'){ return; }
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
    if (G.state === 'READY'){ return; }
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
      if (canMoveTo(G.piece.col, G.piece.row + 1)){
        G.piece.timer -= eff;
        G.piece.row++;
        G.piece.lockStart = null;
      } else {
        break;
      }
    }

    if (!canMoveTo(G.piece.col, G.piece.row + 1)){
      if (!G.piece.lockStart){
        G.piece.lockStart = performance.now();
      } else if (performance.now() - G.piece.lockStart >= CONFIG.LOCK_DELAY_MS){
        lockPiece();
        return;
      }
      G.piece.visualRow = G.piece.row;
    } else {
      G.piece.lockStart = null;
      var frac = G.piece.timer / eff;
      G.piece.visualRow = G.piece.row + Math.min(1, Math.max(0, frac));
    }
  }

  var lastRenderTs = 0;
  var renderInterval = 1000 / CONFIG.RENDER_FPS;

  function loop(ts){
    var dt = Math.min(60, ts - lastFrameTs);
    lastFrameTs = ts;
    update(dt);
    if (ts - lastRenderTs >= renderInterval){
      lastRenderTs = ts;
      render();
    }
    requestAnimationFrame(loop);
  }

  setInterval(function(){
    if (G.state === 'PLAYING' && !G.busy) refreshHighlight();
  }, CONFIG.HIGHLIGHT_REFRESH_MS);

  function boot(){
    newBoard();
    resize();
    updateUI();
    refreshBest();
    showTitleScreen();
    requestAnimationFrame(function(){
      document.body.classList.remove('loading');
      resize();
    });
    requestAnimationFrame(loop);
  }

  boot();
})();
