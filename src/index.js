/**
 * mp4 — um leitor de metadados de MP4, do zero.
 *
 * O ponto de entrada da biblioteca. Quem quer só o resumo usa `lerMidia`;
 * quem quer descer até o osso usa `lerArquivo` e caminha pela árvore.
 */

export {
  CABECALHO,
  Caixa,
  COM_VERSAO,
  desenhar,
  ErroDeMp4,
  lerArquivo,
  lerCabecalho,
  lerCaixas,
  lerVersaoEBandeiras,
  RECIPIENTES,
} from './caixas.js';

export {
  comoData,
  lerHdlr,
  lerMdhd,
  lerMvhd,
  lerStsd,
  lerTkhd,
  pontoFixo1616,
  resolucao,
  SEGUNDOS_ATE_1970,
} from './trilhas.js';

export {
  cadeiaDe,
  cadeiaDoArquivo,
  nomeDe,
  OBJETOS_MPEG4,
  PERFIS_H264,
  tipoMime,
} from './codecs.js';

export {
  lerFtyp,
  lerMidia,
  preparadoParaFluxo,
  relogio,
  resumir,
} from './midia.js';
