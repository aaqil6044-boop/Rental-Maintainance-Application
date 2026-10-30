"use strict";
// A small YAML reader for configuration files (no dependency). It supports what the performance configs need:
//   key: value        nested mappings by indentation        lists ("- item", "- key: value")
//   [a, b] and {a: 1, b: 2} inline collections              "quoted" and 'quoted' strings
//   numbers, true/false, null/~                              # comments
// It deliberately rejects anything else (anchors, multi-line strings, tabs) with a line number, so a typo is an error, not a surprise.
class YamlError extends Error { constructor(line, msg) { super(`Line ${line}: ${msg}`); this.line = line; } }

function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === "#" && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
}
function scalar(t, ln) {
  t = t.trim();
  if (t === "" || t === "~" || /^null$/i.test(t)) return null;
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if ((t[0] === '"' && t.endsWith('"') && t.length > 1)) { try { return JSON.parse(t); } catch (e) { throw new YamlError(ln, `bad quoted string ${t}`); } }
  if (t[0] === "'" && t.endsWith("'") && t.length > 1) return t.slice(1, -1).replace(/''/g, "'");
  if (/^[&*!|>]/.test(t)) throw new YamlError(ln, `unsupported YAML syntax "${t[0]}"`);
  return t;
}
function splitTop(s, ln) {
  const out = []; let depth = 0, q = null, cur = "";
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === "[" || c === "{") depth++; if (c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) { out.push(cur); cur = ""; } else cur += c;
  }
  if (q || depth !== 0) throw new YamlError(ln, "unbalanced brackets or quotes");
  if (cur.trim() !== "") out.push(cur);
  return out;
}
function inline(t, ln) {
  t = t.trim();
  if (t[0] === "[") { if (!t.endsWith("]")) throw new YamlError(ln, "missing ]"); return splitTop(t.slice(1, -1), ln).map((x) => inline(x, ln)); }
  if (t[0] === "{") {
    if (!t.endsWith("}")) throw new YamlError(ln, "missing }");
    const o = {}; for (const part of splitTop(t.slice(1, -1), ln)) { const i = part.indexOf(":"); if (i < 0) throw new YamlError(ln, `expected "key: value" in ${part.trim()}`); o[part.slice(0, i).trim()] = inline(part.slice(i + 1), ln); } return o;
  }
  return scalar(t, ln);
}

function parse(text) {
  const lines = [];
  String(text).replace(/^﻿/, "").split(/\r?\n/).forEach((raw, i) => {
    if (/^\s*\t/.test(raw)) throw new YamlError(i + 1, "tabs are not allowed for indentation");
    const body = stripComment(raw).replace(/\s+$/, ""); if (!body.trim()) return;
    if (/^---\s*$/.test(body.trim())) return;
    lines.push({ indent: body.length - body.trimStart().length, text: body.trim(), ln: i + 1 });
  });
  let pos = 0;
  function block(indent) {
    if (pos >= lines.length) return null;
    return lines[pos].text.startsWith("- ") || lines[pos].text === "-" ? list(indent) : map(indent);
  }
  function map(indent) {
    const o = {};
    while (pos < lines.length && lines[pos].indent === indent && !lines[pos].text.startsWith("- ")) {
      const { text, ln } = lines[pos]; const m = /^("[^"]*"|'[^']*'|[^:]+?):(?:\s+(.*))?$/.exec(text);
      if (!m) throw new YamlError(ln, `expected "key: value", got "${text}"`);
      const key = m[1].replace(/^["']|["']$/g, ""); if (Object.prototype.hasOwnProperty.call(o, key)) throw new YamlError(ln, `duplicate key "${key}"`);
      if (key === "__proto__" || key === "constructor" || key === "prototype") throw new YamlError(ln, `key "${key}" is not allowed`);
      pos++;
      if (m[2] !== undefined && m[2] !== "") o[key] = inline(m[2], ln);
      else if (pos < lines.length && lines[pos].indent > indent) o[key] = block(lines[pos].indent);
      else if (pos < lines.length && lines[pos].indent === indent && lines[pos].text.startsWith("- ")) o[key] = list(indent);
      else o[key] = null;
    }
    if (pos < lines.length && lines[pos].indent > indent) throw new YamlError(lines[pos].ln, "unexpected indentation");
    return o;
  }
  function list(indent) {
    const a = [];
    while (pos < lines.length && lines[pos].indent === indent && (lines[pos].text.startsWith("- ") || lines[pos].text === "-")) {
      const { text, ln } = lines[pos]; const rest = text === "-" ? "" : text.slice(2).trim();
      if (rest === "") { pos++; a.push(pos < lines.length && lines[pos].indent > indent ? block(lines[pos].indent) : null); continue; }
      if (/^("[^"]*"|'[^']*'|[^:\[\{]+?):(\s|$)/.test(rest) && !/^["'\[{]/.test(rest.slice(0, 1) === "\"" ? rest : "x")) {
        // "- key: value" starts a mapping whose further keys are indented to the column after "- "
        const inner = indent + 2; lines[pos] = { indent: inner, text: rest, ln };
        a.push(map(inner));
      } else { pos++; a.push(inline(rest, ln)); }
    }
    return a;
  }
  if (!lines.length) return {};
  const v = block(lines[0].indent);
  if (pos < lines.length) throw new YamlError(lines[pos].ln, "unexpected content (check the indentation)");
  return v;
}
module.exports = { parse, YamlError };
