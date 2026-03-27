import { Surreal } from "surrealdb";
import type { Config } from "../config/index.js";
import { resolveDbPath } from "../config/index.js";

let instance: Surreal | null = null;

export async function connect(config: Config): Promise<Surreal> {
  if (instance) return instance;

  const db = new Surreal();

  if (config.surrealdb.mode === "embedded") {
    const dbPath = resolveDbPath(config.surrealdb.path);
    await db.connect(`surrealkv://${dbPath}`);
  } else {
    const url = config.surrealdb.url ?? "http://127.0.0.1:8000";
    await db.connect(url);

    // Authenticate for remote mode
    if (config.surrealdb.username && config.surrealdb.password) {
      await db.signin({
        username: config.surrealdb.username,
        password: config.surrealdb.password,
      });
    }
  }

  // Ensure namespace and database exist (requires root auth)
  await db.query(
    `DEFINE NAMESPACE IF NOT EXISTS ${config.surrealdb.namespace}`,
  );
  await db.use({ namespace: config.surrealdb.namespace });
  await db.query(
    `DEFINE DATABASE IF NOT EXISTS ${config.surrealdb.database}`,
  );
  await db.use({
    namespace: config.surrealdb.namespace,
    database: config.surrealdb.database,
  });

  instance = db;
  return db;
}

export async function disconnect(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
  }
}

export function getDb(): Surreal {
  if (!instance) {
    throw new Error("Database not connected. Call connect() first.");
  }
  return instance;
}
