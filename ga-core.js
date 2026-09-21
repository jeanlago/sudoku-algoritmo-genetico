/*
 * ga-core.js - Nucleo do Algoritmo Genetico para Sudoku
 * Baseado em: T. Mantere, J. Koljonen, "Solving, Rating and Generating
 * Sudoku Puzzles with GA", IEEE CEC 2007, pp. 1382-1389.
 *
 * O arquivo inteiro e uma FUNCAO FABRICA (GACoreFactory). Isso permite
 * exatamente o mesmo codigo rodar em tres lugares:
 *   1. navegador  -> <script src="ga-core.js">, window.GACore
 *   2. Web Worker -> o worker e montado a partir de GACoreFactory.toString()
 *                    dentro de um Blob (funciona tambem em file://)
 *   3. Node       -> require('./ga-core.js')
 */
function GACoreFactory() {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 1. Gerador de numeros aleatorios com semente (mulberry32)
   * ------------------------------------------------------------------ */
  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Aceita semente numerica ou texto. Texto vira hash FNV-1a de 32 bits. */
  function normalizeSeed(seed) {
    if (typeof seed === 'number' && isFinite(seed)) return seed >>> 0;
    var s = String(seed === undefined || seed === null ? '' : seed).trim();
    if (/^[0-9]{1,10}$/.test(s)) {
      var n = parseInt(s, 10);
      if (isFinite(n)) return n >>> 0;
    }
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /* ------------------------------------------------------------------ *
   * 2. Tabelas de indice: ordem-bloco  <->  ordem-grade
   *    O cromossomo tem 81 genes em 9 sub-blocos de 9 (esq->dir, cima->baixo).
   *    genome[b*9 + k] = digito na posicao k do sub-bloco b.
   * ------------------------------------------------------------------ */
  var BLOCK_TO_GRID = new Int32Array(81);
  var GRID_TO_BLOCK = new Int32Array(81);
  (function () {
    for (var b = 0; b < 9; b++) {
      for (var k = 0; k < 9; k++) {
        var r = 3 * ((b / 3) | 0) + ((k / 3) | 0);
        var c = 3 * (b % 3) + (k % 3);
        BLOCK_TO_GRID[b * 9 + k] = r * 9 + c;
        GRID_TO_BLOCK[r * 9 + c] = b * 9 + k;
      }
    }
  })();

  function blocksToGrid(genome, out) {
    out = out || new Int8Array(81);
    for (var i = 0; i < 81; i++) out[BLOCK_TO_GRID[i]] = genome[i];
    return out;
  }

  function gridToBlocks(grid, out) {
    out = out || new Int8Array(81);
    for (var i = 0; i < 81; i++) out[GRID_TO_BLOCK[i]] = grid[i];
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 3. Leitura de puzzle: string de 81 caracteres, 0 ou . = vazio
   * ------------------------------------------------------------------ */
  function parsePuzzle(str) {
    var s = String(str).replace(/[^0-9.]/g, '');
    if (s.length !== 81) {
      throw new Error('O puzzle precisa ter 81 caracteres (recebi ' + s.length + ').');
    }
    var grid = new Int8Array(81);
    for (var i = 0; i < 81; i++) {
      var ch = s.charAt(i);
      if (ch === '.' || ch === '0') { grid[i] = 0; continue; }
      grid[i] = ch.charCodeAt(0) - 48;
    }
    return grid;
  }

  function gridToString(grid) {
    var out = '';
    for (var i = 0; i < 81; i++) out += String(grid[i]);
    return out;
  }

  /* Pistas coerentes? (nenhuma repeticao em linha, coluna ou sub-grade) */
  function cluesAreConsistent(grid) {
    var i, r, c, b, seen, v;
    for (r = 0; r < 9; r++) {
      seen = 0;
      for (c = 0; c < 9; c++) {
        v = grid[r * 9 + c];
        if (!v) continue;
        if (seen & (1 << v)) return false;
        seen |= (1 << v);
      }
    }
    for (c = 0; c < 9; c++) {
      seen = 0;
      for (r = 0; r < 9; r++) {
        v = grid[r * 9 + c];
        if (!v) continue;
        if (seen & (1 << v)) return false;
        seen |= (1 << v);
      }
    }
    for (b = 0; b < 9; b++) {
      seen = 0;
      for (i = 0; i < 9; i++) {
        v = grid[BLOCK_TO_GRID[b * 9 + i]];
        if (!v) continue;
        if (seen & (1 << v)) return false;
        seen |= (1 << v);
      }
    }
    return true;
  }

  /* ------------------------------------------------------------------ *
   * 4. Aptidao (minimizar)
   *    Para cada uma das 9 linhas e 9 colunas:
   *      + 1 para cada digito 1..9 ausente
   *      + (n-1) para cada digito que aparece n>1 vezes
   *    Solucao = 0.
   * ------------------------------------------------------------------ */
  var _scratchGrid = new Int8Array(81);
  var _counts = new Int32Array(10);

  function fitnessOfGrid(grid) {
    var total = 0, r, c, d, n;
    for (r = 0; r < 9; r++) {
      for (d = 0; d <= 9; d++) _counts[d] = 0;
      for (c = 0; c < 9; c++) _counts[grid[r * 9 + c]]++;
      for (d = 1; d <= 9; d++) {
        n = _counts[d];
        if (n === 0) total += 1; else if (n > 1) total += n - 1;
      }
    }
    for (c = 0; c < 9; c++) {
      for (d = 0; d <= 9; d++) _counts[d] = 0;
      for (r = 0; r < 9; r++) _counts[grid[r * 9 + c]]++;
      for (d = 1; d <= 9; d++) {
        n = _counts[d];
        if (n === 0) total += 1; else if (n > 1) total += n - 1;
      }
    }
    return total;
  }

  function fitness(genome) {
    return fitnessOfGrid(blocksToGrid(genome, _scratchGrid));
  }

  /* Celulas em conflito (linha ou coluna com repeticao), em ORDEM DE GRADE. */
  function conflictCells(grid) {
    var bad = new Uint8Array(81), r, c, d;
    for (r = 0; r < 9; r++) {
      for (d = 0; d <= 9; d++) _counts[d] = 0;
      for (c = 0; c < 9; c++) _counts[grid[r * 9 + c]]++;
      for (c = 0; c < 9; c++) if (_counts[grid[r * 9 + c]] > 1) bad[r * 9 + c] = 1;
    }
    for (c = 0; c < 9; c++) {
      for (d = 0; d <= 9; d++) _counts[d] = 0;
      for (r = 0; r < 9; r++) _counts[grid[r * 9 + c]]++;
      for (r = 0; r < 9; r++) if (_counts[grid[r * 9 + c]] > 1) bad[r * 9 + c] = 1;
    }
    return bad;
  }

  /* ------------------------------------------------------------------ *
   * 5. Inicializacao de um individuo
   *    DECISAO NOSSA (o artigo nao detalha): cada sub-bloco recebe, em
   *    ordem aleatoria, os digitos que faltam nele, respeitando as pistas.
   *    Assim sub-grades e pistas ja nascem corretas e o AG so otimiza
   *    linhas e colunas.
   * ------------------------------------------------------------------ */
  function randomIndividual(givens, rng, out) {
    var genome = out || new Int8Array(81);
    var missing = [];
    for (var b = 0; b < 9; b++) {
      var used = 0, k, i, v, d, j, t;
      for (k = 0; k < 9; k++) {
        v = givens[b * 9 + k];
        genome[b * 9 + k] = v;
        if (v) used |= (1 << v);
      }
      missing.length = 0;
      for (d = 1; d <= 9; d++) if (!(used & (1 << d))) missing.push(d);
      /* Fisher-Yates com o RNG semeado */
      for (i = missing.length - 1; i > 0; i--) {
        j = (rng() * (i + 1)) | 0;
        t = missing[i]; missing[i] = missing[j]; missing[j] = t;
      }
      var p = 0;
      for (k = 0; k < 9; k++) if (!givens[b * 9 + k]) genome[b * 9 + k] = missing[p++];
    }
    return genome;
  }

  /* Sub-grades continuam sendo permutacoes de 1..9? (usado nos testes) */
  function blocksAreValid(genome) {
    for (var b = 0; b < 9; b++) {
      var seen = 0;
      for (var k = 0; k < 9; k++) {
        var v = genome[b * 9 + k];
        if (v < 1 || v > 9) return false;
        if (seen & (1 << v)) return false;
        seen |= (1 << v);
      }
    }
    return true;
  }

  /* ------------------------------------------------------------------ *
   * 6. Cruzamento uniforme entre sub-blocos
   *    Para cada um dos 9 blocos, o filho herda o bloco INTEIRO de x1 ou
   *    de x2 com probabilidade 1/2. Nunca corta dentro de um bloco, entao
   *    as sub-grades do filho continuam validas.
   * ------------------------------------------------------------------ */
  function crossover(p1, p2, child, rng, traceOut) {
    for (var b = 0; b < 9; b++) {
      var fromSecond = rng() < 0.5;
      var src = fromSecond ? p2 : p1;
      for (var k = 0; k < 9; k++) child[b * 9 + k] = src[b * 9 + k];
      if (traceOut) traceOut[b] = fromSecond ? 2 : 1;
    }
    return child;
  }

  /* ------------------------------------------------------------------ *
   * 7. Mutacao por trocas dentro de um sub-bloco
   *    - probabilidade 0.6 de TENTAR mutar
   *    - sorteia 1 sub-bloco e uma sequencia de 1 a 5 trocas nele
   *    - se uma troca tocar uma pista, a sequencia e interrompida ali
   *    - regra de folga: a troca so e aceita se, depois dela, cada um dos
   *      dois digitos trocados aparecer no maximo 3 vezes somando as
   *      linhas e colunas afetadas; caso contrario, desfaz
   * ------------------------------------------------------------------ */
  var MUTATION_PROB = 0.6;
  var MAX_SWAPS = 5;
  var SLACK_LIMIT = 3;

  /* Conta quantas vezes "digit" aparece na linha e na coluna da celula de
     grade "cell". A propria celula e contada duas vezes (uma pela linha,
     outra pela coluna), entao o minimo possivel e 2. Ou seja, o limite 3
     tolera no maximo UMA repeticao extra: e exatamente a "folga".

     AMBIGUIDADE DO ARTIGO: "linhas e colunas afetadas" pode ser lido como
     (a) a linha e a coluna da celula de destino de CADA digito  <- adotado
     (b) o conjunto das ate 4 linhas/colunas tocadas pela troca, para os
         dois digitos.
     A leitura (b) e drasticamente mais restritiva (quase nenhuma troca e
     aceita): mede ~29.900 geracoes na grade vazia contra ~545 da leitura
     (a). Ver README, secao "Decisoes e ambiguidades". */
  function countInLines(grid, cell, digit) {
    var r = (cell / 9) | 0, c = cell % 9;
    var total = 0, i;
    for (i = 0; i < 9; i++) if (grid[r * 9 + i] === digit) total++;
    for (i = 0; i < 9; i++) if (grid[i * 9 + c] === digit) total++;
    return total;
  }

  /* A troca so e aceita se, depois dela, cada um dos dois digitos trocados
     aparecer no maximo SLACK_LIMIT vezes nas linhas/colunas afetadas. */
  function slackAccepts(grid, g1, g2, v1, v2) {
    /* v1 foi para g2 e v2 foi para g1 */
    return countInLines(grid, g2, v1) <= SLACK_LIMIT &&
           countInLines(grid, g1, v2) <= SLACK_LIMIT;
  }

  function mutate(genome, givens, rng, flags, traceOut) {
    if (rng() >= MUTATION_PROB) return false;
    var b = (rng() * 9) | 0;
    var nSwaps = 1 + ((rng() * MAX_SWAPS) | 0);
    var changed = false;

    for (var s = 0; s < nSwaps; s++) {
      var k1 = (rng() * 9) | 0;
      var k2 = (rng() * 9) | 0;
      var i1 = b * 9 + k1, i2 = b * 9 + k2;

      if (givens[i1] || givens[i2]) {
        if (traceOut) traceOut.push({ block: b, k1: k1, k2: k2, result: 'pista' });
        break; /* troca tocou uma pista: interrompe a sequencia */
      }
      if (k1 === k2) {
        if (traceOut) traceOut.push({ block: b, k1: k1, k2: k2, result: 'nula' });
        continue;
      }

      var v1 = genome[i1], v2 = genome[i2];
      genome[i1] = v2; genome[i2] = v1;

      if (flags.slack) {
        var grid = blocksToGrid(genome, _scratchGrid);
        var g1 = BLOCK_TO_GRID[i1], g2 = BLOCK_TO_GRID[i2];
        if (!slackAccepts(grid, g1, g2, v1, v2)) {
          genome[i1] = v1; genome[i2] = v2; /* desfaz */
          if (traceOut) traceOut.push({ block: b, k1: k1, k2: k2, result: 'desfeita' });
          continue;
        }
      }
      changed = true;
      if (traceOut) traceOut.push({ block: b, k1: k1, k2: k2, result: 'aceita' });
    }
    return changed;
  }

  /* ------------------------------------------------------------------ *
   * 8. A execucao (populacao + geracoes)
   * ------------------------------------------------------------------ */
  var DEFAULTS = {
    population: 21,
    elite: 1,
    restartAfter: 2000,
    maxTrials: 0,          /* 0 = sem limite */
    maxGenerations: 0,     /* 0 = sem limite (usado pelos scripts de teste) */
    flags: { crossover: true, slack: true, aging: true, restart: true }
  };

  function Run(opts) {
    opts = opts || {};
    this.puzzleString = opts.puzzle;
    this.grid0 = parsePuzzle(opts.puzzle);
    if (!cluesAreConsistent(this.grid0)) {
      throw new Error('As pistas desse puzzle ja se repetem em alguma linha, coluna ou sub-grade.');
    }
    this.givens = gridToBlocks(this.grid0);
    this.seedRaw = opts.seed;
    this.seed = normalizeSeed(opts.seed);
    this.POP = opts.population || DEFAULTS.population;
    this.ELIT = (opts.elite === undefined) ? DEFAULTS.elite : opts.elite;
    this.restartAfter = (opts.restartAfter === undefined) ? DEFAULTS.restartAfter : opts.restartAfter;
    this.maxTrials = opts.maxTrials || 0;
    this.maxGenerations = opts.maxGenerations || 0;
    var f = opts.flags || {};
    this.flags = {
      crossover: ('crossover' in f) ? !!f.crossover : true,
      slack:     ('slack' in f)     ? !!f.slack     : true,
      aging:     ('aging' in f)     ? !!f.aging     : true,
      restart:   ('restart' in f)   ? !!f.restart   : true
    };
    this.reset();
  }

  Run.prototype.reset = function () {
    this.rng = mulberry32(this.seed);
    this.generation = 0;
    this.evaluations = 0;
    this.restarts = 0;
    this.restartGenerations = [];
    this.gensSinceRestart = 0;
    this.solved = false;
    this.status = 'rodando';
    this.prevBest = null;
    this.pop = [];
    for (var i = 0; i < this.POP; i++) {
      this.pop.push({ g: new Int8Array(81), fit: 0, age: 0, eff: 0 });
    }
    this.scratch = new Int8Array(81);
    this.initPopulation();
  };

  Run.prototype.initPopulation = function () {
    for (var i = 0; i < this.POP; i++) {
      var ind = this.pop[i];
      randomIndividual(this.givens, this.rng, ind.g);
      ind.fit = fitness(ind.g);
      ind.age = 0;
      ind.eff = ind.fit;
      this.evaluations++;
    }
    this.sortPop();
    this.prevBest = Int8Array.from(this.pop[0].g);
    this.gensSinceRestart = 0;
    if (this.pop[0].fit === 0) { this.solved = true; this.status = 'resolvido'; }
  };

  Run.prototype.sortPop = function () {
    this.pop.sort(function (a, b) { return a.eff - b.eff; });
  };

  Run.prototype.best = function () { return this.pop[0]; };

  Run.prototype.bestGrid = function () { return blocksToGrid(this.pop[0].g); };

  /* Uma geracao. Se wantTrace, devolve o detalhamento do passo a passo. */
  Run.prototype.step = function (wantTrace) {
    if (this.solved) return null;
    var trace = wantTrace ? { generation: this.generation + 1, children: [] } : null;
    var i, b;

    /* No passo a passo, marcamos cada individuo para depois saber qual
       filho virou o novo melhor (o elite sobrevivente fica com -1). */
    if (wantTrace) for (i = 0; i < this.POP; i++) this.pop[i].traceIdx = -1;

    /* --- Selecao e reproducao, conforme o pseudocodigo do artigo --- *
     * for i = POP-1 downto ELIT:
     *    x1 = floor(i*rand); x2 = floor(i*rand)
     *    filho de x1,x2 ocupa a posicao i
     * Como x1,x2 < i, os pais sao sempre individuos melhor classificados
     * e ainda nao sobrescritos: da para reproduzir no proprio vetor.     */
    for (i = this.POP - 1; i >= this.ELIT; i--) {
      var x1 = (i * this.rng()) | 0;
      var x2 = (i * this.rng()) | 0;
      var child = this.pop[i];
      var inherit = wantTrace ? new Array(9) : null;

      if (this.flags.crossover) {
        crossover(this.pop[x1].g, this.pop[x2].g, this.scratch, this.rng, inherit);
      } else {
        this.scratch.set(this.pop[x1].g);
        if (inherit) for (b = 0; b < 9; b++) inherit[b] = 1;
      }
      child.g.set(this.scratch);

      var swaps = wantTrace ? [] : null;
      mutate(child.g, this.givens, this.rng, this.flags, swaps);

      child.fit = fitness(child.g);
      child.age = 0;
      child.eff = child.fit;
      this.evaluations++;

      if (trace) {
        child.traceIdx = trace.children.length;
        trace.children.push({
          slot: i, x1: x1, x2: x2, sameParent: x1 === x2,
          inherit: inherit, swaps: swaps, fitness: child.fit
        });
      }
    }

    this.sortPop();

    /* --- Envelhecimento: se o melhor e o mesmo da geracao anterior,
           soma +1 a aptidao dele, acumulando. --- */
    if (this.flags.aging) {
      var top = this.pop[0];
      var same = true;
      for (b = 0; b < 81; b++) { if (top.g[b] !== this.prevBest[b]) { same = false; break; } }
      if (same) { top.age += 1; } else { top.age = 0; }
      top.eff = top.fit + top.age;
      if (trace) trace.age = top.age;
      /* a nova aptidao efetiva pode tirar o elite do topo na proxima ordenacao */
      this.sortPop();
    }
    if (trace) trace.bestTraceIdx = this.pop[0].traceIdx;
    this.prevBest = Int8Array.from(this.pop[0].g);

    this.generation++;
    this.gensSinceRestart++;

    /* --- Solucao? (aptidao CRUA zero) --- */
    for (i = 0; i < this.POP; i++) {
      if (this.pop[i].fit === 0) {
        this.solved = true;
        this.status = 'resolvido';
        if (i !== 0) {
          var sol = this.pop[i];
          this.pop[i] = this.pop[0];
          this.pop[0] = sol;
        }
        if (trace) trace.solved = true;
        return trace;
      }
    }

    /* --- Reinicio: 2000 geracoes sem solucao --- */
    if (this.flags.restart && this.restartAfter > 0 && this.gensSinceRestart >= this.restartAfter) {
      this.restarts++;
      this.restartGenerations.push(this.generation);
      this.initPopulation();
      if (trace) trace.restarted = true;
    }

    /* --- Parada por limite de avaliacoes / geracoes --- */
    if (this.maxTrials > 0 && this.evaluations >= this.maxTrials) this.status = 'limite-avaliacoes';
    if (this.maxGenerations > 0 && this.generation >= this.maxGenerations) this.status = 'limite-geracoes';

    return trace;
  };

  Run.prototype.finished = function () {
    return this.solved || this.status === 'limite-avaliacoes' || this.status === 'limite-geracoes';
  };

  /* Roda ate terminar. Usado pelos scripts de teste em Node. */
  function solve(opts) {
    var run = new Run(opts);
    var now = (typeof performance !== 'undefined' && performance.now)
      ? function () { return performance.now(); }
      : function () { return Date.now(); };
    var t0 = now();
    while (!run.finished()) run.step(false);
    var t1 = now();
    return {
      solved: run.solved,
      status: run.status,
      generations: run.generation,
      evaluations: run.evaluations,
      restarts: run.restarts,
      ms: t1 - t0,
      bestFitness: run.pop[0].fit,
      grid: gridToString(run.bestGrid()),
      run: run
    };
  }

  return {
    mulberry32: mulberry32,
    normalizeSeed: normalizeSeed,
    BLOCK_TO_GRID: BLOCK_TO_GRID,
    GRID_TO_BLOCK: GRID_TO_BLOCK,
    blocksToGrid: blocksToGrid,
    gridToBlocks: gridToBlocks,
    parsePuzzle: parsePuzzle,
    gridToString: gridToString,
    cluesAreConsistent: cluesAreConsistent,
    fitness: fitness,
    fitnessOfGrid: fitnessOfGrid,
    conflictCells: conflictCells,
    randomIndividual: randomIndividual,
    blocksAreValid: blocksAreValid,
    crossover: crossover,
    mutate: mutate,
    countInLines: countInLines,
    slackAccepts: slackAccepts,
    Run: Run,
    solve: solve,
    constants: {
      MUTATION_PROB: MUTATION_PROB,
      MAX_SWAPS: MAX_SWAPS,
      SLACK_LIMIT: SLACK_LIMIT,
      DEFAULTS: DEFAULTS
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GACoreFactory();
  module.exports.factorySource = GACoreFactory.toString();
} else if (typeof window !== 'undefined') {
  window.GACoreFactory = GACoreFactory;
  window.GACore = GACoreFactory();
}
