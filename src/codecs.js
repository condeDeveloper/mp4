/**
 * A cadeia de codec, no formato da RFC 6381.
 *
 * É aquele texto que aparece nos lugares mais importantes e que quase ninguém
 * sabe de onde vem:
 *
 *     CODECS="avc1.64001f,mp4a.40.2"          na playlist HLS
 *     MediaSource.isTypeSupported('video/mp4; codecs="avc1.64001f"')
 *     <source type='video/mp4; codecs="…"'>
 *
 * Ele **não** está guardado no arquivo como texto: é montado a partir de três
 * bytes da caixa de configuração. `avc1.64001f` significa H.264, perfil High
 * (0x64), sem restrições (0x00), nível 3.1 (0x1f = 31).
 *
 * Errar isso tem uma consequência específica e irritante: o navegador responde
 * que não sabe tocar um arquivo que ele toca perfeitamente — porque o que ele
 * avalia é a cadeia, não o arquivo.
 */

/** Os perfis do H.264, pelo número que aparece na cadeia. */
export const PERFIS_H264 = {
  0x42: 'Baseline',
  0x4d: 'Main',
  0x58: 'Extended',
  0x64: 'High',
  0x6e: 'High 10',
  0x7a: 'High 4:2:2',
  0xf4: 'High 4:4:4',
};

/** Os tipos de objeto MPEG-4 que interessam ao áudio. */
export const OBJETOS_MPEG4 = {
  0x40: 'AAC',
  0x66: 'AAC Main',
  0x67: 'AAC LC',
  0x69: 'MP3',
  0x6b: 'MP3',
};

/** Dois dígitos hexadecimais, minúsculos — é como a RFC escreve. */
function hex2(valor) {
  return Number(valor).toString(16).padStart(2, '0');
}

/**
 * Monta a cadeia de uma trilha.
 *
 * @param {{formato: string, configuracao: object|null}} descricao a saída de `lerStsd`
 * @returns {string|null}
 */
export function cadeiaDe(descricao) {
  if (!descricao?.formato) return null;

  const { formato, configuracao } = descricao;

  if ((formato === 'avc1' || formato === 'avc3') && configuracao?.tipo === 'avcC') {
    // Os três bytes vêm colados e em hexadecimal: perfil, compatibilidade e
    // nível. É literalmente o conteúdo do avcC, byte a byte.
    return `${formato}.${hex2(configuracao.perfil)}${hex2(configuracao.compatibilidade)}${hex2(configuracao.nivel)}`;
  }

  if ((formato === 'hvc1' || formato === 'hev1') && configuracao?.tipo === 'hvcC') {
    // O H.265 usa outro esquema, com pontos separando os campos.
    return `${formato}.1.6.L${configuracao.nivelGeral}.B0`;
  }

  if (formato === 'mp4a') {
    const tipo = configuracao?.tipoDeObjeto ?? 0x40;

    // `mp4a.40.2` é AAC-LC: 40 é o tipo de objeto MPEG-4 em hexadecimal e 2 é
    // o perfil de áudio. O "2" é fixo aqui porque lê-lo exigiria decodificar
    // a configuração específica do AAC, que é outro nível de detalhe.
    return tipo === 0x40 ? 'mp4a.40.2' : `mp4a.${hex2(tipo)}`;
  }

  // Formatos que não precisam de parâmetro: a própria marca basta.
  return formato;
}

/** O nome legível de um codec, para a tela. */
export function nomeDe(descricao) {
  const formato = descricao?.formato;

  const nomes = {
    avc1: 'H.264', avc3: 'H.264', hvc1: 'H.265', hev1: 'H.265',
    av01: 'AV1', vp09: 'VP9', mp4v: 'MPEG-4 Visual',
    mp4a: 'AAC', 'ac-3': 'Dolby Digital', 'ec-3': 'Dolby Digital Plus',
    Opus: 'Opus', fLaC: 'FLAC',
  };

  const base = nomes[formato] ?? formato ?? 'desconhecido';

  if (formato?.startsWith('avc') && descricao?.configuracao?.perfil) {
    const perfil = PERFIS_H264[descricao.configuracao.perfil];
    const nivel = (descricao.configuracao.nivel / 10).toFixed(1);

    return perfil ? `${base} ${perfil} nível ${nivel}` : base;
  }

  return base;
}

/**
 * A cadeia completa de um arquivo, como vai no `CODECS` da playlist.
 *
 * A ordem é vídeo primeiro, áudio depois — que é como as playlists do mundo
 * real escrevem, e o que este projeto confere contra elas nos testes.
 */
export function cadeiaDoArquivo(trilhas) {
  const partes = [];

  for (const trilha of trilhas ?? []) {
    if (trilha.tipo !== 'vide') continue;

    const cadeia = cadeiaDe(trilha.descricao);

    if (cadeia) partes.push(cadeia);
  }

  for (const trilha of trilhas ?? []) {
    if (trilha.tipo !== 'soun') continue;

    const cadeia = cadeiaDe(trilha.descricao);

    if (cadeia) partes.push(cadeia);
  }

  return partes.join(',');
}

/** O tipo MIME completo, pronto para o `isTypeSupported`. */
export function tipoMime(trilhas, contenedor = 'video/mp4') {
  const cadeia = cadeiaDoArquivo(trilhas);

  return cadeia ? `${contenedor}; codecs="${cadeia}"` : contenedor;
}
