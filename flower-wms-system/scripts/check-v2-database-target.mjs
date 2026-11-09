import "dotenv/config";

function readTarget(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length < 2) {
      throw new Error();
    }
    return url;
  } catch {
    throw new Error(`${name} must name a PostgreSQL database`);
  }
}

const v2 = readTarget("V2_DATABASE_URL");
const targets = [["V2_DATABASE_URL", v2]];
if (process.env.DATABASE_URL) {
  const legacy = readTarget("DATABASE_URL");
  if (decodeURIComponent(v2.pathname) === decodeURIComponent(legacy.pathname)) {
    throw new Error("V1 and V2 must use distinct PostgreSQL database names");
  }
  targets.push(["DATABASE_URL", legacy]);
}

if (process.argv.includes("--connect")) {
  const { Client } = await import("pg");
  for (const [name, url] of targets) {
    const client = new Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
    try {
      await client.connect();
      const result = await client.query("SELECT current_database() AS name");
      if (result.rows[0]?.name !== decodeURIComponent(url.pathname.slice(1))) {
        throw new Error("Unexpected PostgreSQL database");
      }
    } catch {
      throw new Error(`Cannot connect to the database configured by ${name}`);
    } finally {
      await client.end();
    }
  }
}
