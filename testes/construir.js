/**
 * Construtor de caixas para os testes.
 *
 * Alguns casos — tamanho de 64 bits, tamanho zero, `uuid`, aninhamento fundo —
 * não aparecem no arquivo de amostra e seria preciso um arquivo de gigabytes
 * para provocar o primeiro. Montar os bytes à mão é a única forma de testá-los,
 * e como o formato é só cabeçalho e conteúdo, montar é tão simples quanto ler.
 */

/** Uma caixa comum: tamanho de 32 bits, tipo, conteúdo. */
export function caixa(tipo, conteudo = Buffer.alloc(0)) {
  const dados = Buffer.isBuffer(conteudo) ? conteudo : Buffer.concat(conteudo);
  const cabecalho = Buffer.alloc(8);

  cabecalho.writeUInt32BE(8 + dados.length, 0);
  cabecalho.write(tipo, 4, 'latin1');

  return Buffer.concat([cabecalho, dados]);
}

/** Uma caixa com tamanho de 64 bits: o campo de 32 bits vale 1. */
export function caixaGrande(tipo, conteudo = Buffer.alloc(0)) {
  const dados = Buffer.isBuffer(conteudo) ? conteudo : Buffer.concat(conteudo);
  const cabecalho = Buffer.alloc(16);

  cabecalho.writeUInt32BE(1, 0);
  cabecalho.write(tipo, 4, 'latin1');
  cabecalho.writeBigUInt64BE(BigInt(16 + dados.length), 8);

  return Buffer.concat([cabecalho, dados]);
}

/** Uma caixa "até o fim do arquivo": o tamanho vale 0. */
export function caixaAteOFim(tipo, conteudo = Buffer.alloc(0)) {
  const dados = Buffer.isBuffer(conteudo) ? conteudo : Buffer.concat(conteudo);
  const cabecalho = Buffer.alloc(8);

  cabecalho.writeUInt32BE(0, 0);
  cabecalho.write(tipo, 4, 'latin1');

  return Buffer.concat([cabecalho, dados]);
}

/** Uma caixa `uuid`, com o identificador estendido de 16 bytes. */
export function caixaUuid(hex, conteudo = Buffer.alloc(0)) {
  const identificador = Buffer.from(hex, 'hex');
  const dados = Buffer.isBuffer(conteudo) ? conteudo : Buffer.concat(conteudo);
  const cabecalho = Buffer.alloc(8);

  cabecalho.writeUInt32BE(8 + 16 + dados.length, 0);
  cabecalho.write('uuid', 4, 'latin1');

  return Buffer.concat([cabecalho, identificador, dados]);
}

/** Uma FullBox: versão e bandeiras antes do conteúdo. */
export function caixaComVersao(tipo, versao, bandeiras, conteudo = Buffer.alloc(0)) {
  const prefixo = Buffer.alloc(4);

  prefixo.writeUInt8(versao, 0);
  prefixo.writeUIntBE(bandeiras, 1, 3);

  return caixa(tipo, Buffer.concat([prefixo, Buffer.isBuffer(conteudo) ? conteudo : Buffer.concat(conteudo)]));
}

/** Um inteiro de 32 bits, big-endian. */
export function u32(valor) {
  const bytes = Buffer.alloc(4);

  bytes.writeUInt32BE(valor, 0);

  return bytes;
}

/** Um inteiro de 16 bits, big-endian. */
export function u16(valor) {
  const bytes = Buffer.alloc(2);

  bytes.writeUInt16BE(valor, 0);

  return bytes;
}

/** Um número 16.16 em ponto fixo, como o tkhd guarda largura e altura. */
export function fixo1616(valor) {
  return u32(Math.round(valor * 65536));
}

/**
 * Um `mvhd` versão 0.
 *
 * Campos: criado(4) alterado(4) escala(4) duração(4) e o resto, que o leitor
 * não usa mas que precisa existir para os deslocamentos baterem.
 */
export function mvhd({ escala, duracao, criadoEm = 0, versao = 0 }) {
  const instante = versao === 1 ? 8 : 4;
  const conteudo = Buffer.alloc(instante * 2 + 4 + instante + 80);

  if (versao === 1) {
    conteudo.writeBigUInt64BE(BigInt(criadoEm), 0);
    conteudo.writeBigUInt64BE(BigInt(criadoEm), 8);
    conteudo.writeUInt32BE(escala, 16);
    conteudo.writeBigUInt64BE(BigInt(duracao), 20);
  } else {
    conteudo.writeUInt32BE(criadoEm, 0);
    conteudo.writeUInt32BE(criadoEm, 4);
    conteudo.writeUInt32BE(escala, 8);
    conteudo.writeUInt32BE(duracao, 12);
  }

  return caixaComVersao('mvhd', versao, 0, conteudo);
}

