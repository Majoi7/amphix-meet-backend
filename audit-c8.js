/* ════════════════════════════════════════════════════════════════════════
   C8 — AUDIT PRÉ-MIGRATION DES DONNÉES — LECTURE SEULE STRICTE
   ════════════════════════════════════════════════════════════════════════

   Ce script N'ÉCRIT RIEN. Il ne contient que des SELECT et des requêtes de
   métadonnées. Aucun INSERT / UPDATE / DELETE / TRUNCATE / DROP / ALTER.

   Il lit lui-même les deux URL depuis les fichiers existants — aucun
   identifiant n'est écrit dans ce fichier ni affiché par lui.

     ANCIENNE BASE : backend/diagnostic-9-participants.js (Render)
     NOUVELLE BASE : backend/.env  (Supabase)

   Lancement, depuis backend/ :
       node audit-c8.js
   ════════════════════════════════════════════════════════════════════════ */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const HERE = __dirname;

const TABLES = [
  "users",
  "refresh_tokens",
  "verification_tokens",
  "meetings",
  "rooms",
  "meeting_participants",
  "bookings",
  "lobby_requests",
  "whiteboards",
  "integration_sessions",
];

/* ── Lecture des cibles, sans jamais les divulguer ─────────────────────── */

function oldUrl() {
  const src = fs.readFileSync(path.join(HERE, "diagnostic-9-participants.js"), "utf8");
  const m = src.match(/postgresql:\/\/[^\s'"`]+/);
  return m ? m[0] : null;
}

function newUrl() {
  const env = fs.readFileSync(path.join(HERE, ".env"), "utf8");
  const m = env.match(/^DATABASE_URL=(.*)$/m);
  return m ? m[1].trim() : null;
}

function mask(url) {
  if (!url) return "(absente)";
  try {
    const p = new URL(url);
    return (
      p.protocol.replace(":", "") +
      "://" + p.username.slice(0, 4) + "***:***@" +
      p.hostname + ":" + (p.port || "5432") +
      p.pathname
    );
  } catch {
    return "(illisible)";
  }
}

/* ── Connexion ─────────────────────────────────────────────────────────── */

function pool(url) {
  return new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
    max: 2,
  });
}

const q = async (p, sql, params) => (await p.query(sql, params)).rows;

/* ── 1. Inventaire + volumes ───────────────────────────────────────────── */

