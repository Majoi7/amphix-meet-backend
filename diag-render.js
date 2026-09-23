/* ════════════════════════════════════════════════════════════════════════
   C8 — DIAGNOSTIC DE CONNECTIVITÉ — ANCIENNE BASE RENDER
   ════════════════════════════════════════════════════════════════════════
   STRICTEMENT DIAGNOSTIQUE. Aucune écriture, sur aucune base.
   Aucune requête métier : uniquement version() / current_database() /
   current_user / current_schema().

   L'URL est lue depuis le fichier existant. Ce script n'affiche JAMAIS
   d'identifiant : la cible est masquée à l'affichage.
   ════════════════════════════════════════════════════════════════════════ */

const fs = require("fs");
const path = require("path");
const net = require("net");
const tls = require("tls");
const dns = require("dns");

const { Client } = require("pg");

const HERE = __dirname;

/* ── Lecture de la cible, sans divulgation ─────────────────────────────── */

const src = fs.readFileSync(path.join(HERE, "diagnostic-9-participants.js"), "utf8");
const RAW = (src.match(/postgresql:\/\/[^\s'"`]+/) || [])[0];
if (!RAW) {
  console.log("URL Render introuvable dans diagnostic-9-participants.js");
  process.exit(1);
}
const U = new URL(RAW);
const HOST = U.hostname;
const PORT = Number(U.port || 5432);
const DB = U.pathname.replace(/^\//, "");

const MASKED = `postgresql://${U.username.slice(0, 8)}***:***@${HOST}:${PORT}/${DB}`;

/* ── Capture d'erreur exhaustive, sans secret ──────────────────────────── */

function errInfo(e) {
  if (!e) return "(aucune)";
  const parts = [];
  for (const k of ["name", "message", "code", "errno", "syscall", "address", "port", "severity", "routine"]) {
    if (e[k] !== undefined && e[k] !== null && e[k] !== "") parts.push(`${k}=${e[k]}`);
  }
  return parts.join("  |  ");
}

const hr = (t) => console.log("\n" + "─".repeat(72) + "\n  " + t + "\n" + "─".repeat(72));

/* ── 1. DNS ────────────────────────────────────────────────────────────── */

function dnsStep() {
  return new Promise((resolve) => {
    hr("1. DNS — " + HOST);
    let pending = 3;
    const done = () => { if (--pending === 0) resolve(); };

    dns.resolve4(HOST, (err, addrs) => {
      console.log("  resolve4 (A)     : " + (err ? "ÉCHEC  " + errInfo(err) : addrs.join(", ")));
      done();
    });
    dns.resolve6(HOST, (err, addrs) => {
      console.log("  resolve6 (AAAA)  : " + (err ? "ÉCHEC  " + errInfo(err) : addrs.join(", ")));
      done();
    });
    dns.lookup(HOST, { all: true }, (err, addrs) => {
      console.log("  lookup (OS)      : " + (err ? "ÉCHEC  " + errInfo(err) : addrs.map((a) => a.address + " (IPv" + a.family + ")").join(", ")));
      done();
    });
  });
}

/* ── 2. TCP ────────────────────────────────────────────────────────────── */

function tcpStep() {
  return new Promise((resolve) => {
    hr(`2. TCP — ${HOST}:${PORT}`);
    const t0 = Date.now();
    const sock = net.connect({ host: HOST, port: PORT });
    let settled = false;

    const finish = (msg) => {
      if (settled) return;
      settled = true;
      console.log("  " + msg);
      console.log("  Durée : " + (Date.now() - t0) + " ms");
      sock.destroy();
      resolve();
    };

    sock.setTimeout(10000);
    sock.on("connect", () => {
      const local = sock.localAddress + ":" + sock.localPort;
      finish(`  RÉSULTAT : CONNECTÉ  (socket locale ${local})`);
    });
    sock.on("timeout", () => finish("  RÉSULTAT : TIMEOUT (10 s) — aucune réponse TCP"));
    sock.on("error", (e) => finish("  RÉSULTAT : ÉCHEC  " + errInfo(e)));
  });
}

/* ── 3. TLS ────────────────────────────────────────────────────────────── */

function tlsStep() {
  return new Promise((resolve) => {
    hr("3. TLS — poignée de main seule (aucune authentification)");
    const t0 = Date.now();
    const sock = tls.connect({
      host: HOST,
      port: PORT,
      servername: HOST,
      rejectUnauthorized: false,
      timeout: 10000,
    });
    let settled = false;

    const finish = (msg) => {
      if (settled) return;
      settled = true;
      console.log("  " + msg);
      console.log("  Durée : " + (Date.now() - t0) + " ms");
      sock.destroy();
      resolve();
    };

    sock.on("secureConnect", () => {
      console.log("  RÉSULTAT : POIGNÉE DE MAIN TLS RÉUSSIE");
      console.log("  Protocole   : " + sock.getProtocol());
      console.log("  Chiffrement : " + JSON.stringify(sock.getCipher()));
      const c = sock.getPeerCertificate();
      console.log("  Certificat  : sujet=" + (c && c.subject ? c.subject.CN : "?") +
                  "  émetteur=" + (c && c.issuer ? c.issuer.O || c.issuer.CN : "?") +
                  "  valide jusqu'au=" + (c ? c.valid_to : "?"));
      console.log("  ALPN        : " + JSON.stringify(sock.alpnProtocol || null));
      finish("  (le serveur a accepté TLS)");
    });
    sock.on("timeout", () => finish("  RÉSULTAT : TIMEOUT (10 s) pendant la poignée de main TLS"));
    sock.on("error", (e) => finish("  RÉSULTAT : ÉCHEC TLS  " + errInfo(e)));
  });
}

/* ── 4. PostgreSQL minimal, par mode SSL ───────────────────────────────── */

const MINIMAL = [
  ["version()", "SELECT version()"],
  ["current_database()", "SELECT current_database()"],
  ["current_user", "SELECT current_user"],
  ["current_schema()", "SELECT current_schema()"],
];

async function pgAttempt(label, sslConfig, firstRowWriter) {
  console.log("\n  ▸ Mode : " + label);
  const t0 = Date.now();
  const client = new Client({
    connectionString: RAW,
    ssl: sslConfig,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
    query_timeout: 10000,
  });

  try {
    await client.connect();
    console.log("    CONNEXION : OK  (" + (Date.now() - t0) + " ms)");
    for (const [name, sql] of MINIMAL) {
      const r = await client.query(sql);
      const val = r.rows[0] ? Object.values(r.rows[0])[0] : "(vide)";
      let shown = String(val);
      // version() est long : on n'en garde que la tête, jamais de secret.
      if (name === "version()") shown = shown.split(",")[0];
      console.log("      " + name.padEnd(20) + " = " + shown);
      if (name === "version()" && firstRowWriter) firstRowWriter(shown);
    }
    await client.end();
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    console.log("    ÉCHEC : " + errInfo(e));
    if (e && e.stack) {
      const first = String(e.stack).split("\n")[0];
      console.log("    stack[0] : " + first);
    }
    try { await client.end(); } catch {}
    return { ok: false, err: e, ms: Date.now() - t0 };
  }
}

/* ── Exécution ─────────────────────────────────────────────────────────── */

(async () => {
  console.log("\n" + "█".repeat(72));
  console.log("  C8 — DIAGNOSTIC CONNECTIVITÉ RENDER  (lecture seule, aucune écriture)");
  console.log("█".repeat(72));
  console.log("  Cible : " + MASKED);
  console.log("  Node  : " + process.version);
  console.log("  pg    : " + require("pg/package.json").version);

  await dnsStep();
  await tcpStep();
  await tlsStep();

  hr("4. PostgreSQL — requêtes minimales, par mode SSL");
  const results = {};
  results["défaut (ssl implicite de la connectionString)"] = await pgAttempt("défaut (ssl implicite)", undefined);
  results["ssl: false (clair)"] = await pgAttempt("ssl: false — NON CHIFFRÉ (diagnostic uniquement)", false);
  results["ssl: {rejectUnauthorized:false}"] = await pgAttempt("ssl: {rejectUnauthorized:false}", { rejectUnauthorized: false });
  results["ssl: {rejectUnauthorized:true}"] = await pgAttempt("ssl: {rejectUnauthorized:true} (vérification stricte)", { rejectUnauthorized: true });

  hr("SYNTHÈSE");
  for (const [k, v] of Object.entries(results)) {
    console.log("  " + (v.ok ? "✅ OK    " : "❌ ÉCHEC ") + "  " + k + "   (" + v.ms + " ms)");
  }

  console.log("\n  Aucune écriture n'a été effectuée. Aucune donnée métier lue.");
  console.log("█".repeat(72) + "\n");
})();
