/*
 * tests/benchmark.js
 *
 * Roda o AG 30 vezes em cada preset e salva um CSV com geracoes,
 * avaliacoes, reinicios e tempo. Material para o trabalho 2.
 *
 * Saidas:
 *   results/benchmark.csv  - uma linha por execucao
 *   results/resumo.csv     - uma linha por preset (media, mediana, etc.)
 *
 * Uso:  node tests/benchmark.js [execucoes] [tetoDeGeracoes]
 *   ex: node tests/benchmark.js 30 30000
 */
var fs = require('fs');
var path = require('path');
var GA = require('../ga-core.js');
var Solver = require('../sudoku-solver.js');
var Puzzles = require('../puzzles.js');

var EXECUCOES = parseInt(process.argv[2], 10) || 30;
var TETO = parseInt(process.argv[3], 10) || 30000;

var dirResultados = path.join(__dirname, '..', 'results');
if (!fs.existsSync(dirResultados)) fs.mkdirSync(dirResultados);

/* Criterio do artigo, aplicado a media de geracoes do proprio AG. */
function classificar(mediaGer, taxaResolvido) {
  if (taxaResolvido < 0.9) return 'dificil';
  if (mediaGer < 3500) return 'facil';
  if (mediaGer > 10000) return 'dificil';
  return 'medio';
}

function estatisticas(valores) {
  var ordenado = valores.slice().sort(function (a, b) { return a - b; });
  var soma = valores.reduce(function (a, b) { return a + b; }, 0);
  var media = soma / valores.length;
  var meio = Math.floor(ordenado.length / 2);
  var mediana = ordenado.length % 2 ? ordenado[meio] : (ordenado[meio - 1] + ordenado[meio]) / 2;
  var variancia = valores.reduce(function (a, b) { return a + (b - media) * (b - media); }, 0) /
                  valores.length;
  return {
    media: media,
    mediana: mediana,
    desvio: Math.sqrt(variancia),
    min: ordenado[0],
    max: ordenado[ordenado.length - 1]
  };
}

function n2(x) { return x.toFixed(2).replace('.', ','); }

var linhas = ['preset;nivel_declarado;pistas;execucao;semente;resolvido;geracoes;avaliacoes;reinicios;tempo_ms;aptidao_final'];
var resumo = ['preset;nivel_declarado;nivel_medido;pistas;execucoes;taxa_resolvido;ger_media;ger_mediana;ger_desvio;ger_min;ger_max;aval_media;reinicios_media;tempo_ms_media;backtracking_ms;backtracking_nos'];

console.log('Benchmark: ' + EXECUCOES + ' execucoes por preset, teto de ' +
            TETO + ' geracoes.\n');

Puzzles.PRESETS.forEach(function (p) {
  var grid = GA.parsePuzzle(p.puzzle);
  var exato = Solver.solveExact(grid);

  var gers = [], avals = [], reinicios = [], tempos = [], resolvidas = 0;

  for (var i = 1; i <= EXECUCOES; i++) {
    var semente = i * 7919;   /* sementes fixas: o benchmark e reproduzivel */
    var r = GA.solve({ puzzle: p.puzzle, seed: semente, maxGenerations: TETO });
    if (r.solved) resolvidas++;
    gers.push(r.generations);
    avals.push(r.evaluations);
    reinicios.push(r.restarts);
    tempos.push(r.ms);
    linhas.push([p.id, p.level, p.givens, i, semente, r.solved ? 1 : 0,
                 r.generations, r.evaluations, r.restarts, n2(r.ms), r.bestFitness].join(';'));
  }

  var eg = estatisticas(gers), ea = estatisticas(avals);
  var er = estatisticas(reinicios), et = estatisticas(tempos);
  var taxa = resolvidas / EXECUCOES;
  var medido = p.id === 'vazia' ? 'vazia' : classificar(eg.media, taxa);

  resumo.push([p.id, p.level, medido, p.givens, EXECUCOES, n2(taxa),
               n2(eg.media), n2(eg.mediana), n2(eg.desvio), eg.min, eg.max,
               n2(ea.media), n2(er.media), n2(et.media),
               n2(exato.ms), exato.nodes].join(';'));

  console.log(p.name.padEnd(22) +
              ' nivel medido: ' + medido.padEnd(8) +
              ' resolvidas: ' + (taxa * 100).toFixed(0).padStart(3) + '%' +
              ' | geracoes media ' + Math.round(eg.media).toString().padStart(6) +
              ' mediana ' + Math.round(eg.mediana).toString().padStart(6) +
              ' | tempo ' + Math.round(et.media).toString().padStart(5) + ' ms' +
              ' | backtracking ' + exato.ms.toFixed(2) + ' ms');
});

fs.writeFileSync(path.join(dirResultados, 'benchmark.csv'), linhas.join('\n') + '\n', 'utf8');
fs.writeFileSync(path.join(dirResultados, 'resumo.csv'), resumo.join('\n') + '\n', 'utf8');

console.log('\nCSV salvo em results/benchmark.csv (' + (linhas.length - 1) + ' execucoes)');
console.log('Resumo salvo em results/resumo.csv');
console.log('\nCriterio do artigo aplicado a media de geracoes do AG:');
console.log('  facil < 3500   |   3500..10000 medio   |   dificil > 10000');
console.log('  (execucoes que batem no teto de ' + TETO + ' geracoes contam como nao resolvidas,');
console.log('   e um preset que resolve em menos de 90% das execucoes e classificado como dificil)');
