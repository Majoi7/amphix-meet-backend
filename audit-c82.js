/* ════════════════════════════════════════════════════════════════════════
   C8.2 — AUDIT STRUCTUREL SUPABASE ↔ schema.prisma
   ════════════════════════════════════════════════════════════════════════
   STRICTEMENT READ-ONLY. Uniquement des SELECT sur les catalogues
   système (pg_catalog / information_schema) et des COUNT(*).

   Aucun INSERT / UPDATE / DELETE / TRUNCATE / DROP / ALTER / CREATE.

   L'URL est lue depuis backend/.env. Elle n'est jamais affichée :
   seule une forme masquée l'est.
   ════════════════════════════════════════════════════════════════════════ */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const HERE = __dirname;

const env = fs.readFileSync(path.join(HERE, ".env"), "utf8");
const RAW = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1];
if (!RAW) { console.log("DATABASE_URL absente de .env"); process.exit(1); }
const URL_ = RAW.trim();

const U = new URL(URL_);
console.log("Cible : postgresql://" + U.username.slice(0, 4) + "***:***@" + U.hostname + ":" + (U.port || 5432) + U.pathname);

const TABLES = [
  "users", "refresh_tokens", "verification_tokens", "meetings", "rooms",
  "meeting_participants", "bookings", "lobby_requests", "whiteboards",
  "integration_sessions",
];

const ENUMS = [
  "UserRole", "VerificationTokenType", "MeetingStatus", "RoomStatus",
  "ParticipantRole", "BookingStatus", "LobbyRequestStatus",
];

