import { AsyncLocalStorage } from "node:async_hooks";
import { Client } from "pg";
import type { SessionContext } from "../../src/types";

export type QaScope = {
  session: SessionContext | null;
  role: "authenticated" | "anon" | "service_role";
  intakeHash?: string;
};
export const scope = new AsyncLocalStorage<QaScope>();
const connectionString = process.env.SUPABASE_DB_URL;
if (
  !connectionString ||
  !["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(connectionString).hostname,
  )
) {
  throw new Error(
    "SUPABASE_DB_URL must identify a disposable loopback database",
  );
}
export async function connect() {
  const c = new Client({ connectionString });
  await c.connect();
  return c;
}
function identifier(value: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value))
    throw new Error("Invalid QA SQL identifier");
  return `"${value}"`;
}
export async function withSql<T>(
  context: QaScope,
  run: (c: Client) => Promise<T>,
) {
  const c = await connect();
  try {
    await c.query(`BEGIN; SET LOCAL ROLE ${context.role}`);
    await c.query(
      "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",
      [context.session?.profileId ?? "", context.role],
    );
    const result = await run(c);
    await c.query("COMMIT");
    return result;
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    await c.end();
  }
}
type Result = {
  data: unknown;
  error: { code: string; message: string } | null;
  count?: number;
};
function failed(e: unknown): Result {
  const error = e as { code?: string; message?: string };
  return {
    data: null,
    error: {
      code: error.code ?? "qa_error",
      message: error.message ?? "QA query failed",
    },
  };
}

class Query {
  private columns = "*";
  private mode: "select" | "insert" | "update" = "select";
  private values: Record<string, unknown> = {};
  private filters: Array<{
    column: string;
    operation: "eq" | "is" | "in" | "ilike";
    value: unknown;
  }> = [];
  private ordering: Array<{ column: string; ascending: boolean }> = [];
  private size?: number;
  private offset = 0;
  private cardinality: "many" | "one" | "maybe" = "many";
  private exactCount = false;
  constructor(
    private table: string,
    private context: QaScope,
  ) {}
  select(columns: string, options?: { count?: string }) {
    this.columns = columns;
    this.exactCount = options?.count === "exact";
    return this;
  }
  insert(values: Record<string, unknown>) {
    this.mode = "insert";
    this.values = values;
    return this;
  }
  update(values: Record<string, unknown>) {
    this.mode = "update";
    this.values = values;
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push({ column, operation: "eq", value });
    return this;
  }
  is(column: string, value: unknown) {
    this.filters.push({ column, operation: "is", value });
    return this;
  }
  in(column: string, value: unknown[]) {
    this.filters.push({ column, operation: "in", value });
    return this;
  }
  ilike(column: string, value: string) {
    this.filters.push({ column, operation: "ilike", value });
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.ordering.push({ column, ascending: options?.ascending !== false });
    return this;
  }
  limit(size: number) {
    this.size = size;
    return this;
  }
  range(start: number, end: number) {
    this.offset = start;
    this.size = end - start + 1;
    return this;
  }
  single() {
    this.cardinality = "one";
    return this;
  }
  maybeSingle() {
    this.cardinality = "maybe";
    return this;
  }
  then<T = Result>(
    resolve: (value: Result) => T | PromiseLike<T>,
    reject?: (reason: unknown) => T | PromiseLike<T>,
  ) {
    return this.execute().then(resolve, reject);
  }
  private async execute(): Promise<Result> {
    try {
      return await withSql(this.context, async (c) => {
        const params: unknown[] = [];
        const bind = (v: unknown) => {
          params.push(v);
          return `$${params.length}`;
        };
        const where = this.filters.map((f) => {
          const field = identifier(f.column);
          if (f.operation === "is" && f.value === null)
            return `${field} IS NULL`;
          if (f.operation === "in")
            return `${field} IN (${(f.value as unknown[]).map(bind).join(",") || "NULL"})`;
          return `${field} ${f.operation === "ilike" ? "ILIKE" : "="} ${bind(f.value)}`;
        });
        const selection =
          this.columns === "*"
            ? "*"
            : this.columns
                .split(",")
                .map((item) => {
                  const bits = item.trim().split(":");
                  return bits.length === 2
                    ? `${identifier(bits[1])} AS ${identifier(bits[0])}`
                    : identifier(bits[0]);
                })
                .join(",");
        let sql: string;
        if (this.mode === "select") {
          sql = `SELECT ${selection} FROM public.${identifier(this.table)}${where.length ? " WHERE " + where.join(" AND ") : ""}`;
          if (this.ordering.length)
            sql +=
              " ORDER BY " +
              this.ordering
                .map(
                  (o) =>
                    `${identifier(o.column)} ${o.ascending ? "ASC" : "DESC"}`,
                )
                .join(",");
          if (this.size !== undefined)
            sql += ` LIMIT ${bind(this.size)} OFFSET ${bind(this.offset)}`;
        } else if (this.mode === "insert") {
          const keys = Object.keys(this.values);
          sql = `INSERT INTO public.${identifier(this.table)}(${keys.map(identifier).join(",")}) VALUES(${keys.map((k) => bind(this.values[k])).join(",")}) RETURNING ${selection}`;
        } else {
          const keys = Object.keys(this.values);
          sql = `UPDATE public.${identifier(this.table)} SET ${keys.map((k) => `${identifier(k)}=${bind(this.values[k])}`).join(",")}${where.length ? " WHERE " + where.join(" AND ") : ""} RETURNING ${selection}`;
        }
        const result =
          this.mode === "select"
            ? await c.query(
                `SELECT to_jsonb(row) value FROM (${sql}) row`,
                params,
              )
            : await c.query(
                `WITH changed AS (${sql}) SELECT to_jsonb(changed) value FROM changed`,
                params,
              );
        const rows = result.rows.map((r) => r.value);
        if (this.cardinality === "one" && rows.length !== 1)
          return {
            data: null,
            error: { code: "PGRST116", message: "Row cardinality mismatch" },
          };
        if (this.cardinality === "maybe" && rows.length > 1)
          return {
            data: null,
            error: { code: "PGRST116", message: "Row cardinality mismatch" },
          };
        return {
          data: this.cardinality === "many" ? rows : (rows[0] ?? null),
          error: null,
          ...(this.exactCount ? { count: rows.length } : {}),
        };
      });
    } catch (e) {
      return failed(e);
    }
  }
}

