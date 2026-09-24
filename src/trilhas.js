/**
 * As trilhas e o que elas dizem sobre a mídia.
 *
 * Aqui mora a armadilha que mais faz gente errar duração de vídeo: **existem
 * duas escalas de tempo, e elas não são a mesma**.
 *
 * - O `mvhd` traz a escala do filme, que costuma ser 600 ou 1000.
 * - Cada `mdhd` traz a escala **daquela trilha**, que costuma ser 90000 no
 *   vídeo e 44100 ou 48000 no áudio.
 *
 * Dividir a duração da trilha pela escala do filme dá um número que parece
 * plausível e está 90 vezes errado. É o bug clássico do formato.
 *
 * A segunda armadilha é a resolução: ela aparece em dois lugares e eles
 * discordam de propósito. Ver `resolucao` mais abaixo.
 */

import { ErroDeMp4, lerVersaoEBandeiras } from './caixas.js';

/** A época do MP4 é 1904, não 1970 — 66 anos de diferença. */
export const SEGUNDOS_ATE_1970 = 2_082_844_800;

/** Converte um instante do MP4 para `Date`. */
export function comoData(segundosDesde1904) {
  if (!segundosDesde1904) return null;

  return new Date((segundosDesde1904 - SEGUNDOS_ATE_1970) * 1000);
}

/** Lê um número de 16.16 em ponto fixo, como o `tkhd` guarda largura e altura. */
export function pontoFixo1616(bytes, posicao) {
  return bytes.readUInt32BE(posicao) / 65536;
}

/** O cabeçalho do filme. */
export function lerMvhd(bytes, moov) {
  const mvhd = moov.filha('mvhd');

  if (!mvhd) throw new ErroDeMp4('O moov não tem mvhd');

  const { versao, apos } = lerVersaoEBandeiras(bytes, mvhd);

  // Na versão 1 os instantes e a duração são de 64 bits; na 0, de 32. Ler a
  // versão errada desloca tudo.
  const largo = versao === 1;
  const tamanhoDoInstante = largo ? 8 : 4;

  const lerInstante = (posicao) =>
    largo ? Number(bytes.readBigUInt64BE(posicao)) : bytes.readUInt32BE(posicao);

  const criadoEm = lerInstante(apos);
  const alteradoEm = lerInstante(apos + tamanhoDoInstante);
  const escala = bytes.readUInt32BE(apos + tamanhoDoInstante * 2);
  const duracao = lerInstante(apos + tamanhoDoInstante * 2 + 4);

  return {
    versao,
    escala,
    duracao,
    duracaoEmSegundos: escala > 0 ? duracao / escala : 0,
    criadoEm: comoData(criadoEm),
    alteradoEm: comoData(alteradoEm),
  };
}

/** O cabeçalho de uma trilha. */
export function lerTkhd(bytes, trak) {
  const tkhd = trak.filha('tkhd');

  if (!tkhd) throw new ErroDeMp4('A trak não tem tkhd');

  const { versao, bandeiras, apos } = lerVersaoEBandeiras(bytes, tkhd);
  const largo = versao === 1;
  const tamanhoDoInstante = largo ? 8 : 4;

  // criado(8/4) alterado(8/4) id(4) reservado(4) duracao(8/4)
  const posicaoDoId = apos + tamanhoDoInstante * 2;
  const id = bytes.readUInt32BE(posicaoDoId);
  const posicaoDaDuracao = posicaoDoId + 8;

  const duracao = largo
    ? Number(bytes.readBigUInt64BE(posicaoDaDuracao))
    : bytes.readUInt32BE(posicaoDaDuracao);

  // Depois vêm 8 reservados, camada(2), grupo(2), volume(2), reservado(2),
  // a matriz de 9 inteiros (36) e então largura e altura.
  const posicaoDaLargura = posicaoDaDuracao + (largo ? 8 : 4) + 8 + 2 + 2 + 2 + 2 + 36;

  return {
    id,
    versao,
    duracao,
    // O bit 0 das bandeiras é "trilha habilitada". Uma trilha desabilitada
    // existe no arquivo e não deve tocar.
    habilitada: (bandeiras & 0x1) !== 0,
    largura: pontoFixo1616(bytes, posicaoDaLargura),
    altura: pontoFixo1616(bytes, posicaoDaLargura + 4),
  };
}

