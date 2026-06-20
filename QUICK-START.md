# Data Quality Tools - Quick Start

Get started in 3 minutes!

## Step 1: Copy Example Config

```bash
cp ~/.claude/scripts/data-quality/example-config.json ./my-config.json
```

## Step 2: Edit Config for Your Schema

```json
{
  "database": {
    "type": "neon",
    "connectionString": "postgresql://user:pass@host/db"
  },
  "tables": {
    "projects": {
      "calculated": {
        "spent": {
          "source": "SELECT SUM(actual_spent) FROM milestones WHERE project_id = $1",
          "field": "spent"
        }
      }
    }
  },
  "relationships": [
    {
      "child": "tasks",
      "parent": "projects",
      "foreignKey": "project_id"
    }
  ]
}
```

## Step 3: Run Validation

```bash
npx tsx ~/.claude/scripts/data-quality/cli.ts --config my-config.json
```

## Output

```
🔍 Data Quality Analysis Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Overall Quality Score: 95/100 (Grade: A)

✅ Referential Integrity: PASS (0 violations)
✅ Date Sequences: PASS (0 violations)
⚠️  Calculated Fields: WARNING (3 discrepancies)
✅ Null Analysis: PASS (98% complete)
✅ Business Rules: PASS (all valid)

Total Issues: 3 (all fixable)
```

## Common Commands

```bash
# HTML report
npx tsx ~/.claude/scripts/data-quality/cli.ts --format html --output report.html

# JSON output
npx tsx ~/.claude/scripts/data-quality/cli.ts --format json > data.json

# Specific validator
npx tsx ~/.claude/scripts/data-quality/cli.ts --only referential-integrity

# Verbose output
npx tsx ~/.claude/scripts/data-quality/cli.ts --verbose
```

## Shell Alias (Optional)

```bash
# Add to ~/.zshrc or ~/.bashrc
alias dq='npx tsx ~/.claude/scripts/data-quality/cli.ts'

# Then use:
dq --config my-config.json
dq --format html
```

## Need Help?

```bash
# Full documentation
cat ~/.claude/scripts/data-quality/README.md

# Usage examples
cat ~/.claude/scripts/data-quality/USAGE-EXAMPLES.md

# Quick reference
cat ~/.claude/scripts/data-quality/QUICK-REFERENCE.md
```

That's it! You're validating data quality across any project. 🎉
