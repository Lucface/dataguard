/**
 * Calculated Fields Validator
 *
 * Ensures calculated/derived fields match their source data.
 * Validates aggregations, percentages, and computed metrics.
 */

import type { ValidationResult, CalculationConfig, DatabaseAdapter } from './types';
import { formatValue } from './validate-date-sequences';

export interface CalculatedFieldsConfig {
  calculations: CalculationConfig[];
  adapter: DatabaseAdapter;
}

export async function validateCalculatedFields(
  config: CalculatedFieldsConfig
): Promise<ValidationResult> {
  console.log('Validating Calculated Fields...');

  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    for (const calc of config.calculations) {
      const result = await validateSingleCalculation(calc, config.adapter);

      if (result.errors.length > 0) {
        errors.push(...result.errors);
      }
      if (result.warnings.length > 0) {
        warnings.push(...result.warnings);
      }
    }

    if (errors.length === 0) {
      console.log(`   ✅ All ${config.calculations.length} calculated field(s) validated`);
    } else {
      console.log(`   ❌ ${errors.length} calculated field error(s) found`);
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings
    };

  } catch (error) {
    errors.push(`Calculated fields validation failed: ${error}`);
    return { passed: false, errors, warnings };
  }
}

async function validateSingleCalculation(
  calc: CalculationConfig,
  adapter: DatabaseAdapter
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const tolerance = calc.tolerance || 0.01; // Default: 1 cent for money

  // Build the aggregation expression
  const aggExpr = buildAggregationExpression(calc);

  // Build the filter clause if provided
  const filterClause = calc.filter ? ` AND (${calc.filter})` : '';

  // Build join condition
  const parentKey = calc.parentKey || 'id';
  const joinKey = calc.joinKey || 'id';

  const query = `
    SELECT
      t.${parentKey} AS id,
      t.${calc.field} as recorded_value,
      COALESCE(${aggExpr}, 0) as calculated_value,
      ABS(t.${calc.field} - COALESCE(${aggExpr}, 0)) as discrepancy
    FROM ${calc.table} t
    LEFT JOIN ${calc.sourceTable} s ON t.${parentKey} = s.${joinKey}${filterClause}
    GROUP BY t.${parentKey}, t.${calc.field}
    HAVING ABS(t.${calc.field} - COALESCE(${aggExpr}, 0)) > ${tolerance}
  `;

  try {
    const countResult = await adapter.execute(`SELECT COUNT(*) AS count FROM (${query}) d`);
    const count = Number(countResult.rows[0].count);

    if (count > 0) {
      const result = await adapter.execute(`${query} ORDER BY id LIMIT 3`);
      errors.push(
        `Found ${count} discrepancies in ${calc.table}.${calc.field} ` +
        `(expected ${calc.calculation} of ${calc.sourceTable}.${calc.sourceField})`
      );

      for (const row of result.rows) {
        errors.push(
          `  Example: ID ${formatValue(row.id)} - Recorded=${formatValue(row.recorded_value)}, ` +
          `Calculated=${formatValue(row.calculated_value)}, Diff=${formatValue(row.discrepancy)}`
        );
      }
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings
    };

  } catch (error) {
    errors.push(`Validation failed for ${calc.table}.${calc.field}: ${error}`);
    return { passed: false, errors, warnings };
  }
}

function buildAggregationExpression(calc: CalculationConfig): string {
  switch (calc.calculation) {
    case 'SUM':
      return `SUM(s.${calc.sourceField})`;
    case 'COUNT':
      return `COUNT(s.${calc.sourceField})`;
    case 'AVG':
      return `AVG(s.${calc.sourceField})`;
    case 'MAX':
      return `MAX(s.${calc.sourceField})`;
    case 'MIN':
      return `MIN(s.${calc.sourceField})`;
    default:
      throw new Error(`Unsupported calculation type: ${calc.calculation}`);
  }
}

/**
 * Helper: Validate percentage calculations (should sum to 100)
 */
export async function validatePercentageSum(
  adapter: DatabaseAdapter,
  config: {
    table: string;
    percentageField: string;
    groupBy: string;
    expectedSum?: number;
  }
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const expectedSum = config.expectedSum || 100;

  const query = `
    SELECT
      ${config.groupBy},
      SUM(${config.percentageField}) as total_percentage
    FROM ${config.table}
    GROUP BY ${config.groupBy}
    HAVING ABS(SUM(${config.percentageField}) - ${expectedSum}) > 0.01
    LIMIT 10
  `;

  try {
    const result = await adapter.execute(query);

    if (result.rows.length > 0) {
      errors.push(
        `Found ${result.rows.length} groups where percentages don't sum to ${expectedSum}%`
      );

      result.rows.forEach((row: any) => {
        errors.push(
          `  Example: ${config.groupBy}=${row[config.groupBy]} - Total=${row.total_percentage}%`
        );
      });
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings
    };

  } catch (error) {
    errors.push(`Percentage sum validation failed: ${error}`);
    return { passed: false, errors, warnings };
  }
}

/**
 * Helper: Validate progress percentage (0-100 range)
 */
export async function validateProgressRange(
  adapter: DatabaseAdapter,
  config: {
    table: string;
    progressField: string;
    min?: number;
    max?: number;
  }
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const min = config.min !== undefined ? config.min : 0;
  const max = config.max !== undefined ? config.max : 100;

  const query = `
    SELECT id, ${config.progressField}
    FROM ${config.table}
    WHERE ${config.progressField} < ${min}
       OR ${config.progressField} > ${max}
    LIMIT 10
  `;

  try {
    const result = await adapter.execute(query);

    if (result.rows.length > 0) {
      errors.push(
        `Found ${result.rows.length} records with ${config.progressField} outside valid range (${min}-${max})`
      );

      result.rows.forEach((row: any) => {
        errors.push(
          `  Example: ID ${row.id} - ${config.progressField}=${row[config.progressField]}`
        );
      });
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings
    };

  } catch (error) {
    errors.push(`Progress range validation failed: ${error}`);
    return { passed: false, errors, warnings };
  }
}

/**
 * Helper: Validate that derived value doesn't exceed base value
 * Example: spent <= budget
 */
export async function validateDerivedNotExceedsBase(
  adapter: DatabaseAdapter,
  config: {
    table: string;
    baseField: string;
    derivedField: string;
    allowWarning?: boolean;
  }
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const query = `
    SELECT
      id,
      ${config.baseField},
      ${config.derivedField}
    FROM ${config.table}
    WHERE ${config.derivedField} > ${config.baseField}
    LIMIT 10
  `;

  try {
    const result = await adapter.execute(query);

    if (result.rows.length > 0) {
      const message = `Found ${result.rows.length} records where ${config.derivedField} exceeds ${config.baseField}`;

      if (config.allowWarning) {
        warnings.push(message);
      } else {
        errors.push(message);
      }

      result.rows.forEach((row: any) => {
        const detail = `  Example: ID ${row.id} - ${config.baseField}=${row[config.baseField]}, ${config.derivedField}=${row[config.derivedField]}`;
        if (config.allowWarning) {
          warnings.push(detail);
        } else {
          errors.push(detail);
        }
      });
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings
    };

  } catch (error) {
    errors.push(`Derived value validation failed: ${error}`);
    return { passed: false, errors, warnings };
  }
}
