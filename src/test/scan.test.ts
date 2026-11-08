import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { esclScan, parseScannerStatus } from '../scan.js';
import { loadSharp } from '../render.js';

const input = (name: string) => `<scan:${name}><scan:${name}InputCaps><scan:MaxWidth>2550</scan:MaxWidth><scan:MaxHeight>3507</scan:MaxHeight>
<scan:ColorMode>RGB24</scan:ColorMode><scan:ColorMode>Grayscale8</scan:ColorMode><pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
<scan:XResolution>150</scan:XResolution><scan:XResolution>300</scan:XResolution></scan:${name}InputCaps></scan:${name}>`;

/** A fake eSCL scanner that hands out `pages` pages per job. */
async function fakeScanner(o: { adf?: string; pages: number; busyOnce?: boolean; location?: string }) {
  const page = await (await loadSharp())({ create: { width: 300, height: 400, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  const log: string[] = [];
  let left = 0, busy = o.busyOnce;
  const server = http.createServer((req, res) => {
    log.push(`${req.method} ${req.url}`);
    let body = '';
    req.on('data', d => { body += d; }).on('end', () => {
      if (req.url === '/eSCL/ScannerCapabilities') return res.end(`<scan:ScannerCapabilities><pwg:Version>2.6</pwg:Version>${input('Platen')}${o.adf ? input('Adf') : ''}</scan:ScannerCapabilities>`);
      if (req.url === '/eSCL/ScannerStatus') return res.end(`<scan:ScannerStatus><pwg:State>Idle</pwg:State>${o.adf ? `<scan:AdfState>${o.adf}</scan:AdfState>` : ''}</scan:ScannerStatus>`);
      if (req.method === 'POST') {
        if (busy) { busy = false; res.statusCode = 503; return res.end(); }
        assert.doesNotMatch(body, /\n/);
        assert.match(body, /<pwg:Width>2550<\/pwg:Width>/);
        left = o.pages;
        res.writeHead(201, { Location: o.location ?? '/eSCL/ScanJobs/42' });
        return res.end();
      }
      if (req.url === '/eSCL/ScanJobs/42/NextDocument' && left > 0) { left--; res.setHeader('Content-Type', 'image/jpeg'); return res.end(page); }
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/eSCL`, log, close: () => server.close() };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'scan-test-'));

test('scan from the glass: retries a busy scanner, closes the job, saves a PDF', async () => {
  const s = await fakeScanner({ pages: 1, busyOnce: true });
  try {
    const out = path.join(tmp(), 'doc.pdf');
    const r = await esclScan(s.base, 'Fake', { dpi: 225, output_file: out });
    assert.equal(r.source, 'glass');
    assert.equal(r.dpi, 300, 'tie between 150 and 300 goes to the sharper one');
    assert.deepEqual(r.files, [out]);
    assert.equal(fs.readFileSync(out).subarray(0, 5).toString(), '%PDF-');
    assert.equal(s.log.filter(l => l.endsWith('/NextDocument')).length, 2, 'asks once more so the device ends the job');
  } finally { s.close(); }
});

test('scan from a loaded feeder: every page, numbered files', async () => {
  const s = await fakeScanner({ pages: 3, adf: 'ScannerAdfLoaded' });
  try {
    const dir = tmp();
    const r = await esclScan(s.base, 'Fake', { format: 'jpeg', color: 'gray', output_file: path.join(dir, 'a.jpg') });
    assert.equal(r.source, 'feeder');
    assert.equal(r.color, 'Grayscale8');
    assert.deepEqual(r.files, ['a.jpg', 'a-2.jpg', 'a-3.jpg'].map(f => path.join(dir, f)));
  } finally { s.close(); }
});

test('scan refuses an empty feeder, a foreign job URL and an existing file', async () => {
  const empty = await fakeScanner({ pages: 0, adf: 'ScannerAdfEmpty' });
  try {
    await assert.rejects(esclScan(empty.base, 'Fake', { source: 'feeder', output_file: path.join(tmp(), 'a.pdf') }), /feeder: empty/);
  } finally { empty.close(); }
  const evil = await fakeScanner({ pages: 1, location: 'http://example.com/eSCL/ScanJobs/42' });
  try {
    await assert.rejects(esclScan(evil.base, 'Fake', { output_file: path.join(tmp(), 'a.pdf') }), /another host/);
  } finally { evil.close(); }
  const s = await fakeScanner({ pages: 1 });
  try {
    const out = path.join(tmp(), 'taken.jpg');
    fs.writeFileSync(out, 'keep me');
    await assert.rejects(esclScan(s.base, 'Fake', { format: 'jpeg', output_file: out }), /already exists/);
    assert.equal(fs.readFileSync(out, 'utf8'), 'keep me');
  } finally { s.close(); }
});

test('scanner status in plain words', () => {
  assert.deepEqual(parseScannerStatus('<pwg:State>Idle</pwg:State><scan:AdfState>ScannerAdfLoaded</scan:AdfState>'), { state: 'idle', adf: 'loaded' });
  assert.match(parseScannerStatus('<pwg:State>Idle</pwg:State><scan:AdfState>ScannerAdfHatchOpen</scan:AdfState>').problem!, /hatch open/);
  assert.match(parseScannerStatus('<pwg:State>Down</pwg:State>').problem!, /down/);
  assert.equal(parseScannerStatus('<pwg:JobState>Processing</pwg:JobState><pwg:State>Idle</pwg:State>').state, 'idle');
});
