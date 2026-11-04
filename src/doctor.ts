// Finds out why printing doesn't work and repairs whatever software can repair. What only a
// person can do (load paper, click the Windows permission prompt) comes back as an instruction.
import fs from 'node:fs';
import path from 'node:path';
import { SCRIPTS_DIR, lanInterfaces, runPowerShell } from './discovery.js';
import { deviceText } from './ipp.js';
import { cancelPrinterJob, printerJobs, readPrinterStatus } from './jobs.js';
import { registry, type PrinterRecord } from './registry.js';
import { assertLocalPathAllowed, resolveLocalPath } from './sources.js';
import { makeTempDir, removeDir } from './state.js';

export interface Finding {
  check: string;
  status: 'ok' | 'fixed' | 'problem' | 'working';
  detail: string;
  you_do?: string;
}

interface QueueHealth {
  name: string; driver: string; port: string; host?: string; status: string; offline: boolean; virtual: boolean;
  jobs: { id: number; document: string; status: string }[];
}
interface UsbDevice { name: string; id: string; errorCode: number; hardwareIds: string[] }
interface Health { spooler: string; spoolerStart: string; queueError?: string; queues: QueueHealth[]; usb: UsbDevice[]; protectedPrint: boolean }

const DOCTOR = path.join(SCRIPTS_DIR, 'doctor.ps1');
const asArray = <T>(v: T | T[] | undefined | null): T[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

async function doctor<T>(action: string, data: Record<string, unknown> = {}, timeoutMs = 30000): Promise<T> {
  const out = await runPowerShell(DOCTOR, JSON.stringify({ action, ...data }), timeoutMs);
  return JSON.parse(out.trim() || '{}') as T;
}

async function inspect(): Promise<Health> {
  const h = await doctor<Health>('inspect');
  return { ...h, queues: asArray(h.queues).map(q => ({ ...q, jobs: asArray(q.jobs) })), usb: asArray(h.usb).map(u => ({ ...u, hardwareIds: asArray(u.hardwareIds) })) };
}

interface ElevatedResult { ok?: boolean; error?: string; declined?: boolean; [key: string]: unknown }

const DECLINED = 'Approve the Windows permission prompt when it appears, then ask again.';

/** Goes through the Windows permission prompt, so the user decides. The prompt shows only when a fix needs it. */
async function elevated(action: string, data: Record<string, unknown> = {}, timeoutMs = 15 * 60 * 1000): Promise<ElevatedResult> {
  if (!registry.reloadConfig().allowElevation) return { declined: true, error: 'allowElevation is off in config.json' };
  const dir = makeTempDir();
  try {
    const resultFile = path.join(dir, 'result.json');
    const requestFile = path.join(dir, 'request.json');
    fs.writeFileSync(requestFile, JSON.stringify({ action, resultFile, ...data }));
    const started = await doctor<{ declined: boolean; error?: string }>('elevate', { script: path.join(SCRIPTS_DIR, 'elevated.ps1'), requestFile }, timeoutMs);
    if (started.declined) return { declined: true, error: started.error };
    return JSON.parse(fs.readFileSync(resultFile, 'utf8')) as ElevatedResult;
  } finally {
    removeDir(dir);
  }
}

// ---------- what a printer's own status means ----------

const REASON_HELP: [RegExp, string][] = [
  [/^media-(empty|needed)/, 'Load paper into the tray.'],
  [/^media-jam/, 'Open the printer and remove the jammed paper, then close it.'],
  [/^(door|cover|interlock)-open/, 'Close the printer cover or door.'],
  [/^(toner|marker-supply|marker-ink|ink)-?.*(empty)/, 'Replace or refill the empty ink or toner.'],
  [/^input-tray-missing/, 'Push the paper tray fully in.'],
  [/^output-(tray|area)-(full|almost-full)/, 'Clear the output tray.'],
  [/^(toner|marker-supply)-low/, 'Ink or toner is low; have some ready.'],
  [/^media-low/, 'Paper is low; add more soon.'],
  [/^(paused|moving-to-paused)/, 'The printer is paused. Press resume or OK on its panel.'],
  [/^(shutdown|offline|timed-out)/, 'The printer reports it is off or offline. Turn it on and wait a minute.'],
  [/^spool-area-full/, 'The printer has run out of memory. Turn it off and on again.'],
];

/** Returns the instruction for a printer-state-reason, or undefined when none is needed. */
export function explainReason(reason: string): { severe: boolean; you_do: string } | undefined {
  if (reason.endsWith('-report')) return undefined;
  const base = reason.replace(/-(error|warning)$/, '');
  const hit = REASON_HELP.find(([re]) => re.test(base));
  if (hit) return { severe: !/low|almost-full/.test(base) || reason.endsWith('-error'), you_do: hit[1] };
  return reason === 'none' ? undefined : { severe: reason.endsWith('-error'), you_do: `The printer reports "${reason}". Check its screen or lights.` };
}

// ---------- the check for one network printer ----------

async function checkNetworkPrinter(p: PrinterRecord, clearAll: boolean, add: (f: Finding) => void): Promise<void> {
  const check = p.name;
  let status;
  try {
    status = await readPrinterStatus(p, 2500);
  } catch (e) {
    add({
      check, status: 'problem', detail: `Not answering at ${p.ipp?.host} (${(e as Error).message}).`,
      you_do: 'Check the printer is on and its Wi-Fi or network light is steady. If it moved to another network, reconnect it to this one using its panel or WPS button.',
    });
    return;
  }
  let severe = false;
  for (const reason of status.reasons) {
    const help = explainReason(reason);
    if (!help) continue;
    severe ||= help.severe;
    add({ check, status: help.severe ? 'problem' : 'ok', detail: `Printer says: ${reason}`, you_do: help.you_do });
  }
  if (status.acceptingJobs === false && !severe) {
    severe = true;
    add({ check, status: 'problem', detail: 'Refusing new jobs.', you_do: status.message ? `Printer says: ${status.message}` : 'Turn the printer off and on again.' });
  }
  for (const ink of status.ink) {
    if (ink.low) add({ check, status: 'ok', detail: `${ink.name} is low (${ink.level}%).` });
  }
  if (clearAll) {
    const pending = await printerJobs(p).catch(() => []) as { id?: number }[];
    let cleared = 0;
    for (const j of pending) {
      if (j.id === undefined) continue;
      try { await cancelPrinterJob(p, j.id); cleared++; } catch (e) { add({ check, status: 'problem', detail: `Could not cancel job ${j.id}: ${(e as Error).message}` }); }
    }
    if (cleared) add({ check, status: 'fixed', detail: `Canceled ${cleared} job(s) waiting on the printer.` });
  }
  if (!severe) add({ check, status: 'ok', detail: `Online${status.state ? `, ${status.state}` : ''}${status.queuedJobs ? `, ${status.queuedJobs} job(s) waiting` : ''}.` });
}

// ---------- the Windows queue ----------

/** Try without admin rights first, because most of these work and need no prompt at all. */
async function setQueue(name: string, what: 'online' | 'resume'): Promise<{ done: boolean; declined?: boolean; error?: string }> {
  try {
    await doctor('set-queue', { name, what });
    return { done: true };
  } catch {
    const r = await elevated('set-queue', { name, what });
    return { done: !!r.ok, declined: r.declined, error: r.error };
  }
}

async function repairQueue(q: QueueHealth, clearAll: boolean, add: (f: Finding) => void): Promise<void> {
  const check = `Windows queue "${q.name}"`;
  const report = (r: { done: boolean; declined?: boolean; error?: string }, did: string) => add(r.done
    ? { check, status: 'fixed', detail: did }
    : { check, status: 'problem', detail: `Could not change it: ${r.error ?? 'refused'}.`, you_do: r.declined ? DECLINED : undefined });
  if (q.offline) report(await setQueue(q.name, 'online'), 'Was set to "Use Printer Offline"; turned that off.');
  if (/Paused/i.test(q.status)) report(await setQueue(q.name, 'resume'), 'Was paused; resumed it.');
  // A job in error blocks everything behind it. Out of paper is not stuck: it resumes once refilled.
  const stuck = clearAll ? q.jobs : q.jobs.filter(j => /Error|Deleting/i.test(j.status) && !/PaperOut/i.test(j.status));
  if (stuck.length) {
    const names = stuck.map(j => deviceText(j.document, 60)).join(', ');
    try {
      await doctor('remove-jobs', { name: q.name, ids: stuck.map(j => j.id) });
      add({ check, status: 'fixed', detail: `Removed ${stuck.length} stuck job(s): ${names}. Print them again if they are still needed.` });
    } catch {
      // A wedged spooler refuses removal, and clearing its folder is the only cure. It drops every queued job.
      if (clearAll) {
        const r = await elevated('clear-spool');
        report({ done: !!r.ok, declined: r.declined, error: r.error }, `Cleared the whole Windows print queue: ${names}.`);
      } else {
        add({ check, status: 'problem', detail: `Windows refused to remove stuck job(s): ${names}.`, you_do: 'Say so if every queued job may be dropped; fix_printer with clear_all_jobs clears the queue.' });
      }
    }
  } else if (q.jobs.length) {
    add({ check, status: 'ok', detail: `${q.jobs.length} job(s) waiting: ${[...new Set(q.jobs.map(j => j.status))].map(s => deviceText(s, 40)).join(', ')}.` });
  }
}

// ---------- drivers ----------

export interface DriverReport {
  state: 'done' | 'working' | 'needs_you';
  detail: string;
  queues_added?: string[];
  still_without_driver?: { name: string; hardware_ids: string[] }[];
  reboot_required?: boolean;
  you_do?: string;
}

const driverless = (h: Health) => h.usb.filter(u => u.errorCode !== 0);
const physicalQueues = (h: Health) => h.queues.filter(q => !q.virtual).map(q => q.name);

async function installFromFile(file: string): Promise<DriverReport> {
  assertLocalPathAllowed(file, {});
  const full = resolveLocalPath(file);
  const info = fs.statSync(full, { throwIfNoEntry: false });
  if (!info) throw new Error(`No such file or folder: ${full}`);
  const ext = path.extname(full).toLowerCase();
  if (info.isDirectory() || ext === '.inf') {
    const r = await elevated('add-inf', { path: full, folder: info.isDirectory() });
    if (r.declined) return { state: 'needs_you', detail: 'The driver was not installed.', you_do: DECLINED };
    if (!r.ok) return { state: 'needs_you', detail: `Windows refused the driver: ${r.error}. Output: ${deviceText(String(r.output ?? ''), 400)}`, you_do: 'The package may be unsigned or for another Windows version. Get the current one from the manufacturer.' };
    return { state: 'done', detail: `Driver package added. ${deviceText(String(r.output ?? ''), 400)}` };
  }
  if (ext !== '.exe' && ext !== '.msi') throw new Error('driver_file must be a .inf file, a folder holding one, or a .exe or .msi installer.');
  // An installer runs as admin, so a valid publisher signature is the minimum bar. The prompt then names that publisher.
  const sig = await doctor<{ status: string; signer: string }>('signature', { path: full });
  if (sig.status !== 'Valid') throw new Error(`Refusing to run ${path.basename(full)}: its digital signature is "${sig.status}". Download the driver from the printer manufacturer's own website.`);
  const r = await elevated('run-installer', { path: full });
  if (r.declined) return { state: 'needs_you', detail: 'The installer did not run.', you_do: DECLINED };
  if (!r.ok) return { state: 'needs_you', detail: `The installer failed: ${r.error}` };
  return { state: 'done', detail: `Ran the installer signed by ${deviceText(sig.signer, 120)} (exit code ${r.exitCode}).` };
}

async function installAuto(before: Health): Promise<DriverReport> {
  const missing = driverless(before);
  if (!missing.length) {
    return { state: 'done', detail: `No connected printer is missing a driver.${before.usb.length ? '' : ' No USB printer is connected; network printers need no driver here.'}` };
  }
  // Windows often only needs a nudge to match a driver it already has.
  const scan = await elevated('scan-devices');
  if (scan.declined) return { state: 'needs_you', detail: `${missing.map(m => m.name).join(', ')} has no driver.`, you_do: DECLINED };
  let now = await inspect();
  let reboot = false;
  if (driverless(now).length) {
    const wu = await elevated('wu-install', { hardwareIds: driverless(now).flatMap(u => u.hardwareIds) });
    if (wu.declined) return { state: 'needs_you', detail: 'Windows Update was not allowed to install the driver.', you_do: DECLINED };
    if (wu.error) console.error('print-mcp: Windows Update:', wu.error);
    reboot = !!wu.rebootRequired;
    now = await inspect();
  }
  const left = driverless(now);
  if (left.length) {
    return {
      state: 'needs_you', reboot_required: reboot || undefined,
      detail: `Windows has no driver for ${left.map(u => u.name).join(', ')}.`,
      still_without_driver: left.map(u => ({ name: u.name, hardware_ids: u.hardwareIds.slice(0, 4) })),
      you_do: 'Find the driver on the manufacturer\'s official website using the model name, download it, then call install_printer with driver_file. Never use third-party driver sites.',
    };
  }
  return { state: 'done', detail: 'The driver is installed.', reboot_required: reboot || undefined };
}

let driverRun: Promise<DriverReport> | null = null;
let unclaimedDriverResult: DriverReport | undefined;
const DRIVER_WAIT_MS = 45000;

/**
 * Windows Update can take many minutes and many clients give up on a tool call after a minute, so
 * a long run answers "working" and the next call picks up the same run instead of starting another.
 */
export async function installPrinter(args: { driver_file?: string }): Promise<DriverReport> {
  if (process.platform !== 'win32') {
    return { state: 'done', detail: 'Network printers need no driver on this system. USB printers are set up through CUPS, which print-mcp does not manage yet.' };
  }
  // A run that finished after its caller gave up hands over its result here rather than losing it.
  if (unclaimedDriverResult && !driverRun && !args.driver_file) {
    const r = unclaimedDriverResult;
    unclaimedDriverResult = undefined;
    return r;
  }
  driverRun ??= (async () => {
    const health = await inspect();
    if (!args.driver_file && !driverless(health).length) return installAuto(health);
    const before = physicalQueues(health);
    const report = args.driver_file ? await installFromFile(args.driver_file) : await installAuto(health);
    const added = physicalQueues(await inspect()).filter(n => !before.includes(n));
    if (added.length) {
      report.queues_added = added;
      await registry.refresh();
    }
    return report;
  })().catch((e): DriverReport => ({ state: 'needs_you', detail: (e as Error).message })).then(r => {
    unclaimedDriverResult = r;
    driverRun = null;
    return r;
  });
  let timer: NodeJS.Timeout | undefined;
  const waiting = new Promise<DriverReport>(resolve => {
    timer = setTimeout(() => resolve({ state: 'working', detail: 'Still installing; Windows Update can take several minutes. Call install_printer again shortly for the result.' }), DRIVER_WAIT_MS);
  });
  const result = await Promise.race([driverRun, waiting]);
  clearTimeout(timer);
  if (result.state !== 'working') unclaimedDriverResult = undefined;
  return result;
}

// ---------- the whole check ----------

export interface FixArgs { printer?: string; clear_all_jobs?: boolean }

export async function fixPrinter(args: FixArgs): Promise<{ ok: boolean; findings: Finding[]; printers_found: string[]; summary: string }> {
  const findings: Finding[] = [];
  const add = (f: Finding) => { findings.push({ ...f, detail: deviceText(f.detail, 500) }); };
  const clearAll = !!args.clear_all_jobs;
  await registry.whenReady();

  let health: Health | undefined;
  if (process.platform === 'win32') {
    health = await inspect();
    if (health.spooler !== 'Running') {
      let started = false;
      try { await doctor('start-spooler'); started = true; } catch {
        const r = await elevated('restart-spooler');
        started = !!r.ok;
        if (!started) add({ check: 'Windows print service', status: 'problem', detail: `It is ${health.spooler} and could not be started: ${r.error ?? 'refused'}.`, you_do: r.declined ? DECLINED : undefined });
      }
      if (started) {
        add({ check: 'Windows print service', status: 'fixed', detail: `It was ${health.spooler}; started it.` });
        health = await inspect();
      }
    } else if (health.queueError) {
      const r = await elevated('restart-spooler');
      add(r.ok
        ? { check: 'Windows print service', status: 'fixed', detail: `It was not responding (${health.queueError}); restarted it.` }
        : { check: 'Windows print service', status: 'problem', detail: `Not responding: ${health.queueError}.`, you_do: r.declined ? DECLINED : undefined });
      if (r.ok) health = await inspect();
    }
  }

  // A rescan costs seconds, so skip it when the cache already holds what this PC can see.
  const known = new Set(registry.visible().map(p => p.queue?.name));
  const newQueue = !args.printer && health?.queues.some(q => !q.virtual && !known.has(q.name));
  const list = () => (args.printer ? registry.findByQuery(args.printer) : registry.visible().filter(p => !p.virtual && (p.ipp || p.queue || p.raw?.verified)));
  let targets = list();
  let rescanned = false;
  const rescan = async () => { await registry.refresh(); rescanned = true; targets = list(); };
  if (!targets.length || newQueue) await rescan();
  if (!rescanned && targets.length && (await Promise.all(targets.map(p => registry.isOnline(p, 1500)))).some(up => !up)) await rescan();

  if (args.printer && !targets.length) add({ check: args.printer, status: 'problem', detail: `No printer matches "${args.printer}".` });

  for (const p of targets) {
    if (p.ipp) await checkNetworkPrinter(p, clearAll, add);
    else if (p.raw) {
      const up = await registry.isOnline(p, 2000);
      add(up ? { check: p.name, status: 'ok', detail: `Answering on port ${p.raw.port}.` } : { check: p.name, status: 'problem', detail: `Not answering at ${p.raw.host}:${p.raw.port}.`, you_do: 'Check the printer is on and connected.' });
    }
  }

  if (health) {
    const wanted = new Set(targets.map(p => p.queue?.name));
    const repairable = health.queues.filter(q => (args.printer ? wanted.has(q.name) : !q.virtual));
    for (const q of repairable) await repairQueue(q, clearAll, add);
    if (repairable.some(q => q.offline || /Paused/i.test(q.status))) await registry.refresh();

    for (const q of repairable) {
      // A USB queue exists whether or not the cable is in, so only its status can tell.
      if (/Offline|Error/i.test(q.status) && !q.host && /USB/i.test(q.port)) add({ check: `Windows queue "${q.name}"`, status: 'problem', detail: `Windows reports ${q.status}.`, you_do: 'Check the USB cable and that the printer is on.' });
    }

    const missing = driverless(health);
    if (health.protectedPrint && missing.length) add({ check: 'Windows Protected Print', status: 'problem', detail: 'This PC blocks third-party printer drivers.', you_do: 'Use a network printer, which needs no driver, or turn off Windows Protected Print in Settings > Bluetooth & devices > Printers & scanners.' });
    else if (missing.length) {
      const r = await installPrinter({});
      add({ check: `Driver for ${missing.map(m => m.name).join(', ')}`, status: r.state === 'done' ? 'fixed' : r.state === 'working' ? 'working' : 'problem', detail: r.detail, you_do: r.you_do });
      if (r.state === 'done') await registry.refresh();
    }
  }

  const physical = registry.visible().filter(p => !p.virtual && (p.ipp || p.queue || p.raw?.verified));
  if (!physical.length) {
    if (!lanInterfaces().length) {
      add({ check: 'Network', status: 'problem', detail: 'This PC is not connected to any network.', you_do: 'Connect to Wi-Fi or plug in the network cable, or connect the printer by USB.' });
    }
    let direct: string[] = [];
    if (process.platform === 'win32') direct = asArray((await doctor<{ networks?: string[] }>('wifi-direct', {}, 15000).catch(() => ({ networks: [] as string[] }))).networks);
    add({
      check: 'Printers', status: 'problem',
      detail: direct.length ? `No printer on this network, but a printer is broadcasting its own Wi-Fi: ${direct.map(d => deviceText(d, 40)).join(', ')}. It has not joined your network yet.` : 'No printer found on USB or this network.',
      you_do: direct.length
        ? 'On the printer\'s panel, open Network > Wi-Fi setup and choose your network, or press WPS on the printer and then on the router within 2 minutes.'
        : 'Turn the printer on and wait a minute. For USB, plug in the cable. For Wi-Fi, join it to this network with its panel or WPS button. If its IP is known, add it with configure_printer.',
    });
  }

  const problems = findings.filter(f => f.status === 'problem');
  const fixed = findings.filter(f => f.status === 'fixed');
  const working = findings.some(f => f.status === 'working');
  const summary = problems.length ? `${problems.length} problem(s) left${fixed.length ? `, ${fixed.length} fixed` : ''}. Relay each you_do to the user.`
    : working ? 'Still working; call install_printer for the result.'
    : fixed.length ? `Fixed ${fixed.length} problem(s). Ready to print.` : 'Nothing is wrong. Ready to print.';
  return { ok: !problems.length && !working, findings, printers_found: physical.map(p => p.name), summary };
}
