# Data Quality Tools - Quick Reference

## One-Liners

```bash
# Run all validations
bun x tsx ~/.claude/scripts/data-quality/cli.ts

# Generate HTML report
bun x tsx ~/.claude/scripts/data-quality/cli.ts --format html --output report.html

# Check only referential integrity
bun x tsx ~/.claude/scripts/data-quality/cli.ts --only referential-integrity

# Check only date sequences
bun x tsx ~/.claude/scripts/data-quality/cli.ts --only date-sequences

# Check only calculated fields
bun x tsx ~/.claude/scripts/data-quality/cli.ts --only calculated-fields

# Check only null analysis
bun x tsx ~/.claude/scripts/data-quality/cli.ts --only null-analysis

# Check only business rules
bun x tsx ~/.claude/scripts/data-quality/cli.ts --only business-rules

# Use custom config
bun x tsx ~/.claude/scripts/data-quality/cli.ts --config ./my-config.json
```

## Minimal Config Template

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
    { "child": "TABLE", "parent": "PARENT", "foreignKey": "FK" }
  ],
  "dateRules": [
    { "table": "TABLE", "before": "START", "after": "END" }
  ],
  "calculations": [
    {
      "table": "TABLE",
      "field": "TOTAL",
      "calculation": "SUM",
      "sourceTable": "SOURCE",
      "sourceField": "AMOUNT",
      "joinKey": "FK"
    }
  ],
  "nullAnalysis": {
    "tables": ["TABLE1", "TABLE2"],
    "requiredFields": {
      "TABLE1": ["field1", "field2"]
    }
  },
  "businessRules": [
    {
      "name": "rule_name",
      "table": "TABLE",
      "condition": "field = 'value'",
      "requireFields": ["field1"]
    }
  ]
}
```

## Programmatic Usage

```typescript
import { generateQualityReport, createAdapter } from '~/.claude/scripts/data-quality';

const adapter = createAdapter({
  type: 'neon',
  connectionString: process.env.DATABASE_URL!
});

const report = await generateQualityReport(adapter, config);
console.log(`Score: ${report.score}/100 (${report.grade})`);
await adapter.disconnect();
```

## Database Types

- `neon` - Neon Serverless
- `neon-pool` - Neon with pooling
- `postgres` - PostgreSQL (pg)
- `mysql` - MySQL
- `sqlite` - SQLite
- `drizzle` - Drizzle ORM

## Calculation Types

- `SUM` - Sum of values
- `COUNT` - Count of records
- `AVG` - Average value
- `MAX` - Maximum value
- `MIN` - Minimum value

## Quality Score Grading

- **90-100:** Grade A (Excellent)
- **80-89:** Grade B (Good)
- **70-79:** Grade C (Fair)
- **60-69:** Grade D (Needs Work)
- **0-59:** Grade F (Critical Issues)

## Common Patterns

### Referential Integrity
```json
{
  "relationships": [
    { "child": "orders", "parent": "customers", "foreignKey": "customer_id" },
    { "child": "order_items", "parent": "orders", "foreignKey": "order_id" }
  ]
}
```

### Date Sequences
```json
{
  "dateRules": [
    { "table": "orders", "before": "created_at", "after": "shipped_at" },
    { "table": "orders", "before": "shipped_at", "after": "delivered_at" }
  ]
}
```

### Calculated Fields
```json
{
  "calculations": [
    {
      "table": "orders",
      "field": "total",
      "calculation": "SUM",
      "sourceTable": "order_items",
      "sourceField": "price",
      "joinKey": "order_id"
    }
  ]
}
```

### Business Rules
```json
{
  "businessRules": [
    {
      "name": "shipped_orders_need_tracking",
      "table": "orders",
      "condition": "status = 'shipped'",
      "requireFields": ["tracking_number"]
    }
  ]
}
```

## CI/CD Integration

```yaml
# .github/workflows/data-quality.yml
- name: Data Quality Check
  run: bun x tsx ~/.claude/scripts/data-quality/cli.ts --format json --output report.json
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

## File Locations

```
~/.claude/scripts/data-quality/
├── README.md                           # Full documentation
├── USAGE-EXAMPLES.md                   # Real-world examples
├── QUICK-REFERENCE.md                  # This file
├── EXTRACTION-SUMMARY.md               # Project history
├── types.ts                            # TypeScript types
├── adapters.ts                         # Database adapters
├── validate-referential-integrity.ts   # Foreign key validation
├── validate-date-sequences.ts          # Date ordering validation
├── validate-calculated-fields.ts       # Aggregation validation
├── analyze-nulls.ts                    # Completeness analysis
├── validate-business-rules.ts          # Business logic validation
├── generate-quality-report.ts          # Report generator
├── cli.ts                              # Command-line interface
├── index.ts                            # Main entry point
├── example-config.json                 # Config template
└── package.json                        # NPM package definition
```

## Help

```bash
# Show CLI help
bun x tsx ~/.claude/scripts/data-quality/cli.ts --help

# Read full documentation
cat ~/.claude/scripts/data-quality/README.md

# See usage examples
cat ~/.claude/scripts/data-quality/USAGE-EXAMPLES.md
```
