# DataGuard

Generic, reusable data quality validation tools extracted from the AcmeCRM project.

## Overview

This directory contains schema-agnostic data quality validation utilities that you configure for your own tables on PostgreSQL (including Neon) and SQLite. These tools were originally developed for the AcmeCRM but have been generalized for broader use.

## Quick start

```bash
git clone https://github.com/Lucface/dataguard.git
cd dataguard
bun install
bunx tsx cli.ts --help
```

Then copy `example-config.json`, point it at your database (see [Database Adapters](#database-adapters)) and run:

```bash
bunx tsx cli.ts --config example-config.json
```

`example-config.json` uses the `neon` adapter and reads the connection string from the `DATABASE_URL` environment variable. Its table and column names are examples: change them to your schema.

A run ends on its own. To stop one early, press Ctrl+C. There is nothing to undo in the database afterwards, because dataguard only reads it.

## What it reads and what it writes

Every check only reads. Every statement dataguard builds is a `SELECT` (one helper puts a `WITH` clause in front of its `SELECT`). No check adds, changes or removes a row.

**SQLite.** The file is opened read-only and must already exist. A statement that writes is refused by SQLite with `attempt to write a readonly database`, and that includes one of your own sent through `adapter.execute`. A run leaves the database file byte for byte as it was. If the database is in WAL mode, SQLite creates its `-wal` and `-shm` files next to it while reading and leaves them there; the database file itself still does not change. In a folder dataguard cannot write to, SQLite cannot read a WAL database at all. Each check then reports `SQLite could not read <path> because it cannot write in that folder (SQLITE_READONLY_DIRECTORY)`, and the way through is to check a copy of the database in a folder you can write to.

**PostgreSQL and Neon.** dataguard sends the same `SELECT` statements, but nothing in dataguard stops a write there: the connection can do whatever its role can. The table names, column names, `condition` and `filter` in your config are put into those statements as written. Treat a config file like code, and connect with a role that can only read. On PostgreSQL 14 or newer:

```sql
CREATE ROLE dataguard_reader LOGIN;
GRANT pg_read_all_data TO dataguard_reader;
```

Give that role a password (`\password dataguard_reader` in psql) and use it in the connection string.

**Files.** The only file dataguard writes is the report you name with `--output`. A file already at that path is replaced.

## When it stops before the checks

A setup mistake ends in one line and exit code 1. Nothing has been read from the database at that point.

| It prints | What to do |
|---|---|
| `No SQLite database at <path>. dataguard opens existing files read-only. Check database.connectionString.` | Fix the path in `database.connectionString`. A relative path is shown with the full path it resolved to. No file was created. |
| `The better-sqlite3 package is not installed. Install it with: bun add better-sqlite3` (the same line names `pg`, `ws` or `mysql2` when that is the one missing) | Run that command in the dataguard folder, then run dataguard again. |
| `The config reads the connection string from the environment variable DATABASE_URL, which is not set. Set it and run again.` | Set the variable in your shell, then run again. |
| `Config file not found: <path>` | Pass the right path with `--config`. |
| `No config file found. Looked for data-quality-config.json, config/data-quality.json and .claude/data-quality-config.json. Pass one with --config.` | Create one of those files, or pass `--config`. |

A check whose own query fails, for example on a table that does not exist, puts the database's error on a line of the report, and the other checks still run.

## Tools

Every example below uses an adapter made like this:

```typescript
import { createAdapter } from './index';

const adapter = createAdapter({
  type: 'postgres',
  connectionString: process.env.DATABASE_URL!
});
```

### 1. `validate-referential-integrity.ts`
**Purpose:** Checks for orphaned records and broken foreign key relationships

**Features:**
- Detects orphaned child records
- Validates foreign key references
- Works with any table relationships whose parent key column is named `id`

**Usage:**
```typescript
import { validateReferentialIntegrity } from './index';

const result = await validateReferentialIntegrity({
  adapter,
  relationships: [
    { child: 'project_tasks', parent: 'projects', foreignKey: 'project_id' },
    { child: 'invoices', parent: 'projects', foreignKey: 'project_id' }
  ]
});
```

### 2. `validate-date-sequences.ts`
**Purpose:** Validates temporal logic and date ordering constraints

**Features:**
- Ensures start dates precede end dates
- Validates sequential date progressions (`validateSequentialProgression`)
- Validates business workflow dates (e.g., invoiced before paid)
- Equal dates pass unless a rule sets `allowEqual: false`

**Usage:**
```typescript
import { validateDateSequences } from './index';

const result = await validateDateSequences({
  adapter,
  rules: [
    { table: 'projects', before: 'start_date', after: 'delivery_date' },
    { table: 'payment_milestones', before: 'invoiced_date', after: 'paid_date' }
  ]
});
```

### 3. `validate-calculated-fields.ts`
**Purpose:** Ensures calculated/derived fields match their source data

**Features:**
- Validates aggregation accuracy (SUM, COUNT, AVG, MAX, MIN)
- Checks percentage calculations (`validatePercentageSum`)
- Checks value ranges (`validateProgressRange`, `validateDerivedNotExceedsBase`)
- Detects calculation mismatches

**Usage:**
```typescript
import { validateCalculatedFields } from './index';

const result = await validateCalculatedFields({
  adapter,
  calculations: [
    {
      table: 'projects',
      field: 'spent',
      calculation: 'SUM',
      sourceTable: 'project_milestones',
      sourceField: 'actual_spent',
      joinKey: 'project_id'
    }
  ]
});
```

`joinKey` is the column in `sourceTable` that points at `table`, and `parentKey` (default `id`) is the column in `table` it points at. `filter` limits which source rows count, for example `"filter": "s.status = 'paid'"`; put `s.` in front of a column that both tables have. Parents with no matching rows count as 0.

### 4. `analyze-nulls.ts`
**Purpose:** Analyzes null/empty field patterns and completeness

**Features:**
- Counts null/empty values per field
- Calculates data completeness percentages
- Identifies required fields with missing data
- Suggests a default from the most common value (`suggestDefaults`)

**Usage:**
```typescript
import { analyzeNulls } from './index';

const result = await analyzeNulls(adapter, {
  tables: ['projects', 'contacts', 'invoices'],
  requiredFields: {
    projects: ['name', 'client', 'budget'],
    contacts: ['email', 'company']
  }
});
```

### 5. `validate-business-rules.ts`
**Purpose:** Validates domain-specific business logic constraints

**Features:**
- Configurable business rule validation
- Stage/status consistency checks
- Allowed values and uniqueness (`validateEnumValues`, `validateUniqueness`)
- Custom validation functions (from code, not from a JSON config)

**Usage:**
```typescript
import { validateBusinessRules } from './index';

const result = await validateBusinessRules({
  adapter,
  rules: [
    {
      name: 'completed_projects_need_dates',
      table: 'projects',
      condition: "stage = 'Completed'",
      requireFields: ['completed_date']
    }
  ]
});
```

### 6. `generate-quality-report.ts`
**Purpose:** Comprehensive data quality assessment with scoring

**Features:**
- Runs all validation checks enabled in the config
- Generates quality score (0-100)
- Produces HTML/JSON reports

**Usage:**
```typescript
import * as fs from 'fs';
import { generateQualityReport, exportReportHTML } from './index';

const config = JSON.parse(fs.readFileSync('example-config.json', 'utf-8'));
const report = await generateQualityReport(adapter, config);
exportReportHTML(report, 'report.html');

console.log(`Quality Score: ${report.score}%`);
await adapter.disconnect();
```

## Database Adapters

`bun install` brings the drivers for all three databases the CLI can open:

| `database.type` | Database | Driver |
|---|---|---|
| `neon` | Neon Serverless (PostgreSQL) | included |
| `postgres` | PostgreSQL | included (`pg`) |
| `sqlite` | SQLite, `connectionString` is the path to an existing file, opened read-only | included (`better-sqlite3`) |

`pg` and `better-sqlite3` are optional dependencies: if one cannot install on your machine, `bun install` skips it and the other databases still work. When a config asks for the one that is missing, dataguard says so in one line with the command that installs it.

From code, `createAdapter` also accepts `neon-pool` (needs `ws`), `mysql` (needs `mysql2` and a `connectionConfig` object) and `drizzle` (pass your Drizzle `db`). The CLI passes only `connectionString`, so it cannot open a MySQL or Drizzle connection. A setup mistake (a wrong SQLite path, a missing driver, a missing connection string) is thrown as `AdapterSetupError`, which `./index` exports.

## Configuration

Create a `data-quality-config.json` in your project:

```json
{
  "database": {
    "type": "neon",
    "connectionString": "process.env.DATABASE_URL"
  },
  "validations": {
    "referentialIntegrity": true,
    "dateSequences": true,
    "calculatedFields": true,
    "nullAnalysis": true,
    "businessRules": true
  },
  "relationships": [
    { "child": "tasks", "parent": "projects", "foreignKey": "project_id" }
  ],
  "dateRules": [
    { "table": "projects", "before": "start_date", "after": "end_date" }
  ],
  "calculations": [
    {
      "table": "projects",
      "field": "total_spent",
      "calculation": "SUM",
      "sourceTable": "expenses",
      "sourceField": "amount",
      "joinKey": "project_id"
    }
  ],
  "nullAnalysis": {
    "tables": ["projects"],
    "requiredFields": { "projects": ["name"] }
  },
  "businessRules": [
    {
      "name": "completed_projects_need_dates",
      "table": "projects",
      "condition": "stage = 'Completed'",
      "requireFields": ["completed_date"]
    }
  ]
}
```

A check runs only when it is switched on under `validations` and its own section is present. A `connectionString` written as `process.env.NAME` is replaced with that environment variable.

## CLI Usage

Run validations from the command line. Without `--config` the CLI looks for `data-quality-config.json`, then `config/data-quality.json`, then `.claude/data-quality-config.json`.

```bash
# Run all validations
bunx tsx cli.ts --config example-config.json

# Run specific validation
bunx tsx cli.ts --config example-config.json --only referential-integrity

# Generate report
bunx tsx cli.ts --config example-config.json --output report.html

# Show every option
bunx tsx cli.ts --help
```

`--only` takes `referential-integrity`, `date-sequences`, `calculated-fields`, `null-analysis` or `business-rules`. `--output` writes HTML or JSON by file extension. The exit code is 1 when any check fails and 0 when all pass.

## Integration with CI/CD

Add to your CI pipeline:

```yaml
# .github/workflows/data-quality.yml
name: Data Quality Check

on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - name: Run data quality checks
        run: |
          bun install
          bunx tsx cli.ts --config example-config.json
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

## Tests

```bash
bun run test
```

The tests run every check against a small made-up sample (`tests/fixtures/sample.sql`) on SQLite. To run them on PostgreSQL too, point `DATAGUARD_TEST_PG_URL` at a throwaway database. The tests create a schema of their own, load the sample there, and remove that schema when they finish; nothing else in the database is touched:

```bash
DATAGUARD_TEST_PG_URL=postgresql://localhost/dataguard_test bun run test
```

## Extending the Tools

### Add Custom Validators

A check is a function that takes the adapter and returns a `ValidationResult`. Call it next to the built-in ones.

```typescript
// my-custom-validator.ts
import type { ValidationResult, DatabaseAdapter } from './types';

export async function validateCustomRule(adapter: DatabaseAdapter): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Your custom validation logic here, for example:
  // const result = await adapter.execute('SELECT ...');

  return {
    passed: errors.length === 0,
    errors,
    warnings
  };
}
```

## Best Practices

1. **Run regularly:** Schedule automated quality checks
2. **Track trends:** Save reports and compare scores over time
3. **Fix incrementally:** Address high-priority issues first
4. **Document exceptions:** When business rules are intentionally violated
5. **Version configurations:** Track validation rules in version control

## Metrics & Scoring

Quality score calculation:
- **Referential Integrity:** 25 points
- **Date Sequences:** 20 points
- **Calculated Fields:** 25 points
- **Data Completeness:** 15 points
- **Business Rules:** 15 points

Only the checks that ran count toward the score. A failed check keeps part of its points: it loses 10% per error line, up to half.

Grades:
- 90-100: Excellent
- 80-89: Good
- 70-79: Fair
- Below 70: Needs improvement

## Examples from AcmeCRM

Original validations that inspired these tools:

1. **Calculated Fields:** `projects.spent = SUM(milestones.actualSpent)`
2. **Date Sequences:** `invoicedDate <= paidDate`
3. **Business Rules:** Invoiced projects must have `completedDate`
4. **Referential Integrity:** No orphaned tasks/milestones
5. **Data Realism:** Budget values within expected ranges

## License

MIT

## Contributing

To add new tools or improve existing ones:
1. Keep them database-agnostic
2. Support configuration via parameters
3. Include comprehensive documentation
4. Add examples and test cases
