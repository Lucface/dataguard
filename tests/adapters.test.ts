import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import {
  AdapterSetupError,
  MySQLAdapter,
  NeonPoolAdapter,
  PostgresAdapter,
  SQLiteAdapter,
  createAdapter,
  loadDriver
} from '../adapters';

const temporaryDirectories: string[] = [];
const sample = readFileSync(join(__dirname, 'fixtures', 'sample.sql'), 'utf8');

function makeTemp(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dataguard-adapter-'));
  temporaryDirectories.push(directory);
  return directory;
}

function shownPath(filepath: string): string {
  const resolved = resolve(filepath);
  return resolved === filepath ? filepath : `${filepath} (${resolved})`;
}

function missingDatabaseMessage(filepath: string): string {
  return `No SQLite database at ${shownPath(filepath)}. dataguard opens existing files read-only. Check database.connectionString.`;
}

function readonlyDirectoryMessage(filepath: string): string {
  return `SQLite could not read ${shownPath(filepath)} because it cannot write in that folder (SQLITE_READONLY_DIRECTORY). This happens with a database in WAL mode, which needs its -shm file there even to be read. Copy the database, with its -wal file if there is one, to a folder you can write to and point database.connectionString at the copy.`;
}

function errorCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return (error as { code: unknown }).code;
}

