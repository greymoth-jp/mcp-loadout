#!/usr/bin/env node
// mcp-loadout — turn your local MCP config into an RPG-style "AI loadout" share card.
// Zero dependencies. Local-only. Nothing is sent anywhere.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------- config discovery ----------

const CANDIDATES = [
  join(homedir(), ".claude.json"),
  join(homedir(), ".claude", "mcp.json"),
  join(homedir(), ".claude", "claude_desktop_config.json"),
  join(homedir(), "AppData", "Roaming", "Claude", "claude_desktop_config.json"),
  join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
  join(process.cwd(), ".mcp.json"),
  join(process.cwd(), "claude_desktop_config.json"),
];

const SAMPLE = {
  mcpServers: {
    filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] },
    github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
    "claude-in-chrome": { url: "https://example.com/mcp" },
    memory: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] },
    "sequential-thinking": { command: "uvx", args: ["mcp-server-sequential-thinking"] },
  },
};

// ---------- parser ----------

// Pull mcpServers out of a config object. Claude Code's ~/.claude.json nests
// per-project configs too, so collect from the root AND every project block,
// deduping by server name.
function parseServers(config) {
  const seen = new Map();
  const collect = (obj) => {
    if (!obj || typeof obj !== "object") return;
    const servers = obj.mcpServers;
    if (servers && typeof servers === "object") {
      for (const [name, def] of Object.entries(servers)) {
        if (!seen.has(name)) seen.set(name, def || {});
      }
    }
  };
  collect(config);
  if (config && typeof config.projects === "object" && config.projects) {
    for (const proj of Object.values(config.projects)) collect(proj);
  }
  return [...seen.entries()].map(([name, def]) => ({
    name,
    kind: classify(def),
    detail: describe(def),
  }));
}

function classify(def) {
  if (def && typeof def === "object") {
    if (def.url || def.type === "sse" || def.type === "http") return "remote";
    if (def.command) return "local";
  }
  return "local";
}

function describe(def) {
  if (!def || typeof def !== "object") return "";
  if (def.url) return String(def.url);
  if (def.command) {
    const args = Array.isArray(def.args) ? def.args.join(" ") : "";
    return (def.command + (args ? " " + args : "")).trim();
  }
  return "";
}

