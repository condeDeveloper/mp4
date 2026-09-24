import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  CABECALHO,
  desenhar,
  ErroDeMp4,
  lerArquivo,
  lerCabecalho,
  lerCaixas,
  lerVersaoEBandeiras,
} from '../src/caixas.js';

import { caixa, caixaAteOFim, caixaComVersao, caixaGrande, caixaUuid, u32 } from './construir.js';

const AMOSTRA = readFileSync(new URL('./amostras/flor-cabecalho.mp4', import.meta.url));

describe('o cabeçalho de uma caixa', () => {
  it('lê tamanho e tipo dos oito primeiros bytes', () => {
    const bytes = caixa('free', Buffer.alloc(4));
    const cabecalho = lerCabecalho(bytes, 0);

    assert.equal(cabecalho.tipo, 'free');
    assert.equal(cabecalho.tamanho, 12);
    assert.equal(cabecalho.inicioDosDados, CABECALHO);
  });

  it('lê o tamanho de 64 bits quando o de 32 vale 1', () => {
    // É assim que um arquivo passa de 4 GB. Sem tratar, o leitor entenderia
    // "caixa de 1 byte" e a leitura seguinte cairia dentro do próprio tamanho.
    const bytes = caixaGrande('mdat', Buffer.alloc(8));
    const cabecalho = lerCabecalho(bytes, 0);

    assert.equal(cabecalho.tamanho, 24);
    assert.equal(cabecalho.inicioDosDados, 16, 'os dados começam depois dos 8 bytes extras');
  });

  it('entende tamanho zero como "até o fim do arquivo"', () => {
    const bytes = caixaAteOFim('mdat', Buffer.alloc(40));
    const cabecalho = lerCabecalho(bytes, 0);

    assert.equal(cabecalho.tamanho, bytes.length);
  });

  it('pula os 16 bytes do identificador numa caixa uuid', () => {
    const identificador = 'd08a4f1810f34a82b6c832d8aba183d3';
    const bytes = caixaUuid(identificador, Buffer.from('conteúdo'));
    const cabecalho = lerCabecalho(bytes, 0);

    assert.equal(cabecalho.uuid, identificador);
    assert.equal(cabecalho.inicioDosDados, 24);
  });

  it('recusa uma caixa que declara menos bytes que o próprio cabeçalho', () => {
    // Um tamanho de 4 num cabeçalho de 8 faria a leitura andar para trás e
    // repetir a mesma caixa para sempre.
    const bytes = Buffer.concat([u32(4), Buffer.from('free', 'latin1')]);

    assert.throws(() => lerCabecalho(bytes, 0), ErroDeMp4);
  });

  it('recusa um cabeçalho cortado', () => {
    assert.throws(() => lerCabecalho(Buffer.alloc(4), 0), ErroDeMp4);
  });
});

describe('a árvore', () => {
  it('desce apenas nas caixas que são recipientes', () => {
    // O `mdat` tem dados de vídeo, que por acaso podem parecer cabeçalhos.
    // Entrar nele é o erro que manda a leitura para qualquer lugar.
    const bytes = Buffer.concat([
      caixa('mdat', Buffer.from('0000000cfree', 'latin1')),
      caixa('free'),
    ]);

    const caixas = lerCaixas(bytes);

    assert.deepEqual(caixas.map((c) => c.tipo), ['mdat', 'free']);
    assert.deepEqual(caixas[0].filhas, [], 'o mdat não é recipiente');
  });

  it('encontra uma caixa por caminho', () => {
    const raiz = lerArquivo(AMOSTRA);

    assert.ok(raiz.caminho('moov/trak/mdia/minf/stbl/stsd'));
  });

  it('devolve null em vez de estourar quando o caminho não existe', () => {
    const raiz = lerArquivo(AMOSTRA);

    assert.equal(raiz.caminho('moov/trak/mdia/nao-existe/stsd'), null);
  });

  it('percorre todas as caixas, em qualquer profundidade', () => {
    const raiz = lerArquivo(AMOSTRA);
    const tipos = [...raiz.percorrer()].map((c) => c.tipo);

    assert.ok(tipos.includes('avc1'), 'chega até a entrada de amostra');
    assert.ok(tipos.length > 40);
  });

  it('marca como truncada a caixa que não coube nos bytes lidos', () => {
    // Ler só o começo de um arquivo é legítimo; o que não pode é o resultado
    // parcial passar por completo.
    const inteiro = lerArquivo(AMOSTRA);
    const pedaco = lerArquivo(AMOSTRA.subarray(0, 800));

    assert.equal(inteiro.filha('moov').truncada, false);
    assert.equal(pedaco.filha('moov').truncada, true);
  });

  it('recusa aninhamento absurdo em vez de estourar a pilha', () => {
    let bytes = caixa('free');

    for (let i = 0; i < 40; i += 1) bytes = caixa('moov', bytes);

    assert.throws(() => lerCaixas(bytes), /fundo demais/);
  });

  it('recusa um arquivo curto demais', () => {
    assert.throws(() => lerArquivo(Buffer.alloc(4)), ErroDeMp4);
  });

  it('recusa qualquer coisa que não seja um Buffer', () => {
    assert.throws(() => lerArquivo('um caminho'), TypeError);
  });
});

describe('versão e bandeiras', () => {
  it('lê os quatro bytes iniciais de uma FullBox', () => {
    const bytes = caixaComVersao('tkhd', 1, 0x000003, Buffer.alloc(8));
    const [tkhd] = lerCaixas(bytes);
    const { versao, bandeiras, apos } = lerVersaoEBandeiras(bytes, tkhd);

    assert.equal(versao, 1);
    assert.equal(bandeiras, 3);
    assert.equal(apos, tkhd.inicioDosDados + 4);
  });

  it('recusa ler versão numa caixa que não tem', () => {
    // Melhor um erro claro do que quatro bytes de deslocamento silencioso em
    // todos os campos seguintes.
    const bytes = caixa('moov');
    const [moov] = lerCaixas(bytes);

    assert.throws(() => lerVersaoEBandeiras(bytes, moov), /não tem versão/);
  });
});

describe('o desenho da árvore', () => {
  it('mostra tipo, tamanho e recuo', () => {
    const texto = desenhar(lerArquivo(AMOSTRA));

    assert.match(texto, /^ftyp {2}32 bytes$/m);
    assert.match(texto, /^ {4}tkhd {2}92 bytes$/m);
  });

  it('assinala as caixas truncadas', () => {
    const texto = desenhar(lerArquivo(AMOSTRA.subarray(0, 800)));

    assert.match(texto, /moov {2}4238 bytes \(truncada\)/);
  });
});
