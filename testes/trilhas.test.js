import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { lerArquivo } from '../src/caixas.js';
import {
  comoData,
  lerHdlr,
  lerMdhd,
  lerMvhd,
  lerStsd,
  lerTkhd,
  pontoFixo1616,
  resolucao,
  SEGUNDOS_ATE_1970,
} from '../src/trilhas.js';

import { arquivo, avc1, avcC, caixa, fixo1616, mdhd, mvhd, tkhd, trak } from './construir.js';

const AMOSTRA = readFileSync(new URL('./amostras/flor-cabecalho.mp4', import.meta.url));
const MOOV = lerArquivo(AMOSTRA).filha('moov');
const [VIDEO, AUDIO] = MOOV.todas('trak');

describe('o cabeçalho do filme', () => {
  it('lê escala e duração do arquivo de verdade', () => {
    const filme = lerMvhd(AMOSTRA, MOOV);

    // 600, e não 1000: é a herança do QuickTime, divisível por 24, 25 e 30.
    // Quem supõe milissegundos aqui já erra no primeiro arquivo que abre.
    assert.equal(filme.escala, 600);
    assert.ok(Math.abs(filme.duracaoEmSegundos - 5.055) < 0.001);
  });

  it('lê duração de 64 bits quando a versão é 1', () => {
    const bytes = arquivo({ filhasDoMoov: [mvhd({ escala: 1000, duracao: 90000, versao: 1 })] });
    const filme = lerMvhd(bytes, lerArquivo(bytes).filha('moov'));

    assert.equal(filme.versao, 1);
    assert.equal(filme.duracaoEmSegundos, 90);
  });

  it('não divide por zero quando a escala é zero', () => {
    const bytes = arquivo({ filhasDoMoov: [mvhd({ escala: 0, duracao: 1000 })] });
    const filme = lerMvhd(bytes, lerArquivo(bytes).filha('moov'));

    assert.equal(filme.duracaoEmSegundos, 0);
  });

  it('reclama de um moov sem mvhd', () => {
    const bytes = arquivo({ filhasDoMoov: [caixa('udta')] });

    assert.throws(() => lerMvhd(bytes, lerArquivo(bytes).filha('moov')), /não tem mvhd/);
  });
});

describe('as duas escalas de tempo', () => {
  it('usa a escala da trilha, não a do filme', () => {
    // O bug clássico do formato. Aqui o filme conta em milissegundos e a
    // trilha em 90000; dividir 450000 pela escala errada daria 450 segundos
    // em vez de 5 — noventa vezes mais.
    const bytes = arquivo({
      filhasDoMoov: [
        mvhd({ escala: 1000, duracao: 5000 }),
        trak({
          cabecalho: tkhd({ id: 1, largura: 1920, altura: 1080 }),
          midia: mdhd({ escala: 90000, duracao: 450000 }),
          tipo: 'vide',
          descricao: avc1({ largura: 1920, altura: 1080, configuracao: avcC(0x64, 0x00, 0x28) }),
        }),
      ],
    });

    const raiz = lerArquivo(bytes);
    const [trilha] = raiz.filha('moov').todas('trak');
    const filme = lerMvhd(bytes, raiz.filha('moov'));
    const midia = lerMdhd(bytes, trilha);

    assert.equal(midia.escala, 90000);
    assert.equal(midia.duracaoEmSegundos, 5);
    assert.equal(filme.escala, 1000);
    assert.notEqual(midia.escala, filme.escala, 'as duas escalas são mesmo diferentes');
  });

  it('o arquivo de verdade tem três escalas diferentes ao mesmo tempo', () => {
    // Este arquivo sozinho desmonta a suposição: o filme conta em 600, o vídeo
    // em 30000 (por causa dos 29,97 quadros) e o áudio em 48000. Três relógios,
    // um arquivo, e nenhum deles é milissegundo.
    const filme = lerMvhd(AMOSTRA, MOOV);
    const video = lerMdhd(AMOSTRA, VIDEO);
    const audio = lerMdhd(AMOSTRA, AUDIO);

    assert.deepEqual([filme.escala, video.escala, audio.escala], [600, 30000, 48000]);

    // Escalas diferentes, durações iguais — é o mesmo vídeo. Ler o vídeo com a
    // escala do filme daria 250 segundos em vez de 5.
    assert.ok(Math.abs(video.duracaoEmSegundos - audio.duracaoEmSegundos) < 0.1);
    assert.ok(Math.abs(video.duracao / filme.escala - 250) < 1, 'a conta errada, para registro');
  });

  it('decodifica o idioma empacotado em cinco bits por letra', () => {
    const bytes = arquivo({
      filhasDoMoov: [
        mvhd({ escala: 1000, duracao: 1000 }),
        trak({
          cabecalho: tkhd({ id: 1, largura: 16, altura: 16 }),
          midia: mdhd({ escala: 1000, duracao: 1000, idioma: 'por' }),
          tipo: 'soun',
          descricao: caixa('mp4a', Buffer.alloc(36)),
        }),
      ],
    });

    const [trilha] = lerArquivo(bytes).filha('moov').todas('trak');

    assert.equal(lerMdhd(bytes, trilha).idioma, 'por');
  });
});

