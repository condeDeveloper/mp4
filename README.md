# mp4

Um leitor de metadados de MP4 escrito do zero, sem dependência nenhuma: a
árvore de caixas, a duração, a resolução e a cadeia de codec da RFC 6381.

É a metade de um transcodificador que não transcodifica nada — a parte que um
catálogo de streaming realmente precisa: *quanto dura, em que resolução, com
que codecs, e o navegador consegue tocar isso?*

## O que ele faz

```
$ node src/cli.js resumo testes/amostras/flor-cabecalho.mp4
formato:  mp42 (mp42, mp41, isom, avc1)
duração:  0:05  (5.055 s)
codecs:   avc1.64001f,mp4a.40.2
mime:     video/mp4; codecs="avc1.64001f,mp4a.40.2"
fluxo:    preparado (moov antes do mdat)

trilhas:  2
  #1 vide  H.264 High nível 3.1  960×540  0:05  und
  #2 soun  AAC  2 canal(is)  48000 Hz  0:05  und
```

```
$ node src/cli.js arvore testes/amostras/flor-cabecalho.mp4
ftyp  32 bytes
moov  4238 bytes
  mvhd  108 bytes
  iods  42 bytes
  trak  2591 bytes
    tkhd  92 bytes
    edts  36 bytes
      elst  28 bytes
    mdia  2455 bytes
      mdhd  32 bytes
      hdlr  54 bytes
      minf  2361 bytes
        vmhd  20 bytes
        dinf  36 bytes
          dref  28 bytes
        stbl  2297 bytes
          stsd  195 bytes
            avc1  179 bytes
          stts  24 bytes
          ...
```

```
$ node src/cli.js codec testes/amostras/flor-cabecalho.mp4
avc1.64001f,mp4a.40.2
```

## O formato inteiro numa frase

Um MP4 é uma árvore de caixas. Cada caixa tem oito bytes de cabeçalho — quatro
de tamanho, quatro de tipo em ASCII — e depois o conteúdo, que para algumas
caixas são outras caixas. É só isso.

É por isso que dá para escrever um leitor de MP4 numa tarde, e por isso que
`.mp4`, `.m4a`, `.mov` e os segmentos de HLS fragmentado são todos o mesmo
formato por dentro.

## O teste que vale por todos

A cadeia `avc1.64001f` que este leitor monta a partir de **três bytes** do
arquivo é, caractere por caractere, a mesma que a Mux e a Apple escrevem à mão
no `CODECS=` das playlists HLS públicas de teste.

Essas cadeias estão em `testes/amostras/codecs-reais.txt`, capturadas das
playlists de verdade, e o teste faz o caminho de volta: para cada uma das oito,
reconstrói os três bytes que a gerariam e confere que o leitor produz o texto
idêntico.

Não é um valor que eu inventei e conferi comigo mesmo. É o que dois serviços de
streaming publicam.

## As armadilhas do formato, e o que este leitor faz com elas

### 1. Existem três escalas de tempo, e nenhuma é milissegundo

O arquivo de amostra sozinho desmonta a suposição: o filme conta em **600**, o
vídeo em **30000** (por causa dos 29,97 quadros por segundo) e o áudio em
**48000**.

Dividir a duração do vídeo pela escala do filme dá **250 segundos** para um
vídeo de 5. É o bug clássico do formato, e um teste guarda a conta errada para
registro.

A duração de uma trilha vem do `mdhd` **dela**, nunca do `mvhd`.

### 2. A resolução aparece em dois lugares, e eles discordam de propósito

- O `tkhd` traz as dimensões de **exibição**, em ponto fixo 16.16, já com a
  proporção corrigida.
- O `stsd` traz as dimensões **codificadas**, em inteiros — o que está mesmo
  nos quadros.

Em vídeo anamórfico, 720×480 codificados podem ser exibidos como 854×480. Quem
pergunta "que resolução é esse vídeo" quer a primeira; quem vai desenhar na tela
quer a segunda. `resolucao()` devolve as duas e diz quando elas divergem.

### 3. Entrar numa caixa que não é recipiente destrói a leitura

Não há como descobrir pelo arquivo se uma caixa contém outras: é uma
propriedade do tipo, e está na especificação. Entrar num `mdat` faz o leitor
interpretar dados de vídeo como cabeçalhos — e os "tamanhos" que saem daí
mandam a leitura para qualquer endereço.

Daí a lista explícita de recipientes, e um teste que põe bytes parecidos com um
cabeçalho dentro de um `mdat` para conferir que o leitor não morde a isca.

### 4. Três formas de escrever um tamanho

- `tamanho == 1`: o tamanho de verdade vem depois do tipo, em 8 bytes. É como
  um arquivo passa de 4 GB.
- `tamanho == 0`: até o fim do arquivo.
- `tipo == "uuid"`: os 16 bytes seguintes são identificador, não conteúdo.

Nenhum dos três aparece no arquivo de amostra, e provocar o primeiro exigiria
um arquivo de gigabytes. Por isso `testes/construir.js` monta as caixas byte a
byte — como o formato é só cabeçalho e conteúdo, escrever é tão simples quanto
ler.

### 5. Um tamanho menor que o próprio cabeçalho trava o leitor