/** Test-only transport. Production helpers and SQL/RLS are real; auth sessions
 * and the Supabase transport are injected. No hosted accounts or keys exist. */
export function pgClient(
  context: QaScope = scope.getStore() ?? { session: null, role: "anon" },
) {
  return {
    from: (table: string) => new Query(table, context),
    rpc: async (
      name: string,
      args: Record<string, unknown>,
    ): Promise<Result> => {
      try {
        return await withSql(context, async (c) => {
          const shape = await c.query(
            "SELECT p.proretset is_set,jsonb_object_agg(p.proargnames[a.i],t.typname) input_types FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL unnest(p.proargtypes::oid[]) WITH ORDINALITY a(type_id,i) JOIN pg_type t ON t.oid=a.type_id WHERE n.nspname='public' AND p.proname=$1 AND p.proargnames @> $2::text[] GROUP BY p.oid,p.proretset ORDER BY p.pronargs DESC LIMIT 1",
            [name, Object.keys(args)],
          );
          const entries = Object.entries(args);
          const call = `public.${identifier(name)}(${entries.map(([key], i) => `${identifier(key)}=>$${i + 1}`).join(",")})`;
          const r = await c.query(
            shape.rows[0].is_set
              ? `SELECT to_jsonb(row) value FROM ${call} row`
              : `SELECT to_jsonb(${call}) value`,
            entries.map(([key, value]) =>
              value !== null &&
              ["json", "jsonb"].includes(shape.rows[0].input_types[key])
                ? JSON.stringify(value)
                : value,
            ),
          );
          return {
            data: shape.rows[0].is_set
              ? r.rows.map((row) => row.value)
              : (r.rows[0]?.value ?? null),
            error: null,
          };
        });
      } catch (e) {
        return failed(e);
      }
    },
  };
}
