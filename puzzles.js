/*
 * puzzles.js - Presets da demonstracao.
 *
 * Todos os presets tem SOLUCAO UNICA, verificada pelo resolvedor exato
 * (sudoku-solver.js) no script tests/run-tests.js.
 *
 * A classificacao (facil / medio / dificil) segue o criterio do artigo:
 * pela media de geracoes do PROPRIO AG - facil < 3500, dificil > 10000.
 * Os numeros em "stats" vem de tests/benchmark.js (30 execucoes cada,
 * teto de 30000 geracoes por execucao) e estao em results/benchmark.csv.
 *
 * "demoSeed" e uma semente conferida que resolve rapido no navegador -
 * e a semente para usar na apresentacao ao vivo.
 */
function PuzzlesFactory() {
  'use strict';

  var PRESETS = [
    {
      id: 'vazia',
      name: 'Grade vazia',
      level: 'vazia',
      givens: 0,
      puzzle: '000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      demoSeed: 7,
      note: 'Sem pistas: o AG gera um Sudoku completo do zero. O artigo relata ~101 geracoes em media.'
    },
    {
      id: 'facil-1',
      name: 'Facil 1',
      level: 'facil',
      givens: 44,
      puzzle: '000096040730000265084235901072560819390041600816020400060310004000679000920450030',
      demoSeed: 265,
      note: 'Semente 265 resolve em 43 geracoes (< 1 s).'
    },
    {
      id: 'facil-2',
      name: 'Facil 2',
      level: 'facil',
      givens: 46,
      puzzle: '038950120015328049020176803002490570004760010970582060180040090590207000047000630',
      demoSeed: 286,
      note: 'Semente 286 resolve em 32 geracoes (< 1 s).'
    },
    {
      id: 'medio-1',
      name: 'Medio 1',
      level: 'medio',
      givens: 40,
      puzzle: '001038750085010936009026810710865090000400087068370000106200005057000020000057360',
      demoSeed: 1,
      note: ''
    },
    {
      id: 'medio-2',
      name: 'Medio 2',
      level: 'medio',
      givens: 40,
      puzzle: '006804009900760000010095860604052010000070604001340050069481003347509006080007045',
      demoSeed: 1,
      note: ''
    },
    {
      id: 'dificil-1',
      name: 'Dificil 1 (classico)',
      level: 'dificil',
      givens: 30,
      puzzle: '530070000600195000098000060800060003400803001700020006060000280000419005000080079',
      demoSeed: 1,
      note: 'O Sudoku classico da Wikipedia. O AG nem sempre resolve dentro do teto de geracoes.'
    },
    {
      id: 'dificil-2',
      name: 'Dificil 2',
      level: 'dificil',
      givens: 38,
      puzzle: '700034260008209005920050803090080002005067904430912086502600007600000028040700000',
      demoSeed: 1,
      note: ''
    }
  ];

  /* Medido por tests/benchmark.js: 30 execucoes por preset, sementes
     i*7919 (i = 1..30), teto de 30000 geracoes. Numeros completos em
     results/benchmark.csv e results/resumo.csv. */
  var STATS = {
    'vazia':     { taxa: 1.00, gerMedia: 502,   gerMediana: 451,   reinicios: 0.00, exatoMs: 0.41 },
    'facil-1':   { taxa: 1.00, gerMedia: 1256,  gerMediana: 643,   reinicios: 0.30, exatoMs: 0.07 },
    'facil-2':   { taxa: 1.00, gerMedia: 1138,  gerMediana: 580,   reinicios: 0.30, exatoMs: 0.02 },
    'medio-1':   { taxa: 0.97, gerMedia: 6016,  gerMediana: 4931,  reinicios: 2.57, exatoMs: 0.02 },
    'medio-2':   { taxa: 0.97, gerMedia: 6887,  gerMediana: 4794,  reinicios: 3.03, exatoMs: 0.04 },
    'dificil-1': { taxa: 0.57, gerMedia: 19847, gerMediana: 24978, reinicios: 9.60, exatoMs: 0.02 },
    'dificil-2': { taxa: 0.90, gerMedia: 11014, gerMediana: 6935,  reinicios: 5.10, exatoMs: 0.17 }
  };

  return { PRESETS: PRESETS, STATS: STATS };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PuzzlesFactory();
  module.exports.factorySource = PuzzlesFactory.toString();
} else if (typeof window !== 'undefined') {
  window.PuzzlesFactory = PuzzlesFactory;
  window.Puzzles = PuzzlesFactory();
}