(async () => {
  const c = new Client({
    connectionString: URL_,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    statement_timeout: 20000,
    query_timeout: 20000,
  });

  try {
    await c.connect();
  } catch (e) {
    console.log("CONNEXION SUPABASE : ÉCHEC — " + e.code + " " + e.message);
    process.exit(1);
  }

  const q = async (sql, p) => (await c.query(sql, p)).rows;

  console.log("\n" + "█".repeat(74));
  console.log("  C8.2 — STRUCTURE RÉELLE SUPABASE (public)");
  console.log("█".repeat(74));

  /* ── 0. Version ─────────────────────────────────────────────────────── */
  const v = await q("select version()");
  console.log("\n[0] VERSION\n    " + v[0].version.split(",")[0]);
  const sc = await q("select current_schema() s, current_database() d, current_user u");
  console.log("    base=" + sc[0].d + "  schema=" + sc[0].s + "  user=" + String(sc[0].u).slice(0, 12) + "***");

  /* ── 1. Tables ──────────────────────────────────────────────────────── */
  console.log("\n[1] TABLES du schéma public");
  const allTables = await q(
    `select table_name from information_schema.tables
     where table_schema='public' and table_type='BASE TABLE' order by 1`
  );
  console.log("    total=" + allTables.length + "  →  " + allTables.map((r) => r.table_name).join(", "));
  for (const t of TABLES) {
    const found = allTables.some((r) => r.table_name === t);
    console.log("    " + (found ? "✔" : "✘") + " " + t);
  }

  /* ── 2. Enums ───────────────────────────────────────────────────────── */
  console.log("\n[2] ENUMS du schéma public");
  const enums = await q(
    `select t.typname,
            string_agg(e.enumlabel, ' | ' order by e.enumsortorder) vals,
            count(*)::int n
     from pg_type t
     join pg_enum e on e.enumtypid = t.oid
     join pg_namespace n on n.oid = t.typnamespace
     where n.nspname='public'
     group by t.typname order by 1`
  );
  const enumMap = {};
  for (const e of enums) { enumMap[e.typname] = e.vals; }
  console.log("    total=" + enums.length);
  for (const name of ENUMS) {
    console.log("    " + (enumMap[name] ? "✔" : "✘") + " " + name + " = " + (enumMap[name] || "(ABSENT)"));
  }
  const extra = enums.filter((e) => !ENUMS.includes(e.typname));
  if (extra.length) console.log("    ⚠ enums non attendus : " + extra.map((e) => e.typname).join(", "));

  /* ── 3. Colonnes ────────────────────────────────────────────────────── */
  console.log("\n[3] COLONNES (nom | type | nullable | default)");
  for (const t of TABLES) {
    const cols = await q(
      `select column_name, data_type, udt_name, is_nullable, column_default
       from information_schema.columns
       where table_schema='public' and table_name=$1
       order by ordinal_position`,
      [t]
    );
    console.log("\n    ▸ " + t + "  (" + cols.length + " colonnes)");
    for (const col of cols) {
      const typ = col.data_type === "USER-DEFINED" ? col.udt_name
                : col.data_type === "timestamp without time zone" ? "timestamp(3)"
                : col.data_type;
      console.log(
        "        " + col.column_name.padEnd(28) +
        String(typ).padEnd(16) +
        (col.is_nullable === "YES" ? "NULL" : "NOT NULL").padEnd(10) +
        (col.column_default ? "DEFAULT " + String(col.column_default).slice(0, 44) : "")
      );
    }
  }

  /* ── 4. Contraintes ─────────────────────────────────────────────────── */
  console.log("\n[4] CONTRAINTES (PK / UNIQUE / FK)");
  for (const t of TABLES) {
    console.log("\n    ▸ " + t);

    const pk = await q(
      `select a.attname, array_position(i.indkey, a.attnum) ord
       from pg_index i
       join pg_attribute a on a.attrelid=i.indrelid and a.attnum = any(i.indkey)
       where i.indrelid = ('public.' || quote_ident($1))::regclass and i.indisprimary
       order by 2`,
      [t]
    );
    console.log("        PK      : " + (pk.map((r) => r.attname).join(", ") || "—"));

    const uq = await q(
      `select con.conname, pg_get_constraintdef(con.oid) def
       from pg_constraint con
       join pg_class cl on cl.oid=con.conrelid
       join pg_namespace n on n.oid=cl.relnamespace
       where n.nspname='public' and cl.relname=$1 and con.contype='u'
       order by 1`,
      [t]
    );
    for (const u of uq) console.log("        UNIQUE  : " + u.conname + "  " + u.def);

    const uqIdx = await q(
      `select ic.relname idx, pg_get_indexdef(x.indexrelid) def
       from pg_index x
       join pg_class ic on ic.oid=x.indexrelid
       join pg_class cl on cl.oid=x.indrelid
       join pg_namespace n on n.oid=cl.relnamespace
       where n.nspname='public' and cl.relname=$1 and x.indisunique and not x.indisprimary
       order by 1`,
      [t]
    );
    for (const u of uqIdx) console.log("        UNIQ-IDX: " + u.def);

    const fk = await q(
      `select con.conname,
              pg_get_constraintdef(con.oid) def,
              con.confdeltype, con.confupdtype
       from pg_constraint con
       join pg_class cl on cl.oid=con.conrelid
       join pg_namespace n on n.oid=cl.relnamespace
       where n.nspname='public' and cl.relname=$1 and con.contype='f'
       order by 1`,
      [t]
    );
    const DEL = { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" };
    for (const f of fk) {
      console.log("        FK      : " + f.conname);
      console.log("                  " + f.def);
      console.log("                  confdeltype=" + f.confdeltype + " (" + (DEL[f.confdeltype] || "?") +
                  ")  confupdtype=" + f.confupdtype + " (" + (DEL[f.confupdtype] || "?") + ")");
    }

    const ix = await q(
      `select pg_get_indexdef(x.indexrelid) def
       from pg_index x
       join pg_class cl on cl.oid=x.indrelid
       join pg_namespace n on n.oid=cl.relnamespace
       where n.nspname='public' and cl.relname=$1 and not x.indisunique and not x.indisprimary
       order by 1`,
      [t]
    );
    for (const i of ix) console.log("        INDEX   : " + i.def);
  }

  /* ── 5. Volumes ─────────────────────────────────────────────────────── */
  console.log("\n[5] VOLUMES (COUNT(*))");
  let total = 0;
  for (const t of TABLES) {
    try {
      const r = await q(`select count(*)::int n from public."${t}"`);
      total += r[0].n;
      console.log("    " + t.padEnd(24) + " = " + r[0].n);
    } catch (e) {
      console.log("    " + t.padEnd(24) + " = ÉCHEC " + e.code);
    }
  }
  console.log("    " + "TOTAL".padEnd(24) + " = " + total);

  /* ── 6. Séquences / autres objets ───────────────────────────────────── */
  const seq = await q(
    `select sequencename from pg_sequences where schemaname='public' order by 1`
  );
  console.log("\n[6] SÉQUENCES dans public : " + (seq.length ? seq.map((s) => s.sequencename).join(", ") : "aucune"));

  const other = await q(
    `select table_name, table_type from information_schema.tables
     where table_schema='public' and table_type <> 'BASE TABLE' order by 1`
  );
  console.log("    autres objets public : " + (other.length ? other.map((o) => o.table_name + "(" + o.table_type + ")").join(", ") : "aucun"));

  const migExists = await q(
    `select exists (
       select 1 from information_schema.tables
       where table_schema='public' and table_name='_prisma_migrations'
     ) e`
  );
  const hasMig = migExists[0].e === true || migExists[0].e === "t";
  console.log("\n[7] _prisma_migrations : " + (hasMig ? "PRÉSENTE" : "ABSENTE"));
  if (hasMig) {
    try {
      const rows = await q(
        `select migration_name, finished_at, rolled_back_at
         from "_prisma_migrations" order by started_at`
      );
      if (!rows.length) console.log("    (table présente mais VIDE — aucune migration enregistrée)");
      for (const r of rows) {
        console.log("    " + String(r.migration_name).padEnd(34) +
                    " finished=" + (r.finished_at || "NULL") +
                    "  rolled_back=" + (r.rolled_back_at || "NULL"));
      }
    } catch (e) {
      console.log("    lecture impossible : " + e.code + " " + e.message);
    }
  }

  /* ── 8. Index bruts (pg_indexes) ────────────────────────────────────── */
  const pix = await q(
    `select tablename, indexname, indexdef
     from pg_indexes where schemaname='public'
     and tablename = any($1) order by tablename, indexname`,
    [TABLES]
  );
  console.log("\n[8] pg_indexes — total dans public pour les 10 tables : " + pix.length);

  await c.end();
  console.log("\n" + "█".repeat(74));
  console.log("  FIN — aucune écriture effectuée.");
  console.log("█".repeat(74) + "\n");
})().catch((e) => {
  console.log("ERREUR : " + e.code + " " + e.message);
  process.exit(1);
});
