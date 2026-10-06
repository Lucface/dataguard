import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { Client } from 'pg';
import { createAdapter } from '../adapters';
import { analyzeNulls, findAlwaysNullFields } from '../analyze-nulls';
import { createValueRangeRule, validateBusinessRules } from '../validate-business-rules';
import { validateCalculatedFields } from '../validate-calculated-fields';
import { formatValue, validateDateSequences } from '../validate-date-sequences';
import { validateReferentialIntegrity } from '../validate-referential-integrity';
import type { CalculationConfig, DatabaseAdapter, NullAnalysisConfig } from '../types';

const sample = readFileSync(join(__dirname, 'fixtures', 'sample.sql'), 'utf8');
const temporaryDirectories: string[] = [];

function withSearchPath(url: string, name: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}options=-c%20search_path%3D${name}`;
}

async function createTestAdapter(type: 'sqlite' | 'postgres', schema: string): Promise<DatabaseAdapter> {
  if (type === 'sqlite') {
    const directory = mkdtempSync(join(tmpdir(), 'dataguard-test-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'sample.db');
    const db = new Database(path);
    try {
      db.exec(sample);
    } finally {
      db.close();
    }
    return createAdapter({ type: 'sqlite', connectionString: path });
  }

  const url = process.env.DATAGUARD_TEST_PG_URL;
  assert.ok(url);
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(sample);
  } finally {
    await client.end();
  }
  return createAdapter({ type: 'postgres', connectionString: withSearchPath(url, schema) });
}

after(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function exampleIds(errors: string[]): number[] {
  return errors.filter(line => line.startsWith('  Example:')).map(line => {
    const match = /^  Example: ID (\d+) - /.exec(line);
    assert.ok(match, line);
    return Number(match[1]);
  });
}

const spentCalculation: CalculationConfig = {
  table: 'projects', field: 'spent', calculation: 'SUM',
  sourceTable: 'project_milestones', sourceField: 'actual_spent', joinKey: 'project_id'
};
const budgetCalculation: CalculationConfig = {
  table: 'projects', field: 'budget', calculation: 'SUM',
  sourceTable: 'payment_milestones', sourceField: 'amount', joinKey: 'project_id'
};
const nullConfig: NullAnalysisConfig = {
  tables: ['projects', 'contacts', 'leads', 'deals', 'invoices'],
  requiredFields: {
    projects: ['name', 'client', 'type', 'budget', 'stage', 'start_date'],
    contacts: ['name', 'email', 'company'],
    leads: ['name', 'email', 'company', 'stage'],
    deals: ['title', 'value', 'stage'],
    invoices: ['invoice_number', 'total_amount', 'status']
  },
  completenessThreshold: 95
};

for (const type of ['sqlite', 'postgres'] as const) {
  describe(type, {
    concurrency: false,
    skip: type === 'postgres' && !process.env.DATAGUARD_TEST_PG_URL
      ? 'set DATAGUARD_TEST_PG_URL to a throwaway database to run these; the tests create and remove their own schema'
      : false
  }, () => {
    const schema = `dataguard_test_${process.pid}_${Date.now()}`;
    let adapter: DatabaseAdapter;

    before(async () => {
      adapter = await createTestAdapter(type, schema);
    });
    after(async () => {
      await adapter?.disconnect();
      if (type === 'postgres') {
        const url = process.env.DATAGUARD_TEST_PG_URL;
        assert.ok(url);
        const client = new Client({ connectionString: url });
        try {
          await client.connect();
          await client.query(`DROP SCHEMA ${schema} CASCADE`);
        } finally {
          await client.end();
        }
      }
    });
    beforeEach(context => {
      context.mock.method(console, 'log', () => {});
      context.mock.method(console, 'warn', () => {});
    });
    afterEach(context => {
      context.mock.restoreAll();
    });

    it('reports the orphaned project task', async () => {
      // source: sample contract, one project task points at a missing project.
      const result = await validateReferentialIntegrity({
        adapter,
        relationships: [{ child: 'project_tasks', parent: 'projects', foreignKey: 'project_id' }]
      });
      assert.deepEqual(result, {
        passed: false,
        errors: ['Found 1 orphaned records in project_tasks (missing parent in projects)'],
        warnings: []
      });
    });

    it('passes optional invoice relationships without warnings', async () => {
      // source: sample contract, all optional invoice parents exist.
      const result = await validateReferentialIntegrity({
        adapter,
        relationships: [{ child: 'invoices', parent: 'projects', foreignKey: 'project_id', required: false }]
      });
      assert.deepEqual(result, { passed: true, errors: [], warnings: [] });
    });

    it('prints the same project date violation on both databases', async () => {
      // source: 2026-10-06 measurement, PostgreSQL DATE examples printed local Date descriptions.
      const result = await validateDateSequences({
        adapter,
        rules: [{ table: 'projects', before: 'start_date', after: 'delivery_date' }]
      });
      assert.deepEqual(result, {
        passed: false,
        errors: [
          'Found 1 date sequence violation(s) in projects: start_date should be before delivery_date',
          '  Example: ID 2 - start_date=2026-03-10, delivery_date=2026-03-01'
        ],
        warnings: []
      });
    });

    for (const [label, equality, expected] of [
      ['true', { allowEqual: true }, [3]],
      ['false', { allowEqual: false }, [1, 3]],
      ['omitted', {}, [3]]
    ] as const) {
      it(`handles allowEqual ${label} on milestone dates`, async () => {
        // source: 2026-10-06 measurement, allowEqual inverted whether equal dates were violations.
        const result = await validateDateSequences({
          adapter,
          rules: [{ table: 'payment_milestones', before: 'invoiced_date', after: 'paid_date', ...equality }]
        });
        assert.equal(result.passed, false);
        assert.equal(result.errors[0],
          `Found ${expected.length} date sequence violation(s) in payment_milestones: invoiced_date should be before paid_date`);
        assert.deepEqual(exampleIds(result.errors), expected);
        assert.equal(result.errors.length, expected.length + 1);
      });
    }

    it('counts every date violation and prints three ordered examples', async () => {
      // source: 2026-10-06 measurement, date violation counts stopped at ten.
      const result = await validateDateSequences({
        adapter,
        rules: [{ table: 'bulk_events', before: 'started', after: 'ended' }]
      });
      assert.equal(result.passed, false);
      assert.equal(result.errors[0],
        'Found 12 date sequence violation(s) in bulk_events: started should be before ended');
      assert.equal(result.errors.length, 4);
      assert.deepEqual(exampleIds(result.errors), [1, 2, 3]);
    });

    it('keeps custom date error wording and example lines', async () => {
      // source: report contract, custom date messages replace only the finding line.
      const result = await validateDateSequences({
        adapter,
        rules: [{
          table: 'projects', before: 'start_date', after: 'delivery_date',
          errorMessage: 'Project dates are out of order'
        }]
      });
      assert.deepEqual(result.errors, [
        'Project dates are out of order',
        '  Example: ID 2 - start_date=2026-03-10, delivery_date=2026-03-01'
      ]);
    });

    it('joins child project_id to the parent id for spent totals', async () => {
      // source: 2026-10-06 measurement, the totals check joined both tables on one column name.
      const result = await validateCalculatedFields({ adapter, calculations: [spentCalculation] });
      assert.deepEqual(result, {
        passed: false,
        errors: [
          'Found 1 discrepancies in projects.spent (expected SUM of project_milestones.actual_spent)',
          '  Example: ID 2 - Recorded=500, Calculated=450, Diff=50'
        ],
        warnings: []
      });
    });

    it('passes matching budget totals', async () => {
      // source: sample contract, every project budget matches its payment milestone total.
      const result = await validateCalculatedFields({ adapter, calculations: [budgetCalculation] });
      assert.deepEqual(result, { passed: true, errors: [], warnings: [] });
    });

    it('filters child totals without dropping parents that have no matching children', async () => {
      // source: 2026-10-06 measurement, calculation filters were built but never used.
      const result = await validateCalculatedFields({
        adapter,
        calculations: [{ ...budgetCalculation, filter: "s.status = 'paid'" }]
      });
      assert.deepEqual(result, {
        passed: false,
        errors: [
          'Found 1 discrepancies in projects.budget (expected SUM of payment_milestones.amount)',
          '  Example: ID 2 - Recorded=500, Calculated=0, Diff=500'
        ],
        warnings: []
      });
    });

    it('uses the same parent id whether parentKey is explicit or omitted', async () => {
      // source: calculation contract, parentKey defaults to id.
      const implicit = await validateCalculatedFields({ adapter, calculations: [spentCalculation] });
      const explicit = await validateCalculatedFields({
        adapter, calculations: [{ ...spentCalculation, parentKey: 'id' }]
      });
      assert.deepEqual(explicit, implicit);
      assert.deepEqual(exampleIds(explicit.errors), [2]);
    });

    it('counts every calculated discrepancy and prints three ordered examples', async () => {
      // source: 2026-10-06 measurement, calculated discrepancy counts stopped at ten.
      const result = await validateCalculatedFields({
        adapter,
        calculations: [{
          table: 'bulk_parents', field: 'total', calculation: 'SUM',
          sourceTable: 'bulk_children', sourceField: 'amount', joinKey: 'parent_id'
        }]
      });
      assert.equal(result.passed, false);
      assert.deepEqual(result.errors, [
        'Found 12 discrepancies in bulk_parents.total (expected SUM of bulk_children.amount)',
        '  Example: ID 1 - Recorded=10, Calculated=5, Diff=5',
        '  Example: ID 2 - Recorded=10, Calculated=5, Diff=5',
        '  Example: ID 3 - Recorded=10, Calculated=5, Diff=5'
      ]);
    });

    it('analyzes actual columns and handles numeric and date fields', async () => {
      // source: 2026-10-06 measurement, SQLite skipped columns and PostgreSQL compared numeric fields to empty strings.
      const result = await analyzeNulls(adapter, nullConfig);
      assert.equal(result.passed, false);
      assert.deepEqual(result.errors, [
        'Required field contacts.email has 1 null/empty values',
        'Field contacts.email is only 50.0% complete (threshold: 95%)'
      ]);
      assert.deepEqual(result.warnings, [
        'Field projects.completed_date is only 33.3% complete (threshold: 95%)'
      ]);
      assert.ok(result.fieldAnalysis && result.fieldAnalysis.length > 0);
      assert.deepEqual(result.fieldAnalysis.find(field => field.table === 'contacts' && field.field === 'email'), {
        table: 'contacts', field: 'email', nullCount: 1, emptyCount: 0,
        totalCount: 2, completeness: 50, required: true
      });
    });

    it('fails null analysis when a table has no readable columns', async () => {
      // source: 2026-10-06 measurement, unreadable columns silently produced a passing completeness result.
      const result = await analyzeNulls(adapter, { tables: ['no_such_table'] });
      assert.equal(result.passed, false);
      assert.deepEqual(result.errors, ['Could not read the columns of no_such_table']);
      assert.deepEqual(result.fieldAnalysis, []);
      assert.equal(result.completenessScore, 0);
    });

    if (type === 'postgres') {
      it('analyzes only contacts columns from the current schema', async () => {
        // source: review of this branch, information_schema read same-named tables from every schema
        const url = process.env.DATAGUARD_TEST_PG_URL;
        assert.ok(url);
        const otherSchema = `${schema}_other`;
        const client = new Client({ connectionString: url });
        try {
          await client.connect();
          await client.query(`CREATE SCHEMA ${otherSchema}`);
          try {
            await client.query(`CREATE TABLE ${otherSchema}.contacts (id INTEGER, name TEXT, email TEXT, company TEXT, extra_column TEXT)`);
            const result = await analyzeNulls(adapter, { tables: ['contacts'] });
            assert.deepEqual(result.fieldAnalysis?.map(field => field.field), ['id', 'name', 'email', 'company']);
          } finally {
            await client.query(`DROP SCHEMA ${otherSchema} CASCADE`);
          }
        } finally {
          await client.end();
        }
      });
    }

    it('does not label partially populated sample columns as always null', async () => {
      // source: null analysis contract, always-null detection uses column names and portable conditional sums.
      assert.deepEqual(await findAlwaysNullFields(adapter, 'projects'), []);
      assert.deepEqual(await findAlwaysNullFields(adapter, 'contacts'), []);
    });

    it('reports only the two missing required fields in the sample business rules', async () => {
      // source: 2026-10-06 measurement, required-field rules treated the count row itself as a violation.
      const result = await validateBusinessRules({
        adapter,
        rules: [
          {
            name: 'invoiced_projects_need_completion_date', table: 'projects',
            condition: "stage = 'Invoiced'", requireFields: ['completed_date'],
            errorMessage: 'Invoiced projects must have a completion date'
          },
          {
            name: 'completed_projects_need_delivery', table: 'projects',
            condition: "stage IN ('Delivered', 'Invoiced')", requireFields: ['delivery_date', 'completed_date']
          },
          {
            name: 'paid_milestones_need_dates', table: 'payment_milestones',
            condition: "status = 'paid'", requireFields: ['invoiced_date', 'paid_date']
          }
        ]
      });
      assert.deepEqual(result, {
        passed: false,
        errors: [
          'Invoiced projects must have a completion date',
          'Rule "completed_projects_need_delivery": Found 1 records where required field completed_date is null'
        ],
        warnings: []
      });
    });

    it('counts both forbidden invoice dates on paid milestones', async () => {
      // source: 2026-10-06 measurement, forbidden-field rules reported one aggregate row instead of the true count.
      const result = await validateBusinessRules({
        adapter,
        rules: [{
          name: 'paid_milestones_have_no_invoice_date', table: 'payment_milestones',
          condition: "status = 'paid'", forbidFields: ['invoiced_date']
        }]
      });
      assert.deepEqual(result, {
        passed: false,
        errors: ['Rule "paid_milestones_have_no_invoice_date": Found 2 records where forbidden field invoiced_date is not null'],
        warnings: []
      });
    });

    it('passes forbidden-field rules with no violating rows', async () => {
      // source: 2026-10-06 measurement, a zero forbidden-field count still produced a violation on SQLite.
      const result = await validateBusinessRules({
        adapter,
        rules: [{
          name: 'pending_milestones_have_no_paid_date', table: 'payment_milestones',
          condition: "status = 'pending'", forbidFields: ['paid_date']
        }]
      });
      assert.deepEqual(result, { passed: true, errors: [], warnings: [] });
    });

    it('groups OR conditions before testing required fields', async () => {
      // source: 2026-10-06 measurement, unparenthesized OR conditions included complete delivered projects.
      const result = await validateBusinessRules({
        adapter,
        rules: [{
          name: 'or_condition', table: 'projects', condition: "stage = 'Delivered' OR stage = 'Invoiced'",
          requireFields: ['completed_date']
        }]
      });
      assert.deepEqual(result.errors, [
        'Rule "or_condition": Found 1 records where required field completed_date is null'
      ]);
      assert.equal(result.passed, false);
    });

    it('checks required fields when no condition is supplied', async () => {
      // source: business rule contract, missing conditions still require a valid WHERE clause and actual count.
      const result = await validateBusinessRules({
        adapter,
        rules: [{ name: 'contacts_need_email', table: 'contacts', requireFields: ['email'] }]
      });
      assert.deepEqual(result.errors, ['Rule "contacts_need_email": Found 1 records where required field email is null']);
    });

    it('evaluates the value range rule against every project', async () => {
      // source: 2026-10-06 measurement, value range rules returned a condition that nothing evaluated.
      const result = await validateBusinessRules({
        adapter,
        rules: [createValueRangeRule({ table: 'projects', field: 'budget', min: 0, max: 600 })]
      });
      assert.deepEqual(result, {
        passed: false, errors: ['Field budget must be between 0 and 600'], warnings: []
      });
    });

    it('reports one-sided budget range violations without undefined bounds', async () => {
      // source: review of this branch, one-sided ranges printed undefined in the message
      const minimum = await validateBusinessRules({
        adapter,
        rules: [createValueRangeRule({ table: 'projects', field: 'budget', min: 400 })]
      });
      assert.deepEqual(minimum, {
        passed: false, errors: ['Field budget must be at least 400'], warnings: []
      });
      const maximum = await validateBusinessRules({
        adapter,
        rules: [createValueRangeRule({ table: 'projects', field: 'budget', max: 600 })]
      });
      assert.deepEqual(maximum, {
        passed: false, errors: ['Field budget must be at most 600'], warnings: []
      });
    });

    it('honors value range boundaries, numeric strings and allowNull', () => {
      // source: value range contract, nullable values and optional inclusive bounds must be evaluated explicitly.
      const rule = createValueRangeRule({ table: 'projects', field: 'budget', min: 0, max: 600 });
      assert.equal(rule.name, 'projects_budget_range');
      assert.equal(rule.condition, undefined);
      assert.ok(rule.customValidator);
      for (const value of [0, 600, '500']) {
        assert.equal(rule.customValidator({ budget: value }), true);
      }
      for (const value of [-1, 601, null, undefined]) {
        assert.equal(rule.customValidator({ budget: value }), false);
      }
      const nullable = createValueRangeRule({ table: 'projects', field: 'budget', allowNull: true });
      assert.ok(nullable.customValidator);
      assert.equal(nullable.customValidator({ budget: null }), true);
      assert.equal(nullable.customValidator({}), true);
      const minimum = createValueRangeRule({ table: 'projects', field: 'budget', min: 0 });
      assert.ok(minimum.customValidator);
      assert.equal(minimum.customValidator({ budget: 1000 }), true);
      const maximum = createValueRangeRule({ table: 'projects', field: 'budget', max: 600 });
      assert.ok(maximum.customValidator);
      assert.equal(maximum.customValidator({ budget: -1 }), true);
    });

    it('formats local midnight dates, strings and numbers consistently', () => {
      // source: 2026-10-06 measurement, PostgreSQL local-midnight Date objects changed report text.
      assert.equal(formatValue(new Date(2026, 2, 10)), '2026-03-10');
      assert.equal(formatValue('2026-03-10'), '2026-03-10');
      assert.equal(formatValue(500), String(500));
    });

    it('formats non-midnight Date objects as ISO timestamps', () => {
      // source: formatValue contract, any nonzero local time component preserves the full timestamp.
      for (const date of [
        new Date(2026, 2, 10, 1), new Date(2026, 2, 10, 0, 1),
        new Date(2026, 2, 10, 0, 0, 1), new Date(2026, 2, 10, 0, 0, 0, 1)
      ]) {
        assert.equal(formatValue(date), date.toISOString());
      }
    });

    if (type === 'sqlite') {
      it('executes statements without result rows', async () => {
        // source: 2026-10-06 measurement, SQLite .all() threw for CREATE TABLE statements.
        let result!: Awaited<ReturnType<DatabaseAdapter['execute']>>;
        await assert.doesNotReject(async () => {
          result = await adapter.execute('CREATE TABLE scratch (id INTEGER)');
        });
        assert.deepEqual(result.rows, []);
        assert.deepEqual((await adapter.execute('SELECT id FROM scratch')).rows, []);
      });
    }
  });
}
