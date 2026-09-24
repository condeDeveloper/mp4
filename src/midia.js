/**
 * O resumo da mídia.
 *
 * É o que um catálogo precisa saber de um arquivo: quanto dura, em que
 * resolução, com que codecs, quantas trilhas. Exatamente a parte do trabalho
 * de um transcodificador que não envolve transcodificar nada.
 */

import { ErroDeMp4, lerArquivo } from './caixas.js';
import { cadeiaDe, cadeiaDoArquivo, nomeDe, tipoMime } from './codecs.js';
import { lerHdlr, lerMdhd, lerMvhd, lerStsd, lerTkhd, resolucao } from './trilhas.js';

/** As marcas que indicam um arquivo fragmentado ou preparado para fluxo. */
export const MARCAS_FRAGMENTADAS = new Set(['iso5', 'iso6', 'cmfc', 'dash', 'msdh']);

/** Lê o `ftyp`: qual variante do formato é este arquivo. */
export function lerFtyp(bytes, raiz) {
  const ftyp = raiz.filha('ftyp');

  if (!ftyp) return null;

  const marca = bytes.toString('latin1', ftyp.inicioDosDados, ftyp.inicioDosDados + 4);
  const versao = bytes.readUInt32BE(ftyp.inicioDosDados + 4);
  const compativeis = [];

  for (let i = ftyp.inicioDosDados + 8; i + 4 <= ftyp.fim; i += 4) {
    compativeis.push(bytes.toString('latin1', i, i + 4));
  }

  return { marca, versao, compativeis };
}

/**
 * Lê tudo que importa de um arquivo MP4.
 *
 * @param {Buffer} bytes o arquivo, ou só o começo dele
 * @returns {object} o resumo
 */
export function lerMidia(bytes) {
  const raiz = lerArquivo(bytes);
  const moov = raiz.filha('moov');

  if (!moov) {
    // Num arquivo preparado para fluxo o `moov` vem antes do `mdat`; num
    // arquivo comum ele vem depois, e ler só o começo não o encontra. Dizer
    // isso é mais útil do que "formato inválido".
    throw new ErroDeMp4(
      'Não achei o moov. Num arquivo não preparado para fluxo ele fica no fim — leia o arquivo inteiro.');
  }

  const ftyp = lerFtyp(bytes, raiz);
  const filme = lerMvhd(bytes, moov);
  const trilhas = [];

  for (const trak of moov.todas('trak')) {
    const tkhd = lerTkhd(bytes, trak);
    const mdhd = lerMdhd(bytes, trak);
    const hdlr = lerHdlr(bytes, trak);
    const descricao = lerStsd(bytes, trak);

    trilhas.push({
      id: tkhd.id,
      tipo: hdlr.tipo,
      nome: hdlr.nome,
      habilitada: tkhd.habilitada,
      idioma: mdhd.idioma,
      // A duração vem da escala **da trilha**, não da do filme.
      duracaoEmSegundos: mdhd.duracaoEmSegundos,
      escala: mdhd.escala,
      descricao,
      codec: cadeiaDe(descricao),
      codecLegivel: nomeDe(descricao),
      resolucao: hdlr.ehVideo ? resolucao(tkhd, descricao) : null,
      canais: descricao?.canais ?? null,
      taxaDeAmostragem: descricao?.taxaDeAmostragem ?? null,
    });
  }

  const video = trilhas.find((t) => t.tipo === 'vide') ?? null;
  const audio = trilhas.find((t) => t.tipo === 'soun') ?? null;

  // `mvex` no moov significa que os dados vêm em fragmentos, e o moov não tem
  // as tabelas de amostra — a duração dele pode ser zero mesmo num arquivo
  // longo. É o formato dos segmentos de HLS e DASH.
  const fragmentado = Boolean(moov.filha('mvex')) || Boolean(raiz.filha('moof'));

  // Ler só o começo de um arquivo é legítimo e útil, mas o que sai daí pode
  // estar faltando uma trilha inteira — e um resumo que diz "1 trilha" quando
  // são 2, sem avisar, é pior do que um erro.
  let truncado = false;

  for (const caixa of raiz.percorrer()) {
    if (caixa.truncada) {
      truncado = true;
      break;
    }
  }

  return {
    truncado,
    marca: ftyp?.marca ?? null,
    compativeis: ftyp?.compativeis ?? [],
    fragmentado,
    // Preparado para fluxo: o moov vem antes do mdat, então dá para começar a
    // tocar sem baixar o arquivo inteiro.
    preparadoParaFluxo: preparadoParaFluxo(raiz),
    duracaoEmSegundos: filme.duracaoEmSegundos,
    escalaDoFilme: filme.escala,
    criadoEm: filme.criadoEm,
    trilhas,
    video,
    audio,
    codecs: cadeiaDoArquivo(trilhas),
    tipoMime: tipoMime(trilhas),
    raiz,
  };
}

