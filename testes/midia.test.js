import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { ErroDeMp4 } from '../src/caixas.js';
import { lerFtyp, lerMidia, preparadoParaFluxo, relogio, resumir } from '../src/midia.js';
import { lerArquivo } from '../src/caixas.js';

import { arquivo, avc1, avcC, caixa, mdhd, mvhd, tkhd, trak } from './construir.js';

const AMOSTRA = readFileSync(new URL('./amostras/flor-cabecalho.mp4', import.meta.url));

describe('o resumo do arquivo de verdade', () => {
  const midia = lerMidia(AMOSTRA);

  it('identifica a marca e as compatíveis', () => {
    assert.equal(midia.marca, 'mp42');
    assert.deepEqual(midia.compativeis, ['mp42', 'mp41', 'isom', 'avc1']);
  });

  it('acha as duas trilhas e as separa por tipo', () => {
    assert.equal(midia.trilhas.length, 2);
    assert.equal(midia.video.tipo, 'vide');
    assert.equal(midia.audio.tipo, 'soun');
  });

  it('dá a duração em segundos e em relógio', () => {
    assert.ok(Math.abs(midia.duracaoEmSegundos - 5.055) < 0.001);
    assert.equal(relogio(midia.duracaoEmSegundos), '0:05');
  });

  it('dá a resolução codificada do vídeo', () => {
    assert.deepEqual(midia.video.resolucao.codificada, { largura: 960, altura: 540 });
  });

  it('não marca como fragmentado um arquivo comum', () => {
    assert.equal(midia.fragmentado, false);
  });

  it('não marca como truncado o que coube inteiro', () => {
    assert.equal(midia.truncado, false);
  });

  it('não põe resolução em trilha de áudio', () => {
    assert.equal(midia.audio.resolucao, null);
  });
});

describe('a leitura parcial', () => {
  it('lê o que der e avisa que é parcial', () => {
    // 800 bytes pegam o ftyp, o mvhd e a primeira trilha; a segunda fica de
    // fora. O resultado é útil — e diz que está incompleto.
    const midia = lerMidia(AMOSTRA.subarray(0, 800));

    assert.equal(midia.truncado, true);
    assert.equal(midia.trilhas.length, 1);
    assert.equal(midia.codecs, 'avc1.64001f');
    assert.match(resumir(midia), /resumo parcial/);
  });

  it('explica o que fazer quando o moov ficou para trás', () => {
    // Num arquivo não preparado para fluxo o moov está no fim. Dizer "leia o
    // arquivo inteiro" resolve; dizer "formato inválido" manda procurar um bug
    // que não existe.
    const so_ftyp = AMOSTRA.subarray(0, 32);

    assert.throws(() => lerMidia(so_ftyp), /leia o arquivo inteiro/);
  });
});

describe('preparado para fluxo', () => {
  it('reconhece o moov na frente do mdat', () => {
    const bytes = arquivo({
      filhasDoMoov: [mvhd({ escala: 1000, duracao: 1000 })],
      comMdat: true,
    });

    assert.equal(preparadoParaFluxo(lerArquivo(bytes)), true);
  });

  it('vê que o moov ficou atrás do mdat', () => {
    // O arquivo como sai da câmera: para saber a duração é preciso baixar
    // tudo. É o que o `-movflags +faststart` conserta.
    const ftyp = arquivo({ filhasDoMoov: [mvhd({ escala: 1000, duracao: 1000 })], comMdat: false })
      .subarray(0, 24);

    const bytes = Buffer.concat([
      ftyp,
      caixa('mdat', Buffer.alloc(64)),
      caixa('moov', mvhd({ escala: 1000, duracao: 1000 })),
    ]);

    assert.equal(preparadoParaFluxo(lerArquivo(bytes)), false);
  });

  it('sem mdat nenhum, o que há é metadado — e ele está na frente', () => {
    const bytes = arquivo({
      filhasDoMoov: [mvhd({ escala: 1000, duracao: 1000 })],
      comMdat: false,
    });

    assert.equal(preparadoParaFluxo(lerArquivo(bytes)), true);
  });
});

describe('o fragmentado', () => {
  it('reconhece o mvex de um arquivo fragmentado', () => {
    // O segmento de inicialização de HLS e DASH: o moov descreve as trilhas e
    // a duração dele é zero, porque os dados vêm depois, em fragmentos.
    const bytes = arquivo({
      marca: 'iso5',
      compativeis: ['iso5', 'cmfc'],
      comMdat: false,
      filhasDoMoov: [
        mvhd({ escala: 1000, duracao: 0 }),
        trak({
          cabecalho: tkhd({ id: 1, largura: 1280, altura: 720 }),
          midia: mdhd({ escala: 90000, duracao: 0 }),
          tipo: 'vide',
          descricao: avc1({ largura: 1280, altura: 720, configuracao: avcC(0x64, 0x00, 0x1f) }),
        }),
        caixa('mvex', caixa('trex', Buffer.alloc(24))),
      ],
    });

    const midia = lerMidia(bytes);

    assert.equal(midia.fragmentado, true);
    assert.equal(midia.duracaoEmSegundos, 0, 'a duração zero é esperada, não um erro');
    assert.equal(midia.codecs, 'avc1.64001f');
    assert.match(resumir(midia), /fragmentado: sim/);
  });
});

describe('o ftyp', () => {
  it('lê marca e compatíveis', () => {
    const ftyp = lerFtyp(AMOSTRA, lerArquivo(AMOSTRA));

    assert.equal(ftyp.marca, 'mp42');
    assert.ok(ftyp.compativeis.includes('isom'));
  });

  it('devolve null quando não há ftyp', () => {
    // Um `.mov` antigo pode não ter ftyp nenhum, e isso não impede de ler.
    const bytes = Buffer.concat([caixa('moov', mvhd({ escala: 1000, duracao: 1000 }))]);

    assert.equal(lerFtyp(bytes, lerArquivo(bytes)), null);
    assert.equal(lerMidia(bytes).marca, null);
  });
});

describe('o relógio', () => {
  it('escreve minutos e segundos', () => {
    assert.equal(relogio(247), '4:07');
  });

  it('escreve horas quando passa de uma', () => {
    assert.equal(relogio(3903), '1:05:03');
  });

  it('não escreve NaN nem número negativo', () => {
    assert.equal(relogio(Number.NaN), '0:00');
    assert.equal(relogio(-5), '0:00');
  });
});

describe('o resumo em texto', () => {
  const texto = resumir(lerMidia(AMOSTRA));

  it('traz formato, duração, codecs e as trilhas', () => {
    assert.match(texto, /formato: {2}mp42/);
    assert.match(texto, /duração: {2}0:05/);
    assert.match(texto, /codecs: {3}avc1\.64001f,mp4a\.40\.2/);
    assert.match(texto, /#1 vide {2}H\.264 High nível 3\.1 {2}960×540/);
    assert.match(texto, /#2 soun {2}AAC {2}2 canal\(is\) {2}48000 Hz/);
  });

  it('não fala em resumo parcial quando não é', () => {
    assert.doesNotMatch(texto, /parcial/);
  });
});

describe('os erros', () => {
  it('são do tipo certo, para dar para tratar', () => {
    assert.throws(() => lerMidia(Buffer.alloc(4)), ErroDeMp4);
  });
});
