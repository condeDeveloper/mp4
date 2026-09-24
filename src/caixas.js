/**
 * As caixas.
 *
 * Um arquivo MP4 é uma árvore de caixas — e só isso. Cada uma tem oito bytes
 * de cabeçalho:
 *
 *     tamanho  4 bytes, big-endian, **incluindo o próprio cabeçalho**
 *     tipo     4 bytes ASCII: "ftyp", "moov", "trak"…
 *
 * Depois vêm os dados, que para algumas caixas são outras caixas. O formato
 * inteiro cabe nessa frase, e é por isso que dá para escrever um leitor de MP4
 * numa tarde — e por isso que `.mp4`, `.m4a`, `.mov` e os segmentos de HLS
 * fragmentado são todos o mesmo formato por dentro.
 *
 * Três detalhes do cabeçalho, e cada um quebra um tipo de arquivo:
 *
 * - **`tamanho == 1`** significa que o tamanho de verdade vem depois do tipo,
 *   em 8 bytes. É como um arquivo passa de 4 GB.
 * - **`tamanho == 0`** significa "até o fim do arquivo", e só é válido na
 *   última caixa.
 * - **`tipo == "uuid"`** significa que os 16 bytes seguintes são um
 *   identificador estendido; sem tratar isso, o leitor entra nos dados dele
 *   como se fossem caixas.
 */

/** O arquivo não está no formato esperado. */
export class ErroDeMp4 extends Error {
  constructor(mensagem, deslocamento = null) {
    super(deslocamento === null ? mensagem : `${mensagem} (byte ${deslocamento})`);
    this.name = 'ErroDeMp4';
    this.deslocamento = deslocamento;
  }
}

/** O cabeçalho tem 8 bytes; 16 quando o tamanho é de 64 bits. */
export const CABECALHO = 8;

/**
 * As caixas que contêm outras caixas.
 *
 * Não há como descobrir isso lendo o arquivo: é uma propriedade do tipo, e
 * está na especificação. Entrar numa caixa que não é recipiente faz o leitor
 * interpretar dados de vídeo como cabeçalhos — e os "tamanhos" que saem daí
 * mandam a leitura para qualquer lugar.
 */
export const RECIPIENTES = new Set([
  'moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'mvex', 'moof', 'traf',
  'mfra', 'udta', 'meta', 'ipro', 'sinf', 'schi', 'stsd',
]);

/**
 * Caixas com versão e bandeiras nos primeiros 4 bytes.
 *
 * É a "FullBox" da especificação: 1 byte de versão e 3 de bandeiras antes dos
 * dados. Ler uma delas como caixa comum desloca tudo em quatro bytes.
 */
export const COM_VERSAO = new Set([
  'mvhd', 'tkhd', 'mdhd', 'hdlr', 'vmhd', 'smhd', 'stsd', 'stts', 'stsc', 'stsz',
  'stco', 'co64', 'stss', 'ctts', 'elst', 'mehd', 'trex', 'mfhd', 'tfhd', 'trun', 'url ', 'dref',
]);

/** Uma caixa lida. */
export class Caixa {
  constructor({ tipo, inicio, tamanho, inicioDosDados, fim, uuid = null, filhas = [], truncada = false }) {
    this.tipo = tipo;
    this.inicio = inicio;
    this.tamanho = tamanho;
    this.inicioDosDados = inicioDosDados;
    this.fim = fim;
    this.uuid = uuid;
    this.filhas = filhas;
    // A caixa declara mais bytes do que havia para ler. Acontece o tempo todo
    // ao ler só o começo de um arquivo, e não é erro — mas o que sai daí é
    // parcial, e quem lê precisa saber disso.
    this.truncada = truncada;
  }

  /** Quantos bytes de conteúdo a caixa tem. */
  get tamanhoDosDados() {
    return this.fim - this.inicioDosDados;
  }

  /** A primeira filha deste tipo. */
  filha(tipo) {
    return this.filhas.find((c) => c.tipo === tipo) ?? null;
  }

  /** Todas as filhas deste tipo. */
  todas(tipo) {
    return this.filhas.filter((c) => c.tipo === tipo);
  }

  /**
   * Busca em profundidade pelo caminho, como `moov/trak/mdia/mdhd`.
   *
   * Sem isso, chegar num `mdhd` exige quatro `filha()` encadeados — e a
   * primeira ausência no meio vira um erro de nulo em vez de um "não achei".
   */
  caminho(caminho) {
    let atual = this;

    for (const parte of caminho.split('/').filter(Boolean)) {
      atual = atual?.filha(parte);

      if (!atual) return null;
    }

    return atual;
  }

  /** Percorre a árvore inteira, em profundidade. */
  *percorrer() {
    yield this;

    for (const filha of this.filhas) yield* filha.percorrer();
  }

  toString() {
    return `${this.tipo}[${this.tamanho}]`;
  }
}

/**
 * Lê o cabeçalho de uma caixa.
 *
 * @returns {{tipo: string, tamanho: number, inicioDosDados: number, uuid: string|null}}
 */