/** O cabeçalho de mídia de uma trilha: a escala de tempo dela. */
export function lerMdhd(bytes, trak) {
  const mdhd = trak.caminho('mdia/mdhd');

  if (!mdhd) throw new ErroDeMp4('A trak não tem mdia/mdhd');

  const { versao, apos } = lerVersaoEBandeiras(bytes, mdhd);
  const largo = versao === 1;
  const tamanhoDoInstante = largo ? 8 : 4;

  const escala = bytes.readUInt32BE(apos + tamanhoDoInstante * 2);
  const posicaoDaDuracao = apos + tamanhoDoInstante * 2 + 4;

  const duracao = largo
    ? Number(bytes.readBigUInt64BE(posicaoDaDuracao))
    : bytes.readUInt32BE(posicaoDaDuracao);

  // O idioma vem em três letras de 5 bits cada, somadas a 0x60 — uma
  // compactação de 1991 para caber "por" em dois bytes.
  const empacotado = bytes.readUInt16BE(posicaoDaDuracao + (largo ? 8 : 4));
  const idioma = [10, 5, 0]
    .map((deslocamento) => String.fromCharCode(((empacotado >> deslocamento) & 0x1f) + 0x60))
    .join('');

  return {
    escala,
    duracao,
    // **A escala da trilha, não a do filme.** É aqui que a duração se perde.
    duracaoEmSegundos: escala > 0 ? duracao / escala : 0,
    idioma: /^[a-z]{3}$/.test(idioma) ? idioma : null,
  };
}

/** O tipo de mídia da trilha: vídeo, áudio, legenda. */
export function lerHdlr(bytes, trak) {
  const hdlr = trak.caminho('mdia/hdlr');

  if (!hdlr) return { tipo: null, nome: null };

  const { apos } = lerVersaoEBandeiras(bytes, hdlr);
  const tipo = bytes.toString('latin1', apos + 4, apos + 8);
  const bruto = bytes.subarray(apos + 20, hdlr.fim).toString('utf8');

  return {
    tipo,
    ehVideo: tipo === 'vide',
    ehAudio: tipo === 'soun',
    ehLegenda: tipo === 'text' || tipo === 'sbtl' || tipo === 'subt',
    nome: bruto.replace(/\0.*$/s, '').trim() || null,
  };
}

/**
 * A descrição da amostra: qual codec e com que parâmetros.
 *
 * O `stsd` guarda uma "entrada de amostra" cujo tipo **é** o codec: `avc1`
 * para H.264, `hvc1` para H.265, `mp4a` para AAC. Dentro dela vem uma caixa de
 * configuração (`avcC`, `hvcC`, `esds`) com os detalhes.
 */
export function lerStsd(bytes, trak) {
  const stsd = trak.caminho('mdia/minf/stbl/stsd');

  if (!stsd || stsd.filhas.length === 0) return null;

  const entrada = stsd.filhas[0];
  const formato = entrada.tipo;

  const descricao = { formato, largura: null, altura: null, canais: null, taxaDeAmostragem: null, configuracao: null };

  if (['avc1', 'avc3', 'hvc1', 'hev1', 'mp4v', 'av01', 'vp09'].includes(formato)) {
    // Entrada visual: 6 reservados + 2 de índice + 16 predefinidos, e então
    // largura e altura como inteiros de 16 bits — a resolução **codificada**.
    const posicao = entrada.inicioDosDados + 24;

    descricao.largura = bytes.readUInt16BE(posicao);
    descricao.altura = bytes.readUInt16BE(posicao + 2);
    descricao.configuracao = lerConfiguracaoDeVideo(bytes, entrada);
  } else if (['mp4a', 'ac-3', 'ec-3', 'Opus', 'fLaC'].includes(formato)) {
    // Entrada sonora: 6 reservados + 2 de índice + 8 reservados, então canais,
    // tamanho da amostra, predefinido, reservado e a taxa em 16.16.
    const posicao = entrada.inicioDosDados + 16;

    descricao.canais = bytes.readUInt16BE(posicao);
    descricao.taxaDeAmostragem = bytes.readUInt32BE(posicao + 8) >>> 16;
    descricao.configuracao = lerConfiguracaoDeAudio(bytes, entrada);
  }

  return descricao;
}

