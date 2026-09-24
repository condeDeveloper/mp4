import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { separarArgumentos } from '../src/cli.js';

const executar = promisify(execFile);

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const AMOSTRA = fileURLToPath(new URL('./amostras/flor-cabecalho.mp4', import.meta.url));

/** Roda a linha de comando de verdade e devolve saída, erro e código. */
async function mp4(...argumentos) {
  try {
    const { stdout, stderr } = await executar(process.execPath, [CLI, ...argumentos]);

    return { stdout, stderr, codigo: 0 };
  } catch (erro) {
    return { stdout: erro.stdout ?? '', stderr: erro.stderr ?? '', codigo: erro.code };
  }
}

describe('os argumentos', () => {
  it('separa opções de caminhos', () => {
    const { opcoes, posicionais } = separarArgumentos(['resumo', '--bytes=4096', 'a.mp4']);

    assert.deepEqual(posicionais, ['resumo', 'a.mp4']);
    assert.equal(opcoes.bytes, '4096');
  });

  it('aceita opção sem valor', () => {
    assert.equal(separarArgumentos(['--ajuda']).opcoes.ajuda, true);
  });

  it('não confunde um caminho com uma opção', () => {
    const { posicionais } = separarArgumentos(['resumo', './videos/-estranho.mp4']);

    assert.deepEqual(posicionais, ['resumo', './videos/-estranho.mp4']);
  });
});

describe('a linha de comando', () => {
  it('resume o arquivo', async () => {
    const { stdout, codigo } = await mp4('resumo', AMOSTRA);

    assert.equal(codigo, 0);
    assert.match(stdout, /duração: {2}0:05/);
    assert.match(stdout, /trilhas: {2}2/);
  });

  it('imprime só a cadeia, pronta para colar numa playlist', async () => {
    const { stdout } = await mp4('codec', AMOSTRA);

    assert.equal(stdout.trim(), 'avc1.64001f,mp4a.40.2');
  });

  it('desenha a árvore de caixas', async () => {
    const { stdout } = await mp4('arvore', AMOSTRA);

    assert.match(stdout, /^ftyp {2}32 bytes$/m);
    assert.match(stdout, /^ {12}avc1  179 bytes$/m);
  });

  it('dá JSON sem estourar na árvore circular', async () => {
    const { stdout, codigo } = await mp4('json', AMOSTRA);

    assert.equal(codigo, 0);

    const midia = JSON.parse(stdout);

    assert.equal(midia.marca, 'mp42');
    assert.equal(midia.trilhas.length, 2);
    assert.equal(midia.raiz, undefined, 'a árvore fica de fora do JSON');
  });

  it('lê só os bytes pedidos', async () => {
    const { stdout } = await mp4('resumo', '--bytes=800', AMOSTRA);

    assert.match(stdout, /resumo parcial/);
  });

  it('sai com erro e explica quando o arquivo não existe', async () => {
    const { stderr, codigo } = await mp4('resumo', 'nao-existe.mp4');

    assert.equal(codigo, 1);
    assert.match(stderr, /Não consegui ler nao-existe\.mp4/);
  });

  it('sai com erro quando falta o arquivo', async () => {
    const { stderr, codigo } = await mp4('resumo');

    assert.equal(codigo, 1);
    assert.match(stderr, /Falta o arquivo/);
  });

  it('recusa um --bytes que não é número', async () => {
    const { stderr, codigo } = await mp4('resumo', '--bytes=muitos', AMOSTRA);

    assert.equal(codigo, 1);
    assert.match(stderr, /esperava um número/);
  });

  it('mostra o uso quando não recebe comando', async () => {
    const { stdout, codigo } = await mp4();

    assert.equal(codigo, 1);
    assert.match(stdout, /leitor de metadados/);
  });

  it('reclama de um comando que não existe', async () => {
    const { stderr, codigo } = await mp4('transcodificar', AMOSTRA);

    assert.equal(codigo, 1);
    assert.match(stderr, /Comando desconhecido/);
  });

  it('não vomita pilha quando o arquivo não é MP4', async () => {
    const { stderr, stdout, codigo } = await mp4('resumo', CLI);

    assert.equal(codigo, 1);
    assert.equal(stdout, '');
    assert.doesNotMatch(stderr, /at Object|node:internal/, 'erro de formato não é bug do programa');
  });
});
