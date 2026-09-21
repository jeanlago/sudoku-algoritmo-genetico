/*
 * sudoku-solver.js - Resolvedor exato por backtracking.
 *
 * Nao faz parte do algoritmo genetico. Serve so para:
 *   - validar solucoes,
 *   - verificar que cada preset tem solucao UNICA,
 *   - medir o tempo do metodo exato como comparacao na apresentacao.
 *
 * Mesmo padrao de fabrica do ga-core.js (navegador / Worker / Node).
 */
function SolverFactory() {
  'use strict';

  var UNITS_ROW = [], UNITS_COL = [], UNITS_BOX = [];
  (function () {
    for (var i = 0; i < 81; i++) {
      var r = (i / 9) | 0, c = i % 9;
      UNITS_ROW.push(r);
      UNITS_COL.push(c);
      UNITS_BOX.push(3 * ((r / 3) | 0) + ((c / 3) | 0));
    }
  })();

  /* Busca com mascaras de bits e heuristica MRV (celula com menos
     candidatos primeiro). limit = quantas solucoes no maximo procurar. */
  function search(grid, limit, rng) {
    var rows = new Int32Array(9), cols = new Int32Array(9), box = new Int32Array(9);
    var i, v;
    for (i = 0; i < 81; i++) {
      v = grid[i];
      if (!v) continue;
      var bit = 1 << v;
      if ((rows[UNITS_ROW[i]] & bit) || (cols[UNITS_COL[i]] & bit) || (box[UNITS_BOX[i]] & bit)) {
        return { count: 0, solutions: [], nodes: 0, contradictory: true };
      }
      rows[UNITS_ROW[i]] |= bit;
      cols[UNITS_COL[i]] |= bit;
      box[UNITS_BOX[i]] |= bit;
    }

    var work = Int8Array.from(grid);
    var solutions = [];
    var nodes = 0;

    function popcount(x) {
      x = x - ((x >> 1) & 0x55555555);
      x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
      x = (x + (x >> 4)) & 0x0F0F0F0F;
      return (x * 0x01010101) >> 24;
    }

    function recurse() {
      var bestCell = -1, bestMask = 0, bestCount = 10, j;
      for (j = 0; j < 81; j++) {
        if (work[j]) continue;
        var used = rows[UNITS_ROW[j]] | cols[UNITS_COL[j]] | box[UNITS_BOX[j]];
        var mask = ~used & 0x3FE; /* bits 1..9 */
        var n = popcount(mask);
        if (n === 0) return false;
        if (n < bestCount) {
          bestCount = n; bestCell = j; bestMask = mask;
          if (n === 1) break;
        }
      }
      if (bestCell === -1) {
        solutions.push(Int8Array.from(work));
        return solutions.length >= limit;
      }
      var cands = [];
      for (var d = 1; d <= 9; d++) if (bestMask & (1 << d)) cands.push(d);
      if (rng) {
        for (var a = cands.length - 1; a > 0; a--) {
          var b2 = (rng() * (a + 1)) | 0;
          var t = cands[a]; cands[a] = cands[b2]; cands[b2] = t;
        }
      }
      for (var ci = 0; ci < cands.length; ci++) {
        var val = cands[ci], bt = 1 << val;
        nodes++;
        work[bestCell] = val;
        rows[UNITS_ROW[bestCell]] |= bt;
        cols[UNITS_COL[bestCell]] |= bt;
        box[UNITS_BOX[bestCell]] |= bt;
        if (recurse()) return true;
        work[bestCell] = 0;
        rows[UNITS_ROW[bestCell]] &= ~bt;
        cols[UNITS_COL[bestCell]] &= ~bt;
        box[UNITS_BOX[bestCell]] &= ~bt;
      }
      return false;
    }

    recurse();
    return { count: solutions.length, solutions: solutions, nodes: nodes, contradictory: false };
  }

  function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  /* Resolve e mede o tempo do metodo exato. */
  function solveExact(grid) {
    var t0 = now();
    var res = search(grid, 1, null);
    var t1 = now();
    return {
      solved: res.count > 0,
      solution: res.count > 0 ? res.solutions[0] : null,
      nodes: res.nodes,
      ms: t1 - t0
    };
  }

  /* Quantas solucoes? (para no maximo em 2 - so interessa saber se e unica) */
  function countSolutions(grid, limit) {
    var res = search(grid, limit || 2, null);
    return res.count;
  }

  function hasUniqueSolution(grid) {
    return countSolutions(grid, 2) === 1;
  }

  /* Uma grade 9x9 completa e um Sudoku valido? */
  function isValidSolution(grid) {
    var i, seenR = new Int32Array(9), seenC = new Int32Array(9), seenB = new Int32Array(9);
    for (i = 0; i < 81; i++) {
      var v = grid[i];
      if (v < 1 || v > 9) return false;
      var bit = 1 << v;
      if (seenR[UNITS_ROW[i]] & bit) return false;
      if (seenC[UNITS_COL[i]] & bit) return false;
      if (seenB[UNITS_BOX[i]] & bit) return false;
      seenR[UNITS_ROW[i]] |= bit;
      seenC[UNITS_COL[i]] |= bit;
      seenB[UNITS_BOX[i]] |= bit;
    }
    return true;
  }

  /* Grade completa aleatoria (usada pelo gerador de presets). */
  function randomFullGrid(rng) {
    var empty = new Int8Array(81);
    var res = search(empty, 1, rng);
    return res.solutions[0];
  }

  return {
    search: search,
    solveExact: solveExact,
    countSolutions: countSolutions,
    hasUniqueSolution: hasUniqueSolution,
    isValidSolution: isValidSolution,
    randomFullGrid: randomFullGrid
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SolverFactory();
  module.exports.factorySource = SolverFactory.toString();
} else if (typeof window !== 'undefined') {
  window.SolverFactory = SolverFactory;
  window.Solver = SolverFactory();
}