async function inventaire(label, url) {
  console.log("\n" + "═".repeat(70));
  console.log("  " + label);
  console.log("  " + mask(url));
  console.log("═".repeat(70));

  if (!url) {
    console.log("  URL ABSENTE — audit impossible.");
    return null;
  }

  const p = pool(url);
  const out = { tables: {}, colonnes: {}, indexes: {} };

  try {
    const v = await q(p, "select version()");
    console.log("  Connexion : OK — " + v[0].version.split(",")[0]);
    const sc = await q(p, "select current_schema() s");
    console.log("  Schéma courant : " + sc[0].s);

    /* Tables du schéma public */
    const t = await q(
      p,
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
       order by 1`
    );
    console.log("\n  TABLES public (" + t.length + ") :");
    console.log("    " + t.map((r) => r.table_name).join(", "));

    /* Volumes */
    console.log("\n  VOLUMES :");
    for (const tb of TABLES) {
      try {
        const c = await q(p, `select count(*)::int n from public."${tb}"`);
        const col = await q(
          p,
          `select count(*)::int n from information_schema.columns
           where table_schema='public' and table_name=$1`,
          [tb]
        );
        out.tables[tb] = c[0].n;
        out.colonnes[tb] = col[0].n;
        console.log(
          "    " + tb.padEnd(24) + " rows=" + String(c[0].n).padStart(8) +
          "   colonnes=" + col[0].n
        );
      } catch (e) {
        out.tables[tb] = null;
        console.log("    " + tb.padEnd(24) + " ABSENTE  (" + e.code + ")");
      }
    }
  } catch (e) {
    console.log("  Connexion : ÉCHEC — " + e.code + " " + String(e.message).slice(0, 160));
    await p.end().catch(() => {});
    return null;
  }

  await p.end().catch(() => {});
  return out;
}

/* ── 2. Structure détaillée d'une base ─────────────────────────────────── */

async function structure(label, url) {
  if (!url) return;
  console.log("\n" + "─".repeat(70));
  console.log("  STRUCTURE — " + label);
  console.log("─".repeat(70));

  const p = pool(url);
  try {
    for (const tb of TABLES) {
      const ex = await q(
        p,
        `select 1 from information_schema.tables
         where table_schema='public' and table_name=$1`,
        [tb]
      );
      if (!ex.length) {
        console.log("\n  ▸ " + tb + " : ABSENTE");
        continue;
      }
      console.log("\n  ▸ " + tb);

      const cols = await q(
        p,
        `select column_name, data_type, udt_name, is_nullable, column_default,
                character_maximum_length, numeric_precision
         from information_schema.columns
         where table_schema='public' and table_name=$1
         order by ordinal_position`,
        [tb]
      );
      for (const c of cols) {
        const typ = c.data_type === "USER-DEFINED" ? c.udt_name : c.data_type;
        console.log(
          "      " + c.column_name.padEnd(30) +
          typ.padEnd(18) +
          (c.is_nullable === "YES" ? "NULL" : "NOT NULL").padEnd(10) +
          (c.column_default ? "DEFAULT " + String(c.column_default).slice(0, 40) : "")
        );
      }

      const pk = await q(
        p,
        `select a.attname
         from pg_index i
         join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
         where i.indrelid = ('public.' || quote_ident($1))::regclass and i.indisprimary`,
        [tb]
      );
      console.log("      PK      : " + (pk.map((r) => r.attname).join(", ") || "—"));

      const uq = await q(
        p,
        `select i.relname idx, pg_get_indexdef(x.indexrelid) def
         from pg_index x
         join pg_class i on i.oid = x.indexrelid
         join pg_class t on t.oid = x.indrelid
         join pg_namespace n on n.oid = t.relnamespace
         where n.nspname='public' and t.relname=$1 and x.indisunique and not x.indisprimary`,
        [tb]
      );
      for (const u of uq) console.log("      UNIQUE  : " + u.def);

      const fk = await q(
        p,
        `select con.conname,
                pg_get_constraintdef(con.oid) def
         from pg_constraint con
         join pg_class t on t.oid = con.conrelid
         join pg_namespace n on n.oid = t.relnamespace
         where n.nspname='public' and t.relname=$1 and con.contype='f'`,
        [tb]
      );
      for (const f of fk) console.log("      FK      : " + f.def);

      const ix = await q(
        p,
        `select pg_get_indexdef(x.indexrelid) def
         from pg_index x
         join pg_class i on i.oid = x.indexrelid
         join pg_class t on t.oid = x.indrelid
         join pg_namespace n on n.oid = t.relnamespace
         where n.nspname='public' and t.relname=$1 and not x.indisunique and not x.indisprimary`,
        [tb]
      );
      for (const i of ix) console.log("      INDEX   : " + i.def);
    }

    /* Enums */
    const en = await q(
      p,
      `select t.typname, string_agg(e.enumlabel, ', ' order by e.enumsortorder) vals
       from pg_type t
       join pg_enum e on e.enumtypid = t.oid
       join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = 'public'
       group by t.typname order by 1`
    );
    console.log("\n  ENUMS (" + en.length + ") :");
    for (const e of en) console.log("      " + e.typname + " = " + e.vals);
  } catch (e) {
    console.log("  ÉCHEC structure : " + e.code + " " + String(e.message).slice(0, 160));
  }
  await p.end().catch(() => {});
}

/* ── 3. Orphelins + collisions + formats d'ID ──────────────────────────── */

async function integrite(label, url) {
  if (!url) return;
  console.log("\n" + "─".repeat(70));
  console.log("  INTÉGRITÉ — " + label);
  console.log("─".repeat(70));

  const p = pool(url);

  const checks = [
    ["FK orphelines refresh_tokens.userId", `select count(*)::int n from refresh_tokens c left join users u on u.id=c."userId" where u.id is null`],
    ["FK orphelines verification_tokens.userId", `select count(*)::int n from verification_tokens c left join users u on u.id=c."userId" where u.id is null`],
    ["meetings sans host", `select count(*)::int n from meetings c left join users u on u.id=c."hostId" where u.id is null`],
    ["rooms sans meeting", `select count(*)::int n from rooms c left join meetings m on m.id=c."meetingId" where m.id is null`],
    ["participants sans meeting", `select count(*)::int n from meeting_participants c left join meetings m on m.id=c."meetingId" where m.id is null`],
    ["participants sans user", `select count(*)::int n from meeting_participants c left join users u on u.id=c."userId" where u.id is null`],
    ["bookings sans student", `select count(*)::int n from bookings c left join users u on u.id=c."studentId" where u.id is null`],
    ["bookings sans teacher", `select count(*)::int n from bookings c left join users u on u.id=c."teacherId" where u.id is null`],
    ["bookings.meetingId non-null sans meeting", `select count(*)::int n from bookings c left join meetings m on m.id=c."meetingId" where c."meetingId" is not null and m.id is null`],
    ["bookings.meetingId NULL", `select count(*)::int n from bookings where "meetingId" is null`],
    ["lobby_requests sans meeting", `select count(*)::int n from lobby_requests c left join meetings m on m.id=c."meetingId" where m.id is null`],
    ["lobby_requests sans user", `select count(*)::int n from lobby_requests c left join users u on u.id=c."userId" where u.id is null`],
    ["whiteboards sans meeting", `select count(*)::int n from whiteboards c left join meetings m on m.id=c."meetingId" where m.id is null`],
    ["integration_sessions sans meeting", `select count(*)::int n from integration_sessions c left join meetings m on m.id=c."meetingId" where m.id is null`],
  ];

  const collisions = [
    ["COLLISION users.email", `select count(*)::int n from (select email from users group by email having count(*)>1) x`],
    ["COLLISION meetings.joinCode", `select count(*)::int n from (select "joinCode" from meetings group by "joinCode" having count(*)>1) x`],
    ["COLLISION rooms.externalRoomName", `select count(*)::int n from (select "externalRoomName" from rooms group by "externalRoomName" having count(*)>1) x`],
    ["COLLISION integration_sessions.externalSessionId", `select count(*)::int n from (select "externalSessionId" from integration_sessions group by "externalSessionId" having count(*)>1) x`],
    ["COLLISION refresh_tokens.tokenHash", `select count(*)::int n from (select "tokenHash" from refresh_tokens group by "tokenHash" having count(*)>1) x`],
    ["COLLISION verification_tokens.tokenHash", `select count(*)::int n from (select "tokenHash" from verification_tokens group by "tokenHash" having count(*)>1) x`],
    ["COLLISION meeting_participants(meetingId,userId)", `select count(*)::int n from (select "meetingId","userId" from meeting_participants group by 1,2 having count(*)>1) x`],
    ["COLLISION lobby_requests(meetingId,userId)", `select count(*)::int n from (select "meetingId","userId" from lobby_requests group by 1,2 having count(*)>1) x`],
    ["COLLISION bookings.meetingId (1:1)", `select count(*)::int n from (select "meetingId" from bookings where "meetingId" is not null group by 1 having count(*)>1) x`],
    ["COLLISION rooms.meetingId (1:1)", `select count(*)::int n from (select "meetingId" from rooms group by 1 having count(*)>1) x`],
    ["COLLISION whiteboards.meetingId (1:1)", `select count(*)::int n from (select "meetingId" from whiteboards group by 1 having count(*)>1) x`],
    ["COLLISION integration_sessions.meetingId (1:1)", `select count(*)::int n from (select "meetingId" from integration_sessions group by 1 having count(*)>1) x`],
  ];

  const fmt = [
    ["users.id", `select count(*)::int total, count(*) filter (where id !~ '^c[a-z0-9]{20,30}$')::int hors_cuid, min(length(id))::int len_min, max(length(id))::int len_max from users`],
    ["meetings.id", `select count(*)::int total, count(*) filter (where id !~ '^c[a-z0-9]{20,30}$')::int hors_cuid, min(length(id))::int len_min, max(length(id))::int len_max from meetings`],
    ["rooms.id", `select count(*)::int total, count(*) filter (where id !~ '^c[a-z0-9]{20,30}$')::int hors_cuid, min(length(id))::int len_min, max(length(id))::int len_max from rooms`],
    ["meeting_participants.id", `select count(*)::int total, count(*) filter (where id !~ '^c[a-z0-9]{20,30}$')::int hors_cuid, min(length(id))::int len_min, max(length(id))::int len_max from meeting_participants`],
    ["bookings.id", `select count(*)::int total, count(*) filter (where id !~ '^c[a-z0-9]{20,30}$')::int hors_cuid, min(length(id))::int len_min, max(length(id))::int len_max from bookings`],
    ["lobby_requests.id", `select count(*)::int total, count(*) filter (where id !~ '^c[a-z0-9]{20,30}$')::int hors_cuid, min(length(id))::int len_min, max(length(id))::int len_max from lobby_requests`],
    ["whiteboards.id", `select count(*)::int total, count(*) filter (where id !~ '^c[a-z0-9]{20,30}$')::int hors_cuid, min(length(id))::int len_min, max(length(id))::int len_max from whiteboards`],
    ["integration_sessions.id", `select count(*)::int total, count(*) filter (where id !~ '^c[a-z0-9]{20,30}$')::int hors_cuid, min(length(id))::int len_min, max(length(id))::int len_max from integration_sessions`],
    ["refresh_tokens.id", `select count(*)::int total, count(*) filter (where id !~ '^c[a-z0-9]{20,30}$')::int hors_cuid, min(length(id))::int len_min, max(length(id))::int len_max from refresh_tokens`],
    ["verification_tokens.id", `select count(*)::int total, count(*) filter (where id !~ '^c[a-z0-9]{20,30}$')::int hors_cuid, min(length(id))::int len_min, max(length(id))::int len_max from verification_tokens`],
  ];

  const sensible = [
    ["users.passwordHash NULL", `select count(*) filter (where "passwordHash" is null)::int nuls, count(*)::int total, min(length("passwordHash"))::int len_min, max(length("passwordHash"))::int len_max, count(*) filter (where "passwordHash" !~ '^\\$2[aby]\\$')::int format_inattendu from users`],
    ["refresh_tokens.tokenHash", `select count(*) filter (where "tokenHash" is null)::int nuls, count(*)::int total, min(length("tokenHash"))::int len_min, max(length("tokenHash"))::int len_max, count(*) filter (where "tokenHash" !~ '^[0-9a-f]{64}$')::int format_inattendu from refresh_tokens`],
    ["verification_tokens.tokenHash", `select count(*) filter (where "tokenHash" is null)::int nuls, count(*)::int total, min(length("tokenHash"))::int len_min, max(length("tokenHash"))::int len_max, count(*) filter (where "tokenHash" !~ '^[0-9a-f]{64}$')::int format_inattendu from verification_tokens`],
    ["users.updatedAt NULL (bloquant)", `select count(*)::int n from users where "updatedAt" is null`],
    ["meetings.updatedAt NULL (bloquant)", `select count(*)::int n from meetings where "updatedAt" is null`],
    ["bookings.updatedAt NULL (bloquant)", `select count(*)::int n from bookings where "updatedAt" is null`],
    ["whiteboards.updatedAt NULL (bloquant)", `select count(*)::int n from whiteboards where "updatedAt" is null`],
  ];

  async function run(group, titre, rows) {
    console.log("\n  " + titre);
    for (const [libelle, sql] of rows) {
      try {
        const libelle_txt = libelle;
        const r = await q(p, sql);
        const vals = Object.entries(r[0] || {})
          .map(([k, v]) => k + "=" + v)
          .join("  ");
        const flag =
          r[0] && Object.entries(r[0]).some(([k, v]) => k !== "total" && k !== "nuls" && Number(v) > 0 && (k.startsWith("hors_cuid") || k.startsWith("format") || k.startsWith("COLLISION")))
            ? "  ⚠"
            : "";
        console.log("    " + libelle_txt.padEnd(48) + vals + flag);
      } catch (e) {
        console.log("    " + libelle.padEnd(48) + "ÉCHEC " + e.code + " " + String(e.message).slice(0, 70));
      }
    }
  }

  try {
    await run("orph", "ORPHELINS (0 attendu partout) :", checks);
    await run("col", "COLLISIONS DE CONTRAINTES UNIQUES (0 attendu partout) :", collisions);
    await run("fmt", "FORMAT DES ID :", fmt);
    await run("sen", "DONNÉES SENSIBLES — MÉTADONNÉES UNIQUEMENT (aucune valeur affichée) :", sensible);
  } catch (e) {
    console.log("  ÉCHEC intégrité : " + e.code + " " + String(e.message).slice(0, 160));
  }

  await p.end().catch(() => {});
}

/* ── Exécution ─────────────────────────────────────────────────────────── */

(async () => {
  const OLD = oldUrl();
  const NEW = newUrl();

  console.log("\n" + "█".repeat(70));
  console.log("  C8 — AUDIT PRÉ-MIGRATION — LECTURE SEULE");
  console.log("█".repeat(70));
  console.log("  Cible ANCIENNE : " + mask(OLD));
  console.log("  Cible NOUVELLE : " + mask(NEW));

  const a = await inventaire("ANCIENNE BASE", OLD);
  const b = await inventaire("NOUVELLE BASE", NEW);

  if (a && b) {
    console.log("\n" + "═".repeat(70));
    console.log("  VOLUMES — COMPARAISON");
    console.log("═".repeat(70));
    console.log("    " + "Table".padEnd(24) + "Ancienne".padStart(10) + "Supabase".padStart(10) + "Écart".padStart(10));
    for (const tb of TABLES) {
      const x = a.tables[tb];
      const y = b.tables[tb];
      const d = x !== null && y !== null ? x - y : "—";
      console.log(
        "    " + tb.padEnd(24) +
        String(x === null ? "ABSENTE" : x).padStart(10) +
        String(y === null ? "ABSENTE" : y).padStart(10) +
        String(d).padStart(10)
      );
    }
  }

  await structure("ANCIENNE BASE", OLD);
  await structure("NOUVELLE BASE", NEW);
  await integrite("ANCIENNE BASE", OLD);
  await integrite("NOUVELLE BASE", NEW);

  console.log("\n" + "█".repeat(70));
  console.log("  FIN — aucune écriture n'a été effectuée sur aucune des deux bases.");
  console.log("█".repeat(70) + "\n");
})();
