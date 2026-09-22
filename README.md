# Sudoku com Algoritmo Genético

Site estático que roda **ao vivo** o algoritmo genético para Sudoku do artigo de
Mantere e Koljonen (IEEE CEC 2007). HTML + CSS + JavaScript puro: sem build, sem
framework, sem dependência. Feito para uma apresentação de 10 minutos num projetor.

**Referência**

> T. Mantere, J. Koljonen. *Solving, Rating and Generating Sudoku Puzzles with GA*.
> IEEE Congress on Evolutionary Computation (CEC 2007), Singapura, pp. 1382–1389.
> DOI: 10.1109/CEC.2007.4424632

---

## Como rodar

**Opção 1 — abrir direto do disco.** Dê duplo clique em `index.html`. Funciona em
`file://` porque o Web Worker é montado a partir de um `Blob` com o código em
linha (o Chrome bloqueia worker carregado de arquivo, mas não de `Blob`).

**Opção 2 — servidor local** (mais parecido com o GitHub Pages):

```bash
npx serve .
# ou
python -m http.server 8000
```

**Testes e benchmark** (precisam de Node ≥ 14, nada mais):

```bash
node tests/run-tests.js              # 13 testes
node tests/benchmark.js 30 30000     # 30 execuções por preset -> results/*.csv
node tools/gen-puzzles.js 6 8        # gera e classifica novos puzzles candidatos
```

## Como publicar no GitHub Pages

Todos os arquivos do site estão na **raiz** do repositório, então é direto:

```bash
git init
git add .
git commit -m "Sudoku com algoritmo genético"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/SEU-REPO.git
git push -u origin main
```

Depois, no GitHub: **Settings → Pages → Source: Deploy from a branch → Branch:
`main` / `(root)` → Save**. Em um ou dois minutos o site fica em
`https://SEU-USUARIO.github.io/SEU-REPO/`.

Não é preciso `.nojekyll`: nenhum arquivo ou pasta começa com `_`.

