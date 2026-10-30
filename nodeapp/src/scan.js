"use strict";
// Optional malware scan of uploads through ClamAV's daemon (clamd, INSTREAM protocol). Off unless SCAN_CLAMD_HOST is set.
// Fail-closed by default: when a scanner is configured but cannot be reached or gives an unclear answer, the upload is refused
// (SCAN_FAIL_OPEN=1 accepts it instead and logs a warning). The file is scanned before it is written to disk.
const net = require("net");
const config = require("./config");

class ScanError extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } }

function scanBuffer(buf, { host = config.scan.host, port = config.scan.port, timeoutMs = config.scan.timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    let reply = "", done = false;
    const sock = net.connect({ host, port });
    const finish = (fn, v) => { if (done) return; done = true; sock.destroy(); fn(v); };
    sock.setTimeout(timeoutMs, () => finish(reject, new Error("scanner timed out")));
    sock.on("error", (e) => finish(reject, e));
    sock.on("data", (d) => { reply += d.toString("latin1"); });
    sock.on("end", () => {
      const r = reply.replace(/\0/g, "").trim();
      if (/\bOK$/.test(r)) return finish(resolve, { clean: true });
      const m = /^stream:\s*(.+?)\s+FOUND$/.exec(r);
      if (m) return finish(resolve, { clean: false, signature: m[1] });
      finish(reject, new Error(`unexpected scanner reply: ${r.slice(0, 80) || "(empty)"}`));
    });
    sock.on("connect", () => {
      sock.write("zINSTREAM\0");
      for (let i = 0; i < buf.length; i += 65536) {
        const chunk = buf.subarray(i, i + 65536), len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length); sock.write(len); sock.write(chunk);
      }
      sock.write(Buffer.alloc(4));
    });
  });
}

/** Resolves when the file may be stored. Throws ScanError (422 infected, 503 scanner unavailable and fail-closed). */
async function check(buf, opts) {
  if (!config.scan.host && !(opts && opts.host)) return { scanned: false };
  try {
    const r = await scanBuffer(buf, opts);
    if (!r.clean) throw new ScanError("That file was blocked because it appears to contain malware.", 422, "MALWARE");
    return { scanned: true };
  } catch (e) {
    if (e instanceof ScanError) throw e;
    if (config.scan.failOpen) { console.warn(`[scan] scanner unavailable, accepting upload: ${e.message}`); return { scanned: false }; }
    console.error(`[scan] scanner unavailable, refusing upload: ${e.message}`);
    throw new ScanError("Files cannot be checked for malware right now, so the upload was refused. Try again shortly.", 503, "SCANNER_DOWN");
  }
}
module.exports = { check, scanBuffer, ScanError };
