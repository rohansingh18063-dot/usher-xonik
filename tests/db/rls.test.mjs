// Offline tests for the database schema and Row Level Security.
//
// Runs every migration in supabase/migrations against an in-process Postgres
// (PGlite with pgvector), then acts as different signed-in clients to prove
// that no client can read or change another client's data.
//
// Run with: npm run test:db

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const root = join(import.meta.dirname, "..", "..");
const migrationsDir = join(root, "supabase", "migrations");

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

let db;
let aliceClientId;
let bobClientId;

/**
 * Runs `fn` inside a transaction as the given API role, the same way
 * Supabase's API does for a request carrying that user's access token.
 * The transaction is committed only when `commit` is true.
 */
async function as(role, userId, fn, { commit = false } = {}) {
  let result;
  try {
    await db.transaction(async (tx) => {
      await tx.query(`set local role ${role}`);
      const claims = userId ? JSON.stringify({ sub: userId, role }) : "";
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
      result = await fn(tx);
      if (!commit) throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return result;
}

class Rollback extends Error {}

const asUser = (userId, fn, options) => as("authenticated", userId, fn, options);
const asAnon = (fn) => as("anon", null, fn);

async function rejects(promise, pattern) {
  await assert.rejects(promise, (error) => {
    assert.match(error.message, pattern);
    return true;
  });
}

before(async () => {
  db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.exec(readFileSync(join(import.meta.dirname, "supabase-shim.sql"), "utf8"));

  const migrations = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of migrations) {
    await db.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }

  await db.query(
    `insert into auth.users (id, email) values ($1, 'alice@clinic.test'), ($2, 'bob@pharmacy.test')`,
    [ALICE, BOB],
  );
});

describe("schema", () => {
  test("pgvector extension is enabled", async () => {
    const { rows } = await db.query(`select extname from pg_extension where extname = 'vector'`);
    assert.equal(rows.length, 1);
  });

  test("Row Level Security is enabled on every table in the public schema", async () => {
    const { rows } = await db.query(`
      select c.relname as table, c.relrowsecurity as rls
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
    `);
    assert.ok(rows.length > 0, "expected at least one table");
    for (const row of rows) {
      assert.equal(row.rls, true, `RLS is not enabled on public.${row.table}`);
    }
  });

  test("the documents bucket exists and is private", async () => {
    const { rows } = await db.query(`select public from storage.buckets where id = 'documents'`);
    assert.deepEqual(rows, [{ public: false }]);
  });
});

describe("creating a business", () => {
  test("a client can create their business, owned by their own account", async () => {
    const row = await asUser(
      ALICE,
      async (tx) => {
        const { rows } = await tx.query(`
          insert into public.clients (business_name, industry, website_domain)
          values ('Bright Smile Dental', 'dentist', 'brightsmile.com')
          returning id, user_id, created_at
        `);
        return rows[0];
      },
      { commit: true },
    );
    assert.equal(row.user_id, ALICE);
    assert.ok(row.created_at instanceof Date);
    aliceClientId = row.id;

    bobClientId = await asUser(
      BOB,
      async (tx) => {
        const { rows } = await tx.query(`
          insert into public.clients (business_name, industry, website_domain)
          values ('Corner Pharmacy', 'pharmacy', 'cornerpharmacy.co.uk')
          returning id
        `);
        return rows[0].id;
      },
      { commit: true },
    );
  });

  test("a client cannot create a business on behalf of another account", async () => {
    await rejects(
      asUser(BOB, (tx) =>
        tx.query(
          `insert into public.clients (user_id, business_name, industry, website_domain)
           values ($1, 'Fake Business', 'other', 'fake.com')`,
          [ALICE],
        ),
      ),
      /permission denied/,
    );
  });

  test("a client can only have one business", async () => {
    await rejects(
      asUser(ALICE, (tx) =>
        tx.query(`
          insert into public.clients (business_name, industry, website_domain)
          values ('Second Business', 'other', 'second.com')
        `),
      ),
      /duplicate key/,
    );
  });

  test("invalid industry and domain values are rejected", async () => {
    await rejects(
      asUser(ALICE, (tx) =>
        tx.query(`update public.clients set industry = 'bakery' where id = $1`, [aliceClientId]),
      ),
      /clients_industry_valid/,
    );
    await rejects(
      asUser(ALICE, (tx) =>
        tx.query(`update public.clients set website_domain = 'https://not a domain' where id = $1`, [
          aliceClientId,
        ]),
      ),
      /clients_website_domain_format/,
    );
  });
});

describe("isolation between clients", () => {
  test("a client only ever sees their own business", async () => {
    const aliceRows = await asUser(ALICE, async (tx) => (await tx.query(`select * from public.clients`)).rows);
    assert.equal(aliceRows.length, 1);
    assert.equal(aliceRows[0].business_name, "Bright Smile Dental");

    const bobRows = await asUser(BOB, async (tx) => (await tx.query(`select * from public.clients`)).rows);
    assert.equal(bobRows.length, 1);
    assert.equal(bobRows[0].business_name, "Corner Pharmacy");
  });

  test("looking up another client's business by id returns nothing", async () => {
    const rows = await asUser(
      BOB,
      async (tx) => (await tx.query(`select * from public.clients where id = $1`, [aliceClientId])).rows,
    );
    assert.deepEqual(rows, []);
  });

  test("a client cannot update another client's business", async () => {
    const result = await asUser(
      BOB,
      (tx) => tx.query(`update public.clients set business_name = 'Hacked' where id = $1`, [aliceClientId]),
      { commit: true },
    );
    assert.equal(result.affectedRows, 0);

    const { rows } = await db.query(`select business_name from public.clients where id = $1`, [aliceClientId]);
    assert.equal(rows[0].business_name, "Bright Smile Dental");
  });

  test("a client cannot delete any business, including their own", async () => {
    await rejects(
      asUser(BOB, (tx) => tx.query(`delete from public.clients where id = $1`, [aliceClientId])),
      /permission denied/,
    );
    await rejects(
      asUser(BOB, (tx) => tx.query(`delete from public.clients where id = $1`, [bobClientId])),
      /permission denied/,
    );
  });

  test("a client cannot reassign their business to another account", async () => {
    await rejects(
      asUser(BOB, (tx) => tx.query(`update public.clients set user_id = $1 where id = $2`, [ALICE, bobClientId])),
      /permission denied/,
    );
  });

  test("a client can update their own business details", async () => {
    const row = await asUser(ALICE, async (tx) => {
      const { rows } = await tx.query(
        `update public.clients set business_name = 'Bright Smile Family Dental'
         where id = $1 returning business_name, created_at, updated_at`,
        [aliceClientId],
      );
      return rows[0];
    });
    assert.equal(row.business_name, "Bright Smile Family Dental");
  });

  test("anonymous visitors cannot read any business", async () => {
    await rejects(
      asAnon((tx) => tx.query(`select * from public.clients`)),
      /permission denied/,
    );
  });
});

describe("document storage isolation", () => {
  test("a client can store files in their own folder", async () => {
    await asUser(
      ALICE,
      (tx) =>
        tx.query(`insert into storage.objects (bucket_id, name) values ('documents', $1)`, [
          `${aliceClientId}/price-list.pdf`,
        ]),
      { commit: true },
    );
  });

  test("a client cannot store files in another client's folder", async () => {
    await rejects(
      asUser(BOB, (tx) =>
        tx.query(`insert into storage.objects (bucket_id, name) values ('documents', $1)`, [
          `${aliceClientId}/planted.pdf`,
        ]),
      ),
      /row-level security/,
    );
  });

  test("a client cannot store files outside a client folder", async () => {
    await rejects(
      asUser(BOB, (tx) =>
        tx.query(`insert into storage.objects (bucket_id, name) values ('documents', 'loose-file.pdf')`),
      ),
      /row-level security/,
    );
  });

  test("a client cannot list, change or delete another client's files", async () => {
    const listed = await asUser(BOB, async (tx) => (await tx.query(`select * from storage.objects`)).rows);
    assert.deepEqual(listed, []);

    const renamed = await asUser(BOB, (tx) =>
      tx.query(`update storage.objects set name = $1 where bucket_id = 'documents'`, [`${bobClientId}/stolen.pdf`]),
    );
    assert.equal(renamed.affectedRows, 0);

    const deleted = await asUser(BOB, (tx) => tx.query(`delete from storage.objects where bucket_id = 'documents'`));
    assert.equal(deleted.affectedRows, 0);

    const own = await asUser(ALICE, async (tx) => (await tx.query(`select name from storage.objects`)).rows);
    assert.deepEqual(own, [{ name: `${aliceClientId}/price-list.pdf` }]);
  });
});

describe("industry packs", () => {
  const asServer = (fn, options) => as("service_role", null, fn, options);

  test("the server can publish and read packs", async () => {
    await asServer(
      (tx) =>
        tx.query(
          `insert into public.industry_packs (industry, version, knowledge, behavior_rules)
           values ('dentist', 1, 'Brush twice a day.', 'Be friendly.'), ('dentist', 2, 'Floss daily.', 'Be brief.')`,
        ),
      { commit: true },
    );
    const latest = await asServer(async (tx) => {
      const { rows } = await tx.query(
        `select version from public.industry_packs
         where industry = 'dentist' and is_published order by version desc limit 1`,
      );
      return rows[0].version;
    });
    assert.equal(latest, 2);
  });

  test("each industry version can only exist once", async () => {
    await rejects(
      asServer((tx) =>
        tx.query(
          `insert into public.industry_packs (industry, version, knowledge, behavior_rules)
           values ('dentist', 2, 'Duplicate', 'Duplicate')`,
        ),
      ),
      /duplicate key/,
    );
  });

  test("clients and visitors cannot read or change packs", async () => {
    await rejects(asUser(ALICE, (tx) => tx.query(`select * from public.industry_packs`)), /permission denied/);
    await rejects(
      asUser(ALICE, (tx) => tx.query(`update public.industry_packs set behavior_rules = 'Give out discounts.'`)),
      /permission denied/,
    );
    await rejects(asAnon((tx) => tx.query(`select * from public.industry_packs`)), /permission denied/);
  });
});

describe("conversations", () => {
  const asServer = (fn, options) => as("service_role", null, fn, options);
  const ALICE_SESSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const BOB_SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  test("the server saves conversations for each client", async () => {
    await asServer(
      (tx) =>
        tx.query(
          `insert into public.conversations (client_id, session_id, visitor_message, assistant_reply)
           values ($1, $2, 'Do you do implants?', 'The clinic will confirm.'),
                  ($3, $4, 'Are you open on Sunday?', 'The pharmacy will confirm.')`,
          [aliceClientId, ALICE_SESSION, bobClientId, BOB_SESSION],
        ),
      { commit: true },
    );
  });

  test("a client only sees their own conversations", async () => {
    const aliceRows = await asUser(ALICE, async (tx) => (await tx.query(`select * from public.conversations`)).rows);
    assert.equal(aliceRows.length, 1);
    assert.equal(aliceRows[0].visitor_message, "Do you do implants?");

    const bobLooksAtAlice = await asUser(
      BOB,
      async (tx) => (await tx.query(`select * from public.conversations where client_id = $1`, [aliceClientId])).rows,
    );
    assert.deepEqual(bobLooksAtAlice, []);
  });

  test("clients cannot write, change or delete conversations", async () => {
    await rejects(
      asUser(ALICE, (tx) =>
        tx.query(
          `insert into public.conversations (client_id, session_id, visitor_message, assistant_reply)
           values ($1, $2, 'Forged', 'Forged')`,
          [aliceClientId, ALICE_SESSION],
        ),
      ),
      /permission denied/,
    );
    await rejects(
      asUser(ALICE, (tx) => tx.query(`update public.conversations set assistant_reply = 'Edited'`)),
      /permission denied/,
    );
    await rejects(asUser(ALICE, (tx) => tx.query(`delete from public.conversations`)), /permission denied/);
  });

  test("anonymous visitors cannot read conversations", async () => {
    await rejects(asAnon((tx) => tx.query(`select * from public.conversations`)), /permission denied/);
  });

  test("conversations are deleted together with their business", async () => {
    const { rows } = await db.query(`select count(*)::int as n from public.conversations where client_id = $1`, [
      bobClientId,
    ]);
    assert.equal(rows[0].n, 1);
    await db.query(`delete from auth.users where id = $1`, [BOB]);
    const after = await db.query(`select count(*)::int as n from public.conversations where client_id = $1`, [
      bobClientId,
    ]);
    assert.equal(after.rows[0].n, 0);
  });
});

describe("client knowledge", () => {
  const CAROL = "33333333-3333-4333-8333-333333333333";
  const DAVE = "44444444-4444-4444-8444-444444444444";
  const asServer = (fn, options) => as("service_role", null, fn, options);
  let carolClient;
  let daveClient;
  let carolDoc;
  let carolOldDoc;
  let daveDoc;

  // A 1024-dimension vector pointing mostly along one axis.
  const vector = (axis) => `[${Array.from({ length: 1024 }, (_, i) => (i === axis ? 1 : 0.001)).join(",")}]`;
  const search = (clientId, axis) =>
    asServer(
      async (tx) =>
        (
          await tx.query(
            `select content, similarity from public.match_document_chunks($1, $2::extensions.vector, 6, 0.3)`,
            [clientId, vector(axis)],
          )
        ).rows,
    );

  before(async () => {
    await db.query(`insert into auth.users (id, email) values ($1, 'carol@dental.test'), ($2, 'dave@dental.test')`, [
      CAROL,
      DAVE,
    ]);
    const { rows } = await db.query(
      `insert into public.clients (user_id, business_name, industry, website_domain)
       values ($1, 'Carol Dental', 'dentist', 'caroldental.com'), ($2, 'Dave Dental', 'dentist', 'davedental.com')
       returning id, user_id`,
      [CAROL, DAVE],
    );
    carolClient = rows.find((row) => row.user_id === CAROL).id;
    daveClient = rows.find((row) => row.user_id === DAVE).id;
  });

  test("a client can save and update their own business profile", async () => {
    await asUser(
      CAROL,
      (tx) =>
        tx.query(
          `insert into public.business_profiles (client_id, phone, opening_hours, fees)
           values ($1, '+91 98765 43210', '{"monday": "9 AM - 5 PM"}', '[{"service": "Cleaning", "price": "₹800"}]')`,
          [carolClient],
        ),
      { commit: true },
    );
    const row = await asUser(CAROL, async (tx) => {
      const { rows } = await tx.query(
        `update public.business_profiles set phone = '+91 90000 00000' where client_id = $1 returning phone, fees`,
        [carolClient],
      );
      return rows[0];
    });
    assert.equal(row.phone, "+91 90000 00000");
    assert.deepEqual(row.fees, [{ service: "Cleaning", price: "₹800" }]);
  });

  test("a client cannot read, create or change another client's business profile", async () => {
    const seen = await asUser(DAVE, async (tx) => (await tx.query(`select * from public.business_profiles`)).rows);
    assert.deepEqual(seen, []);

    const changed = await asUser(DAVE, (tx) =>
      tx.query(`update public.business_profiles set phone = '+1 555 0100' where client_id = $1`, [carolClient]),
    );
    assert.equal(changed.affectedRows, 0);

    await rejects(
      asUser(DAVE, (tx) => tx.query(`insert into public.business_profiles (client_id) values ($1)`, [carolClient])),
      /row-level security/,
    );
    await rejects(
      asUser(CAROL, (tx) => tx.query(`update public.business_profiles set client_id = $1`, [daveClient])),
      /permission denied/,
    );
    await rejects(asAnon((tx) => tx.query(`select * from public.business_profiles`)), /permission denied/);
  });

  test("business profile fields are checked by the database", async () => {
    await rejects(
      asUser(CAROL, (tx) =>
        tx.query(`update public.business_profiles set maps_url = 'javascript:alert(1)' where client_id = $1`, [
          carolClient,
        ]),
      ),
      /business_profiles_maps_url_format/,
    );
    await rejects(
      asUser(CAROL, (tx) =>
        tx.query(`update public.business_profiles set fees = '"not a list"' where client_id = $1`, [carolClient]),
      ),
      /business_profiles_json_shapes/,
    );
  });

  test("the server stores documents and chunks for each client", async () => {
    const docs = await asServer(
      async (tx) =>
        (
          await tx.query(
            `insert into public.documents (client_id, file_name, file_type, size_bytes, storage_path, status, revision)
             values ($1::uuid, 'carol-fees.pdf', 'pdf', 1000, $1::text || '/a/2-carol-fees.pdf', 'ready', 2),
                    ($1::uuid, 'carol-old.pdf', 'pdf', 1000, $1::text || '/b/1-carol-old.pdf', 'failed', 1),
                    ($2::uuid, 'dave-fees.pdf', 'pdf', 1000, $2::text || '/c/1-dave-fees.pdf', 'ready', 1)
             returning id, file_name`,
            [carolClient, daveClient],
          )
        ).rows,
      { commit: true },
    );
    carolDoc = docs.find((d) => d.file_name === "carol-fees.pdf").id;
    carolOldDoc = docs.find((d) => d.file_name === "carol-old.pdf").id;
    daveDoc = docs.find((d) => d.file_name === "dave-fees.pdf").id;

    await asServer(
      (tx) =>
        tx.query(
          `insert into public.document_chunks (client_id, document_id, revision, chunk_index, content, embedding, embedding_model)
           values ($1, $2, 2, 0, 'Carol: cleaning costs ₹800', $6, 'test'),
                  ($1, $2, 1, 0, 'Carol, outdated revision: cleaning costs ₹500', $6, 'test'),
                  ($1, $3, 1, 0, 'Carol, failed document: cleaning costs ₹100', $6, 'test'),
                  ($1, $2, 2, 1, 'Carol: parking is available', $7, 'test'),
                  ($4, $5, 1, 0, 'Dave: cleaning costs ₹2,000', $6, 'test')`,
          [carolClient, carolDoc, carolOldDoc, daveClient, daveDoc, vector(0), vector(1)],
        ),
      { commit: true },
    );
  });

  test("a document must be stored in its client's folder", async () => {
    await rejects(
      asServer((tx) =>
        tx.query(
          `insert into public.documents (client_id, file_name, file_type, size_bytes, storage_path)
           values ($1, 'x.pdf', 'pdf', 10, $2::text || '/x/1-x.pdf')`,
          [carolClient, daveClient],
        ),
      ),
      /documents_storage_path_in_client_folder/,
    );
  });

  test("a chunk cannot belong to another client's document", async () => {
    await rejects(
      asServer((tx) =>
        tx.query(
          `insert into public.document_chunks (client_id, document_id, revision, chunk_index, content, embedding, embedding_model)
           values ($1, $2, 1, 0, 'Mixed up', $3, 'test')`,
          [daveClient, carolDoc, vector(0)],
        ),
      ),
      /document_chunks_document_fk/,
    );
  });

  test("a client only sees their own documents and chunks", async () => {
    const docs = await asUser(DAVE, async (tx) => (await tx.query(`select file_name from public.documents`)).rows);
    assert.deepEqual(docs, [{ file_name: "dave-fees.pdf" }]);

    const chunks = await asUser(DAVE, async (tx) => (await tx.query(`select content from public.document_chunks`)).rows);
    assert.deepEqual(chunks, [{ content: "Dave: cleaning costs ₹2,000" }]);

    const carolCount = await asUser(
      CAROL,
      async (tx) => (await tx.query(`select count(*)::int as n from public.document_chunks`)).rows[0].n,
    );
    assert.equal(carolCount, 4);
  });

  test("clients cannot write documents or chunks directly", async () => {
    await rejects(
      asUser(CAROL, (tx) =>
        tx.query(
          `insert into public.documents (client_id, file_name, file_type, size_bytes, storage_path)
           values ($1::uuid, 'x.pdf', 'pdf', 10, $1::text || '/x/1-x.pdf')`,
          [carolClient],
        ),
      ),
      /permission denied/,
    );
    await rejects(asUser(CAROL, (tx) => tx.query(`update public.documents set status = 'ready'`)), /permission denied/);
    await rejects(asUser(CAROL, (tx) => tx.query(`delete from public.document_chunks`)), /permission denied/);
    await rejects(asAnon((tx) => tx.query(`select * from public.documents`)), /permission denied/);
    await rejects(asAnon((tx) => tx.query(`select * from public.document_chunks`)), /permission denied/);
  });

  test("only the server can run document search", async () => {
    const call = (tx) =>
      tx.query(`select * from public.match_document_chunks($1, $2::extensions.vector)`, [carolClient, vector(0)]);
    await rejects(asUser(CAROL, call), /permission denied/);
    await rejects(asAnon(call), /permission denied/);
  });

  test("search returns only the client's current, ready chunks, most relevant first", async () => {
    const carol = await search(carolClient, 0);
    assert.deepEqual(
      carol.map((row) => row.content),
      ["Carol: cleaning costs ₹800"],
      "expected only Carol's current, ready, relevant chunk",
    );
    assert.ok(carol[0].similarity > 0.99);

    const dave = await search(daveClient, 0);
    assert.deepEqual(
      dave.map((row) => row.content),
      ["Dave: cleaning costs ₹2,000"],
    );
  });

  test("deleting a document removes all of its chunks from search", async () => {
    await db.query(`delete from public.documents where id = $1`, [carolDoc]);
    const { rows } = await db.query(`select count(*)::int as n from public.document_chunks where document_id = $1`, [
      carolDoc,
    ]);
    assert.equal(rows[0].n, 0);
    assert.deepEqual(await search(carolClient, 0), []);
    assert.deepEqual(await search(carolClient, 1), []);
  });

  test("the documents bucket only accepts supported files up to 10 MB", async () => {
    const { rows } = await db.query(`select file_size_limit, allowed_mime_types from storage.buckets where id = 'documents'`);
    assert.equal(Number(rows[0].file_size_limit), 10 * 1024 * 1024);
    assert.equal(rows[0].allowed_mime_types.length, 3);
  });
});

describe("public API access", () => {
  const CAROL = "33333333-3333-4333-8333-333333333333";
  const DAVE = "44444444-4444-4444-8444-444444444444";
  const asServer = (fn, options) => as("service_role", null, fn, options);
  let carolClient;
  let daveClient;

  const keyOf = async (clientId) =>
    (await db.query(`select public_key from public.api_keys where client_id = $1`, [clientId])).rows[0]?.public_key;

  before(async () => {
    const { rows } = await db.query(`select id, user_id from public.clients where user_id in ($1, $2)`, [CAROL, DAVE]);
    carolClient = rows.find((row) => row.user_id === CAROL).id;
    daveClient = rows.find((row) => row.user_id === DAVE).id;
  });

  test("every new client gets a key and its website is allowed by default", async () => {
    const key = await keyOf(carolClient);
    assert.match(key, /^pk_live_[A-Za-z0-9_-]{32}$/);
    assert.notEqual(key, await keyOf(daveClient));

    const { rows } = await db.query(`select domain, include_subdomains from public.allowed_domains where client_id = $1`, [
      carolClient,
    ]);
    assert.deepEqual(rows, [{ domain: "caroldental.com", include_subdomains: false }]);
  });

  test("a client can read only their own key and cannot change it directly", async () => {
    const own = await asUser(CAROL, async (tx) => (await tx.query(`select public_key from public.api_keys`)).rows);
    assert.deepEqual(own, [{ public_key: await keyOf(carolClient) }]);

    await rejects(
      asUser(CAROL, (tx) => tx.query(`update public.api_keys set public_key = 'pk_live_${"a".repeat(32)}'`)),
      /permission denied/,
    );
    await rejects(
      asUser(CAROL, (tx) => tx.query(`update public.api_keys set requests_per_minute = 10000`)),
      /permission denied/,
    );
    await rejects(asUser(CAROL, (tx) => tx.query(`select client_id from public.api_keys`)), /permission denied/);
    await rejects(asAnon((tx) => tx.query(`select public_key from public.api_keys`)), /permission denied/);
  });

  test("regenerating replaces only the caller's own key", async () => {
    const carolBefore = await keyOf(carolClient);
    const daveBefore = await keyOf(daveClient);
    await asUser(CAROL, (tx) => tx.query(`select public.regenerate_public_key()`), { commit: true });

    const carolAfter = await keyOf(carolClient);
    assert.notEqual(carolAfter, carolBefore);
    assert.match(carolAfter, /^pk_live_[A-Za-z0-9_-]{32}$/);
    assert.equal(await keyOf(daveClient), daveBefore);

    await rejects(asAnon((tx) => tx.query(`select public.regenerate_public_key()`)), /permission denied/);
  });

  test("a client manages only their own allowed domains", async () => {
    await asUser(
      CAROL,
      (tx) =>
        tx.query(`insert into public.allowed_domains (client_id, domain, include_subdomains) values ($1, 'carol-smiles.in', true)`, [
          carolClient,
        ]),
      { commit: true },
    );
    const daveSees = await asUser(DAVE, async (tx) => (await tx.query(`select domain from public.allowed_domains`)).rows);
    assert.deepEqual(daveSees, [{ domain: "davedental.com" }]);

    await rejects(
      asUser(DAVE, (tx) =>
        tx.query(`insert into public.allowed_domains (client_id, domain) values ($1, 'dave-takeover.com')`, [carolClient]),
      ),
      /row-level security/,
    );
    const removed = await asUser(DAVE, (tx) =>
      tx.query(`delete from public.allowed_domains where client_id = $1`, [carolClient]),
    );
    assert.equal(removed.affectedRows, 0);
  });

  test("duplicate and badly formatted domains are rejected", async () => {
    await rejects(
      asUser(CAROL, (tx) =>
        tx.query(`insert into public.allowed_domains (client_id, domain) values ($1, 'caroldental.com')`, [carolClient]),
      ),
      /duplicate key/,
    );
    for (const domain of ["www.caroldental.com", "not a domain", "https://caroldental.com", "evil.localhost", "127.0.0.1", "CarolDental.com"]) {
      await rejects(
        asUser(CAROL, (tx) =>
          tx.query(`insert into public.allowed_domains (client_id, domain) values ($1, $2)`, [carolClient, domain]),
        ),
        /allowed_domains_format/,
        domain,
      );
    }
  });

  test("a client can pause their assistant and use test mode, but not raise their monthly limit", async () => {
    const row = await asUser(CAROL, async (tx) => {
      const { rows } = await tx.query(
        `update public.clients set assistant_paused = true, test_mode = true where id = $1
         returning assistant_paused, test_mode, monthly_message_limit`,
        [carolClient],
      );
      return rows[0];
    });
    assert.deepEqual(row, { assistant_paused: true, test_mode: true, monthly_message_limit: 1000 });

    await rejects(
      asUser(CAROL, (tx) => tx.query(`update public.clients set monthly_message_limit = 1000000 where id = $1`, [carolClient])),
      /permission denied/,
    );
    const daveChanged = await asUser(DAVE, (tx) =>
      tx.query(`update public.clients set assistant_paused = true where id = $1`, [carolClient]),
    );
    assert.equal(daveChanged.affectedRows, 0);
  });

  test("rate limits count requests per window and only the server can use them", async () => {
    const hit = () =>
      asServer(
        async (tx) => (await tx.query(`select public.hit_rate_limit('test:bucket', 3, 60) as ok`)).rows[0].ok,
        { commit: true },
      );
    assert.deepEqual([await hit(), await hit(), await hit(), await hit()], [true, true, true, false]);

    await rejects(asUser(CAROL, (tx) => tx.query(`select public.hit_rate_limit('x', 1, 60)`)), /permission denied/);
    await rejects(asAnon((tx) => tx.query(`select * from public.rate_limit_buckets`)), /permission denied/);
  });

  test("a client sees only their own rejected requests", async () => {
    await asServer(
      (tx) =>
        tx.query(
          `insert into public.public_api_rejections (client_id, reason, origin)
           values ($1, 'origin_not_allowed', 'https://evil.example'),
                  ($2, 'ip_rate_limited', 'https://davedental.com'),
                  (null, 'invalid_key', 'https://scanner.example')`,
          [carolClient, daveClient],
        ),
      { commit: true },
    );
    const carol = await asUser(CAROL, async (tx) => (await tx.query(`select reason, origin from public.public_api_rejections`)).rows);
    assert.deepEqual(carol, [{ reason: "origin_not_allowed", origin: "https://evil.example" }]);

    await rejects(asAnon((tx) => tx.query(`select reason from public.public_api_rejections`)), /permission denied/);
    await rejects(
      asServer((tx) => tx.query(`insert into public.public_api_rejections (reason) values ('made_up')`)),
      /public_api_rejections_reason_valid/,
    );
  });

  test("conversations record whether they came from the website", async () => {
    await rejects(
      asServer((tx) =>
        tx.query(
          `insert into public.conversations (client_id, session_id, visitor_message, assistant_reply, channel)
           values ($1, gen_random_uuid(), 'Hi', 'Hello', 'email')`,
          [carolClient],
        ),
      ),
      /conversations_channel_valid/,
    );
  });
});

describe("widget settings", () => {
  const CAROL = "33333333-3333-4333-8333-333333333333";
  const DAVE = "44444444-4444-4444-8444-444444444444";
  const asServer = (fn, options) => as("service_role", null, fn, options);
  let carolClient;

  before(async () => {
    const { rows } = await db.query(`select id from public.clients where user_id = $1`, [CAROL]);
    carolClient = rows[0].id;
  });

  test("every client gets widget settings with quick replies for its industry", async () => {
    const carol = (await db.query(`select * from public.widget_settings where client_id = $1`, [carolClient])).rows[0];
    assert.equal(carol.assistant_name, "Carol Dental");
    assert.equal(carol.welcome_message, "Hi! Welcome to Carol Dental. How can I help you today?");
    assert.deepEqual(carol.quick_replies, [
      { text: "Book an appointment", action: "appointment_form" },
      { text: "Clinic timings", action: "message" },
      { text: "Treatments we offer", action: "message" },
      { text: "Contact the clinic", action: "message" },
    ]);
    assert.equal(carol.brand_color, "#2952e3");
    assert.equal(carol.position, "right");
    assert.equal(carol.logo_path, null);

    let pharmacy;
    const EVE = "55555555-5555-4555-8555-555555555555";
    try {
      await db.transaction(async (tx) => {
        await tx.query(`insert into auth.users (id, email) values ($1, 'eve@pharmacy.test')`, [EVE]);
        await tx.query(
          `insert into public.clients (user_id, business_name, industry, website_domain)
           values ($1, 'Corner Pharmacy', 'pharmacy', 'corner.co.uk')`,
          [EVE],
        );
        pharmacy = (
          await tx.query(
            `select quick_replies from public.widget_settings w join public.clients c on c.id = w.client_id where c.user_id = $1`,
            [EVE],
          )
        ).rows;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    assert.deepEqual(pharmacy, [
      {
        quick_replies: [
          { text: "Opening hours", action: "message" },
          { text: "Check medicine availability", action: "message" },
          { text: "Home delivery", action: "message" },
          { text: "Request a callback", action: "appointment_form" },
        ],
      },
    ]);
  });

  test("a client can read and change only their own widget settings", async () => {
    await asUser(
      CAROL,
      (tx) =>
        tx.query(
          `update public.widget_settings
           set assistant_name = 'Carol Helper', brand_color = '#0f766e', position = 'left',
               welcome_message = 'Hello!', quick_replies = '[{"text": "Parking", "action": "message"}, {"text": "Book", "action": "appointment_form"}]'`,
        ),
      { commit: true },
    );
    const carol = (await db.query(`select * from public.widget_settings where client_id = $1`, [carolClient])).rows[0];
    assert.equal(carol.assistant_name, "Carol Helper");
    assert.deepEqual(carol.quick_replies, [
      { text: "Parking", action: "message" },
      { text: "Book", action: "appointment_form" },
    ]);

    const daveSees = await asUser(DAVE, async (tx) => (await tx.query(`select assistant_name from public.widget_settings`)).rows);
    assert.deepEqual(daveSees, [{ assistant_name: "Dave Dental" }]);

    const changed = await asUser(DAVE, (tx) =>
      tx.query(`update public.widget_settings set assistant_name = 'Hijacked' where client_id = $1`, [carolClient]),
    );
    assert.equal(changed.affectedRows, 0);
    await rejects(asAnon((tx) => tx.query(`select * from public.widget_settings`)), /permission denied/);
  });

  test("clients cannot set the logo, create or delete settings directly", async () => {
    await rejects(
      asUser(CAROL, (tx) =>
        tx.query(`update public.widget_settings set logo_path = '11111111-1111-4111-8111-111111111111.png'`),
      ),
      /permission denied/,
    );
    await rejects(asUser(CAROL, (tx) => tx.query(`delete from public.widget_settings`)), /permission denied/);
    await rejects(
      asUser(CAROL, (tx) =>
        tx.query(`insert into public.widget_settings (client_id, assistant_name, welcome_message) values ($1, 'X', 'Y')`, [
          carolClient,
        ]),
      ),
      /permission denied/,
    );
  });

  test("widget settings are checked by the database", async () => {
    const update = (sql) => asUser(CAROL, (tx) => tx.query(`update public.widget_settings set ${sql}`));
    await rejects(update(`brand_color = 'red'`), /widget_settings_brand_color_format/);
    await rejects(update(`brand_color = '#FFFFFF'`), /widget_settings_brand_color_format/);
    await rejects(update(`position = 'top'`), /widget_settings_position_valid/);
    await rejects(update(`assistant_name = '   '`), /widget_settings_assistant_name_length/);
    await rejects(update(`welcome_message = repeat('a', 501)`), /widget_settings_welcome_message_length/);
    const reply = (text, action = "message") => JSON.stringify({ text, action });
    const replies = (...items) => `quick_replies = '[${items.join(",")}]'`;
    await rejects(update(replies(...["1", "2", "3", "4", "5", "6", "7"].map((t) => reply(t)))), /widget_settings_quick_replies_valid/);
    await rejects(update(replies('"Parking"')), /widget_settings_quick_replies_valid/);
    await rejects(update(replies(reply(""))), /widget_settings_quick_replies_valid/);
    await rejects(update(replies(reply("a".repeat(41)))), /widget_settings_quick_replies_valid/);
    await rejects(update(replies(reply("Book", "open_door"))), /widget_settings_quick_replies_valid/);
    await rejects(update(replies('{"text": "Book", "action": "message", "url": "https://x.test"}')), /widget_settings_quick_replies_valid/);
    await rejects(
      asServer((tx) => tx.query(`update public.widget_settings set logo_path = '../other-client/logo.png'`)),
      /widget_settings_logo_path_format/,
    );
  });

  test("logos are public, limited to small images, and only the server can store them", async () => {
    const { rows } = await db.query(
      `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'widget-logos'`,
    );
    assert.deepEqual(rows, [
      { public: true, file_size_limit: 524288, allowed_mime_types: ["image/png", "image/jpeg", "image/webp"] },
    ]);
    await rejects(
      asUser(CAROL, (tx) =>
        tx.query(`insert into storage.objects (bucket_id, name) values ('widget-logos', 'logo.png')`),
      ),
      /row-level security/,
    );
  });

  test("widget settings are deleted together with their business", async () => {
    const remaining = await asServer(async (tx) => {
      await tx.query(`delete from public.clients where id = $1`, [carolClient]);
      return (await tx.query(`select count(*)::int as n from public.widget_settings where client_id = $1`, [carolClient])).rows[0].n;
    });
    assert.equal(remaining, 0);
  });
});

describe("leads", () => {
  const CAROL = "33333333-3333-4333-8333-333333333333";
  const DAVE = "44444444-4444-4444-8444-444444444444";
  const asServer = (fn, options) => as("service_role", null, fn, options);
  let carolClient;
  let daveClient;
  let carolLead;

  const submit = (clientId, mobile, options) =>
    asServer(
      async (tx) =>
        (
          await tx.query(
            `select public.submit_lead($1, ' Priya Sharma ', $2, current_date + 2, 'morning', '  ', gen_random_uuid(),
                                       'https://caroldental.com/services') as id`,
            [clientId, mobile],
          )
        ).rows[0].id,
      options,
    );

  before(async () => {
    const { rows } = await db.query(`select id, user_id from public.clients where user_id in ($1, $2)`, [CAROL, DAVE]);
    carolClient = rows.find((row) => row.user_id === CAROL).id;
    daveClient = rows.find((row) => row.user_id === DAVE).id;
  });

  test("the server saves a lead and cleans up its text", async () => {
    carolLead = await submit(carolClient, "+919845012345", { commit: true });
    assert.ok(carolLead);
    const { rows } = await db.query(`select * from public.leads where id = $1`, [carolLead]);
    assert.equal(rows[0].name, "Priya Sharma");
    assert.equal(rows[0].concern, null);
    assert.equal(rows[0].status, "new");
    assert.equal(rows[0].seen_at, null);
  });

  test("the same number cannot send a second request to the same clinic within 10 minutes", async () => {
    assert.equal(await submit(carolClient, "+919845012345"), null);
    assert.ok(await submit(carolClient, "+919845099999"), "another number is fine");
    assert.ok(await submit(daveClient, "+919845012345"), "another clinic is fine");

    const later = await asServer(async (tx) => {
      await tx.query(`update public.leads set created_at = now() - interval '11 minutes' where id = $1`, [carolLead]);
      const { rows } = await tx.query(
        `select public.submit_lead($1, 'Priya', '+919845012345', current_date, 'evening', null, null, null) as id`,
        [carolClient],
      );
      return rows[0].id;
    });
    assert.ok(later, "allowed again after 10 minutes");
  });

  test("leads are checked by the database", async () => {
    const insert = (values) =>
      asServer((tx) =>
        tx.query(
          `insert into public.leads (client_id, name, mobile, preferred_date, preferred_time, status, source_url)
           values ($1, $2, $3, current_date, $4, $5, $6)`,
          [carolClient, ...values],
        ),
      );
    await rejects(insert(["P", "+919845012345", "morning", "new", null]), /leads_name_length/);
    await rejects(insert(["Priya", "9845012345", "morning", "new", null]), /leads_mobile_format/);
    await rejects(insert(["Priya", "+919845012345", "night", "new", null]), /leads_preferred_time_valid/);
    await rejects(insert(["Priya", "+919845012345", "morning", "lost", null]), /leads_status_valid/);
    await rejects(insert(["Priya", "+919845012345", "morning", "new", "javascript:alert(1)"]), /leads_source_url_format/);
  });

  test("clients cannot create, delete or submit leads themselves", async () => {
    await rejects(
      asUser(CAROL, (tx) =>
        tx.query(
          `insert into public.leads (client_id, name, mobile, preferred_date, preferred_time)
           values ($1, 'Fake', '+919845012345', current_date, 'morning')`,
          [carolClient],
        ),
      ),
      /permission denied/,
    );
    await rejects(asUser(CAROL, (tx) => tx.query(`delete from public.leads`)), /permission denied/);
    await rejects(
      asUser(CAROL, (tx) =>
        tx.query(`select public.submit_lead($1, 'X', '+919845012345', current_date, 'morning', null, null, null)`, [
          carolClient,
        ]),
      ),
      /permission denied/,
    );
    await rejects(asAnon((tx) => tx.query(`select * from public.leads`)), /permission denied/);
  });

  test("a client sees and follows up only their own leads", async () => {
    const carolSees = await asUser(CAROL, async (tx) => (await tx.query(`select id from public.leads`)).rows);
    assert.deepEqual(carolSees, [{ id: carolLead }]);
    const daveSees = await asUser(
      DAVE,
      async (tx) => (await tx.query(`select id from public.leads where client_id = $1`, [carolClient])).rows,
    );
    assert.deepEqual(daveSees, []);

    const daveChanged = await asUser(DAVE, (tx) =>
      tx.query(`update public.leads set status = 'booked', notes = 'Hijacked' where id = $1`, [carolLead]),
    );
    assert.equal(daveChanged.affectedRows, 0);

    await asUser(
      CAROL,
      (tx) => tx.query(`update public.leads set status = 'contacted', notes = 'Called', seen_at = now() where id = $1`, [carolLead]),
      { commit: true },
    );
    const { rows } = await db.query(`select status, notes, seen_at from public.leads where id = $1`, [carolLead]);
    assert.equal(rows[0].status, "contacted");
    assert.equal(rows[0].notes, "Called");
    assert.ok(rows[0].seen_at);

    for (const column of ["name = 'Changed'", "mobile = '+919999999999'", `client_id = '${daveClient}'`, "created_at = now()"]) {
      await rejects(
        asUser(CAROL, (tx) => tx.query(`update public.leads set ${column} where id = $1`, [carolLead])),
        /permission denied/,
      );
    }
  });

  test("lead alerts are recorded by the server and visible only to their client", async () => {
    await asServer(
      (tx) =>
        tx.query(
          `insert into public.lead_notifications (lead_id, client_id, channel, recipient, status, provider_message_id)
           values ($1, $2, 'email', 'frontdesk@caroldental.com', 'sent', 'msg_123')`,
          [carolLead, carolClient],
        ),
      { commit: true },
    );
    const carolSees = await asUser(
      CAROL,
      async (tx) => (await tx.query(`select channel, recipient, status from public.lead_notifications`)).rows,
    );
    assert.deepEqual(carolSees, [{ channel: "email", recipient: "frontdesk@caroldental.com", status: "sent" }]);
    const daveSees = await asUser(DAVE, async (tx) => (await tx.query(`select recipient from public.lead_notifications`)).rows);
    assert.deepEqual(daveSees, []);

    await rejects(
      asUser(CAROL, (tx) => tx.query(`select provider_message_id from public.lead_notifications`)),
      /permission denied/,
    );
    await rejects(
      asUser(CAROL, (tx) =>
        tx.query(
          `insert into public.lead_notifications (lead_id, client_id, channel, recipient, status)
           values ($1, $2, 'email', 'x@y.com', 'sent')`,
          [carolLead, carolClient],
        ),
      ),
      /permission denied/,
    );
  });

  test("each client sets only their own lead alert addresses", async () => {
    const { rows } = await db.query(`select lead_alert_emails from public.notification_settings where client_id = $1`, [
      carolClient,
    ]);
    assert.deepEqual(rows, [{ lead_alert_emails: [] }]);

    await asUser(
      CAROL,
      (tx) => tx.query(`update public.notification_settings set lead_alert_emails = '{frontdesk@caroldental.com}'`),
      { commit: true },
    );
    const daveSees = await asUser(
      DAVE,
      async (tx) => (await tx.query(`select lead_alert_emails from public.notification_settings`)).rows,
    );
    assert.deepEqual(daveSees, [{ lead_alert_emails: [] }]);
    const daveChanged = await asUser(DAVE, (tx) =>
      tx.query(`update public.notification_settings set lead_alert_emails = '{dave@evil.test}' where client_id = $1`, [
        carolClient,
      ]),
    );
    assert.equal(daveChanged.affectedRows, 0);

    const update = (emails) => asUser(CAROL, (tx) => tx.query(`update public.notification_settings set lead_alert_emails = $1`, [emails]));
    await rejects(update(["not-an-email"]), /notification_settings_lead_alert_emails_valid/);
    await rejects(update(["a@b.co", "c@d.co", "e@f.co", "g@h.co", "i@j.co", "k@l.co"]), /notification_settings_lead_alert_emails_valid/);
    await rejects(asAnon((tx) => tx.query(`select * from public.notification_settings`)), /permission denied/);
  });

  test("leads and their alerts are deleted together with their business", async () => {
    const remaining = await asServer(async (tx) => {
      await tx.query(`delete from public.clients where id = $1`, [carolClient]);
      const count = async (table) =>
        (await tx.query(`select count(*)::int as n from public.${table} where client_id = $1`, [carolClient])).rows[0].n;
      return (await count("leads")) + (await count("lead_notifications"));
    });
    assert.equal(remaining, 0);
  });
});

describe("client dashboard", () => {
  const CAROL = "33333333-3333-4333-8333-333333333333";
  const DAVE = "44444444-4444-4444-8444-444444444444";
  const asServer = (fn, options) => as("service_role", null, fn, options);
  let carolClient;
  let daveClient;

  /** A 1024-dimension vector with the given values in its first places. */
  const vector = (...values) => `[${[...values, ...Array(1024 - values.length).fill(0)].join(",")}]`;
  const SESSION_A = "aaaaaaaa-0000-4000-8000-000000000001";
  const SESSION_B = "aaaaaaaa-0000-4000-8000-000000000002";
  const SESSION_DAVE = "dddddddd-0000-4000-8000-000000000001";
  const SESSION_TEST = "eeeeeeee-0000-4000-8000-000000000005";

  const record = (clientId, category, topic, question, embedding) =>
    asServer(
      async (tx) =>
        (
          await tx.query(`select public.record_knowledge_gap($1, $2, $3, $4, $5, $6::extensions.vector) as id`, [
            clientId,
            category,
            topic,
            question,
            SESSION_A,
            embedding,
          ])
        ).rows[0].id,
      { commit: true },
    );

  before(async () => {
    const { rows } = await db.query(`select id, user_id from public.clients where user_id in ($1, $2)`, [CAROL, DAVE]);
    carolClient = rows.find((row) => row.user_id === CAROL).id;
    daveClient = rows.find((row) => row.user_id === DAVE).id;
  });

  test("conversations keep only web page addresses", async () => {
    await rejects(
      asServer((tx) =>
        tx.query(
          `insert into public.conversations (client_id, session_id, visitor_message, assistant_reply, channel, page_url)
           values ($1, gen_random_uuid(), 'Hi', 'Hello', 'website', 'javascript:alert(1)')`,
          [carolClient],
        ),
      ),
      /conversations_page_url_format/,
    );
  });

  test("similar unanswered questions are grouped, different ones are not", async () => {
    const whitening = await record(carolClient, "fees", "Teeth whitening price", "How much is whitening?", vector(1, 0));
    const sameMeaning = await record(carolClient, "fees", "Cost of teeth whitening", "Whitening cost?", vector(0.98, 0.2));
    const rootCanal = await record(carolClient, "fees", "Root canal price", "Root canal charges?", vector(0, 1));
    const otherCategory = await record(carolClient, "timings", "Teeth whitening price", "Odd", vector(1, 0));
    const noEmbedding = await record(carolClient, "location", "Parking", "Is there parking?", null);
    const sameTopic = await record(carolClient, "location", "parking", "Where can I park?", null);
    const daveGap = await record(daveClient, "fees", "Teeth whitening price", "Whitening?", vector(1, 0));

    assert.equal(sameMeaning, whitening, "a similar question joins the existing gap");
    assert.notEqual(rootCanal, whitening, "a different fee is a separate gap");
    assert.notEqual(otherCategory, whitening, "another category is a separate gap");
    assert.equal(sameTopic, noEmbedding, "without embeddings, the same topic is grouped");
    assert.notEqual(daveGap, whitening, "another clinic's question never joins this clinic's gap");

    const { rows } = await db.query(`select question_count from public.knowledge_gaps where id = $1`, [whitening]);
    assert.equal(rows[0].question_count, 2);
    const questions = await db.query(`select count(*)::int as n from public.knowledge_gap_questions where gap_id = $1`, [whitening]);
    assert.equal(questions.rows[0].n, 2);
  });

  test("a client sees and resolves only their own gaps", async () => {
    const carolSees = await asUser(CAROL, async (tx) => (await tx.query(`select topic, question_count from public.knowledge_gaps order by topic`)).rows);
    assert.deepEqual(carolSees.map((row) => row.topic), ["Parking", "Root canal price", "Teeth whitening price", "Teeth whitening price"]);
    const daveSees = await asUser(DAVE, async (tx) => (await tx.query(`select client_id from public.knowledge_gaps`)).rows);
    assert.ok(daveSees.every((row) => row.client_id === daveClient));
    const daveQuestions = await asUser(DAVE, async (tx) => (await tx.query(`select question from public.knowledge_gap_questions`)).rows);
    assert.deepEqual(daveQuestions, [{ question: "Whitening?" }]);

    const [whitening] = (
      await db.query(`select id from public.knowledge_gaps where client_id = $1 and topic = 'Teeth whitening price' and category = 'fees'`, [carolClient])
    ).rows;
    const daveChanged = await asUser(DAVE, (tx) =>
      tx.query(`update public.knowledge_gaps set status = 'resolved' where id = $1`, [whitening.id]),
    );
    assert.equal(daveChanged.affectedRows, 0);

    await asUser(CAROL, (tx) => tx.query(`update public.knowledge_gaps set status = 'resolved', resolved_at = now() where id = $1`, [whitening.id]), {
      commit: true,
    });
    assert.equal((await db.query(`select status from public.knowledge_gaps where id = $1`, [whitening.id])).rows[0].status, "resolved");

    for (const change of ["topic = 'Changed'", "question_count = 0", `client_id = '${daveClient}'`]) {
      await rejects(asUser(CAROL, (tx) => tx.query(`update public.knowledge_gaps set ${change} where id = $1`, [whitening.id])), /permission denied/);
    }
    await rejects(asUser(CAROL, (tx) => tx.query(`select embedding from public.knowledge_gaps`)), /permission denied/);
    await rejects(asUser(CAROL, (tx) => tx.query(`delete from public.knowledge_gaps`)), /permission denied/);
    await rejects(
      asUser(CAROL, (tx) => tx.query(`select public.record_knowledge_gap($1, 'fees', 'X', 'X', null, null)`, [carolClient])),
      /permission denied/,
    );
    await rejects(asAnon((tx) => tx.query(`select * from public.knowledge_gaps`)), /permission denied/);
  });

  test("a resolved gap opens again when a visitor asks about it again", async () => {
    const id = await record(carolClient, "fees", "Price of whitening", "Whitening price please", vector(0.99, 0.1));
    const { rows } = await db.query(`select status, resolved_at, question_count from public.knowledge_gaps where id = $1`, [id]);
    assert.deepEqual(rows[0], { status: "open", resolved_at: null, question_count: 3 });
  });

  test("the conversation list shows each client only their own website conversations", async () => {
    await asServer(
      async (tx) => {
        const insert = (clientId, session, message, minutesAgo, channel = "website", page = null) =>
          tx.query(
            `insert into public.conversations (client_id, session_id, visitor_message, assistant_reply, channel, page_url, created_at)
             values ($1, $2, $3, 'Reply about ' || $3, $4, $5, now() - make_interval(mins => $6))`,
            [clientId, session, message, channel, page, minutesAgo],
          );
        await insert(carolClient, SESSION_A, "Do you do whitening?", 30, "website", "https://caroldental.com/whitening");
        await insert(carolClient, SESSION_A, "What does it cost?", 29);
        await insert(carolClient, SESSION_B, "Are you open on Sunday?", 10, "website", "https://caroldental.com/");
        await insert(carolClient, SESSION_TEST, "Test message from the dashboard", 5, "test");
        await insert(daveClient, SESSION_DAVE, "Dave's visitor asks about braces", 20);
        await tx.query(
          `insert into public.leads (client_id, name, mobile, preferred_date, preferred_time, conversation_id)
           values ($1, 'Priya', '+919845012345', current_date + 1, 'morning', $2)`,
          [carolClient, SESSION_A],
        );
      },
      { commit: true },
    );

    const list = (userId, args = "") =>
      asUser(userId, async (tx) => (await tx.query(`select * from public.conversation_list(${args})`)).rows);

    const carol = await list(CAROL);
    assert.deepEqual(
      carol.map((row) => [row.session_id, row.message_count, row.first_message, row.page_url, Boolean(row.lead_id), Number(row.total_count)]),
      [
        [SESSION_B, 1, "Are you open on Sunday?", "https://caroldental.com/", false, 2],
        [SESSION_A, 2, "Do you do whitening?", "https://caroldental.com/whitening", true, 2],
      ],
    );
    const dave = await list(DAVE);
    assert.deepEqual(dave.map((row) => row.session_id), [SESSION_DAVE]);

    assert.deepEqual((await list(CAROL, `p_query => 'COST'`)).map((row) => row.session_id), [SESSION_A], "search covers every message");
    assert.deepEqual((await list(CAROL, `p_query => 'reply about are you'`)).map((row) => row.session_id), [SESSION_B], "and replies");
    assert.deepEqual(await list(CAROL, `p_query => 'braces'`), [], "never another clinic's messages");
    assert.deepEqual(await list(CAROL, `p_query => '100%'`), [], "search text is literal");
    assert.deepEqual((await list(CAROL, `p_has_lead => true`)).map((row) => row.session_id), [SESSION_A]);
    assert.deepEqual((await list(CAROL, `p_has_lead => false`)).map((row) => row.session_id), [SESSION_B]);
    assert.deepEqual((await list(CAROL, `p_from => now() - interval '15 minutes'`)).map((row) => row.session_id), [SESSION_B]);
    assert.deepEqual((await list(CAROL, `p_limit => 1, p_offset => 1`)).map((row) => row.session_id), [SESSION_A]);
    await rejects(asAnon((tx) => tx.query(`select * from public.conversation_list()`)), /permission denied/);
  });

  test("daily numbers count only the client's own website activity, by day in their time zone", async () => {
    // 20:00 UTC is already the next day (01:30) in India.
    await asServer(
      (tx) =>
        tx.query(
          `insert into public.conversations (client_id, session_id, visitor_message, assistant_reply, channel, created_at)
           values ($1, gen_random_uuid(), 'Late question', 'Answer', 'website', '2026-11-01 20:00:00+00')`,
          [carolClient],
        ),
      { commit: true },
    );
    const days = (userId, from, to, zone) =>
      asUser(userId, async (tx) =>
        (await tx.query(`select day::text, conversations, messages, leads from public.dashboard_daily($1, $2, $3)`, [from, to, zone])).rows,
      );

    assert.deepEqual(await days(CAROL, "2026-11-01", "2026-11-02", "Asia/Kolkata"), [
      { day: "2026-11-01", conversations: 0, messages: 0, leads: 0 },
      { day: "2026-11-02", conversations: 1, messages: 1, leads: 0 },
    ]);
    assert.deepEqual(await days(CAROL, "2026-11-01", "2026-11-02", "UTC"), [
      { day: "2026-11-01", conversations: 1, messages: 1, leads: 0 },
      { day: "2026-11-02", conversations: 0, messages: 0, leads: 0 },
    ]);
    assert.deepEqual(await days(DAVE, "2026-11-01", "2026-11-02", "Asia/Kolkata"), [
      { day: "2026-11-01", conversations: 0, messages: 0, leads: 0 },
      { day: "2026-11-02", conversations: 0, messages: 0, leads: 0 },
    ]);

    const today = (await db.query(`select (now() at time zone 'Asia/Kolkata')::date::text as day`)).rows[0].day;
    const [carolToday] = await days(CAROL, today, today, "Asia/Kolkata");
    const carolLeadsToday = (
      await db.query(
        `select count(*)::int as n from public.leads where client_id = $1 and (created_at at time zone 'Asia/Kolkata')::date = $2::date`,
        [carolClient, today],
      )
    ).rows[0].n;
    // Today: sessions A and B (2 conversations, 3 visitor messages; test messages are not counted), and every lead
    // Carol received today, including Priya's.
    assert.ok(carolLeadsToday >= 1);
    assert.deepEqual(carolToday, { day: today, conversations: 2, messages: 3, leads: carolLeadsToday });
    await rejects(asAnon((tx) => tx.query(`select * from public.dashboard_daily(current_date, current_date, 'UTC')`)), /permission denied/);
  });

  test("gaps, gap questions and new columns are deleted together with their business", async () => {
    const remaining = await asServer(async (tx) => {
      await tx.query(`delete from public.clients where id = $1`, [carolClient]);
      const count = async (table) =>
        (await tx.query(`select count(*)::int as n from public.${table} where client_id = $1`, [carolClient])).rows[0].n;
      return (await count("knowledge_gaps")) + (await count("knowledge_gap_questions")) + (await count("conversations"));
    });
    assert.equal(remaining, 0);
  });
});

