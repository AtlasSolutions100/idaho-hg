// ---------------------------------------------------------------------------
// Local dev launcher (off Replit). Loads .env, builds + starts the API server,
// and starts the web (Vite) dev server with an /api proxy. Ctrl+C stops both.
//
//   node dev-local.mjs            # build API + run API + run web
//   node dev-local.mjs --no-build # skip the API esbuild step (reuse dist)
//   node dev-local.mjs --api-only # run only the API
//   node dev-local.mjs --web-only # run only the web dev server
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const IS_WIN = process.platform === 'win32';

// --- load .env (simple parser; values may contain '=' and '+') -------------
function loadEnv(file) {
  const env = {};
  if (!existsSync(file)) return env;
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const fileEnv = loadEnv(path.join(__dirname, '.env'));
const base = { ...process.env, ...fileEnv };

const API_PORT = base.API_PORT || '5000';
const WEB_PORT = base.WEB_PORT || '5173';
const BASE_PATH = base.BASE_PATH || '/';
const WEB_HOST = base.REPL_ID ? '0.0.0.0' : '127.0.0.1';

if (!base.DATABASE_URL) {
  console.error('[dev] DATABASE_URL missing. Start Postgres first:\n' +
    '      node ../../.devlocal/pg.mjs up');
  process.exit(1);
}

const children = [];
function run(name, cmd, cmdArgs, opts = {}) {
  const child = spawn(cmd, cmdArgs, {
    cwd: opts.cwd || __dirname,
    env: { ...base, ...(opts.env || {}) },
    shell: opts.shell ?? false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const prefix = `[${name}]`;
  const pipe = (stream, out) => {
    stream.on('data', (d) => {
      const text = d.toString();
      for (const ln of text.split(/\r?\n/)) {
        if (ln.length) out.write(`${prefix} ${ln}\n`);
      }
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code, sig) => {
    console.log(`${prefix} exited (code=${code} sig=${sig || ''})`);
    if (!shuttingDown) shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try { c.kill(IS_WIN ? undefined : 'SIGTERM'); } catch {}
  }
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// --- spawn helpers ---------------------------------------------------------
function spawnSync2(name, cmd, cmdArgs, opts = {}) {
  return new Promise((resolve, reject) => {
    console.log(`[dev] ${name}...`);
    const child = spawn(cmd, cmdArgs, {
      cwd: opts.cwd || __dirname,
      env: { ...base, ...(opts.env || {}) },
      shell: opts.shell ?? false,
      stdio: 'inherit',
    });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${name} failed (code ${code})`)),
    );
  });
}

const apiDir = path.join(__dirname, 'artifacts', 'api-server');
const webDir = path.join(__dirname, 'artifacts', 'staffing-app');

async function main() {
  const webOnly = args.has('--web-only');
  const apiOnly = args.has('--api-only');

  if (!webOnly) {
    if (!args.has('--no-build')) {
      await spawnSync2('building API (esbuild)', 'node', ['build.mjs'], { cwd: apiDir });
    }
    run('api', 'node', ['--enable-source-maps', 'dist/index.mjs'], {
      cwd: apiDir,
      env: { PORT: API_PORT, NODE_ENV: 'development' },
    });
  }

  if (!apiOnly) {
    // Resolve the local vite binary and run it with node directly — avoids
    // pnpm's run/exec deps-verification gate (which aborts on this repo's
    // intentionally-ignored native build scripts). --host binds all interfaces.
    const webRequire = createRequire(path.join(webDir, 'package.json'));
    const vitePkgPath = webRequire.resolve('vite/package.json');
    const vitePkg = JSON.parse(readFileSync(vitePkgPath, 'utf8'));
    const viteBinRel = typeof vitePkg.bin === 'string' ? vitePkg.bin : vitePkg.bin.vite;
    const viteBin = path.join(path.dirname(vitePkgPath), viteBinRel);
    run('web', 'node', [viteBin, '--config', 'vite.config.ts', '--host', WEB_HOST], {
      cwd: webDir,
      env: { PORT: WEB_PORT, BASE_PATH, NODE_ENV: 'development' },
    });
  }

  const parts = [];
  if (!webOnly) parts.push(`API http://localhost:${API_PORT}/api/health`);
  if (!apiOnly) parts.push(`Web http://localhost:${WEB_PORT}`);
  console.log(`\n[dev] starting — ${parts.join('   |   ')}\n`);
}

main().catch((err) => {
  console.error('[dev] fatal:', err.message);
  shutdown(1);
});
