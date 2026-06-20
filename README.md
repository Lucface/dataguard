# DataGuard

Generic, reusable data quality validation tools extracted from the AcmeCRM project.

## Overview

This directory contains schema-agnostic data quality validation utilities that can be adapted to any database project. These tools were originally developed for the AcmeCRM but have been generalized for broader use.

## Tools

### 1. `validate-referential-integrity.ts`
**Purpose:** Checks for orphaned records and broken foreign key relationships

**Features:**
- Detects orphaned child records
- Validates foreign key references
- Works with any table relationships

**Usage:**
```typescript
import { validateReferentialIntegrity } from './validate-referential-integrity';

const config = {
  relationships: [
    { child: 'project_tasks', parent: 'projects', foreignKey: 'project_id' },
    { child: 'invoices', parent: 'projects', foreignKey: 'project_id' }
  ]
};

await validateReferentialIntegrity(db, config);
```

### 2. `validate-date-sequences.ts`
**Purpose:** Validates temporal logic and date ordering constraints

**Features:**
- Ensures start dates precede end dates
- Validates sequential date progressions
- Checks for future dates where inappropriate
- Validates business workflow dates (e.g., invoiced before paid)

**Usage:**
```typescript
import { validateDateSequences } from './validate-date-sequences';

const config = {
  dateRules: [
    { table: 'projects', before: 'start_date', after: 'delivery_date' },
    { table: 'payment_milestones', before: 'invoiced_date', after: 'paid_date' }
  ]
};

await validateDateSequences(db, config);
```

### 3. `validate-calculated-fields.ts`
**Purpose:** Ensures calculated/derived fields match their source data

**Features:**
- Validates aggregation accuracy (SUM, COUNT, AVG)
- Checks percentage calculations
- Verifies derived metrics
- Detects calculation mismatches

**Usage:**
```typescript
import { validateCalculatedFields } from './validate-calculated-fields';

const config = {
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
};

await validateCalculatedFields(db, config);
```

### 4. `analyze-nulls.ts`
**Purpose:** Analyzes null/empty field patterns and completeness

**Features:**
- Counts null/empty values per field
- Calculates data completeness percentages
- Identifies required fields with missing data
- Suggests fields that should have defaults

**Usage:**
```typescript
import { analyzeNulls } from './analyze-nulls';

const config = {
  tables: ['projects', 'contacts', 'invoices'],
  requiredFields: {
    projects: ['name', 'client', 'budget'],
    contacts: ['email', 'company']
  }
};

await analyzeNulls(db, config);
```

### 5. `validate-business-rules.ts`
**Purpose:** Validates domain-specific business logic constraints

**Features:**
- Configurable business rule validation
- Stage/status consistency checks
- Value range validation
- Custom validation functions

**Usage:**
```typescript
import { validateBusinessRules } from './validate-business-rules';

const config = {
  rules: [
    {
      name: 'completed_projects_need_dates',
      table: 'projects',
      condition: "stage = 'Completed'",
      requireFields: ['completed_date']
    }
  ]
};

await validateBusinessRules(db, config);
```

### 6. `generate-quality-report.ts`
**Purpose:** Comprehensive data quality assessment with scoring

**Features:**
- Runs all validation checks
- Generates quality score (0-100)
- Produces detailed HTML/JSON reports
- Tracks quality trends over time

**Usage:**
```typescript
import { generateQualityReport } from './generate-quality-report';

const report = await generateQualityReport(db, {
  includeWarnings: true,
  outputFormat: 'html',
  outputPath: './reports/data-quality-report.html'
});

console.log(`Quality Score: ${report.score}%`);
```

## Database Adapters

These tools support multiple database backends through adapters:

- **Neon Serverless** (PostgreSQL)
- **Drizzle ORM**
- **Raw SQL** (PostgreSQL, MySQL, SQLite)

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
      "sourceField": "amount"
    }
  ]
}
```

## CLI Usage

Run validations from the command line:

```bash
# Run all validations
npx tsx ~/.claude/scripts/data-quality/run-validations.ts

# Run specific validation
npx tsx ~/.claude/scripts/data-quality/run-validations.ts --only referential-integrity

# Generate report
npx tsx ~/.claude/scripts/data-quality/generate-quality-report.ts --output report.html

# Quick check
npx tsx ~/.claude/scripts/data-quality/quick-check.ts
```

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
      - uses: actions/checkout@v2
      - name: Run data quality checks
        run: |
          bun install
          bun x tsx ~/.claude/scripts/data-quality/run-validations.ts
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

## Extending the Tools

### Add Custom Validators

```typescript
// my-custom-validator.ts
import { ValidationResult } from './types';

export async function validateCustomRule(db: any, config: any): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Your custom validation logic here

  return {
    passed: errors.length === 0,
    errors,
    warnings
  };
}
```

### Register Custom Validators

```typescript
import { registerValidator } from './registry';
import { validateCustomRule } from './my-custom-validator';

registerValidator('custom-rule', validateCustomRule);
```

## Best Practices

1. **Run regularly:** Schedule automated quality checks
2. **Track trends:** Monitor quality scores over time
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