/** O `avcC` ou `hvcC` dentro da entrada de amostra. */
function lerConfiguracaoDeVideo(bytes, entrada) {
  for (const nome of ['avcC', 'hvcC']) {
    const caixa = acharFilha(bytes, entrada, nome);

    if (!caixa) continue;

    if (nome === 'avcC') {
      // configuracaoVersao(1) perfil(1) compatibilidade(1) nivel(1)
      return {
        tipo: 'avcC',
        perfil: bytes.readUInt8(caixa.inicioDosDados + 1),
        compatibilidade: bytes.readUInt8(caixa.inicioDosDados + 2),
        nivel: bytes.readUInt8(caixa.inicioDosDados + 3),
      };
    }

    return {
      tipo: 'hvcC',
      perfilGeral: bytes.readUInt8(caixa.inicioDosDados + 1) & 0x1f,
      nivelGeral: bytes.readUInt8(caixa.inicioDosDados + 12),
    };
  }

  return null;
}

/** O `esds` do AAC, de onde sai o tipo de objeto. */
function lerConfiguracaoDeAudio(bytes, entrada) {
  const esds = acharFilha(bytes, entrada, 'esds');

  if (!esds) return null;

  // O esds é uma árvore de descritores MPEG-4 com tamanho em bytes de 7 bits.
  // Aqui basta achar o descritor 0x04 (DecoderConfig), cujo primeiro byte é o
  // tipo de objeto — 0x40 para AAC.
  const inicio = esds.inicioDosDados + 4;

  for (let i = inicio; i < esds.fim - 1; i += 1) {
    if (bytes[i] !== 0x04) continue;

    let j = i + 1;

    // O tamanho é variável: cada byte com o bit alto ligado continua.
    while (j < esds.fim && (bytes[j] & 0x80) !== 0) j += 1;

    const tipoDeObjeto = bytes[j + 1];

    if (tipoDeObjeto) return { tipo: 'esds', tipoDeObjeto };
  }

  return null;
}

/** Acha uma filha dentro de uma entrada de amostra, que não é recipiente. */
function acharFilha(bytes, entrada, tipo) {
  // A entrada de amostra tem um cabeçalho de tamanho fixo e depois caixas,
  // mas ela não está na lista de recipientes — varrer à mão é mais seguro do
  // que assumir onde as caixas começam.
  for (let i = entrada.inicioDosDados; i + 8 <= entrada.fim; i += 1) {
    if (bytes.toString('latin1', i + 4, i + 8) !== tipo) continue;

    const tamanho = bytes.readUInt32BE(i);

    if (tamanho >= 8 && i + tamanho <= entrada.fim) {
      return { inicioDosDados: i + 8, fim: i + tamanho };
    }
  }

  return null;
}

/**
 * A resolução de uma trilha de vídeo.
 *
 * Ela aparece em dois lugares e eles discordam **de propósito**:
 *
 * - `tkhd` traz as dimensões de **exibição**, em ponto fixo 16.16, já com a
 *   correção de proporção aplicada.
 * - `stsd` traz as dimensões **codificadas**, em inteiros — o que está
 *   realmente nos quadros.
 *
 * Em vídeo anamórfico os dois diferem: 720×480 codificados podem ser exibidos
 * como 854×480. Quem quer saber "que resolução é esse vídeo" quer a codificada;
 * quem vai desenhar na tela quer a de exibição.
 */
export function resolucao(tkhd, stsd) {
  return {
    codificada: stsd?.largura ? { largura: stsd.largura, altura: stsd.altura } : null,
    exibicao: tkhd?.largura ? { largura: Math.round(tkhd.largura), altura: Math.round(tkhd.altura) } : null,
    anamorfica: Boolean(
      stsd?.largura && tkhd?.largura && Math.abs(stsd.largura - tkhd.largura) > 1),
  };
}
