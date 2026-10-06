# Data Quality Tools - Usage Examples

Some checks have known limits. Read [Known limits](README.md#known-limits) before relying on calculated fields, null analysis or business rules.

## Quick Start

### 1. CLI Usage (Simplest)

```bash
# Create config file
cat > data-quality-config.json << EOF
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
  ]
}
EOF

# Run validations
bunx tsx cli.ts

# Generate HTML report
bunx tsx cli.ts --format html --output quality-report.html
```

### 2. Programmatic Usage (TypeScript/JavaScript)

```typescript
import { generateQualityReport, createAdapter } from './index';

async function checkDataQuality() {
  const adapter = createAdapter({
    type: 'neon',
    connectionString: process.env.DATABASE_URL!
  });

  const config = {
    database: { type: 'neon', connectionString: process.env.DATABASE_URL! },
    validations: {
      referentialIntegrity: true,
      dateSequences: true,
      calculatedFields: true,
      nullAnalysis: true,
      businessRules: true
    },
    relationships: [
      { child: 'tasks', parent: 'projects', foreignKey: 'project_id' }
    ],
    dateRules: [
      { table: 'projects', before: 'start_date', after: 'end_date' }
    ]
  };

  const report = await generateQualityReport(adapter, config);
  console.log(`Quality Score: ${report.score}/100 (${report.grade})`);

  await adapter.disconnect();
}

checkDataQuality();
```

### 3. Individual Validation Checks

```typescript
import {
  validateReferentialIntegrity,
  validateDateSequences,
  validateCalculatedFields,
  createAdapter
} from './index';

const adapter = createAdapter({
  type: 'neon',
  connectionString: process.env.DATABASE_URL!
});

// Check referential integrity only
const result = await validateReferentialIntegrity({
  relationships: [
    { child: 'tasks', parent: 'projects', foreignKey: 'project_id' },
    { child: 'comments', parent: 'tasks', foreignKey: 'task_id' }
  ],
  adapter
});

console.log(`Passed: ${result.passed}`);
console.log(`Errors: ${result.errors.length}`);
```

## Real-World Examples

### Example 1: E-commerce Platform

```typescript
const ecommerceConfig = {
  database: {
    type: 'postgres',
    connectionString: process.env.DATABASE_URL
  },
  validations: {
    referentialIntegrity: true,
    dateSequences: true,
    calculatedFields: true,
    nullAnalysis: true,
    businessRules: true
  },
  relationships: [
    { child: 'order_items', parent: 'orders', foreignKey: 'order_id' },
    { child: 'orders', parent: 'customers', foreignKey: 'customer_id' },
    { child: 'payments', parent: 'orders', foreignKey: 'order_id' },
    { child: 'shipments', parent: 'orders', foreignKey: 'order_id' }
  ],
  dateRules: [
    { table: 'orders', before: 'created_at', after: 'shipped_at' },
    { table: 'orders', before: 'shipped_at', after: 'delivered_at' },
    { table: 'payments', before: 'authorized_at', after: 'captured_at' }
  ],
  calculations: [
    {
      table: 'orders',
      field: 'total_amount',
      calculation: 'SUM',
      sourceTable: 'order_items',
      sourceField: 'subtotal',
      joinKey: 'order_id'
    }
  ],
  businessRules: [
    {
      name: 'shipped_orders_need_tracking',
      table: 'orders',
      condition: "status = 'shipped'",
      requireFields: ['tracking_number', 'shipped_at']
    },
    {
      name: 'refunded_orders_need_refund_data',
      table: 'orders',
      condition: "status = 'refunded'",
      requireFields: ['refunded_at', 'refund_amount']
    }
  ]
};
```

### Example 2: SaaS Subscription Service

```typescript
const saasConfig = {
  database: {
    type: 'neon',
    connectionString: process.env.DATABASE_URL
  },
  validations: {
    referentialIntegrity: true,
    dateSequences: true,
    calculatedFields: true,
    nullAnalysis: true,
    businessRules: true
  },
  relationships: [
    { child: 'subscriptions', parent: 'customers', foreignKey: 'customer_id' },
    { child: 'invoices', parent: 'subscriptions', foreignKey: 'subscription_id' },
    { child: 'payments', parent: 'invoices', foreignKey: 'invoice_id' },
    { child: 'usage_records', parent: 'subscriptions', foreignKey: 'subscription_id' }
  ],
  dateRules: [
    { table: 'subscriptions', before: 'start_date', after: 'end_date' },
    { table: 'subscriptions', before: 'trial_start', after: 'trial_end' },
    { table: 'invoices', before: 'created_at', after: 'due_date' },
    { table: 'invoices', before: 'due_date', after: 'paid_at' }
  ],
  calculations: [
    {
      table: 'subscriptions',
      field: 'mrr',
      calculation: 'SUM',
      sourceTable: 'subscription_items',
      sourceField: 'amount',
      joinKey: 'subscription_id'
    }
  ],
  businessRules: [
    {
      name: 'active_subscriptions_need_payment_method',
      table: 'subscriptions',
      condition: "status = 'active'",
      requireFields: ['payment_method_id']
    },
    {
      name: 'cancelled_subscriptions_need_cancellation_date',
      table: 'subscriptions',
      condition: "status = 'cancelled'",
      requireFields: ['cancelled_at', 'cancellation_reason']
    }
  ]
};
```

### Example 3: CRM System (like AcmeCRM)

```typescript
const crmConfig = {
  database: {
    type: 'neon',
    connectionString: process.env.DATABASE_URL
  },
  validations: {
    referentialIntegrity: true,
    dateSequences: true,
    calculatedFields: true,
    nullAnalysis: true,
    businessRules: true
  },
  relationships: [
    { child: 'contacts', parent: 'accounts', foreignKey: 'account_id' },
    { child: 'opportunities', parent: 'accounts', foreignKey: 'account_id' },
    { child: 'activities', parent: 'contacts', foreignKey: 'contact_id' },
    { child: 'tasks', parent: 'opportunities', foreignKey: 'opportunity_id' }
  ],
  dateRules: [
    { table: 'opportunities', before: 'created_at', after: 'close_date' },
    { table: 'tasks', before: 'created_at', after: 'due_date' },
    { table: 'activities', before: 'scheduled_at', after: 'completed_at' }
  ],
  calculations: [
    {
      table: 'accounts',
      field: 'total_revenue',
      calculation: 'SUM',
      sourceTable: 'opportunities',
      sourceField: 'amount',
      joinKey: 'account_id',
      filter: "status = 'won'"
    }
  ],
  businessRules: [
    {
      name: 'won_opportunities_need_close_date',
      table: 'opportunities',
      condition: "status = 'won'",
      requireFields: ['close_date', 'amount']
    },
    {
      name: 'qualified_leads_need_score',
      table: 'leads',
      condition: "stage = 'qualified'",
      requireFields: ['lead_score']
    }
  ]
};
```

## Helper Functions

### Auto-detect Database Relationships

```typescript
import { detectRelationships, createAdapter } from './index';

const adapter = createAdapter({
  type: 'postgres',
  connectionString: process.env.DATABASE_URL!
});

// Automatically find all foreign key relationships
const relationships = await detectRelationships(adapter);
console.log('Found relationships:', relationships);
```

### Validate Specific Areas Only

```typescript
import { validateDateSequences, createAdapter } from './index';

const adapter = createAdapter({
  type: 'neon',
  connectionString: process.env.DATABASE_URL!
});

// Check only date sequences
const result = await validateDateSequences({
  rules: [
    { table: 'projects', before: 'start_date', after: 'delivery_date' },
    { table: 'invoices', before: 'issued_at', after: 'paid_at' }
  ],
  adapter
});

if (!result.passed) {
  console.log('Date sequence violations found:');
  result.errors.forEach(err => console.log(`  - ${err}`));
}
```

### Analyze Null Patterns

```typescript
import { analyzeNulls, generateNullReport, createAdapter } from './index';

const adapter = createAdapter({
  type: 'neon',
  connectionString: process.env.DATABASE_URL!
});

const result = await analyzeNulls(adapter, {
  tables: ['users', 'projects', 'tasks'],
  requiredFields: {
    users: ['email', 'name'],
    projects: ['title', 'status']
  },
  completenessThreshold: 95
});

console.log(`Data Completeness: ${result.completenessScore}%`);
console.log(generateNullReport(result.fieldAnalysis || []));
```

## Integration Examples

### Add to CI/CD Pipeline

```yaml
# .github/workflows/data-quality.yml
name: Data Quality Check

on:
  schedule:
    - cron: '0 0 * * *'  # Daily at midnight
  workflow_dispatch:

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Run data quality checks
        run: bunx tsx cli.ts --format json --output report.json
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}

      - name: Upload report
        uses: actions/upload-artifact@v4
        with:
          name: data-quality-report
          path: report.json

      - name: Fail if quality score below threshold
        run: |
          SCORE=$(cat report.json | jq '.score')
          if [ $SCORE -lt 80 ]; then
            echo "Quality score $SCORE is below threshold (80)"
            exit 1
          fi
```

### Add to package.json scripts

```json
{
  "scripts": {
    "db:validate": "tsx cli.ts",
    "db:report": "tsx cli.ts --format html --output reports/data-quality.html",
    "db:check:quick": "tsx cli.ts --only referential-integrity"
  }
}
```

### Pre-deployment Hook

```typescript
// scripts/pre-deploy.ts
import { generateQualityReport, createAdapter } from './index';
import config from './data-quality-config.json';

async function preDeploymentCheck() {
  const adapter = createAdapter({
    type: config.database.type,
    connectionString: process.env.DATABASE_URL!
  });

  const report = await generateQualityReport(adapter, config);

  if (report.score < 80) {
    console.error(`❌ Data quality score (${report.score}) is below threshold (80)`);
    console.error('Fix data quality issues before deploying');
    process.exit(1);
  }

  console.log(`✅ Data quality passed (${report.score}/100)`);
  await adapter.disconnect();
}

preDeploymentCheck();
```

## Tips & Best Practices

1. **Start Small**: Begin with referential integrity checks, then add more validations

2. **Set Realistic Thresholds**: Don't aim for 100% completeness on all fields initially

3. **Document Exceptions**: Some business rules may have valid exceptions

4. **Run Regularly**: Schedule automated checks (daily/weekly)

5. **Track Trends**: Save reports over time to monitor improvements

6. **Custom Validators**: Add project-specific validators using the business rules framework

7. **Performance**: For large databases, run validations during off-peak hours

8. **Incremental Fixes**: Address high-priority issues first (integrity > completeness)