describe('o cabeçalho da trilha', () => {
  it('lê id e bandeira de habilitada', () => {
    const cabecalho = lerTkhd(AMOSTRA, VIDEO);

    assert.equal(cabecalho.id, 1);
    assert.equal(cabecalho.habilitada, true);
  });

  it('vê uma trilha desabilitada', () => {
    const bytes = arquivo({
      filhasDoMoov: [
        mvhd({ escala: 1000, duracao: 1000 }),
        trak({
          cabecalho: tkhd({ id: 3, largura: 640, altura: 360, habilitada: false }),
          midia: mdhd({ escala: 1000, duracao: 1000 }),
          tipo: 'vide',
          descricao: avc1({ largura: 640, altura: 360, configuracao: avcC(0x42, 0x00, 0x1e) }),
        }),
      ],
    });

    const [trilha] = lerArquivo(bytes).filha('moov').todas('trak');

    assert.equal(lerTkhd(bytes, trilha).habilitada, false);
  });

  it('lê as dimensões em ponto fixo 16.16', () => {
    assert.equal(pontoFixo1616(fixo1616(853.5), 0), 853.5);
  });
});

describe('o tipo de mídia', () => {
  it('separa vídeo de áudio', () => {
    assert.equal(lerHdlr(AMOSTRA, VIDEO).tipo, 'vide');
    assert.equal(lerHdlr(AMOSTRA, VIDEO).ehVideo, true);
    assert.equal(lerHdlr(AMOSTRA, AUDIO).tipo, 'soun');
    assert.equal(lerHdlr(AMOSTRA, AUDIO).ehAudio, true);
  });

  it('corta o nome no primeiro byte zero', () => {
    const bytes = arquivo({
      filhasDoMoov: [
        mvhd({ escala: 1000, duracao: 1000 }),
        trak({
          cabecalho: tkhd({ id: 1, largura: 16, altura: 16 }),
          midia: mdhd({ escala: 1000, duracao: 1000 }),
          tipo: 'vide',
          nome: 'VideoHandler',
          descricao: avc1({ largura: 16, altura: 16, configuracao: avcC(0x42, 0, 0x1e) }),
        }),
      ],
    });

    const [trilha] = lerArquivo(bytes).filha('moov').todas('trak');

    assert.equal(lerHdlr(bytes, trilha).nome, 'VideoHandler');
  });
});

describe('a descrição da amostra', () => {
  it('lê o formato, a resolução codificada e o avcC do arquivo de verdade', () => {
    const descricao = lerStsd(AMOSTRA, VIDEO);

    assert.equal(descricao.formato, 'avc1');
    assert.equal(descricao.largura, 960);
    assert.equal(descricao.altura, 540);
    assert.equal(descricao.configuracao.tipo, 'avcC');
    assert.equal(descricao.configuracao.perfil, 0x64, 'perfil High');
    assert.equal(descricao.configuracao.nivel, 0x1f, 'nível 3.1');
  });

  it('lê canais e taxa de amostragem do áudio', () => {
    const descricao = lerStsd(AMOSTRA, AUDIO);

    assert.equal(descricao.formato, 'mp4a');
    assert.equal(descricao.canais, 2);
    assert.equal(descricao.taxaDeAmostragem, 48000);
    assert.equal(descricao.configuracao.tipoDeObjeto, 0x40, 'AAC');
  });
});

describe('a resolução', () => {
  it('distingue o que está codificado do que se exibe', () => {
    // Vídeo anamórfico: 720×480 nos quadros, exibido como 854×480. Quem
    // pergunta "que resolução é esse vídeo" quer o primeiro; quem vai desenhar
    // na tela quer o segundo.
    const medida = resolucao(
      { largura: 853.5, altura: 480 },
      { largura: 720, altura: 480 },
    );

    assert.deepEqual(medida.codificada, { largura: 720, altura: 480 });
    assert.deepEqual(medida.exibicao, { largura: 854, altura: 480 });
    assert.equal(medida.anamorfica, true);
  });

  it('não chama de anamórfico o que só difere por arredondamento', () => {
    const medida = resolucao({ largura: 960.4, altura: 540 }, { largura: 960, altura: 540 });

    assert.equal(medida.anamorfica, false);
  });

  it('no arquivo de verdade as duas medidas coincidem', () => {
    const medida = resolucao(lerTkhd(AMOSTRA, VIDEO), lerStsd(AMOSTRA, VIDEO));

    assert.deepEqual(medida.codificada, { largura: 960, altura: 540 });
    assert.equal(medida.anamorfica, false);
  });
});

describe('os instantes', () => {
  it('converte de 1904 para 1970', () => {
    assert.equal(comoData(SEGUNDOS_ATE_1970).getTime(), 0);
  });

  it('trata zero como "não informado"', () => {
    assert.equal(comoData(0), null);
  });
});
