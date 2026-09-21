/*
 * tests/run-tests.js
 *
 * Roda EXATAMENTE o mesmo codigo do AG que o site usa (ga-core.js).
 *
 * Uso:  node tests/run-tests.js
 */
var path = require('path');
var fs = require('fs');
var GA = require('../ga-core.js');
var Solver = require('../sudoku-solver.js');
var Puzzles = require('../puzzles.js');

var passou = 0, falhou = 0;
var falhas = [];

function teste(nome, fn) {
  try {
    fn();
    passou++;
    console.log('  ok   ' + nome);
  } catch (e) {
    falhou++;
    falhas.push(nome + ': ' + e.message);
    console.log('  FALHA ' + nome + '\n        ' + e.message);
  }
}

function afirma(cond, msg) {
  if (!cond) throw new Error(msg || 'condicao falsa');
}

function secao(titulo) { console.log('\n' + titulo); }

var VAZIA = '0'.repeat(81);

/* =================================================================== *
 * 1. Aptidao 0  <=>  Sudoku valido
 * =================================================================== */
secao('1. Aptidao');

teste('a aptidao de uma solucao conhecida e 0', function () {
  var g = Solver.solveExact(GA.parsePuzzle(Puzzles.PRESETS[1].puzzle)).solution;
  afirma(Solver.isValidSolution(g), 'o backtracking devolveu grade invalida');
  afirma(GA.fitnessOfGrid(g) === 0, 'aptidao deveria ser 0, deu ' + GA.fitnessOfGrid(g));
});

teste('aptidao 0 <=> Sudoku valido, no espaco que o AG percorre', function () {
  /* No AG, as sub-grades sao SEMPRE permutacoes de 1..9 (a inicializacao
     garante e nem o cruzamento nem a mutacao quebram isso). Nesse espaco,
     linhas e colunas corretas ja implicam Sudoku valido. */
  var rng = GA.mulberry32(12345);
  var conferidos = 0, zeros = 0;
  for (var t = 0; t < 4000; t++) {
    var alvo = Puzzles.PRESETS[t % Puzzles.PRESETS.length].puzzle;
    var givens = GA.gridToBlocks(GA.parsePuzzle(alvo));
    var ind = GA.randomIndividual(givens, rng);
    var grid = GA.blocksToGrid(ind);
    var f = GA.fitness(ind);
    var valido = Solver.isValidSolution(grid);
    afirma((f === 0) === valido, 'aptidao ' + f + ' mas valido=' + valido);
    conferidos++;
    if (f === 0) zeros++;
  }
  /* Tambem conferimos sobre solucoes de verdade (onde f=0 acontece). */
  for (var p = 0; p < Puzzles.PRESETS.length; p++) {
    var sol = Solver.solveExact(GA.parsePuzzle(Puzzles.PRESETS[p].puzzle)).solution;
    afirma(GA.fitnessOfGrid(sol) === 0, 'solucao do preset ' + p + ' nao deu aptidao 0');
    afirma(Solver.isValidSolution(sol), 'solucao do preset ' + p + ' nao e valida');
  }
  afirma(conferidos === 4000, 'nem todos os individuos foram conferidos');
});

teste('fora do espaco do AG a equivalencia nao vale (limite conhecido)', function () {
  /* A aptidao so olha linhas e colunas. Esta grade tem todas as linhas e
     colunas perfeitas (e um deslocamento ciclico de 1), aptidao 0, mas as
     sub-grades 3x3 estao erradas: NAO e um Sudoku valido.
     Isso nao e um bug: e uma consequencia da representacao do artigo, que
     mantem as sub-grades corretas por construcao. */
  var g = new Int8Array(81);
  for (var r = 0; r < 9; r++) for (var c = 0; c < 9; c++) g[r * 9 + c] = ((r + c) % 9) + 1;
  afirma(GA.fitnessOfGrid(g) === 0, 'esperava aptidao 0');
  afirma(!Solver.isValidSolution(g), 'esperava Sudoku invalido');
});

/* =================================================================== *
 * 2. Operadores preservam pistas e sub-grades
 * =================================================================== */
secao('2. Cruzamento e mutacao');

