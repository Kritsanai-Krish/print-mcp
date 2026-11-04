import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SCRIPTS_DIR, powerShellEnv, runPowerShell } from '../discovery.js';
import { explainReason } from '../doctor.js';

test('printer reasons become plain instructions, and severity follows the suffix', () => {
  assert.match(explainReason('media-empty-error')!.you_do, /Load paper/);
  assert.equal(explainReason('media-empty-error')!.severe, true);
  assert.match(explainReason('media-jam')!.you_do, /jammed/);
  assert.match(explainReason('cover-open-error')!.you_do, /cover/);
  assert.match(explainReason('marker-supply-empty-error')!.you_do, /ink or toner/);
  assert.equal(explainReason('media-low-warning')!.severe, false);
  assert.equal(explainReason('toner-low-warning')!.severe, false);
  assert.equal(explainReason('none'), undefined);
  assert.equal(explainReason('cups-waiting-for-job-completed-report'), undefined);
  // Nothing is assumed about a reason we have never seen, beyond its own suffix.
  assert.equal(explainReason('vendor-thing-warning')!.severe, false);
  assert.equal(explainReason('vendor-thing-error')!.severe, true);
  assert.match(explainReason('vendor-thing-error')!.you_do, /vendor-thing-error/);
});

test('every script is pure ASCII, because Windows PowerShell misreads UTF-8 without a BOM', () => {
  for (const name of fs.readdirSync(SCRIPTS_DIR)) {
    const bytes = fs.readFileSync(path.join(SCRIPTS_DIR, name));
    assert.ok(bytes.every(b => b < 128), `${name} has a non-ASCII byte`);
  }
});

test('Windows PowerShell never inherits a module path from PowerShell 7', () => {
  const saved = process.env.PSModulePath;
  process.env.PSModulePath = 'C:\\Program Files\\PowerShell\\7\\Modules';
  try {
    assert.ok(!Object.keys(powerShellEnv()).some(k => k.toLowerCase() === 'psmodulepath'));
  } finally {
    if (saved === undefined) delete process.env.PSModulePath;
    else process.env.PSModulePath = saved;
  }
});

test('the health check reads this PC without changing anything', { skip: process.platform !== 'win32' }, async () => {
  const out = await runPowerShell(path.join(SCRIPTS_DIR, 'doctor.ps1'), JSON.stringify({ action: 'inspect' }), 60000);
  const h = JSON.parse(out);
  assert.equal(typeof h.spooler, 'string');
  assert.equal(typeof h.protectedPrint, 'boolean');
  assert.ok(h.queues !== undefined, out);
});

test('the doctor script rejects unknown actions, and the elevated one has no way to run arbitrary commands', { skip: process.platform !== 'win32' }, async () => {
  await assert.rejects(runPowerShell(path.join(SCRIPTS_DIR, 'doctor.ps1'), JSON.stringify({ action: 'run', command: 'calc' }), 30000), /Unknown action/);
  const elevated = fs.readFileSync(path.join(SCRIPTS_DIR, 'elevated.ps1'), 'utf8');
  assert.doesNotMatch(elevated, /Invoke-Expression|\biex\b|\[scriptblock\]/i);
});
