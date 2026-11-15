<div align="center">

# 🖨️ print-mcp

### Tell your AI "print this" — and it prints.

Plug the printer in. The AI handles the rest: finding it, drivers, stuck queues and errors.

[![CI](https://github.com/Kritsanai-Krish/print-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Kritsanai-Krish/print-mcp/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Kritsanai-Krish/print-mcp?style=flat-square&color=e34b2a)](https://github.com/Kritsanai-Krish/print-mcp/releases/latest)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL_v3-2f5f9e?style=flat-square)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A520.11-3c873a?style=flat-square)
![MCP](https://img.shields.io/badge/MCP-server-6b5bd6?style=flat-square)
![Platforms](https://img.shields.io/badge/Windows%20·%20macOS%20·%20Linux-555?style=flat-square)

[Install](#-install) · [Use it](#-use-it) · [Tools](#-tools) · [Print Studio](#-print-studio-web-app) · [Troubleshooting](#-when-something-goes-wrong) · [Platforms](#-platforms) · [Develop](#-develop)

</div>

---

An [MCP](https://modelcontextprotocol.io) server that **finds every printer on your LAN**, remembers them, and **prints PDFs, Office files, images, web pages and plain text in one tool call**, with exact control over borders, color, darkness and quality. When something goes wrong, one more call diagnoses it and repairs what software can repair.

<table>
<tr>
<td width="33%" valign="top">

**🔎 Finds printers itself**<br>
mDNS, a LAN sweep and the Windows spooler. Network printers need no driver. A changed IP is healed automatically.

</td>
<td width="33%" valign="top">

**📄 Prints anything**<br>
PDF, Word, Excel, PowerPoint, images, HEIC, HTML, Markdown, URLs, Thai text in UTF-8 or TIS-620, and more.

</td>
<td width="33%" valign="top">

**🩺 Fixes what breaks**<br>
Stopped print service, paused queues, stuck jobs, missing drivers. You're told exactly what needs a human.

</td>
</tr>
<tr>
<td valign="top">

**🎚️ Exact control**<br>
Margins per side, n-up, frames, darkness, gamma, ink saver, watermark, duplex and 40+ more settings.

</td>
<td valign="top">

**📷 Scans too**<br>
eSCL (AirScan, Mopria) and Windows WIA scanners, to PDF or JPEG. The AI sees the first page.

</td>
<td valign="top">

**🎨 Print Studio**<br>
A local Canva-style editor with live preview. Watch the AI's cursor do the work on the real controls.

</td>
</tr>
</table>

---

## ⚡ Install

You need [Node.js](https://nodejs.org) 20.11 or newer. Then, in any terminal:

```bash
npm install -g https://github.com/Kritsanai-Krish/print-mcp/releases/latest/download/print-mcp.tgz
print-mcp setup
```

`setup` adds the server to **every AI client it finds** (Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, Gemini CLI, Codex) and scans for printers, so the first print starts instantly. Each config file it changes is backed up first. A file it cannot parse is left alone and reported.

**Restart your AI client and you're done.**

| | Command |
| --- | --- |
| Update | Run both install commands again |
| Remove | `print-mcp uninstall`, then `npm uninstall -g print-mcp` |
| Another client | Point it at `print-mcp serve` over stdio |

---

## 💬 Use it

Just say it, in any language:

> 🗨️ *Print report.pdf*
>
> 🗨️ *Print pages 1-3 of report.docx, 2 copies, black and white, with a 1 mm border*
>
> 🗨️ *Print this page 2-up, darker, with a "DRAFT" watermark: https://example.com/spec*
>
> 🗨️ *Is the printer out of paper or ink?*
>
> 🗨️ *Cancel that print*
>
> 🗨️ *I put a page on the scanner, scan it and tell me what it says*

**Which printer?** If you have one printer, or only one is on, it is used without asking. Otherwise the choice falls to your saved default, then the Windows default, then the most recently used. The AI only asks when the choice is truly open.

---

## 🧰 Tools

<table>
<tr><th>Group</th><th>Tool</th><th>Purpose</th></tr>

<tr><td rowspan="5"><b>🖨️ Print</b></td>
<td><code>print</code></td><td>Print a file, URL or text. One call, every setting optional</td></tr>
<tr><td><code>preview</code></td><td>Same settings, returns page images, uses no paper</td></tr>
<tr><td><code>job_status</code> · <code>cancel_job</code></td><td>Follow or stop a job. A waiting job shows <code>printer_problems</code> when the printer is stuck</td></tr>
<tr><td><code>print_raw</code></td><td>Send ZPL, ESC/POS, PCL or PostScript untouched</td></tr>
<tr><td><code>print_test_page</code></td><td>Calibration sheet: rulers, line weights, color ramps, Thai text</td></tr>

<tr><td rowspan="5"><b>🔌 Printers</b></td>
<td><code>list_printers</code></td><td>Everything known, from cache. <code>refresh</code> rescans</td></tr>
<tr><td><code>printer_status</code></td><td>Live state, ink, paper, scanner state, jobs, all capabilities, and <code>problems</code> in plain words with what to do (out of paper, ink empty, jam, cover open)</td></tr>
<tr><td><code>configure_printer</code></td><td>Default printer, aliases, saved defaults, add by IP, hide</td></tr>
<tr><td><code>manage_presets</code></td><td>Named groups of settings</td></tr>
<tr><td><code>identify_printer</code></td><td>Make a printer beep to find it</td></tr>

<tr><td rowspan="2"><b>🩺 Repair</b></td>
<td><code>fix_printer</code></td><td>Diagnose and repair: print service, offline or paused queues, stuck jobs, missing drivers, paper and ink errors, printers not found</td></tr>
<tr><td><code>install_printer</code></td><td>Install a USB printer's driver through Windows, Windows Update or a file from the manufacturer</td></tr>

<tr><td><b>📷 Scan</b></td>
<td><code>scan</code></td><td>Scan from the glass or feeder to PDF or JPEG (default <code>Documents\Scans</code>) and show the AI the first page. Network scanners over eSCL (AirScan, Mopria), USB scanners through Windows WIA</td></tr>

<tr><td rowspan="3"><b>🖼️ Images &amp; layout</b></td>
<td><code>image_edit</code></td><td>Image pipeline: trim, split, deskew, remove background, crop, resize, upscale, denoise, enhance scans, round, pad</td></tr>
<tr><td><code>layout_page</code></td><td>Place images, text and shapes on a page in mm (centred, repeated in a grid), preview, then print</td></tr>
<tr><td><code>manage_templates</code></td><td>Saved page layouts shared with the web editor (list, get, save, rename, delete, duplicate)</td></tr>

<tr><td><b>📜 Scripts</b></td>
<td><code>tool_list</code> · <code>tool_use</code> · <code>tool_write</code> · <code>tool_edit</code> · <code>tool_remove</code></td><td>Small saved JavaScript tools for jobs no built-in tool covers (<a href="#-scripts">details</a>)</td></tr>
</table>

<details>
<summary><b>📥 Sources it reads</b></summary>
<br>

PDF, JPEG, PNG, WebP, TIFF, GIF, HEIC, Word, Excel, PowerPoint, RTF, HTML, Markdown, CSV, text and code (UTF-8, UTF-16, TIS-620), XPS, EPUB, URLs, `data:` URIs.

</details>

<details>
<summary><b>🎚️ Every print setting</b></summary>
<br>

paper, type, tray, pages, odd/even, reverse, copies, collate, duplex, orientation, rotate, scale mode, exact zoom, margins per side, borderless, alignment, n-up, frame thickness/color/style/gap, cell frames, color mode, quality, dpi, darkness, brightness, contrast, saturation, gamma, sharpen, ink saver, black-and-white threshold, invert, mirror, watermark, header, footer, fonts, line height, line numbers, CSS.

</details>

<details>
<summary><b>🖼️ Images and page layout in detail</b></summary>
<br>

`image_edit` takes `source` (a path or `data:` URI) and `ops`, a list applied in order, for example `[{"op":"trim"},{"op":"remove_background"}]`.

- **Ops:** `trim`, `split` (last op, one file per object), `deskew`, `remove_background`, `crop`, `rotate`, `flip`, `resize`, `denoise`, `sharpen`, `upscale`, `enhance_document`, `adjust`, `grayscale`, `invert`, `threshold`, `round`, `border`, `pad`.
- **Output:** results go to `<state dir>/images/` (files older than 7 days are removed there) or to `output_file` / `output_dir`, and come back as `{files, ops_applied, notes, hint}`.
- **Background removal:** the `color` method (flood fill from the edges) is always available. The `ai` method needs the optional package `@imgly/background-removal-node` (about 300 MB with its model runtime, so it is not installed by default).
- Images over 40 megapixels are refused with a fix.

`layout_page` builds one page from `items` (`image`, `text`, `shape`, `copies`) in millimetres and returns a preview; add `print: true` to print it, `save_as` to keep a `.png` or `.pdf`.

> **Example:** an ID card copied 2 × 4 on A4 is an `image` item plus `{"type":"copies","of":0,"rows":4,"cols":2,"gap_mm":3}`.

</details>

---

## 🎨 Print Studio (web app)

```bash
npm run build && npm run web     # → http://localhost:4177
```

Or just **double-click `start.bat`** (Windows) or run **`./start.sh`** (macOS/Linux): it installs, builds if needed, starts the server and opens the browser in its own app window (Edge or Chrome). If it is already running, it just opens a window on it. `autostart.bat` starts it at sign-in; `autostart-remove.bat` undoes that.

Print files or typed text with a live preview, scan and centre the page on paper, check ink and jobs, manage presets. It is an MCP client of this same server, so it does everything the tools do. It listens on localhost only; set `HOST` and `PORT` to change that.

### ✏️ A Canva-style editor, paper first

One page where imported files, scans and typed text are all elements on the paper (Fabric.js 7, MIT, bundled in `web/public/vendor`), printed at 300 dpi.

| | |
| --- | --- |
| 📏 **Precision** | Rulers in mm / cm / inch with draggable guides, snapping (hold **Ctrl** to turn it off), rotation snaps to 0°, 45°, 90° (**Shift** for 15° steps) |
| 🔤 **Content** | Text with 25 bundled fonts (Thai and Latin), shapes, icons, emoji, QR, barcodes, tables, free drawing |
| 🖼️ **Images** | Filters, plus server-side clean-up: trim, split scans, remove background, denoise, upscale |
| 💾 **Reuse** | Your own templates, saved through `manage_templates` so an AI sees them too |
| 📤 **Export** | PDF, PNG, JPG, SVG |
| ⌨️ **Speed** | Right-click menu, command palette (**Ctrl+K**), shortcut sheet (**?**) |

**WYSIWYG printing:** pages are exported at 300 dpi with the true resolution stamped in, and printed at 100% edge to edge, so a 10 cm square prints 10 cm. The print sheet has a calibration percentage for printers that run slightly large or small.

### 🤖 Watch the AI work

While a page is open, every MCP tool call is shown on it: a **vermilion cursor labelled "Claude"** moves over the real controls, opens the real popups and sets the real fields, then the tool runs.

- Press **Esc** in the page to skip the animation.
- In Settings choose how much you see: **full** (cursor, popups, screen locked), **semi** (works in the background, you keep editing, small status bar) or **off**.
- The MCP server reaches the page at `http://127.0.0.1:4177` (change with `PRINT_WEB_URL`); with no page open there is no delay. `PRINT_MCP_THEATER=off` disables it.

### 📜 Scripts

When no tool does the job, the AI or you can write a small JavaScript script. It is saved as a plain file in the `tools` folder next to `config.json` (Windows: `%LOCALAPPDATA%\print-mcp\tools`), so it is still there tomorrow and runs again with `tool_use`, until you delete it. In Print Studio the **สคริปต์** button lists, writes, runs, edits and deletes them; the AI uses the same five tools.

A script body is an async function with `args`, `call(toolName, args)`, `readFile(path)`, `writeFile(name, data)`, `sharp(buffer)`, `log()` and `toolList / toolUse / toolWrite / toolEdit / toolRemove`. Whatever it returns comes back as JSON; files it writes are listed and can be placed on the page.

> [!NOTE]
> Scripts run in a separate Node process under Node's permission model: no file access of their own (reads and writes go through print-mcp, which only allows files named in `args`, files tools returned and the script's own output folder), no child processes, no `fetch`, a 60 s time limit. It is a guard rail for scripts you can read, not a hard security boundary: a script can still call any print-mcp tool, including `print`, with the same power the AI has.

---

## 🩺 When something goes wrong

Just tell the AI. `fix_printer` checks everything and answers with what it fixed and what only you can do.

| Trouble | What happens |
|---|---|
| 📶 Network or Wi-Fi printer plugged in | Found automatically. It needs no driver |
| 🔌 USB printer plugged in, no driver | Tries Windows, then Windows Update. If neither has it, the AI gets the model name to find the manufacturer's driver, then installs that file |
| 🔀 IP address changed | Found again by its UUID |
| ⏹️ Windows print service stopped or hung | Restarted |
| ⏸️ Queue offline or paused | Switched back on |
| 🧾 Job stuck in error | Removed, and you're told which |
| 📄 Out of paper, jam, cover open, no ink | Tells you exactly what to do. It can't load paper for you |
| 📡 Wi-Fi printer that never joined your network | Spots its `DIRECT-` network and gives you the setup steps |

Repairs that need admin rights raise the Windows permission prompt, so you stay in charge. Set `"allowElevation": false` in `config.json` to turn them off.

---

## 💻 Platforms

| | Windows | macOS, Linux |
|---|:---:|:---:|
| Network printers (IPP, AirPrint, Mopria, port 9100) | ✅ | ✅ |
| USB and driver-only printers | ✅ through the Windows queue | ⏳ not yet |
| Driver install, queue and print service repair | ✅ | ⏳ not yet · printer status checks work |
| Word, Excel, PowerPoint input | ✅ needs Microsoft Office | ❌ |
| Text, Markdown, HTML, URL input | ✅ needs Chrome, Edge, Brave or Chromium | ✅ same |

Real-hardware testing so far is one printer on Windows, a Brother DCP-T520W over Wi-Fi. macOS and Linux run the test suite in CI against a mock printer. **Reports from other printers are welcome.**

---

## ⚙️ Under the hood

### How it stays instant

- **Stale-while-revalidate discovery.** `printers.json` answers at once. mDNS, a /24 TCP sweep and the Windows spooler refresh it in the background.
- **Identity is the UUID, not the IP.** A DHCP change is healed by a rescan the moment the old address stops answering. Windows WSD ports store the same UUID as IPP `printer-uuid`, so the queue and the device merge exactly, never by guessing from names.
- **Pages stream while they render.** `print` returns once page 1 is on its way. Rendering is lazy, so memory stays near one page even at 600 dpi.

### Why it renders its own pixels

Printers offer very few job attributes, and none for ink density or a printed frame. Working on the page raster makes those settings behave the same on every printer.

```mermaid
flowchart LR
    J([print job]) --> Q{What does the<br/>printer speak?}
    Q -->|IPP| P{Takes PDF and no<br/>pixel edits asked?}
    P -->|yes| PDF[PDF, untouched]
    P -->|no| R[URF or PWG Raster,<br/>whichever it prefers]
    R -.->|fallback| F[image PDF → PCL → JPEG]
    Q -->|no IPP, has a<br/>Windows queue| W[render, then draw<br/>through the driver]
    Q -->|only port 9100| PCL[PCL mono raster]
```

Pages with no color are sent as gray automatically, so black text uses no color ink.

<details>
<summary><b>🛡️ Safety rules built in</b></summary>
<br>

- A missing path is an error, never printed as literal text. Error pages (HTTP 4xx/5xx) are never printed.
- The same document on the same printer within 20 s is treated as an accidental retry.
- More than 50 sheets needs `confirm_large`.
- Once data has been sent, a job is never retried automatically, because that could print twice.
- Macros stay off for Office files. Only the Office process this tool started is ever closed.
- Printing through a Windows queue restores the default printer afterwards.
- Plain IPP is refused beyond private addresses. IPPS uses trust-on-first-use certificate pinning.
- Inline HTML runs with no scripts and no network unless asked.
- URLs on private addresses and `\\server\share` paths need `allow_private_network`. Every redirect hop and browser request is checked.
- Markdown reads only pictures from its own folder; an HTML file reads only its own folder. No other local file can end up on paper.
- `output_file` only works on virtual queues, needs a document extension and never overwrites.
- Text from printers is cut short and stripped before it reaches the AI.
- Driver installers must carry a valid digital signature, checked again just before they run. Admin repairs are a fixed list of actions in `scripts/elevated.ps1`, and each one needs your yes at the Windows prompt.
- Queued jobs are only removed when they are in error, never ones merely waiting for paper. Dropping everything needs `clear_all_jobs`.

The server only talks over stdio; it opens no listening port. Please report security problems through [a private advisory](https://github.com/Kritsanai-Krish/print-mcp/security/advisories/new).

</details>

<details>
<summary><b>🚧 Known limits</b></summary>
<br>

- A subresource that redirects to an internal address, and DNS rebinding, can get past the browser's address check. The fetch path checks each hop, but Playwright routing does not see browser-followed redirects.
- Word can still fetch a remote template named inside a `.docx` when it opens the file.
- Duplex, PCL and TLS paths are covered by the mock printer only; they have not run on real hardware.
- Printers that need IPP login, or accept only PCLm or PostScript, must go through their Windows driver queue.
- Paper, jams, ink and first-time Wi-Fi setup need a person. No software can do these.
- Network scanning uses eSCL over plain HTTP on port 80; scanners that offer eSCL only over HTTPS fall back to Windows WIA. WIA scans one page per call, also from a feeder.
- A signature proves who published an installer, not that it is safe. Windows Protected Print blocks third-party drivers altogether.
- A Windows queue with a TCP port pointing at an old IP is reported through its status but not re-pointed. Printing still works directly over the network.

</details>

---

## 🔧 Develop

```bash
git clone https://github.com/Kritsanai-Krish/print-mcp.git
cd print-mcp
npm install
npm test            # server: mock IPP printer + Microsoft Print to PDF, no paper
npm run test:ui     # Print Studio: drives Edge or Chrome with playwright-core, no paper
```

`node dist/cli.js setup` registers your local build. After changing code, run `npm run build`, because clients run `dist/index.js`. The UI tests start the web server on a random port.

<details>
<summary><b>🗺️ Code map</b></summary>
<br>

| Path | What it does |
| --- | --- |
| `src/ipp.ts` | IPP client and bounds-checked decoder |
| `src/raster.ts` | URF, PWG and PCL encoders |
| `src/discovery.ts`, `src/registry.ts` | Finding printers, merging, choosing one |
| `src/options.ts` | Settings schema, fitting a request to a printer |
| `src/sources.ts` | Any input to a paged document |
| `src/render.ts` | Layout, tone, frames, overlays |
| `src/jobs.ts` | Routes, queueing, status |
| `src/doctor.ts` | Diagnosis, repairs, driver install |
| `src/cli.ts` | Installer |
| `scripts/*.ps1` | Windows queue listing, driver printing, Office conversion, repairs |

</details>

**State** lives in `%LOCALAPPDATA%\print-mcp` on Windows and `~/.local/share/print-mcp` elsewhere. `PRINT_MCP_HOME` overrides it.

**Release:** bump `version` in `package.json` and push a matching tag such as `v1.0.1`. The workflow tests it and publishes the package the install command downloads.

---

## 📜 License

[AGPL-3.0-or-later](LICENSE), because the PDF engine, MuPDF, is AGPL. **Using this tool yourself brings no obligations.** If you distribute a modified version or offer it as a network service, you must share your source under the same license.

<div align="center">
<br>

Made by [Kritsanai-Krish](https://github.com/Kritsanai-Krish) · ⭐ Star the repo if it saved you a trip to the printer

</div>