teste('cruzamento e mutacao nunca alteram pistas nem quebram sub-grades', function () {
  var rng = GA.mulberry32(987654);
  var flagsVariantes = [
    { crossover: true, slack: true, aging: true, restart: true },
    { crossover: true, slack: false, aging: true, restart: true },
    { crossover: false, slack: true, aging: true, restart: true }
  ];
  for (var v = 0; v < flagsVariantes.length; v++) {
    for (var p = 0; p < Puzzles.PRESETS.length; p++) {
      var givens = GA.gridToBlocks(GA.parsePuzzle(Puzzles.PRESETS[p].puzzle));
      var a = GA.randomIndividual(givens, rng);
      var b = GA.randomIndividual(givens, rng);
      for (var it = 0; it < 300; it++) {
        var filho = new Int8Array(81);
        if (flagsVariantes[v].crossover) GA.crossover(a, b, filho, rng);
        else filho.set(a);
        GA.mutate(filho, givens, rng, flagsVariantes[v]);

        afirma(GA.blocksAreValid(filho),
               'sub-grade invalida apos os operadores (variante ' + v + ', preset ' + p + ')');
        for (var i = 0; i < 81; i++) {
          afirma(!givens[i] || filho[i] === givens[i],
                 'pista alterada no gene ' + i + ' (variante ' + v + ', preset ' + p + ')');
        }
        a = filho;
      }
    }
  }
});

teste('ao longo de uma execucao inteira as pistas continuam intactas', function () {
  for (var p = 0; p < Puzzles.PRESETS.length; p++) {
    var pz = Puzzles.PRESETS[p].puzzle;
    var run = new GA.Run({ puzzle: pz, seed: 4242, maxGenerations: 500 });
    var givens = run.givens;
    while (!run.finished()) {
      run.step(false);
      for (var k = 0; k < run.POP; k++) {
        var ind = run.pop[k];
        afirma(GA.blocksAreValid(ind.g), 'sub-grade invalida no preset ' + p);
        for (var i = 0; i < 81; i++) {
          afirma(!givens[i] || ind.g[i] === givens[i], 'pista alterada no preset ' + p);
        }
      }
    }
  }
});

teste('a regra de folga rejeita trocas que passam do limite', function () {
  /* Com a folga ligada, nenhuma troca aceita pode deixar um dos digitos
     trocados aparecendo mais de 3 vezes na linha+coluna da celula destino. */
  var rng = GA.mulberry32(555);
  var givens = GA.gridToBlocks(GA.parsePuzzle(VAZIA));
  var checados = 0;
  for (var t = 0; t < 2000; t++) {
    var ind = GA.randomIndividual(givens, rng);
    var antes = Int8Array.from(ind);
    var swaps = [];
    GA.mutate(ind, givens, rng, { slack: true }, swaps);
    var grid = GA.blocksToGrid(ind);
    for (var s = 0; s < swaps.length; s++) {
      if (swaps[s].result !== 'aceita') continue;
      var i1 = swaps[s].block * 9 + swaps[s].k1;
      var i2 = swaps[s].block * 9 + swaps[s].k2;
      var g1 = GA.BLOCK_TO_GRID[i1], g2 = GA.BLOCK_TO_GRID[i2];
      afirma(GA.countInLines(grid, g1, grid[g1]) <= 3 &&
             GA.countInLines(grid, g2, grid[g2]) <= 3,
             'troca aceita violou a regra de folga');
      checados++;
    }
    afirma(antes.length === 81, 'copia de seguranca perdida');
  }
  afirma(checados > 100, 'poucas trocas aceitas para o teste valer (' + checados + ')');
});

/* =================================================================== *
 * 3. Reprodutibilidade
 * =================================================================== */
secao('3. Reprodutibilidade');

teste('a mesma semente gera exatamente a mesma execucao', function () {
  var casos = [
    { puzzle: VAZIA, seed: 2024 },
    { puzzle: Puzzles.PRESETS[1].puzzle, seed: 'apresentacao' },
    { puzzle: Puzzles.PRESETS[5].puzzle, seed: 7 }
  ];
  for (var c = 0; c < casos.length; c++) {
    var op = { puzzle: casos[c].puzzle, seed: casos[c].seed, maxGenerations: 400 };
    var r1 = GA.solve(op);
    var r2 = GA.solve(op);
    afirma(r1.generations === r2.generations, 'geracoes diferentes no caso ' + c);
    afirma(r1.evaluations === r2.evaluations, 'avaliacoes diferentes no caso ' + c);
    afirma(r1.restarts === r2.restarts, 'reinicios diferentes no caso ' + c);
    afirma(r1.bestFitness === r2.bestFitness, 'aptidao diferente no caso ' + c);
    afirma(r1.grid === r2.grid, 'grade final diferente no caso ' + c);
  }
});

teste('sementes diferentes geram execucoes diferentes', function () {
  var a = GA.solve({ puzzle: VAZIA, seed: 1, maxGenerations: 300 });
  var b = GA.solve({ puzzle: VAZIA, seed: 2, maxGenerations: 300 });
  afirma(a.grid !== b.grid, 'duas sementes deram a mesma grade final');
});