/** Se o `moov` vem antes do `mdat`. */
export function preparadoParaFluxo(raiz) {
  const moov = raiz.filhas.findIndex((c) => c.tipo === 'moov');
  const mdat = raiz.filhas.findIndex((c) => c.tipo === 'mdat');

  if (moov < 0) return false;

  // Sem mdat nenhum — como num segmento de inicialização — o arquivo é só
  // metadado, e ele está na frente por definição.
  return mdat < 0 || moov < mdat;
}

/** Segundos como relógio: 1:05:03 ou 4:07. */
export function relogio(segundos) {
  if (!Number.isFinite(segundos) || segundos < 0) return '0:00';

  const total = Math.round(segundos);
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const resto = total % 60;

  return horas > 0
    ? `${horas}:${String(minutos).padStart(2, '0')}:${String(resto).padStart(2, '0')}`
    : `${minutos}:${String(resto).padStart(2, '0')}`;
}

/** O resumo em texto, como a linha de comando mostra. */
export function resumir(midia) {
  const linhas = [
    `formato:  ${midia.marca}${midia.compativeis.length ? ` (${midia.compativeis.join(', ')})` : ''}`,
    `duração:  ${relogio(midia.duracaoEmSegundos)}  (${midia.duracaoEmSegundos.toFixed(3)} s)`,
    `codecs:   ${midia.codecs || '—'}`,
    `mime:     ${midia.tipoMime}`,
    `fluxo:    ${midia.preparadoParaFluxo ? 'preparado (moov antes do mdat)' : 'não preparado'}`,
  ];

  if (midia.fragmentado) linhas.push('fragmentado: sim');

  if (midia.truncado) {
    linhas.push('aviso:    os bytes acabaram no meio de uma caixa — isto é um resumo parcial');
  }

  linhas.push('', `trilhas:  ${midia.trilhas.length}`);

  for (const trilha of midia.trilhas) {
    const partes = [`  #${trilha.id} ${trilha.tipo}`, trilha.codecLegivel];

    if (trilha.resolucao?.codificada) {
      const { largura, altura } = trilha.resolucao.codificada;

      partes.push(`${largura}×${altura}`);

      if (trilha.resolucao.anamorfica) {
        const exibicao = trilha.resolucao.exibicao;

        partes.push(`(exibe ${exibicao.largura}×${exibicao.altura})`);
      }
    }

    if (trilha.canais) partes.push(`${trilha.canais} canal(is)`);
    if (trilha.taxaDeAmostragem) partes.push(`${trilha.taxaDeAmostragem} Hz`);

    partes.push(relogio(trilha.duracaoEmSegundos));

    if (trilha.idioma) partes.push(trilha.idioma);
    if (!trilha.habilitada) partes.push('(desabilitada)');

    linhas.push(partes.filter(Boolean).join('  '));
  }

  return linhas.join('\n');
}