---

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html`, `styles.css` | a página e o visual |
| `app.js` | interface, Web Worker (Blob), gráfico, passo a passo |
| `ga-core.js` | **o algoritmo genético** — o mesmo código roda no navegador, no worker e no Node |
| `sudoku-solver.js` | resolvedor exato (backtracking + MRV), só para validar, checar unicidade e comparar tempo |
| `puzzles.js` | os 7 presets, sementes de demonstração e as estatísticas medidas |
| `tests/run-tests.js` | os testes |
| `tests/benchmark.js` | 30 execuções por preset → CSV |
| `tools/gen-puzzles.js` | gera puzzles com solução única e os classifica pelo AG |
| `results/benchmark.csv` | uma linha por execução (210 linhas) |
| `results/resumo.csv` | uma linha por preset |

O truque que faz `ga-core.js` rodar nos três lugares: o arquivo inteiro é uma
função fábrica (`GACoreFactory`). No Node, `module.exports = GACoreFactory()`.
No navegador, `window.GACore = GACoreFactory()`. No worker, `app.js` monta o
código-fonte com `GACoreFactory.toString()` e cria o `Worker` a partir de um
`Blob`. Um dos testes confere que o núcleo reconstruído por `toString()` produz
exatamente o mesmo resultado do original.

---

## O algoritmo

* **Cromossomo**: 81 inteiros divididos em 9 sub-blocos de 9, um por subgrade 3×3
  (da esquerda para a direita, de cima para baixo). Um vetor auxiliar marca as
  pistas; valor diferente de zero é fixo e nunca muda.
* **Inicialização**: cada sub-bloco é preenchido com os dígitos que faltam nele,
  em ordem aleatória, respeitando as pistas. Subgrades e pistas ficam corretas
  desde o começo; o AG só otimiza linhas e colunas.
* **Aptidão (minimizar)**: para cada uma das 9 linhas e 9 colunas, cada dígito
  ausente soma 1 e cada dígito que aparece *n* > 1 vezes soma *n* − 1.
  Solução = 0.
* **População 21, elitismo 1**, ordenada da melhor para a pior.
* **Seleção** (pseudocódigo do artigo): para *i* de POP−1 até ELIT, decrescente,
  `x1 = floor(i·rand)`, `x2 = floor(i·rand)`; o filho de x1 e x2 ocupa a posição
  *i*. Como x1 e x2 são sempre menores que *i*, os pais são indivíduos melhor
  classificados e ainda não sobrescritos. Se x1 = x2, só a mutação altera o filho.
* **Cruzamento uniforme entre sub-blocos**: cada um dos 9 blocos vem inteiro de
  x1 ou de x2, com probabilidade ½. Nunca corta dentro de um bloco, então as
  subgrades do filho continuam válidas.
* **Mutação**: probabilidade 0,6 de tentar. Sorteia um sub-bloco e uma sequência
  de 1 a 5 trocas de dois valores dentro dele. Se uma troca tocar uma pista, a
  sequência é interrompida ali. A **regra de folga** aceita a troca só se, depois
  dela, cada um dos dois dígitos trocados aparecer no máximo 3 vezes nas linhas e
  colunas afetadas; caso contrário, desfaz.
* **Envelhecimento**: se o melhor indivíduo de uma geração é o mesmo da geração
  anterior, soma +1 à aptidão dele, acumulando enquanto continuar sendo o melhor.
* **Reinício**: 2000 gerações sem solução → reinicializa a população inteira.
* **Parada**: solução encontrada, ou limite opcional de avaliações de aptidão
  (*trials*) — padrão sem limite, com a opção de 100.000 como no artigo.

Os quatro interruptores da interface (cruzamento, regra de folga, envelhecimento,
reinício) permitem desligar um operador por vez. **Com os quatro ligados, o
comportamento é o do artigo.**

---

## Decisões e ambiguidades

O artigo não especifica vários pontos. Abaixo está **tudo** o que tivemos de
decidir, com o efeito de cada decisão. Onde a escolha muda muito o resultado,
está dito explicitamente.

### 1. Inicialização da população — não especificada no artigo

Escolhemos preencher cada sub-bloco com os dígitos que faltam nele, em ordem
aleatória. É a escolha que torna o resto do artigo coerente: como o cruzamento
nunca corta dentro de um bloco e a mutação só troca valores dentro de um bloco, a
validade das subgrades é um **invariante** — nunca precisa ser checada nem
penalizada, e é exatamente por isso que a aptidão do artigo só olha linhas e
colunas. Uma inicialização totalmente aleatória tornaria a aptidão incapaz de
detectar subgrades inválidas.

### 2. "Linhas e colunas afetadas" na regra de folga — **a ambiguidade que mais pesa**

A regra diz que, após a troca, cada um dos dois dígitos trocados pode aparecer no
máximo 3 vezes "somando as linhas e colunas afetadas". Há duas leituras:

**(a) adotada** — para cada dígito, a linha e a coluna da célula **de destino
dele**. O próprio dígito é contado duas vezes (uma pela linha, uma pela coluna),
então o mínimo possível é 2 e o limite 3 tolera exatamente **uma** repetição
extra. É daí que vem o nome "folga".

**(b) rejeitada** — o conjunto das até 4 linhas/colunas tocadas pela troca,
contando ambos os dígitos em todas elas.

Medimos as duas na grade vazia, 20 execuções, teto de 50.000 gerações:

| leitura | média de gerações | resolvidas |
|---|---|---|
| (a) destino de cada dígito | **545** | 20/20 |
| (b) todas as linhas tocadas | 25.564 | 16/20 |

A leitura (b) é tão restritiva que quase nenhuma troca é aceita e a mutação
praticamente deixa de funcionar. Adotamos (a).

### 3. Nossa média na grade vazia é ~4,8× a do artigo

O artigo relata **~101 gerações** em média para achar uma grade completa a partir
da grade vazia. Nossa implementação faz **488** (30 execuções, todas resolvidas,
mediana 401, mín. 88, máx. 1705).

Está na mesma ordem de grandeza, mas a diferença é real e provavelmente vem de
operadores de mutação que o artigo descreve e esta implementação não tem: além da
troca simples, o artigo menciona mutação de **três trocas** e mutação por
**inserção**. Nossa especificação cobre só a sequência de trocas de pares.

Como referência de quanto isso importa, medimos variantes na grade vazia
(20 execuções): probabilidade de mutação 1,0 em vez de 0,6 derruba a média para
236 gerações; 1 a 3 trocas em vez de 1 a 5 dá 454. Mantivemos 0,6 e 1–5 porque são
os valores do artigo.

### 4. O que acontece quando a regra de folga rejeita uma troca

O artigo não diz se a sequência de trocas para ali ou continua. **Decidimos
continuar** para a próxima troca da sequência (só a pista interrompe a
sequência). Interromper também na rejeição piora um pouco: 780 contra 545
gerações na grade vazia.

### 5. Sorteio das duas posições iguais na mutação

Se as duas posições sorteadas dentro do bloco forem a mesma, a troca é nula.
**Decidimos** registrar como troca nula e seguir para a próxima da sequência, em
vez de re-sortear.

### 6. "O melhor é o mesmo da geração anterior" (envelhecimento)

**Decidimos** comparar o **genoma** inteiro, não a identidade do objeto. Um filho
idêntico ao melhor anterior conta como "o mesmo".

Duas consequências, também não especificadas:
* a penalidade de idade entra na aptidão usada para **ordenar** a população (é o
  que faz o envelhecimento funcionar: o melhor acomodado acaba perdendo o topo);
* a detecção de solução usa a aptidão **crua**, sem a penalidade — senão uma
  solução envelhecida deixaria de ser reconhecida.

O envelhecimento é, de longe, o operador mais importante desta implementação —
veja a tabela de ablação no fim desta seção.

### 7. Contagem das gerações para reiniciar

**Decidimos** contar 2000 gerações **desde o último reinício** (ou desde o
início). Uma leitura alternativa seria 2000 gerações **sem melhora** na melhor
aptidão. O artigo só diz que reinicia quando não encontra solução.

### 8. O que conta como "avaliação de aptidão" (*trial*)

**Decidimos** contar uma avaliação por indivíduo avaliado: 21 na população
inicial, 20 por geração (os filhos; o elite não é reavaliado) e mais 21 a cada
reinício. O limite de 100.000 avaliações do artigo equivale a ~5.000 gerações.

### 9. Substituição

O pseudocódigo escreve o filho na própria posição *i*, andando de POP−1 para
baixo. Como x1 e x2 são sempre menores que *i*, os pais nunca foram sobrescritos
ainda — sortear "da população antiga" ou "da população sendo atualizada" dá no
mesmo. Não há ambiguidade aqui, mas vale registrar. Um efeito colateral: a
posição 1 (a primeira depois do elite) sempre recebe x1 = x2 = 0, ou seja, um
clone mutado do elite.

### 10. Aptidão 0 ⟺ Sudoku válido vale **dentro** da representação

A aptidão só olha linhas e colunas. Uma grade com todas as linhas e colunas
perfeitas mas subgrades erradas teria aptidão 0 sem ser um Sudoku válido — por
exemplo, a grade em que a célula (linha *r*, coluna *c*) vale `((r+c) mod 9)+1`.
Isso **não é um bug**: no espaço que o AG percorre, as subgrades são sempre
permutações de 1..9 por construção, e aí a equivalência vale. Os testes conferem
as duas coisas: a equivalência dentro do espaço do AG e o contraexemplo fora dele.

### 11. Classificação dos puzzles

O artigo classifica pela média de gerações do próprio AG: **fácil < 3500**,
**difícil > 10000**. Acrescentamos um critério que o artigo não precisa ter:
**taxa de resolução abaixo de 90% ⇒ difícil**, porque um puzzle que às vezes não
resolve dentro do teto de gerações não tem média comparável.

Consequência prática: como nossa implementação gasta ~5× mais gerações que a do
artigo, um Sudoku de jornal "fácil" (30–35 pistas) cai na nossa faixa **difícil**.
Os presets "fácil" daqui têm 44 e 46 pistas. A classificação é honesta — é a média
do nosso AG —, mas não é comparável à de um jornal.

### 12. Detalhes menores

* **Semente**: aceita número ou texto (texto vira hash FNV-1a de 32 bits).
  O gerador é `mulberry32`. A mesma semente sempre reproduz a mesma execução —
  há um teste para isso.
* **Probabilidade de mutação 0,6**: aplicada **por filho** (uma tentativa por
  filho), não por gene.
* **Ordenação da população**: `Array.prototype.sort`, que é estável nos
  navegadores atuais, por aptidão efetiva (crua + idade) crescente.
* **Reinício**: reinicializa os 21 indivíduos, inclusive o elite. O artigo não
  diz se o melhor é preservado; optamos por não preservar, que é o sentido de
  "reinicializa a população inteira".

### 13. O que cada operador realmente faz (ablação)

Medido com a implementação final, desligando um operador por vez — é o que os
interruptores da interface fazem ao vivo. 20 execuções por célula; grade vazia
com teto de 50.000 gerações, presets com teto de 30.000.

| | tudo ligado | sem cruzamento | sem envelhecimento | sem regra de folga |
|---|---|---|---|---|
| Grade vazia | **545** (20/20) | 488 (20/20) | 5.374 (20/20) | 2.029 (20/20) |
| Fácil 1 | **1.151** (20/20) | 1.840 (20/20) | 6.313 (20/20) | 1.560 (20/20) |
| Médio 1 | **5.094** (20/20) | 5.172 (20/20) | 18.081 (12/20) | 4.800 (20/20) |
| Difícil 2 | **12.219** (17/20) | 14.867 (17/20) | 24.072 (6/20) | 7.002 (20/20) |

Três coisas que valem ser ditas na apresentação:

* **O envelhecimento é o que sustenta o algoritmo.** Sem ele a média multiplica
  por 2 a 5 e a taxa de sucesso despenca (6/20 no Difícil 2). É o mecanismo que
  tira a população de ótimos locais — sem ele o elite se instala no topo e a
  busca estagna.
* **O cruzamento ajuda pouco, e só quando há pistas.** Na grade vazia ele até
  atrapalha de leve (545 contra 488): sem pistas, todos os blocos são
  intercambiáveis e herdar blocos inteiros não carrega informação útil.
* **A regra de folga ajuda nos puzzles fáceis e atrapalha nos difíceis.** No
  Difícil 2 desligá-la quase dobra o desempenho (7.002 contra 12.219) e leva a
  taxa de sucesso de 17/20 para 20/20. Ela funciona como uma busca local gulosa:
  acelera enquanto há muito conflito para limpar, mas restringe demais o
  movimento justamente quando é preciso escapar de um ótimo local. Este resultado
  é nosso, não do artigo.

---

## Presets

Todos com solução única, verificada pelo backtracking (um teste confere isso).
Números de `results/resumo.csv`: 30 execuções por preset, sementes `i·7919`
(*i* = 1..30), teto de 30.000 gerações.

| Preset | Pistas | Nível medido | Gerações (média) | Mediana | Resolvidas | Reinícios (média) | Backtracking |
|---|---|---|---|---|---|---|---|
| Grade vazia | 0 | — | 502 | 451 | 100% | 0,0 | 0,41 ms |
| Fácil 1 | 44 | fácil | 1.256 | 643 | 100% | 0,3 | 0,07 ms |
| Fácil 2 | 46 | fácil | 1.138 | 580 | 100% | 0,3 | 0,02 ms |
| Médio 1 | 40 | médio | 6.016 | 4.931 | 97% | 2,6 | 0,02 ms |
| Médio 2 | 40 | médio | 6.887 | 4.794 | 97% | 3,0 | 0,04 ms |
| Difícil 1 (clássico) | 30 | difícil | 19.847 | 24.978 | 57% | 9,6 | 0,02 ms |
| Difícil 2 | 38 | difícil | 11.014 | 6.935 | 90% | 5,1 | 0,17 ms |

O nível medido bate com o nível declarado em todos os presets.

A coluna do backtracking é a comparação honesta da apresentação: o método exato
resolve qualquer um deles em **centésimos de milissegundo**, enquanto o AG leva de
dezenas a centenas de milissegundos e às vezes não resolve. O AG aqui é objeto de
estudo, não a melhor ferramenta para o problema.

### Sementes da demonstração ao vivo

| Preset | Semente | Gerações | Tempo |
|---|---|---|---|
| Fácil 1 | **265** | 43 | < 1 s |
| Fácil 2 | **286** | 32 | < 1 s |

Essas sementes já vêm selecionadas quando você escolhe o preset. Como resolvem em
poucas dezenas de gerações, coloque a velocidade em **1 ou 5 gerações por quadro**
para a plateia ver a grade sendo corrigida; nas velocidades altas termina antes de
aparecer.

---

## A interface

* Grade 9×9 grande, com subgrades de borda grossa. Cada tipo de célula tem cor
  própria, para não depender de "ausência de cor" num projetor:
  **cinza e negrito** = pista do puzzle (nunca muda), **azul** = célula
  preenchida pelo AG, **vermelho** = célula numa linha ou coluna com repetição,
  **verde** = resolvido (as pistas ficam num verde mais forte, então dá para ver
  o que era pista mesmo na grade resolvida).
* Painel com geração, avaliações, melhor aptidão, reinícios e tempo decorrido.
* Gráfico da melhor aptidão por geração, em `<canvas>` puro, com uma linha
  vermelha em cada reinício.
* Controles: preset ou string de 81 caracteres colada, semente (com botão de
  sortear), iniciar/pausar, +1 geração, reiniciar, velocidade e limite de
  avaliações.
* **Barra de espaço** inicia e pausa — útil para não caçar o botão no projetor.
* **Passo a passo**: o botão "+1 geração" mostra, para cada um dos 20 filhos,
  quais pais foram sorteados, de qual pai veio cada um dos 9 blocos (A/B) e cada
  troca da mutação (aceita, desfeita pela folga, ou interrompida por pista). O
  filho que virou o novo melhor fica destacado, e as células que ele trocou ficam
  contornadas em laranja na grade.

Se o navegador não permitir Web Worker, a página avisa e roda o mesmo código na
thread principal, em fatias, sem travar a interface.

---

## Testes

`node tests/run-tests.js` — 13 testes, todos passando:

1. **Aptidão** — a aptidão de uma solução conhecida é 0; aptidão 0 ⟺ Sudoku
   válido dentro do espaço do AG (4.000 indivíduos aleatórios sobre os 7 presets);
   e o contraexemplo fora desse espaço (ver decisão 10).
2. **Operadores** — cruzamento e mutação nunca alteram pistas e nunca deixam uma
   subgrade inválida (3 variantes de operadores × 7 presets × 300 iterações);
   o mesmo ao longo de execuções inteiras, conferindo os 21 indivíduos a cada
   geração; e a regra de folga nunca aceita uma troca que passe do limite.
3. **Reprodutibilidade** — a mesma semente dá exatamente a mesma execução
   (gerações, avaliações, reinícios, grade final); sementes diferentes divergem;
   a assinatura geração a geração da população inteira também bate; e o núcleo
   reconstruído por `toString()` (é assim que o Worker é montado) dá o mesmo
   resultado do original.
4. **Presets** — contagem de pistas declarada correta, pistas coerentes, solução
   única; e a semente de demonstração de cada preset fácil resolve em menos de 15 s.
5. **Grade vazia** — 30 execuções, relatando média, mediana, mín./máx. e a razão
   contra as ~101 gerações do artigo. O teste falha se a média passar de 5.000,
   que seria sinal de erro de implementação.
