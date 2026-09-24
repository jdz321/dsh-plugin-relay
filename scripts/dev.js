#!/usr/bin/env node
// Development launcher (`npm start`): boots dsh web on port 3098 against this
// repo's own `.dsh-home`. DSH_HOME is forced to the workspace home so an
// exported DSH_HOME can never point `npm start` at a foreign dsh home.
// Use --dsh-home <dir> to point somewhere else explicitly, --port <n> for
// another port, and --no-open to keep dsh from opening the default browser.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** The dev home for this launcher: workspace `.dsh-home` unless overridden. */
export function resolveDevHome(flag) {
  return path.resolve(flag ?? path.join(ROOT, '.dsh-home'));
}

/** Absolute path of the `dsh` entry script from devDependencies. */
export function resolveDshEntry() {
  const require = createRequire(import.meta.url);
  const pkg = require('@deepseek-ai/dsh/package.json');
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.dsh;
  if (!bin) throw new Error('@deepseek-ai/dsh 未提供 bin 入口');
  return path.join(path.dirname(require.resolve('@deepseek-ai/dsh/package.json')), bin);
}

/** The dev launcher's own flags, parsed from `npm start` arguments. */
export function parseDevArgs(argv) {
  let homeFlag;
  let port = '3098';
  let noOpen = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dsh-home') homeFlag = argv[(i += 1)];
    else if (argv[i] === '--port') port = String(argv[(i += 1)]);
    else if (argv[i] === '--no-open') noOpen = true;
  }
  return { homeFlag, port, noOpen };
}

function main(argv) {
  const { homeFlag, port, noOpen } = parseDevArgs(argv);
  const home = resolveDevHome(homeFlag);
  fs.mkdirSync(home, { recursive: true });
  let entry;
  try {
    entry = resolveDshEntry();
  } catch (err) {
    console.error(`dsh 未安装：先运行 \`npm install\`（${err.message}）`);
    process.exitCode = 1;
    return;
  }
  const dshArgs = ['web', '--port', port];
  if (noOpen) dshArgs.push('--no-open');
  console.log(`启动 dsh: ${path.relative(ROOT, entry)} ${dshArgs.join(' ')}`);
  console.log(`  DSH_HOME=${home}  →  http://127.0.0.1:${port}`);
  const child = spawn(process.execPath, [entry, ...dshArgs], {
    cwd: ROOT,
    env: { ...process.env, DSH_HOME: home },
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 0;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
