#!/usr/bin/env node
/**
 * A linha de comando.
 *
 *     mp4 resumo   arquivo.mp4     duração, resolução, codecs, trilhas
 *     mp4 arvore   arquivo.mp4     a árvore de caixas inteira
 *     mp4 codec    arquivo.mp4     só a cadeia, para colar numa playlist
 *     mp4 json     arquivo.mp4     tudo, em JSON
 */

import { readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

import { desenhar, ErroDeMp4 } from './caixas.js';
import { lerMidia, resumir } from './midia.js';

const USO = `mp4 — leitor de metadados de MP4

  mp4 resumo <arquivo>   duração, resolução, codecs e trilhas
  mp4 arvore <arquivo>   a árvore de caixas
  mp4 codec  <arquivo>   a cadeia RFC 6381, como vai no CODECS= da playlist
  mp4 json   <arquivo>   tudo, em JSON

  --bytes=N              lê só os N primeiros bytes (basta num arquivo
                         preparado para fluxo, onde o moov vem na frente)`;

/** Separa opções `--chave=valor` dos argumentos posicionais. */
export function separarArgumentos(argumentos) {
  const opcoes = {};
  const posicionais = [];

  for (const argumento of argumentos) {
    const casou = /^--([a-z-]+)(?:=(.*))?$/.exec(argumento);

    if (casou) opcoes[casou[1]] = casou[2] ?? true;
    else posicionais.push(argumento);
  }

  return { opcoes, posicionais };
}

/** Lê o arquivo, inteiro ou só o começo. */
async function carregar(caminho, limite) {
  if (!limite) return readFileSync(caminho);

  const arquivo = await open(caminho, 'r');

  try {
    const destino = Buffer.alloc(limite);
    const { bytesRead } = await arquivo.read(destino, 0, limite, 0);

    return destino.subarray(0, bytesRead);
  } finally {
    await arquivo.close();
  }
}

/** Troca a árvore de caixas por algo que o JSON aguenta. */
function semCircularidade(chave, valor) {
  if (chave === 'raiz' || chave === 'descricao') return undefined;

  return valor;
}

export async function principal(argumentos) {
  const { opcoes, posicionais } = separarArgumentos(argumentos);
  const [comando, caminho] = posicionais;

  if (!comando || opcoes.ajuda || opcoes.help) {
    console.log(USO);

    return comando ? 0 : 1;
  }

  if (!caminho) {
    console.error(`Falta o arquivo. Use: mp4 ${comando} <arquivo>`);

    return 1;
  }

  const limite = opcoes.bytes ? Number(opcoes.bytes) : 0;

  if (opcoes.bytes && !(limite > 0)) {
    console.error(`--bytes esperava um número, veio "${opcoes.bytes}".`);

    return 1;
  }

  let bytes;

  try {
    bytes = await carregar(caminho, limite);
  } catch (erro) {
    console.error(`Não consegui ler ${basename(caminho)}: ${erro.message}`);

    return 1;
  }

  try {
    if (comando === 'arvore') {
      const midia = lerMidia(bytes);

      console.log(desenhar(midia.raiz));

      return 0;
    }

    const midia = lerMidia(bytes);

    if (comando === 'resumo') console.log(resumir(midia));
    else if (comando === 'codec') console.log(midia.codecs);
    else if (comando === 'json') console.log(JSON.stringify(midia, semCircularidade, 2));
    else {
      console.error(`Comando desconhecido: ${comando}\n\n${USO}`);

      return 1;
    }

    return 0;
  } catch (erro) {
    if (erro instanceof ErroDeMp4) {
      console.error(erro.message);

      return 1;
    }

    throw erro;
  }
}

// `import.meta.main` só existe a partir do Node 24; comparar as URLs funciona
// em todas as versões e não se confunde com caminhos do Windows.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await principal(process.argv.slice(2));
}
