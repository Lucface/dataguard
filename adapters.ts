/**
 * Database Adapters
 *
 * Provides unified interface for different database backends.
 */

import type { DatabaseAdapter } from './types';

/**
 * A setup mistake a person fixes by changing the config or installing a package.
 * The message is always one line.
 */
export class AdapterSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterSetupError';
  }
}

export type DriverLoader = (name: string) => unknown;

const defaultLoader: DriverLoader = name => require(name);

function readStringField(error: unknown, field: 'code' | 'message'): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}

function messageQuotesPackage(message: string, name: string): boolean {
  return message.includes(`'${name}'`) || message.includes(`"${name}"`);
}

export function loadDriver(name: string, load: DriverLoader = defaultLoader, moduleId: string = name): unknown {
  try {
    return load(moduleId);
  } catch (error) {
    const code = readStringField(error, 'code');
    const message = readStringField(error, 'message');
    const missing = code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND';
    const quoted = message !== undefined && (
      messageQuotesPackage(message, moduleId) || messageQuotesPackage(message, name)
    );
    if (missing && quoted) {
      throw new AdapterSetupError(
        `The ${name} package is not installed. Install it with: bun add ${name}`
      );
    }
    throw error;
  }
}

function pathForMessage(filepath: string): string {
  if (filepath === '' || filepath === ':memory:' || filepath.startsWith('file:')) {
    return filepath;
  }
  const path = require('path') as typeof import('path');
  const resolved = path.resolve(filepath);
  if (resolved === filepath) return filepath;
  return `${filepath} (${resolved})`;
}

function firstLine(text: string): string {
  const newline = text.indexOf('\n');
  const line = newline === -1 ? text : text.slice(0, newline);
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function driverReason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return firstLine(text);
}

function pathIsFolder(filepath: string): boolean {
  const fs = require('fs') as typeof import('fs');
  try {
    return fs.statSync(filepath).isDirectory();
  } catch {
    return false;
  }
}

function sqliteOpenFailure(filepath: string, error: unknown): AdapterSetupError {
  const fs = require('fs') as typeof import('fs');
  const shown = pathForMessage(filepath);
  const ordinary = filepath !== '' && filepath !== ':memory:' && !filepath.startsWith('file:');
  if (ordinary && !fs.existsSync(filepath)) {
    return new AdapterSetupError(
      `No SQLite database at ${shown}. dataguard opens existing files read-only. Check database.connectionString.`
    );
  }
  if (pathIsFolder(filepath)) {
    return new AdapterSetupError(
      `${shown} is a folder. database.connectionString must be the path to a SQLite database file.`
    );
  }
  return new AdapterSetupError(
    `Could not open the SQLite database at ${shown}. The driver said: ${driverReason(error)}`
  );
}

function rethrowSqliteRead(filepath: string, error: unknown): never {
  if (readStringField(error, 'code') === 'SQLITE_READONLY_DIRECTORY') {
    const shown = pathForMessage(filepath);
    throw new AdapterSetupError(
      `SQLite could not read ${shown} because it cannot write in that folder (SQLITE_READONLY_DIRECTORY). This happens with a database in WAL mode, which needs its -shm file there even to be read. Copy the database, with its -wal file if there is one, to a folder you can write to and point database.connectionString at the copy.`
    );
  }
  throw error;
}

/**
 * Neon Serverless Adapter (PostgreSQL)
 */
export class NeonAdapter implements DatabaseAdapter {
  private sql: any;

  constructor(connectionString: string) {
    // Lazy load to avoid requiring neon in all contexts
    const { neon } = require('@neondatabase/serverless');
    this.sql = neon(connectionString);
  }

  async execute(query: string): Promise<any> {
    const result = await this.sql(query);
    return { rows: result };
  }

  async select(table: string, where?: any): Promise<any[]> {
    let query = `SELECT * FROM ${table}`;
    if (where) {
      const conditions = Object.entries(where)
        .map(([key, value]) => `${key} = '${value}'`)
        .join(' AND ');
      query += ` WHERE ${conditions}`;
    }
    const result = await this.sql(query);
    return result;
  }

  async disconnect(): Promise<void> {
    // Neon serverless doesn't need explicit disconnect
  }
}

/**
 * Neon Pool Adapter (PostgreSQL with connection pooling)
 */
export class NeonPoolAdapter implements DatabaseAdapter {
  private pool: any;

  constructor(connectionString: string, load: DriverLoader = defaultLoader) {
    const { Pool } = require('@neondatabase/serverless');
    const ws = loadDriver('ws', load);
    const { neonConfig } = require('@neondatabase/serverless');

    neonConfig.webSocketConstructor = ws;
    this.pool = new Pool({ connectionString });
  }

  async execute(query: string): Promise<any> {
    return await this.pool.query(query);
  }