export function lerCabecalho(bytes, inicio, limite = bytes.length) {
  if (inicio + CABECALHO > limite) {
    throw new ErroDeMp4('Cabeçalho de caixa truncado', inicio);
  }

  let tamanho = bytes.readUInt32BE(inicio);
  const tipo = bytes.toString('latin1', inicio + 4, inicio + 8);

  let inicioDosDados = inicio + CABECALHO;

  if (tamanho === 1) {
    if (inicioDosDados + 8 > limite) throw new ErroDeMp4('Tamanho de 64 bits truncado', inicio);

    const grande = bytes.readBigUInt64BE(inicioDosDados);

    if (grande > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ErroDeMp4('Caixa grande demais para ser endereçada', inicio);
    }

    tamanho = Number(grande);
    inicioDosDados += 8;
  } else if (tamanho === 0) {
    // "Até o fim do arquivo" — só faz sentido na última caixa.
    tamanho = limite - inicio;
  }

  let uuid = null;

  if (tipo === 'uuid') {
    if (inicioDosDados + 16 > limite) throw new ErroDeMp4('UUID truncado', inicio);

    uuid = bytes.toString('hex', inicioDosDados, inicioDosDados + 16);
    inicioDosDados += 16;
  }

  if (tamanho < inicioDosDados - inicio) {
    throw new ErroDeMp4(`Caixa "${tipo}" declara ${tamanho} bytes, menos que o próprio cabeçalho`, inicio);
  }

  return { tipo, tamanho, inicioDosDados, uuid };
}

/**
 * Lê todas as caixas de uma região.
 *
 * @param {Buffer} bytes
 * @param {{inicio?: number, fim?: number, profundidade?: number}} opcoes
 * @returns {Caixa[]}
 */
export function lerCaixas(bytes, { inicio = 0, fim = bytes.length, profundidade = 0 } = {}) {
  if (profundidade > 32) {
    // Nenhum MP4 legítimo aninha tão fundo; um arquivo que aninha assim está
    // tentando estourar a pilha.
    throw new ErroDeMp4('Aninhamento de caixas fundo demais', inicio);
  }

  const caixas = [];
  let i = inicio;

  while (i + CABECALHO <= fim) {
    const cabecalho = lerCabecalho(bytes, i, fim);
    const fimDaCaixa = Math.min(i + cabecalho.tamanho, fim);

    const caixa = new Caixa({
      tipo: cabecalho.tipo,
      inicio: i,
      tamanho: cabecalho.tamanho,
      inicioDosDados: cabecalho.inicioDosDados,
      fim: fimDaCaixa,
      uuid: cabecalho.uuid,
      truncada: i + cabecalho.tamanho > fim,
    });

    if (RECIPIENTES.has(caixa.tipo)) {
      // O `stsd` é recipiente, mas tem 8 bytes próprios antes das filhas: a
      // versão/bandeiras e a contagem de entradas.
      const desvio = caixa.tipo === 'stsd' ? 8 : 0;

      caixa.filhas = lerCaixas(bytes, {
        inicio: caixa.inicioDosDados + desvio,
        fim: caixa.fim,
        profundidade: profundidade + 1,
      });
    }

    caixas.push(caixa);

    if (cabecalho.tamanho <= 0) break;

    i += cabecalho.tamanho;
  }

  return caixas;
}

/** Lê o arquivo inteiro e devolve uma caixa-raiz artificial. */
export function lerArquivo(bytes) {
  if (!Buffer.isBuffer(bytes)) {
    throw new TypeError('Esperava um Buffer com os bytes do arquivo.');
  }

  if (bytes.length < CABECALHO) {
    throw new ErroDeMp4('Arquivo curto demais para ter uma caixa sequer');
  }

  const filhas = lerCaixas(bytes);

  if (filhas.length === 0) {
    throw new ErroDeMp4('Nenhuma caixa encontrada');
  }

  // A raiz não existe no arquivo; ela é criada para que `caminho()` e
  // `percorrer()` funcionem a partir do topo como funcionam em qualquer nível.
  return new Caixa({
    tipo: '(raiz)',
    inicio: 0,
    tamanho: bytes.length,
    inicioDosDados: 0,
    fim: bytes.length,
    filhas,
  });
}

/** Lê a versão e as bandeiras de uma FullBox. */
export function lerVersaoEBandeiras(bytes, caixa) {
  if (!COM_VERSAO.has(caixa.tipo)) {
    throw new ErroDeMp4(`A caixa "${caixa.tipo}" não tem versão nem bandeiras`);
  }

  return {
    versao: bytes.readUInt8(caixa.inicioDosDados),
    bandeiras: bytes.readUIntBE(caixa.inicioDosDados + 1, 3),
    apos: caixa.inicioDosDados + 4,
  };
}

/** Uma árvore em texto, para inspeção. */
export function desenhar(caixa, recuo = '') {
  const linhas = [];

  for (const filha of caixa.filhas) {
    const extra = [
      filha.uuid ? ` uuid=${filha.uuid}` : '',
      filha.truncada ? ' (truncada)' : '',
    ].join('');

    linhas.push(`${recuo}${filha.tipo}  ${filha.tamanho} bytes${extra}`);
    linhas.push(desenhar(filha, `${recuo}  `));
  }

  return linhas.filter(Boolean).join('\n');
}