// ---------- svg card ----------

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function buildSVG(servers) {
  const W = 1200, H = 675;
  const ACCENT = "#ff3b30"; // single accent (riso vermillion)
  const INK = "#111111";
  const PAPER = "#f4f3ef";
  const FAINT = "#cfcdc6";

  // up to 9 slots fit cleanly; note overflow
  const MAX = 9;
  const shown = servers.slice(0, MAX);
  const overflow = servers.length - shown.length;

  const slotsX = 70;
  const slotsTop = 210;
  const rowH = 46;

  const rows = shown
    .map((s, i) => {
      const y = slotsTop + i * rowH;
      const idx = String(i + 1).padStart(2, "0");
      const kindMark = s.kind === "remote" ? "◉" : "■"; // ◉ remote / ■ local
      const name = truncate(s.name, 28);
      const detail = truncate(s.detail, 46);
      return `
    <g transform="translate(${slotsX}, ${y})">
      <text x="0" y="0" font-family="'Courier New', monospace" font-size="22" fill="${FAINT}">${idx}</text>
      <text x="54" y="0" font-family="'Courier New', monospace" font-size="20" fill="${ACCENT}">${kindMark}</text>
      <text x="90" y="0" font-family="Georgia, 'Times New Roman', serif" font-size="27" font-weight="bold" fill="${INK}">${esc(name)}</text>
      <text x="600" y="0" font-family="'Courier New', monospace" font-size="16" fill="#6a6862">${esc(detail)}</text>
      <line x1="0" y1="14" x2="${W - 2 * slotsX}" y2="14" stroke="${FAINT}" stroke-width="1" stroke-dasharray="2 5"/>
    </g>`;
    })
    .join("");

  const overflowLine = overflow > 0
    ? `<text x="${slotsX}" y="${slotsTop + MAX * rowH + 8}" font-family="'Courier New', monospace" font-size="18" fill="#6a6862">+ ${overflow} more equipped…</text>`
    : "";

  const total = servers.length;
  const localCount = servers.filter((s) => s.kind === "local").length;
  const remoteCount = total - localCount;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${PAPER}"/>
  <rect x="20" y="20" width="${W - 40}" height="${H - 40}" fill="none" stroke="${INK}" stroke-width="2"/>
  <rect x="20" y="20" width="${W - 40}" height="64" fill="${INK}"/>

  <text x="44" y="63" font-family="'Courier New', monospace" font-size="30" font-weight="bold" letter-spacing="6" fill="${PAPER}">MCP · LOADOUT</text>
  <text x="${W - 44}" y="60" text-anchor="end" font-family="'Courier New', monospace" font-size="18" fill="${ACCENT}">EQUIPPED</text>

  <text x="${slotsX}" y="150" font-family="Georgia, serif" font-size="56" font-weight="bold" fill="${INK}">${total} <tspan font-size="26" font-weight="normal" fill="#6a6862">server${total === 1 ? "" : "s"} equipped</tspan></text>
  <text x="${slotsX}" y="182" font-family="'Courier New', monospace" font-size="17" fill="#6a6862">${localCount} local · ${remoteCount} remote — your agent's gear</text>

  ${rows}
  ${overflowLine}

  <line x1="${slotsX}" y1="${H - 90}" x2="${W - slotsX}" y2="${H - 90}" stroke="${INK}" stroke-width="1.5"/>
  <text x="${slotsX}" y="${H - 56}" font-family="'Courier New', monospace" font-size="16" fill="#6a6862">■ local  ◉ remote</text>
  <text x="${slotsX}" y="${H - 34}" font-family="'Courier New', monospace" font-size="13" fill="#9a988f">generated locally · nothing sent · mcp-loadout</text>
  <text x="${W - slotsX}" y="${H - 34}" text-anchor="end" font-family="'Courier New', monospace" font-size="13" fill="${ACCENT}">whats your loadout?</text>
</svg>`;
}

// ---------- self test ----------

function selftest() {
  const sample = { mcpServers: { a: { command: "x" }, b: { url: "y" } } };
  const servers = parseServers(sample);
  const assert = (cond, msg) => {
    if (!cond) {
      console.error("FAIL: " + msg);
      process.exit(1);
    }
  };
  assert(servers.length === 2, `expected 2 servers, got ${servers.length}`);
  const names = servers.map((s) => s.name).sort().join(",");
  assert(names === "a,b", `expected names a,b got ${names}`);
  const a = servers.find((s) => s.name === "a");
  const b = servers.find((s) => s.name === "b");
  assert(a.kind === "local", `expected a=local got ${a.kind}`);
  assert(b.kind === "remote", `expected b=remote got ${b.kind}`);

  const svg = buildSVG(servers);
  assert(svg.includes(">a<"), "SVG should contain server name 'a'");
  assert(svg.includes(">b<"), "SVG should contain server name 'b'");
  assert(svg.includes("MCP · LOADOUT"), "SVG should contain the LOADOUT heading");
  assert(svg.includes("2 <tspan"), "SVG should show total count of 2");

  // overflow path: 12 servers -> 9 shown + "+3 more"
  const many = { mcpServers: {} };
  for (let i = 0; i < 12; i++) many.mcpServers["s" + i] = { command: "c" };
  const svg2 = buildSVG(parseServers(many));
  assert(svg2.includes("+ 3 more equipped"), "SVG should note overflow of 3");

  console.log("selftest PASS — parsed 2 servers (a=local, b=remote), SVG contains names + heading, overflow ok");
  process.exit(0);
}

// ---------- main ----------

function loadConfig(args) {
  if (args.includes("--demo")) return { source: "demo (sample data)", config: SAMPLE };

  const explicit = args.find((a) => !a.startsWith("--"));
  if (explicit) {
    if (!existsSync(explicit)) {
      console.error(`config not found: ${explicit}`);
      process.exit(1);
    }
    return { source: explicit, config: JSON.parse(readFileSync(explicit, "utf8")) };
  }

  for (const p of CANDIDATES) {
    if (existsSync(p)) {
      try {
        return { source: p, config: JSON.parse(readFileSync(p, "utf8")) };
      } catch {
        // unreadable/invalid JSON — keep looking
      }
    }
  }
  return { source: "no config found — using sample data", config: SAMPLE };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) return selftest();
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`mcp-loadout — your MCP config as an RPG-style share card (local-only)

usage:
  node mcp-loadout.mjs [config-path]   read an MCP config (auto-detects if omitted)
  node mcp-loadout.mjs --demo          use built-in sample config
  node mcp-loadout.mjs --selftest      run parser/SVG assertions
  node mcp-loadout.mjs --out card.svg  write to a specific path (default loadout.svg)

Nothing is sent anywhere. The SVG is written next to you, on disk.`);
    return;
  }

  const outIdx = args.indexOf("--out");
  const out = outIdx >= 0 ? args[outIdx + 1] : "loadout.svg";
  // drop --out + its value from the positional/flag scan
  const scanArgs = args.filter((_, i) => i !== outIdx && i !== outIdx + 1);

  const { source, config } = loadConfig(scanArgs);
  let servers = parseServers(config);
  if (servers.length === 0) {
    console.log("no MCP servers found in config — falling back to sample data");
    servers = parseServers(SAMPLE);
  }

  const svg = buildSVG(servers);
  writeFileSync(out, svg, "utf8");

  console.log(`source : ${source}`);
  console.log(`servers: ${servers.length} (${servers.map((s) => s.name).join(", ")})`);
  console.log(`wrote  : ${out}`);
}

main();