/** Um `tkhd` versão 0, com id, bandeiras e as dimensões de exibição. */
export function tkhd({ id, largura, altura, habilitada = true, duracao = 0 }) {
  const conteudo = Buffer.alloc(4 + 4 + 4 + 4 + 4 + 8 + 2 + 2 + 2 + 2 + 36 + 8);
  let posicao = 0;

  conteudo.writeUInt32BE(0, posicao); posicao += 4;         // criado
  conteudo.writeUInt32BE(0, posicao); posicao += 4;         // alterado
  conteudo.writeUInt32BE(id, posicao); posicao += 4;        // id
  conteudo.writeUInt32BE(0, posicao); posicao += 4;         // reservado
  conteudo.writeUInt32BE(duracao, posicao); posicao += 4;   // duração
  posicao += 8 + 2 + 2 + 2 + 2 + 36;                        // reservados e matriz
  fixo1616(largura).copy(conteudo, posicao); posicao += 4;
  fixo1616(altura).copy(conteudo, posicao);

  return caixaComVersao('tkhd', 0, habilitada ? 0x1 : 0x0, conteudo);
}

/** Um `mdhd` versão 0, com a escala **da trilha**. */
export function mdhd({ escala, duracao, idioma = 'por' }) {
  const conteudo = Buffer.alloc(4 + 4 + 4 + 4 + 2 + 2);

  conteudo.writeUInt32BE(0, 0);
  conteudo.writeUInt32BE(0, 4);
  conteudo.writeUInt32BE(escala, 8);
  conteudo.writeUInt32BE(duracao, 12);

  // Três letras de 5 bits, cada uma menos 0x60.
  const empacotado = [...idioma]
    .reduce((acumulado, letra) => (acumulado << 5) | ((letra.charCodeAt(0) - 0x60) & 0x1f), 0);

  conteudo.writeUInt16BE(empacotado & 0x7fff, 16);

  return caixaComVersao('mdhd', 0, 0, conteudo);
}

/** Um `hdlr` com o tipo de mídia e um nome. */
export function hdlr(tipo, nome = '') {
  const conteudo = Buffer.concat([
    u32(0),
    Buffer.from(tipo, 'latin1'),
    Buffer.alloc(12),
    Buffer.from(`${nome}\0`, 'utf8'),
  ]);

  return caixaComVersao('hdlr', 0, 0, conteudo);
}

/** Um `avcC` com os três bytes que viram a cadeia de codec. */
export function avcC(perfil, compatibilidade, nivel) {
  return caixa('avcC', Buffer.from([1, perfil, compatibilidade, nivel, 0xff]));
}

/** Uma entrada `avc1` com a resolução codificada e um `avcC` dentro. */
export function avc1({ largura, altura, configuracao }) {
  const cabecalho = Buffer.alloc(78);

  cabecalho.writeUInt16BE(largura, 24);
  cabecalho.writeUInt16BE(altura, 26);

  return caixa('avc1', Buffer.concat([cabecalho, configuracao]));
}

/** Um `stsd` com uma entrada dentro. */
export function stsd(entrada) {
  return caixa('stsd', Buffer.concat([u32(0), u32(1), entrada]));
}

/** Uma trilha inteira, do jeito que o leitor espera encontrar. */
export function trak({ cabecalho, midia, tipo, descricao, nome = '' }) {
  return caixa('trak', [
    cabecalho,
    caixa('mdia', [midia, hdlr(tipo, nome), caixa('minf', [caixa('stbl', [stsd(descricao)])])]),
  ]);
}

/** Um arquivo completo: ftyp + moov (+ mdat, se pedirem). */
export function arquivo({ marca = 'isom', compativeis = ['isom'], filhasDoMoov, comMdat = true }) {
  const ftyp = caixa('ftyp', Buffer.concat([
    Buffer.from(marca, 'latin1'),
    u32(512),
    ...compativeis.map((c) => Buffer.from(c, 'latin1')),
  ]));

  const partes = [ftyp, caixa('moov', filhasDoMoov)];

  if (comMdat) partes.push(caixa('mdat', Buffer.alloc(16)));

  return Buffer.concat(partes);
}
