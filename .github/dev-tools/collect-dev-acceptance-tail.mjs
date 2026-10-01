import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Cloudflare tail is consumed inside the authenticated DEV workflow. Never
// echo a tail envelope: it can contain request URLs, headers and other logs.
const fields = {
  DEV_ACCEPTANCE_PNO_V1: ['inspectedCount', 'confirmedScanIn', 'insufficientHistory',
    'notYetScanInStage', 'suspectedScanInGap', 'falseGapCandidates',
    'cadenceSeconds', 'maxRoutesPerCycle', 'maxRequestsPerCycle', 'maxConcurrency'],
  DEV_ACCEPTANCE_CENTRAL_V1: ['inspectedCount'],
};
const areas = ['origin', 'destination', 'dropUnload', 'dropRelease'];
const states = ['warning', 'danger', 'success', 'normal', 'neutral'];
const safeCount = (n) => Number.isSafeInteger(n) && n >= 0;

export function sanitizedTailEvent(raw) {
  let envelope;
  try { envelope = JSON.parse(raw); } catch { return null; }
  for (const log of Array.isArray(envelope?.logs) ? envelope.logs : []) {
    let message;
    const encoded = Array.isArray(log?.message) && log.message.length === 1
      ? log.message[0] : log?.message;
    try { message = JSON.parse(encoded); } catch { continue; }
    const names = fields[message?.event];
    if (!names || !names.every((name) => safeCount(message[name]))) continue;
    const result = Object.fromEntries(names.map((name) => [name, message[name]]));
    if (message.event === 'DEV_ACCEPTANCE_CENTRAL_V1') {
      if (!areas.every((area) => states.every((state) => safeCount(message.areas?.[area]?.[state])))) continue;
      result.areas = Object.fromEntries(areas.map((area) =>
        [area, Object.fromEntries(states.map((state) => [state, message.areas[area][state]]))]));
    }
    return { event: message.event, ...result };
  }
  return null;
}

export async function collectTail({ durationMs = 150_000, shutdownGraceMs = 1_000,
  spawnTail = spawn } = {}) {
  const workerDir = fileURLToPath(new URL('../../worker/', import.meta.url));
  // The worker lockfile installs Wrangler at this bin path. Invoke it without
  // npx so the process we own is the tail process, not an npm wrapper.
  const wrangler = resolve(workerDir, 'node_modules/wrangler/bin/wrangler.js');
  const result = () => ({
    channel: 'CLOUDFLARE_AUTHENTICATED_TAIL',
    pnoSample: latest.DEV_ACCEPTANCE_PNO_V1 || null,
    centralSample: latest.DEV_ACCEPTANCE_CENTRAL_V1 || null,
    cssComputedLive: 'NOT_OBSERVABLE_FROM_SERVER',
  });
  let buffer = '';
  const latest = {};
  let child;
  try {
    child = spawnTail(process.execPath, [wrangler, 'tail', 'waiting-trucks-report-api-dev',
      '--config', 'wrangler.dev.jsonc', '--format', 'json'],
    { cwd: workerDir, stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32' });
  } catch {
    return result();
  }
  let accepting = true;
  const onData = (chunk) => {
    if (!accepting) return;
    buffer += String(chunk);
    if (buffer.length > 1_000_000) buffer = '';
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      const event = sanitizedTailEvent(line);
      // An empty HUB or a later idle cycle must not erase the one naturally
      // observed populated sample. These are samples, not a global sum.
      if (event && (event.inspectedCount > 0 || !latest[event.event]))
        latest[event.event] = event;
    }
  };
  child.stdout?.on('data', onData);
  // Never print stderr. Wrangler may include request metadata or account info.
  child.stderr?.resume();
  await new Promise((resolve) => {
    let settled = false;
    let graceTimer;
    const finish = () => {
      if (settled) return;
      settled = true;
      accepting = false;
      clearTimeout(deadlineTimer);
      clearTimeout(graceTimer);
      child.stdout?.removeListener('data', onData);
      child.stdout?.destroy?.();
      child.stderr?.destroy?.();
      child.removeListener('error', onError);
      child.removeListener('close', onClose);
      child.unref?.();
      resolve();
    };
    const signal = (name) => {
      // On Ubuntu detached creates one group for Wrangler and any descendants.
      // Kill the group as well as the direct child; either may exit first.
      if (process.platform !== 'win32' && child.pid) {
        try { process.kill(-child.pid, name); } catch { /* already exited */ }
      }
      try { child.kill(name); } catch { /* already exited */ }
    };
    const onError = () => { if (child.pid) signal('SIGKILL'); finish(); };
    const onClose = () => finish();
    child.on('error', onError);
    child.on('close', onClose);
    const deadlineTimer = setTimeout(() => {
      accepting = false;
      child.stdout?.removeListener('data', onData);
      child.stdout?.destroy?.();
      child.stderr?.destroy?.();
      signal('SIGTERM');
      if (!settled) graceTimer = setTimeout(() => {
        signal('SIGKILL');
        finish();
      }, shutdownGraceMs);
    }, durationMs);
  });
  return result();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const evidence = await collectTail();
  console.log(`DEV_ACCEPTANCE_SANITIZED_JSON=${JSON.stringify(evidence)}`);
}
