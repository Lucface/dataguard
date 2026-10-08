/**
 * Database Adapters
 *
 * Provides unified interface for different database backends.
 */

import type { DatabaseAdapter } from './types';

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

  constructor(connectionString: string) {
    const { Pool } = require('@neondatabase/serverless');
    const ws = require('ws');
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
export class PostgresAdapter implements DatabaseAdapter {
  private pool: any;

  constructor(connectionString: string) {
    const { Pool } = require('pg');
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
export class MySQLAdapter implements DatabaseAdapter {
  private pool: any;

  constructor(connectionConfig: any) {
    const mysql = require('mysql2/promise');
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

/**
 * SQLite Adapter
 */
export class SQLiteAdapter implements DatabaseAdapter {
  private db: any;

  constructor(filepath: string) {
    const sqlite3 = require('better-sqlite3');
    this.db = sqlite3(filepath);
  }

  async execute(query: string): Promise<any> {
    const stmt = this.db.prepare(query);
    if (stmt.reader) {
      return { rows: stmt.all() };
    }
    stmt.run();
    return { rows: [] };
  }

  async select(table: string, where?: any): Promise<any[]> {
    let query = `SELECT * FROM ${table}`;
    if (where) {
      const conditions = Object.entries(where)
        .map(([key]) => `${key} = ?`)
        .join(' AND ');
      query += ` WHERE ${conditions}`;
      return this.db.prepare(query).all(...Object.values(where));
    }
    return this.db.prepare(query).all();
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
      if (!config.connectionString) throw new Error('Connection string required for Neon');
      return new NeonAdapter(config.connectionString);

    case 'neon-pool':
      if (!config.connectionString) throw new Error('Connection string required for Neon Pool');
      return new NeonPoolAdapter(config.connectionString);

    case 'drizzle':
      if (!config.db) throw new Error('Drizzle db instance required');
      return new DrizzleAdapter(config.db);

    case 'postgres':
      if (!config.connectionString) throw new Error('Connection string required for PostgreSQL');
      return new PostgresAdapter(config.connectionString);

    case 'mysql':
      if (!config.connectionConfig) throw new Error('Connection config required for MySQL');
      return new MySQLAdapter(config.connectionConfig);

    case 'sqlite':
      if (!config.connectionString) throw new Error('Filepath required for SQLite');
      return new SQLiteAdapter(config.connectionString);

    default:
      throw new Error(`Unsupported database type: ${config.type}`);
  }
}