  async select(table: string, where?: any): Promise<any[]> {
    let query = `SELECT * FROM ${table}`;
    if (where) {
      const conditions = Object.entries(where)
        .map(([key, value]) => `${key} = '${value}'`)
        .join(' AND ');
      query += ` WHERE ${conditions}`;
    }
    const result = await this.pool.query(query);
    return result.rows;
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Drizzle ORM Adapter
 */
export class DrizzleAdapter implements DatabaseAdapter {
  private db: any;

  constructor(db: any) {
    this.db = db;
  }

  async execute(query: string): Promise<any> {
    // For Drizzle, we use sql template
    const { sql } = require('drizzle-orm');
    const result = await this.db.execute(sql.raw(query));
    return result;
  }

  async select(table: string, where?: any): Promise<any[]> {
    // This is simplified - in reality you'd need the schema
    const query = `SELECT * FROM ${table}`;
    const { sql } = require('drizzle-orm');
    const result = await this.db.execute(sql.raw(query));
    return result.rows || [];
  }

  async disconnect(): Promise<void> {
    // Drizzle doesn't manage connections directly
  }
}

/**
 * PostgreSQL (pg) Adapter
 */
interface PgDriver {
  Pool: new (config: { connectionString: string }) => object;
}

export class PostgresAdapter implements DatabaseAdapter {
  private pool: any;

  constructor(connectionString: string, load: DriverLoader = defaultLoader) {
    const { Pool } = loadDriver('pg', load) as PgDriver;
    this.pool = new Pool({ connectionString });
  }

  async execute(query: string): Promise<any> {
    return await this.pool.query(query);
  }

  async select(table: string, where?: any): Promise<any[]> {
    let query = `SELECT * FROM ${table}`;
    if (where) {
      const conditions = Object.entries(where)
        .map(([key, value]) => `${key} = $${Object.keys(where).indexOf(key) + 1}`)
        .join(' AND ');
      query += ` WHERE ${conditions}`;
      const result = await this.pool.query(query, Object.values(where));
      return result.rows;
    }
    const result = await this.pool.query(query);
    return result.rows;
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * MySQL Adapter
 */
interface MysqlDriver {
  createPool(config: unknown): object;
}

export class MySQLAdapter implements DatabaseAdapter {
  private pool: any;

  constructor(connectionConfig: any, load: DriverLoader = defaultLoader) {
    const mysql = loadDriver('mysql2', load, 'mysql2/promise') as MysqlDriver;
    this.pool = mysql.createPool(connectionConfig);
  }

  async execute(query: string): Promise<any> {
    const [rows] = await this.pool.query(query);
    return { rows };
  }

  async select(table: string, where?: any): Promise<any[]> {
    let query = `SELECT * FROM ${table}`;
    if (where) {
      const conditions = Object.entries(where)
        .map(([key, value]) => `${key} = ?`)
        .join(' AND ');
      query += ` WHERE ${conditions}`;
      const [rows] = await this.pool.query(query, Object.values(where));
      return rows as any[];
    }
    const [rows] = await this.pool.query(query);
    return rows as any[];
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }
}

interface SqliteStatement {
  reader: boolean;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
}

interface SqliteHandle {
  prepare(query: string): SqliteStatement;
  close(): void;
}

interface SqliteOpenOptions {
  readonly: boolean;
  fileMustExist: boolean;
}

type SqliteOpen = (filename: string, options: SqliteOpenOptions) => SqliteHandle;

/**
 * SQLite Adapter
 */
export class SQLiteAdapter implements DatabaseAdapter {
  private db: SqliteHandle;
  private filepath: string;

  constructor(filepath: string, load: DriverLoader = defaultLoader) {
    this.filepath = filepath;
    const open = loadDriver('better-sqlite3', load) as SqliteOpen;
    try {
      this.db = open(filepath, { readonly: true, fileMustExist: true });
    } catch (error) {
      throw sqliteOpenFailure(filepath, error);
    }
  }

  async execute(query: string): Promise<any> {
    try {
      const stmt = this.db.prepare(query);
      if (stmt.reader) {
        return { rows: stmt.all() };
      }
      stmt.run();
      return { rows: [] };
    } catch (error) {
      rethrowSqliteRead(this.filepath, error);
    }
  }

  async select(table: string, where?: any): Promise<any[]> {
    try {
      let query = `SELECT * FROM ${table}`;
      if (where) {
        const conditions = Object.entries(where)
          .map(([key]) => `${key} = ?`)
          .join(' AND ');
        query += ` WHERE ${conditions}`;
        return this.db.prepare(query).all(...Object.values(where));
      }
      return this.db.prepare(query).all();
    } catch (error) {
      rethrowSqliteRead(this.filepath, error);
    }
  }

  async disconnect(): Promise<void> {
    this.db.close();
  }
}

/**
 * Factory function to create appropriate adapter
 */
export function createAdapter(config: {
  type: 'neon' | 'neon-pool' | 'drizzle' | 'postgres' | 'mysql' | 'sqlite';
  connectionString?: string;
  connectionConfig?: any;
  db?: any;
}): DatabaseAdapter {
  switch (config.type) {
    case 'neon':
      if (!config.connectionString) throw new AdapterSetupError('Connection string required for Neon');
      return new NeonAdapter(config.connectionString);

    case 'neon-pool':
      if (!config.connectionString) throw new AdapterSetupError('Connection string required for Neon Pool');
      return new NeonPoolAdapter(config.connectionString);

    case 'drizzle':
      if (!config.db) throw new AdapterSetupError('Drizzle db instance required');
      return new DrizzleAdapter(config.db);

    case 'postgres':
      if (!config.connectionString) throw new AdapterSetupError('Connection string required for PostgreSQL');
      return new PostgresAdapter(config.connectionString);

    case 'mysql':
      if (!config.connectionConfig) throw new AdapterSetupError('Connection config required for MySQL');
      return new MySQLAdapter(config.connectionConfig);

    case 'sqlite':
      if (!config.connectionString) throw new AdapterSetupError('Filepath required for SQLite');
      return new SQLiteAdapter(config.connectionString);

    default:
      throw new AdapterSetupError(`Unsupported database type: ${config.type}`);
  }
}
