/*
 * tools/gen-puzzles.js
 *
 * Gera puzzles candidatos com solucao UNICA (verificada pelo backtracking)
 * e mede a media de geracoes que o proprio AG leva para resolver cada um.
 * A classificacao segue o artigo: facil < 3500, dificil > 10000.
 *
 * Uso:  node tools/gen-puzzles.js [candidatosPorNivel] [execucoesPorCandidato]
 */
var GA = require('../ga-core.js');
var Solver = require('../sudoku-solver.js');

var CANDIDATES = parseInt(process.argv[2], 10) || 6;
var RUNS = parseInt(process.argv[3], 10) || 8;
var CAP = 30000; /* teto de geracoes por execucao */

function gridToString(g) { return GA.gridToString(g); }

/* Remove pistas de uma grade completa mantendo solucao unica. */
function dig(full, targetGivens, rng) {
  var puzzle = Int8Array.from(full);
  var order = [];
  for (var i = 0; i < 81; i++) order.push(i);
  for (var a = order.length - 1; a > 0; a--) {
    var b = (rng() * (a + 1)) | 0;
    var t = order[a]; order[a] = order[b]; order[b] = t;
  }
  var givens = 81;
  for (var k = 0; k < order.length && givens > targetGivens; k++) {
    var cell = order[k];
    var saved = puzzle[cell];
    puzzle[cell] = 0;
    if (Solver.countSolutions(puzzle, 2) !== 1) {
      puzzle[cell] = saved;
    } else {
      givens--;
    }
  }
  return { puzzle: puzzle, givens: givens };
}

function rateWithGA(puzzleStr, runs) {
  var totalGen = 0, totalEval = 0, totalRestart = 0, totalMs = 0, solved = 0;
  for (var s = 1; s <= runs; s++) {
    var r = GA.solve({ puzzle: puzzleStr, seed: s * 7919, maxGenerations: CAP });
    totalGen += r.generations;
    totalEval += r.evaluations;
    totalRestart += r.restarts;
    totalMs += r.ms;
    if (r.solved) solved++;
  }
  return {
    avgGen: totalGen / runs,
    avgEval: totalEval / runs,
    avgRestart: totalRestart / runs,
    avgMs: totalMs / runs,
    solvedRate: solved / runs
  };
}

function classify(avgGen, solvedRate) {
  if (solvedRate < 0.9) return 'dificil';
  if (avgGen < 3500) return 'facil';
  if (avgGen > 10000) return 'dificil';
  return 'medio';
}

var rng = GA.mulberry32(20260921);
var targets = (process.env.TARGETS ? process.env.TARGETS.split(",").map(Number) : [38, 34, 30, 28, 26, 24, 22]);
var found = [];

console.log('alvo_pistas;pistas;classe;media_ger;taxa_resolvido;puzzle');
for (var ti = 0; ti < targets.length; ti++) {
  for (var c = 0; c < CANDIDATES; c++) {
    var full = Solver.randomFullGrid(rng);
    var d = dig(full, targets[ti], rng);
    var str = gridToString(d.puzzle);
    var stats = rateWithGA(str, RUNS);
    var cls = classify(stats.avgGen, stats.solvedRate);
    found.push({ target: targets[ti], givens: d.givens, cls: cls, stats: stats, puzzle: str,
                 solution: gridToString(full) });
    console.log([targets[ti], d.givens, cls, Math.round(stats.avgGen),
                 stats.solvedRate.toFixed(2), str].join(';'));
  }
}

console.log('\n--- resumo por classe ---');
['facil', 'medio', 'dificil'].forEach(function (cls) {
  var list = found.filter(function (f) { return f.cls === cls; })
                  .sort(function (a, b) { return a.stats.avgGen - b.stats.avgGen; });
  console.log(cls + ': ' + list.length + ' candidatos');
  list.slice(0, 6).forEach(function (f) {
    console.log('  ' + f.givens + ' pistas, ' + Math.round(f.stats.avgGen) + ' ger, ' +
                (f.stats.solvedRate * 100).toFixed(0) + '% -> ' + f.puzzle);
  });
});
