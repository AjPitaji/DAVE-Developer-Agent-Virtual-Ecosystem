// scripts/dev-keepalive.js
// Detach `next dev` from the parent shell so the harness's 1-hour background
// task reaper doesn't kill it. Writes the PID to .next/dev.pid so you can
// `npm run dev:stop` to shut it down cleanly.
//
// Usage:
//   npm run dev:keepalive   # start detached, prints the PID
//   npm run dev:stop        # stop the running instance

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PID_FILE = path.join(ROOT, '.next', 'dev.pid');
const LOG_FILE = path.join(ROOT, '.next', 'dev.log');

function ensureDir() {
  const dir = path.dirname(PID_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readPid() {
  if (!fs.existsSync(PID_FILE)) return null;
  const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
  const pid = Number(raw);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

function start() {
  ensureDir();
  if (readPid()) {
    console.log(`dev server already running (pid ${readPid()})`);
    return;
  }
  const out = fs.openSync(LOG_FILE, 'a');
  // Run `node <next/bin/next>` directly — no shell, no npx, no .cmd shims
  // (which all blow up on paths with spaces like "C:\Users\Anuj Jha\...").
  const nextBin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  const child = spawn(process.execPath, [nextBin, 'dev'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
    env: { ...process.env },
  });
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));
  console.log(`dev server detached, pid ${child.pid}`);
  console.log(`  log: ${LOG_FILE}`);
  console.log(`  stop with: npm run dev:stop`);
}

function stop() {
  const pid = readPid();
  if (!pid) {
    console.log('no running dev server found');
    try { fs.unlinkSync(PID_FILE); } catch {}
    return;
  }
  try {
    // On Windows, taskkill /T kills the process tree (npm + child next)
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'inherit' });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    console.log(`stopped pid ${pid}`);
  } catch (err) {
    console.error(`failed to stop ${pid}: ${err.message}`);
  }
  try { fs.unlinkSync(PID_FILE); } catch {}
}

const cmd = process.argv[2];
if (cmd === 'stop') stop();
else start();
