/*
 * app.js - interface da demonstracao.
 *
 * O AG roda num Web Worker para a interface nunca travar. O worker e
 * montado a partir do TEXTO das funcoes (GACoreFactory.toString()) dentro
 * de um Blob, entao nao precisa de servidor: funciona tambem abrindo o
 * index.html direto do disco (file://), onde o Chrome bloqueia worker de
 * arquivo. Se ainda assim o Worker falhar, cai para um modo de reserva que
 * roda o MESMO codigo na thread principal, em fatias, via setTimeout.
 */
(function () {
  'use strict';

  var GA = window.GACore;
  var Solver = window.Solver;
  var PRESETS = window.Puzzles.PRESETS;
  var STATS = window.Puzzles.STATS;

  /* =================================================================== *
   * 1. O corpo do worker
   *    Escrito como funcao normal para poder ser convertido em texto.
   *    "host" e o self do worker (ou um objeto falso no modo de reserva).
   * =================================================================== */
  function workerMain(GA, host) {
    var run = null;
    var running = false;
    var gensPerTick = 25;
    var pending = [];      /* pontos [geracao, aptidao] ainda nao enviados */
    var timer = null;

    function gridArray() {
      var g = run.bestGrid();
      var a = new Array(81);
      for (var i = 0; i < 81; i++) a[i] = g[i];
      return a;
    }

    /* Reduz os pontos do grafico para no maximo "max" por mensagem,
       guardando o MINIMO de cada balde (a melhor aptidao do trecho). */
    function squeeze(points, max) {
      if (points.length <= max) return points;
      var out = [];
      var bucket = Math.ceil(points.length / max);
      for (var i = 0; i < points.length; i += bucket) {
        var bestG = points[i][0], bestF = points[i][1];
        for (var j = i + 1; j < i + bucket && j < points.length; j++) {
          if (points[j][1] < bestF) { bestF = points[j][1]; bestG = points[j][0]; }
        }
        out.push([bestG, bestF]);
      }
      return out;
    }

    function postState(trace) {
      var pts = squeeze(pending, 400);
      pending = [];
      host.postMessage({
        type: 'state',
        generation: run.generation,
        evaluations: run.evaluations,
        bestFitness: run.pop[0].fit,
        age: run.pop[0].age,
        restarts: run.restarts,
        restartGenerations: run.restartGenerations.slice(),
        status: run.status,
        solved: run.solved,
        finished: run.finished(),
        running: running,
        grid: gridArray(),
        points: pts,
        trace: trace || null
      });
    }

    function oneGeneration(wantTrace) {
      var trace = run.step(wantTrace);
      pending.push([run.generation, run.pop[0].fit]);
      return trace;
    }

    function tick() {
      timer = null;
      if (!running || !run) return;
      for (var i = 0; i < gensPerTick && !run.finished(); i++) oneGeneration(false);
      if (run.finished()) running = false;
      postState(null);
      if (running) timer = setTimeout(tick, 0);
    }

    function stop() {
      running = false;
      if (timer !== null) { clearTimeout(timer); timer = null; }
    }

    host.onmessage = function (ev) {
      var msg = ev.data;
      try {
        if (msg.type === 'init') {
          stop();
          run = new GA.Run({
            puzzle: msg.puzzle,
            seed: msg.seed,
            maxTrials: msg.maxTrials || 0,
            flags: msg.flags
          });
          pending = [[0, run.pop[0].fit]];
          postState(null);
        } else if (msg.type === 'run') {
          if (!run || run.finished()) return;
          running = true;
          if (timer === null) timer = setTimeout(tick, 0);
        } else if (msg.type === 'pause') {
          stop();
          postState(null);
        } else if (msg.type === 'step') {
          if (!run || run.finished()) return;
          stop();
          var trace = oneGeneration(true);
          postState(trace);
        } else if (msg.type === 'speed') {
          /* nunca deixar virar 0 ou NaN: o laco giraria sem avancar */
          gensPerTick = (msg.gensPerTick > 0) ? Math.floor(msg.gensPerTick) : 1;
        }
      } catch (err) {
        host.postMessage({ type: 'error', message: String(err && err.message || err) });
      }
    };
  }

  /* =================================================================== *
   * 2. Criacao do worker (Blob) com reserva na thread principal
   * =================================================================== */
  var worker = null;
  var modoReserva = false;
  var recebeuEstado = false;

  function criarWorker(onMessage) {
    var fonte =
      'var GACoreFactory = ' + window.GACoreFactory.toString() + ';\n' +
      'var GA = GACoreFactory();\n' +
      'var workerMain = ' + workerMain.toString() + ';\n' +
      'workerMain(GA, self);\n';
    try {
      var blob = new Blob([fonte], { type: 'application/javascript' });
      var url = URL.createObjectURL(blob);
      var w = new Worker(url);
      w.onmessage = onMessage;
      w.onerror = function (e) {
        /* Se o worker morreu antes de dar qualquer sinal de vida (CSP,
           navegador antigo, file:// restrito), cai para a thread principal. */
        if (e && e.preventDefault) e.preventDefault();
        if (!recebeuEstado) {
          try { w.terminate(); } catch (ignora) {}
          worker = criarReserva(onMessage);
          reiniciar(true);
          dizer('Web Worker indisponível neste navegador: rodando na thread principal.');
        }
      };
      return w;
    } catch (e) {
      return null;
    }
  }

  function criarReserva(onMessage) {
    modoReserva = true;
    var host = {
      onmessage: null,
      postMessage: function (m) { onMessage({ data: m }); }
    };
    workerMain(GA, host);
    return {
      postMessage: function (m) { host.onmessage({ data: m }); }
    };
  }

  /* =================================================================== *
   * 3. Estado da interface
   * =================================================================== */
  var el = {};
  ['grade', 'faixa-status', 'v-geracao', 'v-avaliacoes', 'v-aptidao', 'v-reinicios',
   'v-tempo', 'grafico', 'sel-puzzle', 'linha-custom', 'txt-custom', 'txt-semente',
   'btn-semente-aleatoria', 'sel-velocidade', 'sel-trials', 'btn-iniciar', 'btn-passo',
   'btn-reiniciar', 'fl-crossover', 'fl-slack', 'fl-aging', 'fl-restart', 'btn-exato',
   'v-exato', 'nota-unicidade', 'passo-conteudo'].forEach(function (id) {
    el[id] = document.getElementById(id);
  });

  var celulas = [];
  var estado = {
    rodando: false,
    puzzleAtual: PRESETS[0].puzzle,
    pistas: null,          /* Int8Array em ordem de grade */
    pontos: [],            /* [[geracao, aptidao], ...] */
    reinicios: [],
    resolvido: false,
    msAcumulado: 0,
    inicioEm: 0,
    destaques: null        /* celulas trocadas na ultima mutacao mostrada */
  };

  /* --------------------------------------------------------- a grade -- */
  function montarGrade() {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < 81; i++) {
      var d = document.createElement('div');
      d.className = 'celula lin-' + ((i / 9) | 0) + ' col-' + (i % 9);
      frag.appendChild(d);
      celulas.push(d);
    }
    el['grade'].appendChild(frag);
  }

  function desenharGrade(grid, resolvido) {
    var arr = grid || estado.pistas;
    var conflitos = GA.conflictCells(Int8Array.from(arr));
    for (var i = 0; i < 81; i++) {
      var c = celulas[i];
      var v = arr[i];
      var txt = v ? String(v) : '';
      if (c.textContent !== txt) c.textContent = txt;
      var cls = 'celula lin-' + ((i / 9) | 0) + ' col-' + (i % 9);
      if (estado.pistas[i]) cls += ' pista';
      else if (v) cls += ' preenchida';
      if (!resolvido && conflitos[i] && v) cls += ' conflito';
      if (resolvido) cls += ' resolvido';
      if (estado.destaques && estado.destaques.indexOf(i) >= 0) cls += ' trocada';
      if (c.className !== cls) c.className = cls;
    }
  }

  /* -------------------------------------------------------- o grafico -- */
  function desenharGrafico() {
    var cv = el['grafico'];
    var ctx = cv.getContext('2d');
    var larguraCss = cv.clientWidth || 640;
    var dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(larguraCss * dpr)) {
      cv.width = Math.round(larguraCss * dpr);
      cv.height = Math.round(200 * dpr);
    }
    var W = cv.width, H = cv.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0c1013';
    ctx.fillRect(0, 0, W, H);

    var pts = estado.pontos;
    if (pts.length < 2) return;

    var margemE = 44 * dpr, margemB = 24 * dpr, margemT = 10 * dpr, margemD = 8 * dpr;
    var areaW = W - margemE - margemD, areaH = H - margemT - margemB;
    var maxG = pts[pts.length - 1][0] || 1;
    var maxF = 0;
    for (var i = 0; i < pts.length; i++) if (pts[i][1] > maxF) maxF = pts[i][1];
    if (maxF < 4) maxF = 4;

    function px(g) { return margemE + (g / maxG) * areaW; }
    function py(f) { return margemT + areaH - (f / maxF) * areaH; }

    /* eixos e marcas */
    ctx.strokeStyle = '#39424d';
    ctx.lineWidth = 1 * dpr;
    ctx.fillStyle = '#aab4c0';
    ctx.font = (11 * dpr) + 'px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    var passos = 4;
    for (var k = 0; k <= passos; k++) {
      var val = Math.round((maxF / passos) * k);
      var y = py(val);
      ctx.beginPath();
      ctx.moveTo(margemE, y); ctx.lineTo(W - margemD, y); ctx.stroke();
      ctx.fillText(String(val), margemE - 6 * dpr, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('0', margemE, H - margemB + 5 * dpr);
    ctx.fillText(String(maxG) + ' ger.', W - margemD - 24 * dpr, H - margemB + 5 * dpr);

    /* reinicios */
    ctx.strokeStyle = '#ff5252';
    ctx.lineWidth = 2 * dpr;
    for (var r = 0; r < estado.reinicios.length; r++) {
      var xg = px(estado.reinicios[r]);
      ctx.beginPath();
      ctx.moveTo(xg, margemT); ctx.lineTo(xg, margemT + areaH); ctx.stroke();
    }

    /* curva da melhor aptidao */
    ctx.strokeStyle = '#4da3ff';
    ctx.lineWidth = 2.5 * dpr;
    ctx.beginPath();
    for (var p = 0; p < pts.length; p++) {
      var x = px(pts[p][0]), y2 = py(pts[p][1]);
      if (p === 0) ctx.moveTo(x, y2); else ctx.lineTo(x, y2);
    }
    ctx.stroke();

    /* ponto atual */
    var ult = pts[pts.length - 1];
    ctx.fillStyle = ult[1] === 0 ? '#3ddc84' : '#4da3ff';
    ctx.beginPath();
    ctx.arc(px(ult[0]), py(ult[1]), 4 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ------------------------------------------------------ os numeros -- */
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

  function atualizarNumeros(s) {
    el['v-geracao'].textContent = fmt(s.generation);
    el['v-avaliacoes'].textContent = fmt(s.evaluations);
    el['v-aptidao'].textContent = String(s.bestFitness);
    el['v-aptidao'].className = 'valor ' + (s.bestFitness === 0 ? 'zerado' : 'destaque');
    el['v-reinicios'].textContent = fmt(s.restarts);
  }

  function tempoDecorrido() {
    var ms = estado.msAcumulado;
    if (estado.rodando) ms += performance.now() - estado.inicioEm;
    return ms;
  }

  function atualizarTempo() {
    el['v-tempo'].textContent = (tempoDecorrido() / 1000).toFixed(1).replace('.', ',') + ' s';
    if (estado.rodando) requestAnimationFrame(atualizarTempo);
  }

  function dizer(texto, classe) {
    el['faixa-status'].textContent = texto;
    el['faixa-status'].className = 'faixa-status' + (classe ? ' ' + classe : '');
  }

  /* ---------------------------------------------- mensagens do worker -- */
  function aoReceber(ev) {
    var s = ev.data;
    if (s.type === 'error') {
      pararCronometro();
      estado.rodando = false;
      el['btn-iniciar'].textContent = 'Iniciar';
      dizer('Erro: ' + s.message, 'erro');
      return;
    }
    if (s.type !== 'state') return;
    recebeuEstado = true;

    for (var i = 0; i < s.points.length; i++) estado.pontos.push(s.points[i]);
    if (estado.pontos.length > 4000) {
      /* mantem o grafico leve sem perder a forma da curva */
      var reduzido = [];
      for (var j = 0; j < estado.pontos.length; j += 2) reduzido.push(estado.pontos[j]);
      reduzido.push(estado.pontos[estado.pontos.length - 1]);
      estado.pontos = reduzido;
    }
    estado.reinicios = s.restartGenerations;
    estado.resolvido = s.solved;

    estado.destaques = null;
    if (s.trace) mostrarPasso(s.trace);

    atualizarNumeros(s);
    desenharGrade(s.grid, s.solved);
    desenharGrafico();

    if (s.finished && estado.rodando) {
      pararCronometro();
      estado.rodando = false;
      el['btn-iniciar'].textContent = 'Iniciar';
    }

    if (s.solved) {
      var ok = Solver.isValidSolution(Int8Array.from(s.grid));
      dizer('Resolvido na geração ' + fmt(s.generation) + ' com ' + fmt(s.evaluations) +
            ' avaliações em ' + (tempoDecorrido() / 1000).toFixed(1).replace('.', ',') + ' s. ' +
            'Verificação pelo resolvedor exato: ' + (ok ? 'grade válida.' : 'INVÁLIDA (erro!).'),
            ok ? 'ok' : 'erro');
      el['btn-iniciar'].disabled = true;
      el['btn-passo'].disabled = true;
    } else if (s.status === 'limite-avaliacoes') {
      dizer('Parou no limite de avaliações (' + fmt(s.evaluations) + ') sem encontrar solução. ' +
            'Melhor aptidão: ' + s.bestFitness + '.', 'erro');
      el['btn-iniciar'].disabled = true;
      el['btn-passo'].disabled = true;
    }
  }

  /* ------------------------------------------------- passo a passo ---- */
  function mostrarPasso(trace) {
    var alvo = el['passo-conteudo'];
    alvo.className = '';
    var html = '';

    var melhor = trace.bestTraceIdx;
    html += '<div class="passo-resumo">Geração <b>' + trace.generation + '</b>. ' +
            'Os 20 filhos substituíram as posições 1 a 20 da população; a posição 0 é o elite. ';
    if (melhor === -1 || melhor === undefined) {
      html += 'O melhor continua sendo o <b>elite</b> da geração anterior';
      if (trace.age) html += ' (envelhecimento acumulado: <b>+' + trace.age + '</b>)';
      html += '.';
    } else {
      html += 'O novo melhor veio do <b>filho da posição ' +
              trace.children[melhor].slot + '</b>.';
    }
    if (trace.restarted) html += ' <b>A população foi reiniciada.</b>';
    html += '</div>';

    html += '<div class="passo-lista">';
    for (var i = 0; i < trace.children.length; i++) {
      var c = trace.children[i];
      html += '<div class="passo-filho' + (i === melhor ? ' selecionado' : '') + '">';
      html += '<div class="cabeca">posição <b>' + c.slot + '</b> &larr; pais <b>' +
              c.x1 + '</b> e <b>' + c.x2 + '</b>' +
              (c.sameParent ? ' <i>(iguais: só a mutação muda o filho)</i>' : '') +
              ' &nbsp; aptidão <b>' + c.fitness + '</b></div>';

      html += '<span class="blocos-herdados">';
      for (var b = 0; b < 9; b++) {
        var de = c.inherit ? c.inherit[b] : 1;
        html += '<span class="bloco-h p' + de + '" title="bloco ' + b + '">' + (de === 1 ? 'A' : 'B') + '</span>';
      }
      html += '</span>';
      html += '<span class="trocas">' + textoTrocas(c.swaps) + '</span>';
      html += '</div>';
    }
    html += '</div>';
    alvo.innerHTML = html;

    /* destaca na grade as celulas trocadas pelo filho que virou o melhor */
    if (melhor >= 0 && trace.children[melhor].swaps) {
      var cels = [];
      var sw = trace.children[melhor].swaps;
      for (var k = 0; k < sw.length; k++) {
        if (sw[k].result !== 'aceita') continue;
        cels.push(GA.BLOCK_TO_GRID[sw[k].block * 9 + sw[k].k1]);
        cels.push(GA.BLOCK_TO_GRID[sw[k].block * 9 + sw[k].k2]);
      }
      if (cels.length) estado.destaques = cels;
    }
  }

  function textoTrocas(swaps) {
    if (!swaps || !swaps.length) return 'sem mutação nesta geração';
    var partes = [];
    for (var i = 0; i < swaps.length; i++) {
      var s = swaps[i];
      var classe = s.result === 'aceita' ? 'troca-aceita'
                 : s.result === 'desfeita' ? 'troca-desfeita'
                 : s.result === 'pista' ? 'troca-pista' : '';
      var rotulo = s.result === 'aceita' ? 'trocou'
                 : s.result === 'desfeita' ? 'desfeita pela folga'
                 : s.result === 'pista' ? 'parou numa pista'
                 : 'troca nula';
      partes.push('<span class="' + classe + '">bloco ' + s.block + ': ' +
                  s.k1 + '&harr;' + s.k2 + ' ' + rotulo + '</span>');
    }
    return 'mutação &rarr; ' + partes.join(' · ');
  }

  /* =================================================================== *
   * 4. Controles
   * =================================================================== */
  function preencherPresets() {
    var sel = el['sel-puzzle'];
    PRESETS.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name + (p.givens ? ' — ' + p.givens + ' pistas' : '');
      sel.appendChild(o);
    });
    var o2 = document.createElement('option');
    o2.value = '__custom__';
    o2.textContent = 'Colar meu puzzle…';
    sel.appendChild(o2);
  }

  function presetAtual() {
    var id = el['sel-puzzle'].value;
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return null;
  }

  /* Uma frase com o que medimos para o preset (30 execucoes em Node). */
  function textoPreset(p) {
    if (!p) return 'Puzzle colado pelo usuário.';
    var s = STATS[p.id];
    var partes = [p.name];
    if (p.givens) partes.push(p.givens + ' pistas');
    if (s) {
      partes.push('média de ' + fmt(s.gerMedia) + ' gerações em 30 execuções');
      partes.push('resolvido em ' + Math.round(s.taxa * 100) + '% delas');
    }
    var txt = partes.join(' · ') + '.';
    if (p.note) txt += ' ' + p.note;
    return txt;
  }

  function puzzleEscolhido() {
    if (el['sel-puzzle'].value === '__custom__') return el['txt-custom'].value;
    return presetAtual().puzzle;
  }

  function lerFlags() {
    return {
      crossover: el['fl-crossover'].checked,
      slack: el['fl-slack'].checked,
      aging: el['fl-aging'].checked,
      restart: el['fl-restart'].checked
    };
  }

  function pararCronometro() {
    if (estado.rodando) estado.msAcumulado += performance.now() - estado.inicioEm;
  }

  /* Reinicializa tudo com o puzzle, a semente e os operadores atuais. */
  function reiniciar(silencioso) {
    var texto = puzzleEscolhido();
    var grid;
    try {
      grid = GA.parsePuzzle(texto);
      if (!GA.cluesAreConsistent(grid)) throw new Error('as pistas já se repetem em alguma linha, coluna ou sub-grade.');
    } catch (e) {
      dizer('Puzzle inválido: ' + e.message, 'erro');
      return false;
    }

    pararCronometro();
    estado.rodando = false;
    estado.msAcumulado = 0;
    estado.pontos = [];
    estado.reinicios = [];
    estado.resolvido = false;
    estado.destaques = null;
    estado.puzzleAtual = texto;
    estado.pistas = grid;

    el['btn-iniciar'].textContent = 'Iniciar';
    el['btn-iniciar'].disabled = false;
    el['btn-passo'].disabled = false;
    el['v-tempo'].textContent = '0,0 s';
    el['v-exato'].textContent = '–';
    el['passo-conteudo'].className = 'passo-vazio';
    el['passo-conteudo'].textContent =
      'Avance uma geração para ver os pais sorteados, a herança de blocos e as trocas da mutação.';

    worker.postMessage({
      type: 'init',
      puzzle: texto,
      seed: el['txt-semente'].value,
      maxTrials: parseInt(el['sel-trials'].value, 10) || 0,
      flags: lerFlags()
    });
    worker.postMessage({ type: 'speed', gensPerTick: parseInt(el['sel-velocidade'].value, 10) });

    if (!silencioso) {
      var p = presetAtual();
      var pistas = 0;
      for (var i = 0; i < 81; i++) if (grid[i]) pistas++;
      dizer('Pronto: ' + (p ? p.name : 'puzzle colado') + ', ' + pistas + ' pistas, semente ' +
            el['txt-semente'].value + '.' + (modoReserva ? ' (modo de reserva: sem Web Worker)' : ''));
    }
    checarUnicidade(grid);
    return true;
  }

  function checarUnicidade(grid) {
    var n = Solver.countSolutions(grid, 2);
    var msg = n === 0 ? 'Este puzzle não tem solução.'
            : n === 1 ? 'Solução única, confirmada pelo backtracking.'
            : 'Atenção: este puzzle tem mais de uma solução.';
    el['nota-unicidade'].textContent = msg;
  }

  function alternarExecucao() {
    if (estado.resolvido) return;
    if (estado.rodando) {
      pararCronometro();
      estado.rodando = false;
      el['btn-iniciar'].textContent = 'Continuar';
      worker.postMessage({ type: 'pause' });
      dizer('Pausado.');
    } else {
      estado.rodando = true;
      estado.inicioEm = performance.now();
      el['btn-iniciar'].textContent = 'Pausar';
      worker.postMessage({ type: 'run' });
      dizer('Rodando…');
      requestAnimationFrame(atualizarTempo);
    }
  }

  /* =================================================================== *
   * 5. Ligacao dos eventos
   * =================================================================== */
  function ligarEventos() {
    el['sel-puzzle'].addEventListener('change', function () {
      var custom = el['sel-puzzle'].value === '__custom__';
      el['linha-custom'].hidden = !custom;
      if (custom) {
        if (!el['txt-custom'].value) el['txt-custom'].value = PRESETS[1].puzzle;
      } else {
        var p = presetAtual();
        if (p && p.demoSeed) el['txt-semente'].value = String(p.demoSeed);
      }
      reiniciar(false);
      dizer(textoPreset(presetAtual()));
    });

    el['txt-custom'].addEventListener('change', function () { reiniciar(false); });
    el['txt-semente'].addEventListener('change', function () { reiniciar(false); });
    el['sel-trials'].addEventListener('change', function () { reiniciar(false); });

    ['fl-crossover', 'fl-slack', 'fl-aging', 'fl-restart'].forEach(function (id) {
      el[id].addEventListener('change', function () { reiniciar(false); });
    });

    el['sel-velocidade'].addEventListener('change', function () {
      worker.postMessage({ type: 'speed', gensPerTick: parseInt(el['sel-velocidade'].value, 10) });
    });

    el['btn-semente-aleatoria'].addEventListener('click', function () {
      el['txt-semente'].value = String(Math.floor(Math.random() * 1000000));
      reiniciar(false);
    });

    el['btn-iniciar'].addEventListener('click', alternarExecucao);
    el['btn-reiniciar'].addEventListener('click', function () { reiniciar(false); });

    el['btn-passo'].addEventListener('click', function () {
      if (estado.rodando) alternarExecucao();
      worker.postMessage({ type: 'step' });
    });

    el['btn-exato'].addEventListener('click', function () {
      var r = Solver.solveExact(estado.pistas);
      if (!r.solved) { el['v-exato'].textContent = 'sem solução'; return; }
      el['v-exato'].textContent = r.ms.toFixed(2).replace('.', ',') + ' ms · ' +
                                  fmt(r.nodes) + ' nós';
    });

    window.addEventListener('resize', desenharGrafico);

    /* barra de espaco = iniciar/pausar, util na apresentacao */
    document.addEventListener('keydown', function (e) {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        alternarExecucao();
      }
    });
  }

  /* =================================================================== *
   * 6. Partida
   * =================================================================== */
  function iniciar() {
    montarGrade();
    preencherPresets();
    ligarEventos();

    worker = criarWorker(aoReceber);
    if (!worker) worker = criarReserva(aoReceber);

    /* Comeca no primeiro preset facil - e o melhor para abrir a demo. */
    el['sel-puzzle'].value = 'facil-1';
    var p = presetAtual();
    if (p && p.demoSeed) el['txt-semente'].value = String(p.demoSeed);
    reiniciar(false);
    dizer(textoPreset(p));
  }

  iniciar();
})();