teste('geracao a geracao tambem bate (populacao inteira)', function () {
  function assinatura(seed) {
    var run = new GA.Run({ puzzle: Puzzles.PRESETS[3].puzzle, seed: seed, maxGenerations: 120 });
    var s = '';
    while (!run.finished()) {
      run.step(false);
      for (var i = 0; i < run.POP; i++) s += run.pop[i].fit + ',' + run.pop[i].age + ';';
    }
    return s;
  }
  afirma(assinatura(31337) === assinatura(31337), 'as duas execucoes divergiram');
});

teste('o codigo do Worker (via toString) produz o mesmo resultado', function () {
  /* E assim que o navegador monta o Worker: texto da fabrica dentro de um
     Blob. Aqui avaliamos o mesmo texto e conferimos que o AG bate. */
  var fonte = GA.factorySource;
  var fabricado = eval('(' + fonte + ')')();
  var r1 = GA.solve({ puzzle: Puzzles.PRESETS[2].puzzle, seed: 99, maxGenerations: 300 });
  var r2 = fabricado.solve({ puzzle: Puzzles.PRESETS[2].puzzle, seed: 99, maxGenerations: 300 });
  afirma(r1.grid === r2.grid && r1.generations === r2.generations,
         'o nucleo reconstruido por toString divergiu do original');
});

/* =================================================================== *
 * 4. Presets
 * =================================================================== */
secao('4. Presets');

teste('todo preset tem solucao unica e pistas coerentes', function () {
  for (var i = 0; i < Puzzles.PRESETS.length; i++) {
    var p = Puzzles.PRESETS[i];
    var g = GA.parsePuzzle(p.puzzle);
    var pistas = 0;
    for (var k = 0; k < 81; k++) if (g[k]) pistas++;
    afirma(pistas === p.givens, p.id + ': declarou ' + p.givens + ' pistas mas tem ' + pistas);
    afirma(GA.cluesAreConsistent(g), p.id + ': pistas incoerentes');
    if (p.id === 'vazia') continue; /* a grade vazia tem 6,67e21 solucoes */
    afirma(Solver.countSolutions(g, 2) === 1, p.id + ': nao tem solucao unica');
  }
});

teste('a semente de demonstracao de cada preset facil resolve em menos de 15 s', function () {
  for (var i = 0; i < Puzzles.PRESETS.length; i++) {
    var p = Puzzles.PRESETS[i];
    if (p.level !== 'facil') continue;
    var r = GA.solve({ puzzle: p.puzzle, seed: p.demoSeed, maxGenerations: 2000000 });
    afirma(r.solved, p.id + ': a semente de demonstracao nao resolveu');
    afirma(r.ms < 15000, p.id + ': demorou ' + Math.round(r.ms) + ' ms');
    console.log('       ' + p.id + ': semente ' + p.demoSeed + ' -> ' + r.generations +
                ' geracoes em ' + r.ms.toFixed(1) + ' ms');
  }
});

/* =================================================================== *
 * 5. Grade vazia: 30 execucoes (comparacao com o artigo)
 * =================================================================== */
secao('5. Grade vazia, 30 execucoes');

teste('30 execucoes na grade vazia, media de geracoes', function () {
  var total = 0, resolvidas = 0, totalMs = 0, min = Infinity, max = 0;
  var gers = [];
  for (var s = 1; s <= 30; s++) {
    var r = GA.solve({ puzzle: VAZIA, seed: s, maxGenerations: 100000 });
    total += r.generations;
    totalMs += r.ms;
    gers.push(r.generations);
    if (r.solved) resolvidas++;
    if (r.generations < min) min = r.generations;
    if (r.generations > max) max = r.generations;
  }
  var media = total / 30;
  gers.sort(function (a, b) { return a - b; });
  var mediana = (gers[14] + gers[15]) / 2;
  console.log('       media   : ' + media.toFixed(1) + ' geracoes');
  console.log('       mediana : ' + mediana);
  console.log('       min/max : ' + min + ' / ' + max);
  console.log('       tempo   : ' + (totalMs / 30).toFixed(1) + ' ms por execucao');
  console.log('       artigo  : ~101 geracoes  ->  nossa media e ' +
              (media / 101).toFixed(1) + 'x a do artigo');
  console.log('       (a diferenca e discutida no README, secao "Decisoes e ambiguidades")');
  afirma(resolvidas === 30, 'so ' + resolvidas + '/30 execucoes resolveram');
  afirma(media < 5000, 'media de ' + media.toFixed(0) +
         ' geracoes e alta demais: provavel erro de implementacao');
});

/* =================================================================== *
 * Fim
 * =================================================================== */
console.log('\n' + '-'.repeat(60));
console.log(passou + ' testes passaram, ' + falhou + ' falharam.');
if (falhou) {
  console.log('\nFalhas:');
  falhas.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