after(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('adapter setup', { concurrency: false }, () => {
  it('opens SQLite with readonly and fileMustExist', () => {
    // source: 2026-10-08 review, the adapter opened SQLite with no options.
    const filepath = join(makeTemp(), 'example.db');
    const calls: { filename: string; options: unknown }[] = [];
    const open = (filename: string, options: { readonly: boolean; fileMustExist: boolean }) => {
      calls.push({ filename, options });
      return {
        prepare() {
          return { reader: false, all() { return []; }, run() { return undefined; } };
        },
        close() {}
      };
    };
    new SQLiteAdapter(filepath, (name) => {
      assert.equal(name, 'better-sqlite3');
      return open;
    });
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call);
    assert.equal(call.filename, filepath);
    assert.deepEqual(call.options, { readonly: true, fileMustExist: true });
  });

  it('a wrong SQLite path fails, names the path and creates no file', () => {
    // source: 2026-10-08 review, a mistyped path created an empty database file.
    const directory = makeTemp();
    const connectionString = join(directory, 'missing.db');
    const message = missingDatabaseMessage(connectionString);
    assert.throws(
      () => createAdapter({ type: 'sqlite', connectionString }),
      (error: unknown) => {
        assert.ok(error instanceof AdapterSetupError);
        assert.equal(error.message, message);
        return true;
      }
    );
    assert.equal(existsSync(connectionString), false);
    assert.deepEqual(readdirSync(directory), []);
  });

  it('a relative wrong path also shows the full path', () => {
    // source: the wrong-path message contract.
    const directory = makeTemp();
    const folder = `missing-${process.pid}`;
    const relative = `${folder}/sample.db`;
    const previous = process.cwd();
    process.chdir(directory);
    try {
      assert.throws(
        () => createAdapter({ type: 'sqlite', connectionString: relative }),
        (error: unknown) => {
          assert.ok(error instanceof AdapterSetupError);
          const prefix = `No SQLite database at ${relative} (${resolve(relative)}).`;
          assert.equal(error.message.slice(0, prefix.length), prefix);
          return true;
        }
      );
      assert.equal(existsSync(folder), false);
    } finally {
      process.chdir(previous);
    }
  });

  it('a folder given as the SQLite path is named as a folder', () => {
    // source: measured 2026-10-08, the driver answers a folder with "disk I/O error".
    const directory = makeTemp();
    const message = `${shownPath(directory)} is a folder. database.connectionString must be the path to a SQLite database file.`;
    assert.throws(
      () => createAdapter({ type: 'sqlite', connectionString: directory }),
      (error: unknown) => {
        assert.ok(error instanceof AdapterSetupError);
        assert.equal(error.message, message);
        return true;
      }
    );
  });

  it('refuses statements that write and leaves the file unchanged', async () => {
    // source: 2026-10-08 review, a statement that writes went through the adapter.
    const directory = makeTemp();
    const dbPath = join(directory, 'sample.db');
    const db = new Database(dbPath);
    try {
      db.exec(sample);
    } finally {
      db.close();
    }
    const before = readFileSync(dbPath);
    const adapter = createAdapter({ type: 'sqlite', connectionString: dbPath });
    try {
      const statements = [
        'CREATE TABLE scratch (id INTEGER)',
        "INSERT INTO contacts (id, name, email, company) VALUES (50, 'Added Person', 'added@example.com', 'Example Co')",
        "UPDATE contacts SET name = 'Changed Person' WHERE id = 1"
      ];
      for (const statement of statements) {
        await assert.rejects(adapter.execute(statement), (error: unknown) => {
          assert.equal(errorCode(error), 'SQLITE_READONLY');
          return true;
        });
      }
      const selected = await adapter.execute('SELECT name FROM contacts WHERE id = 1');
      assert.deepEqual(selected.rows, [{ name: 'Sample Person' }]);
    } finally {
      await adapter.disconnect();
    }
    assert.deepEqual(readFileSync(dbPath), before);
    assert.deepEqual(readdirSync(directory), ['sample.db']);
  });

  it('a WAL database in a folder that cannot be written to says so', async (t) => {
    // source: measured 2026-10-08, the first read failed with "attempt to write a readonly database", which reads as if dataguard had tried to write.
    if (process.platform === 'win32') {
      t.skip('Windows does not enforce the folder mode');
      return;
    }
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      t.skip('running as root does not enforce the folder mode');
      return;
    }
    const directory = makeTemp();
    const dbPath = join(directory, 'sample.db');
    const db = new Database(dbPath);
    try {
      db.pragma('journal_mode = WAL');
      db.exec(sample);
    } finally {
      db.close();
    }
    chmodSync(directory, 0o555);
    try {
      const adapter = createAdapter({ type: 'sqlite', connectionString: dbPath });
      const message = readonlyDirectoryMessage(dbPath);
      try {
        await assert.rejects(adapter.execute('SELECT COUNT(*) AS count FROM contacts'), (error: unknown) => {
          assert.ok(error instanceof AdapterSetupError);
          assert.equal(error.message, message);
          return true;
        });
        await assert.rejects(adapter.select('contacts'), (error: unknown) => {
          assert.ok(error instanceof AdapterSetupError);
          assert.equal(error.message, message);
          return true;
        });
      } finally {
        await adapter.disconnect();
      }
    } finally {
      chmodSync(directory, 0o755);
    }
  });

  it('a missing better-sqlite3 says how to install it', () => {
    // source: better-sqlite3 is an optional dependency and bun install may skip it.
    const loader = () => {
      throw Object.assign(
        new Error("Cannot find module 'better-sqlite3'\nRequire stack:\n- /x/adapters.ts"),
        { code: 'MODULE_NOT_FOUND' }
      );
    };
    assert.throws(
      () => new SQLiteAdapter(join(makeTemp(), 'unused.db'), loader),
      (error: unknown) => {
        assert.ok(error instanceof AdapterSetupError);
        assert.equal(
          error.message,
          'The better-sqlite3 package is not installed. Install it with: bun add better-sqlite3'
        );
        assert.equal(error.message.includes('\n'), false);
        return true;
      }
    );
  });

  it('a missing pg says how to install it', () => {
    // source: pg is an optional dependency.
    const loader = () => {
      throw Object.assign(
        new Error("Cannot find module 'pg'\nRequire stack:\n- /x/adapters.ts"),
        { code: 'MODULE_NOT_FOUND' }
      );
    };
    assert.throws(
      () => new PostgresAdapter('postgresql://localhost/none', loader),
      (error: unknown) => {
        assert.ok(error instanceof AdapterSetupError);
        assert.equal(error.message, 'The pg package is not installed. Install it with: bun add pg');
        assert.equal(error.message.includes('\n'), false);
        return true;
      }
    );
  });

  it('a missing ws says how to install it', () => {
    // source: ws is not a dependency of this package and was loaded with a bare require.
    const loader = () => {
      throw Object.assign(
        new Error("Cannot find module 'ws'\nRequire stack:\n- /x/adapters.ts"),
        { code: 'MODULE_NOT_FOUND' }
      );
    };
    assert.throws(
      () => new NeonPoolAdapter('postgresql://localhost/none', loader),
      (error: unknown) => {
        assert.ok(error instanceof AdapterSetupError);
        assert.equal(error.message, 'The ws package is not installed. Install it with: bun add ws');
        assert.equal(error.message.includes('\n'), false);
        return true;
      }
    );
  });

  it('a missing mysql2 says how to install it', () => {
    // source: mysql2 is not a dependency of this package and was loaded with a bare require.
    const requested: string[] = [];
    const loader = (moduleId: string) => {
      requested.push(moduleId);
      throw Object.assign(
        new Error("Cannot find module 'mysql2/promise'\nRequire stack:\n- /x/adapters.ts"),
        { code: 'MODULE_NOT_FOUND' }
      );
    };
    assert.throws(
      () => new MySQLAdapter({}, loader),
      (error: unknown) => {
        assert.ok(error instanceof AdapterSetupError);
        assert.equal(error.message, 'The mysql2 package is not installed. Install it with: bun add mysql2');
        assert.equal(error.message.includes('\n'), false);
        return true;
      }
    );
    assert.deepEqual(requested, ['mysql2/promise']);
  });

  it('a missing package is recognized from the real loader', () => {
    // source: the detection must match the error this runtime really throws.
    assert.throws(
      () => loadDriver('dataguard-no-such-driver'),
      (error: unknown) => {
        assert.ok(error instanceof AdapterSetupError);
        assert.equal(
          error.message,
          'The dataguard-no-such-driver package is not installed. Install it with: bun add dataguard-no-such-driver'
        );
        return true;
      }
    );
  });

  it('other driver errors keep their own error', () => {
    // source: a driver that is installed but broken must not be reported as not installed.
    const missingBindings = Object.assign(
      new Error("Cannot find module 'bindings'"),
      { code: 'MODULE_NOT_FOUND' }
    );
    assert.throws(
      () => loadDriver('better-sqlite3', () => {
        throw missingBindings;
      }),
      (error: unknown) => {
        assert.strictEqual(error, missingBindings);
        return true;
      }
    );
    const boom = new Error('boom');
    assert.throws(
      () => loadDriver('better-sqlite3', () => {
        throw boom;
      }),
      (error: unknown) => {
        assert.strictEqual(error, boom);
        return true;
      }
    );
  });

  it('the CLI prints a wrong SQLite path as one line and creates no file', () => {
    // source: 2026-10-08 review, the CLI printed setup mistakes as a stack trace.
    const directory = makeTemp();
    const databasePath = join(directory, 'missing.db');
    const configPath = join(directory, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      database: { type: 'sqlite', connectionString: databasePath },
      validations: {}
    }));
    const cliPath = join(__dirname, '..', 'cli.ts');
    const result = spawnSync(
      process.execPath,
      [require.resolve('tsx/cli'), cliPath, '--config', configPath],
      { encoding: 'utf8' }
    );
    const stderr = result.stderr ?? '';
    const message = missingDatabaseMessage(databasePath);
    assert.equal(result.status, 1);
    assert.equal(stderr.trim(), `❌ Error: ${message}`);
    assert.equal(/\n\s+at /.test(stderr), false);
    assert.equal(existsSync(databasePath), false);
  });

  it('the CLI names a config file that is not there', () => {
    // source: a mistyped config path printed a stack trace and did not name the path.
    const configPath = join(makeTemp(), 'nope.json');
    const cliPath = join(__dirname, '..', 'cli.ts');
    const result = spawnSync(
      process.execPath,
      [require.resolve('tsx/cli'), cliPath, '--config', configPath],
      { encoding: 'utf8' }
    );
    const stderr = result.stderr ?? '';
    assert.equal(result.status, 1);
    assert.equal(stderr.trim(), `❌ Error: Config file not found: ${configPath}`);
    assert.equal(/\n\s+at /.test(stderr), false);
  });

  it('the CLI lists where it looked when no config is given', () => {
    // source: a run with no config printed a stack trace.
    const directory = makeTemp();
    const cliPath = join(__dirname, '..', 'cli.ts');
    const result = spawnSync(
      process.execPath,
      [require.resolve('tsx/cli'), cliPath],
      { encoding: 'utf8', cwd: directory }
    );
    const stderr = result.stderr ?? '';
    assert.equal(result.status, 1);
    assert.equal(
      stderr.trim(),
      '❌ Error: No config file found. Looked for data-quality-config.json, config/data-quality.json and .claude/data-quality-config.json. Pass one with --config.'
    );
    assert.equal(/\n\s+at /.test(stderr), false);
  });

  it('the CLI names the environment variable that is not set', () => {
    // source: the README's first command with no DATABASE_URL printed a stack trace.
    const directory = makeTemp();
    const configPath = join(directory, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      database: { type: 'neon', connectionString: 'process.env.DATAGUARD_TEST_UNSET_URL' },
      validations: {}
    }));
    const cliPath = join(__dirname, '..', 'cli.ts');
    const expected = '❌ Error: The config reads the connection string from the environment variable DATAGUARD_TEST_UNSET_URL, which is not set. Set it and run again.';
    const removed: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (key !== 'DATAGUARD_TEST_UNSET_URL') removed[key] = value;
    }
    const runs = [removed, { ...process.env, DATAGUARD_TEST_UNSET_URL: '' }];
    for (const env of runs) {
      const result = spawnSync(
        process.execPath,
        [require.resolve('tsx/cli'), cliPath, '--config', configPath],
        { encoding: 'utf8', env }
      );
      const stderr = result.stderr ?? '';
      assert.equal(result.status, 1);
      assert.equal(stderr.trim(), expected);
      assert.equal(/\n\s+at /.test(stderr), false);
    }
  });

  it('the CLI prints a missing connection string as one line', () => {
    // source: createAdapter's config errors were printed with a stack.
    const directory = makeTemp();
    const configPath = join(directory, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      database: { type: 'postgres' },
      validations: {}
    }));
    const cliPath = join(__dirname, '..', 'cli.ts');
    const result = spawnSync(
      process.execPath,
      [require.resolve('tsx/cli'), cliPath, '--config', configPath],
      { encoding: 'utf8' }
    );
    const stderr = result.stderr ?? '';
    assert.equal(result.status, 1);
    assert.equal(stderr.trim(), '❌ Error: Connection string required for PostgreSQL');
    assert.equal(/\n\s+at /.test(stderr), false);
  });

  it('createAdapter reports config mistakes as setup errors', () => {
    // source: createAdapter's config errors were plain Errors, so nothing told them apart from a bug.
    assert.throws(
      () => createAdapter({ type: 'sqlite' }),
      (error: unknown) => {
        assert.ok(error instanceof AdapterSetupError);
        assert.equal(error.message, 'Filepath required for SQLite');
        return true;
      }
    );
    const oracle = { type: 'oracle' } as unknown as Parameters<typeof createAdapter>[0];
    assert.throws(
      () => createAdapter(oracle),
      (error: unknown) => {
        assert.ok(error instanceof AdapterSetupError);
        assert.equal(error.message, 'Unsupported database type: oracle');
        return true;
      }
    );
  });

  it('adapters.ts loads no Node module at the top of the file', () => {
    // source: the library's files load fs only inside the function that needs it.
    const source = readFileSync(join(__dirname, '..', 'adapters.ts'), 'utf8');
    for (const line of source.split('\n')) {
      if (line.startsWith('import ')) {
        assert.equal(line.startsWith('import type '), true);
      }
    }
  });
});