Uma caixa que declara 4 bytes num cabeçalho de 8 faz a leitura andar para trás
e reencontrar a mesma caixa para sempre. O leitor recusa, em vez de girar.

### 6. Ler só o começo é legítimo — mentir sobre isso não é

Num arquivo preparado para fluxo o `moov` vem antes do `mdat`, e 4 KB bastam
para saber tudo. Mas se os bytes acabam no meio de uma caixa, o resultado é
parcial:

```
$ node src/cli.js resumo --bytes=800 testes/amostras/flor-cabecalho.mp4
formato:  mp42 (mp42, mp41, isom, avc1)
duração:  0:05  (5.055 s)
codecs:   avc1.64001f
mime:     video/mp4; codecs="avc1.64001f"
fluxo:    preparado (moov antes do mdat)
aviso:    os bytes acabaram no meio de uma caixa — isto é um resumo parcial

trilhas:  1
  #1 vide  H.264 High nível 3.1  960×540  0:05  und
```

A primeira versão dizia **"trilhas: 1"** sem o aviso. Um resumo que esconde uma
trilha inteira é pior do que um erro, porque quem lê não tem como desconfiar.

E quando o `moov` não aparece nos bytes lidos, o erro diz o que fazer — "leia o
arquivo inteiro" — em vez de "formato inválido", que manda procurar um bug que
não existe.

## O arquivo de amostra

`testes/amostras/flor-cabecalho.mp4` tem **4270 bytes**: são os primeiros 4270
bytes do `flower.mp4` que a Mozilla publica em domínio público (CC0) para
exemplos de MDN — exatamente o `ftyp` (32 bytes) e o `moov` (4238), e **nem um
quadro de vídeo**. O `mdat` do original vem logo em seguida e ficou de fora.

É metadado puro: 4 KB em vez de 1,1 MB, e nada de conteúdo audiovisual no
repositório.

## Instalando e rodando

Não há o que instalar — nenhuma dependência, nenhuma etapa de build.

```bash
node src/cli.js resumo <arquivo.mp4>
node src/cli.js arvore <arquivo.mp4>
node src/cli.js codec  <arquivo.mp4>
node src/cli.js json   <arquivo.mp4>

node src/cli.js resumo --bytes=65536 <arquivo.mp4>   # só o começo
```

Como biblioteca:

```js
import { lerMidia } from './src/index.js';
import { readFileSync } from 'node:fs';

const midia = lerMidia(readFileSync('filme.mp4'));

midia.duracaoEmSegundos;               // 5.055
midia.video.resolucao.codificada;      // { largura: 960, altura: 540 }
midia.tipoMime;                        // video/mp4; codecs="avc1.64001f,mp4a.40.2"

// E a árvore crua, para quem quiser descer:
midia.raiz.caminho('moov/trak/mdia/mdhd');
```

## Testes

```bash
npm test
```

90 testes: os três tamanhos de cabeçalho, o `uuid`, o recipiente que não é
recipiente, o aninhamento absurdo, as três escalas de tempo do arquivo real, o
anamórfico, a reconstrução das oito cadeias reais, a leitura parcial, o
fragmentado e a linha de comando inteira rodando como processo.

## Estrutura

```
src/caixas.js     a árvore: cabeçalho, recipientes, percurso
src/trilhas.js    mvhd, tkhd, mdhd, hdlr, stsd — e as duas armadilhas
src/codecs.js     a cadeia da RFC 6381
src/midia.js      o resumo que um catálogo consome
src/cli.js        a linha de comando
testes/construir.js          monta caixas byte a byte, para os casos raros
testes/amostras/             o cabeçalho de 4 KB e as cadeias reais capturadas
```

## Onde ele se encaixa

Faz parte do **CondePlay**, um serviço de streaming montado em peças separadas:

| | |
|---|---|
| [`catalogo`](https://github.com/condeDeveloper/catalogo) | a API do catálogo, em C# e .NET 8 |
| [`player-hls`](https://github.com/condeDeveloper/player-hls) | o player HLS, do zero |
| [`conde-play`](https://github.com/condeDeveloper/conde-play) | a tela |
| **`mp4`** | os metadados da mídia |

As cadeias que este leitor monta são exatamente as que o `player-hls` lê das
playlists — e é assim que as duas metades se conferem.

## Limites conhecidos

- **Não distingue HE-AAC.** A cadeia sai sempre `mp4a.40.2`; ler o `.5` exigiria
  decodificar a configuração específica do AAC dentro do `esds`. As playlists
  reais capturadas mostram `mp4a.40.5` acontecendo, e um teste guarda o limite
  para ele não virar surpresa.
- **Não lê as tabelas de amostra.** `stts`, `stsc`, `stsz` e `stco` são
  reconhecidas na árvore mas não interpretadas, então não há como extrair um
  quadro nem calcular taxa de bits real.
- **Não escreve.** Só lê. Nada de `+faststart`, nada de remux.
- **AV1 e VP9 só pelo nome.** Aparecem no `stsd` e ganham nome legível, mas a
  cadeia completa deles tem campos que este leitor não lê.
- **Sem legendas.** Trilhas `text`/`sbtl` são reconhecidas e listadas, e nada
  além disso.

## Licença

MIT.
