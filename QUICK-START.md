# Data Quality Tools - Quick Start

Two ways in: a throwaway SQLite file you can make in a minute, or your own database.

## Try it on a throwaway SQLite file

```bash
git clone https://github.com/Lucface/dataguard.git
cd dataguard
bun install
bun add better-sqlite3
```

Make a small database with one orphaned task and one project that ends before it starts:

```bash
sqlite3 demo.db "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, start_date TEXT, end_date TEXT); CREATE TABLE tasks (id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT); INSERT INTO projects VALUES (1, 'Garden shed', '2026-01-05', '2026-02-01'), (2, 'Bike rack', '2026-03-10', '2026-03-01'); INSERT INTO tasks VALUES (1, 1, 'Cut boards'), (2, 2, 'Weld frame'), (3, 99, 'No such project');"
```

Save this as `demo-config.json`:

```json
{
  "database": { "type": "sqlite", "connectionString": "demo.db" },
  "validations": { "referentialIntegrity": true, "dateSequences": true },
  "relationships": [
    { "child": "tasks", "parent": "projects", "foreignKey": "project_id" }
  ],
  "dateRules": [
    { "table": "projects", "before": "start_date", "after": "end_date" }
  ]
}
```

Run it:

```bash
bunx tsx cli.ts --config demo-config.json
```

The report ends with what it found, and the command exits with code 1 because a check failed:

```
❌ REFERENTIAL INTEGRITY

  Errors:
    - Found 1 orphaned records in tasks (missing parent in projects)

❌ DATE SEQUENCES

  Errors:
    - Found 1 date sequence violation(s) in projects: start_date should be before end_date
    -   Example: ID 2 - start_date=2026-03-10, end_date=2026-03-01
```

## Use your own database

### Step 1: Copy Example Config

```bash
cp example-config.json my-config.json
```

### Step 2: Edit Config for Your Schema

Change the table and column names in `my-config.json` to yours, and set the database:

```json
{
  "database": {
    "type": "neon",
    "connectionString": "process.env.DATABASE_URL"
  }
}
```

`type` is `neon`, `postgres` or `sqlite`. For `postgres` run `bun add pg` first; for `sqlite` run `bun add better-sqlite3` and put the file path in `connectionString`. The full config shape is in [README.md](README.md#configuration).

### Step 3: Run Validation

```bash
bunx tsx cli.ts --config my-config.json
```

## Common Commands

```bash
# HTML report
bunx tsx cli.ts --config my-config.json --output report.html

# JSON report
bunx tsx cli.ts --config my-config.json --output report.json

# Specific validator
bunx tsx cli.ts --config my-config.json --only referential-integrity

# Every option
bunx tsx cli.ts --help
```

## Need Help?

- [README.md](README.md): every check, the config shape and the known limits
- [USAGE-EXAMPLES.md](USAGE-EXAMPLES.md): longer examples
- [QUICK-REFERENCE.md](QUICK-REFERENCE.md): one-page reference
