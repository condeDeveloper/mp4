import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { lerArquivo } from '../src/caixas.js';
import { cadeiaDe, cadeiaDoArquivo, nomeDe, tipoMime } from '../src/codecs.js';
import { lerMidia } from '../src/midia.js';
import { lerStsd } from '../src/trilhas.js';

const AMOSTRA = readFileSync(new URL('./amostras/flor-cabecalho.mp4', import.meta.url));

/** As cadeias que serviços de verdade escrevem nas playlists deles. */
const REAIS = readFileSync(new URL('./amostras/codecs-reais.txt', import.meta.url), 'utf8')
  .split('\n')
  .filter((linha) => linha.trim() && !linha.startsWith('#'))
  .flatMap((linha) => linha.split(',').map((parte) => parte.trim()));

describe('a cadeia do H.264', () => {
  it('monta perfil, compatibilidade e nível em seis dígitos hexadecimais', () => {
    const cadeia = cadeiaDe({
      formato: 'avc1',
      configuracao: { tipo: 'avcC', perfil: 0x64, compatibilidade: 0x00, nivel: 0x1f },
    });

    assert.equal(cadeia, 'avc1.64001f');
  });

  it('preenche com zero à esquerda', () => {
    // Sem o preenchimento sairia `avc1.42d` em vez de `avc1.42000d`, e o
    // navegador recusaria um arquivo que toca sem problema.
    const cadeia = cadeiaDe({
      formato: 'avc1',
      configuracao: { tipo: 'avcC', perfil: 0x42, compatibilidade: 0x00, nivel: 0x0d },
    });

    assert.equal(cadeia, 'avc1.42000d');
  });

  it('usa minúsculas, como a RFC escreve', () => {
    const cadeia = cadeiaDe({
      formato: 'avc1',
      configuracao: { tipo: 'avcC', perfil: 0x4d, compatibilidade: 0x40, nivel: 0x1e },
    });

    assert.equal(cadeia, 'avc1.4d401e');
  });

  it('não inventa parâmetros quando não há avcC', () => {
    assert.equal(cadeiaDe({ formato: 'avc1', configuracao: null }), 'avc1');
  });
});

describe('contra as playlists de verdade', () => {
  it('a amostra produz uma cadeia que a Mux e a Apple também publicam', () => {
    // O teste que vale por todos: o `avc1.64001f` que este leitor monta a
    // partir de três bytes do arquivo é, caractere por caractere, o mesmo que
    // aparece no CODECS= de uma playlist HLS pública.
    const midia = lerMidia(AMOSTRA);

    assert.ok(REAIS.includes(midia.video.codec), `${midia.video.codec} não está nas playlists reais`);
    assert.ok(REAIS.includes(midia.audio.codec), `${midia.audio.codec} não está nas playlists reais`);
    assert.equal(midia.video.codec, 'avc1.64001f');
  });

  it('reconstrói cada cadeia de vídeo real a partir dos bytes que a gerariam', () => {
    // A cadeia é reversível: os seis dígitos são três bytes do avcC. Voltar
    // deles para a cadeia tem de dar exatamente o texto de origem, para todas
    // as oito capturadas.
    const deVideo = REAIS.filter((cadeia) => cadeia.startsWith('avc1.'));

    assert.ok(deVideo.length >= 6, 'há cadeias de vídeo para conferir');

    for (const esperada of deVideo) {
      const digitos = esperada.slice('avc1.'.length);

      const reconstruida = cadeiaDe({
        formato: 'avc1',
        configuracao: {
          tipo: 'avcC',
          perfil: Number.parseInt(digitos.slice(0, 2), 16),
          compatibilidade: Number.parseInt(digitos.slice(2, 4), 16),
          nivel: Number.parseInt(digitos.slice(4, 6), 16),
        },
      });

      assert.equal(reconstruida, esperada);
    }
  });

  it('todas as cadeias reais têm a forma que este leitor produz', () => {
    for (const cadeia of REAIS) {
      assert.match(cadeia, /^(avc1\.[0-9a-f]{6}|mp4a\.40\.\d+)$/, cadeia);
    }
  });
});

describe('a cadeia do AAC', () => {
  it('monta mp4a.40.2 para o AAC-LC', () => {
    assert.equal(cadeiaDe({ formato: 'mp4a', configuracao: { tipo: 'esds', tipoDeObjeto: 0x40 } }), 'mp4a.40.2');
  });

  it('assume AAC quando o esds não foi lido', () => {
    assert.equal(cadeiaDe({ formato: 'mp4a', configuracao: null }), 'mp4a.40.2');
  });

  it('a amostra dá mp4a.40.2, que também está nas playlists reais', () => {
    const descricao = lerStsd(AMOSTRA, lerArquivo(AMOSTRA).filha('moov').todas('trak')[1]);

    assert.equal(cadeiaDe(descricao), 'mp4a.40.2');
    assert.ok(REAIS.includes('mp4a.40.2'));
  });

  it('não sabe distinguir HE-AAC, e as playlists reais provam que ele existe', () => {
    // Limite conhecido, escrito como teste para não virar surpresa: o `.5` de
    // `mp4a.40.5` é o perfil de áudio, e lê-lo exigiria decodificar a
    // configuração específica do AAC dentro do esds. Este leitor sempre diz
    // `.2`. As playlists da Mux mostram que `.5` acontece no mundo real.
    assert.ok(REAIS.includes('mp4a.40.5'));
    assert.equal(cadeiaDe({ formato: 'mp4a', configuracao: { tipo: 'esds', tipoDeObjeto: 0x40 } }), 'mp4a.40.2');
  });
});

describe('a cadeia do arquivo', () => {
  it('põe o vídeo antes do áudio', () => {
    const cadeia = cadeiaDoArquivo([
      { tipo: 'soun', descricao: { formato: 'mp4a', configuracao: null } },
      { tipo: 'vide', descricao: { formato: 'avc1', configuracao: { tipo: 'avcC', perfil: 0x64, compatibilidade: 0, nivel: 0x28 } } },
    ]);

    assert.equal(cadeia, 'avc1.640028,mp4a.40.2');
  });

  it('ignora trilhas sem codec reconhecível', () => {
    const cadeia = cadeiaDoArquivo([
      { tipo: 'vide', descricao: null },
      { tipo: 'soun', descricao: { formato: 'mp4a', configuracao: null } },
    ]);

    assert.equal(cadeia, 'mp4a.40.2');
  });

  it('monta o tipo MIME pronto para o isTypeSupported', () => {
    const midia = lerMidia(AMOSTRA);

    assert.equal(midia.tipoMime, 'video/mp4; codecs="avc1.64001f,mp4a.40.2"');
  });

  it('não escreve codecs="" quando não há codec nenhum', () => {
    assert.equal(tipoMime([]), 'video/mp4');
  });
});

describe('o nome legível', () => {
  it('traduz o perfil e o nível do H.264', () => {
    const nome = nomeDe({
      formato: 'avc1',
      configuracao: { tipo: 'avcC', perfil: 0x64, compatibilidade: 0, nivel: 0x1f },
    });

    assert.equal(nome, 'H.264 High nível 3.1');
  });

  it('devolve a marca de quatro letras quando não conhece o formato', () => {
    assert.equal(nomeDe({ formato: 'zzzz' }), 'zzzz');
  });

  it('não estoura sem descrição nenhuma', () => {
    assert.equal(nomeDe(null), 'desconhecido');
  });
});
