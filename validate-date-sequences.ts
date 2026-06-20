/**
 * Date Sequence Validator
 *
 * Validates temporal logic and date ordering constraints.
 * Ensures business workflow dates follow logical sequences.
 */

import type { ValidationResult, DateRuleConfig, DatabaseAdapter } from './types';

export interface DateSequenceConfig {
  rules: DateRuleConfig[];
  adapter: DatabaseAdapter;
  checkFutureDates?: boolean;
}

export async function validateDateSequences(
  config: DateSequenceConfig
): Promise<ValidationResult> {
  console.log('Validating Date Sequences...');

  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    for (const rule of config.rules) {
      const operator = rule.allowEqual ? '>=' : '>';
      const query = `
        SELECT
          COUNT(*) as count,
          id,
          ${rule.before},
          ${rule.after}
        FROM ${rule.table}
        WHERE ${rule.before} IS NOT NULL
          AND ${rule.after} IS NOT NULL
          AND ${rule.before} ${operator} ${rule.after}
        GROUP BY id, ${rule.before}, ${rule.after}
        LIMIT 10
      `;

      const result = await config.adapter.execute(query);
      const violationCount = result.rows.length;

      if (violationCount > 0) {
        const message = rule.errorMessage ||
          `Found ${violationCount} date sequence violation(s) in ${rule.table}: ${rule.before} should be before ${rule.after}`;
        errors.push(message);

        // Log examples
        result.rows.slice(0, 3).forEach((row: any) => {
          errors.push(
            `  Example: ID ${row.id} - ${rule.before}=${row[rule.before]}, ${rule.after}=${row[rule.after]}`
          );
        });
      }
    }

    // Check for future dates if enabled
    if (config.checkFutureDates) {
      const futureErrors = await checkFutureDates(config.adapter);
      errors.push(...futureErrors);
    }

    if (errors.length === 0) {
      console.log(`   ✅ All ${config.rules.length} date sequence rule(s) validated`);
    } else {
      console.log(`   ❌ ${errors.length} date sequence error(s) found`);
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings
    };

  } catch (error) {
    errors.push(`Date sequence validation failed: ${error}`);
    return { passed: false, errors, warnings };
  }
}

/**
 * Helper: Check for dates in the future where they shouldn't be
 */
async function checkFutureDates(adapter: DatabaseAdapter): Promise<string[]> {
  const errors: string[] = [];

  // This is a generic check - customize for your schema
  const commonDateFields = [
    'created_at',
    'updated_at',
    'completed_date',
    'closed_date',
    'paid_date'
  ];

  // Would need to be implemented based on specific schema
  // This is a placeholder for the concept

  return errors;
}

/**
 * Helper: Validate sequential progression within a partition
 * Example: Task completion dates should be sequential within a project
 */
export async function validateSequentialProgression(
  adapter: DatabaseAdapter,
  config: {
    table: string;
    dateField: string;
    partitionBy: string;
    orderBy?: string;
  }
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const orderClause = config.orderBy || config.dateField;

  const query = `
    WITH ranked AS (
      SELECT
        *,
        LAG(${config.dateField}) OVER (
          PARTITION BY ${config.partitionBy}
          ORDER BY ${orderClause}
        ) as prev_date
      FROM ${config.table}
      WHERE ${config.dateField} IS NOT NULL
    )
    SELECT *
    FROM ranked
    WHERE ${config.dateField} < prev_date
    LIMIT 10
  `;

  try {
    const result = await adapter.execute(query);

    if (result.rows.length > 0) {
      errors.push(
        `Found ${result.rows.length} out-of-sequence dates in ${config.table}.${config.dateField}`
      );

      result.rows.forEach((row: any) => {
        errors.push(
          `  Example: ${config.partitionBy}=${row[config.partitionBy]} - ` +
          `current=${row[config.dateField]}, previous=${row.prev_date}`
        );
      });
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings
    };

  } catch (error) {
    errors.push(`Sequential progression validation failed: ${error}`);
    return { passed: false, errors, warnings };
  }
}

/**
 * Helper: Validate date is within expected business hours (if relevant)
 */
export async function validateBusinessHours(
  adapter: DatabaseAdapter,
  config: {
    table: string;
    dateField: string;
    businessHoursStart?: number; // Hour (0-23)
    businessHoursEnd?: number;
  }
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const startHour = config.businessHoursStart || 8;
  const endHour = config.businessHoursEnd || 18;

  const query = `
    SELECT COUNT(*) as count
    FROM ${config.table}
    WHERE ${config.dateField} IS NOT NULL
      AND (
        EXTRACT(HOUR FROM ${config.dateField}) < ${startHour}
        OR EXTRACT(HOUR FROM ${config.dateField}) >= ${endHour}
      )
  `;

  try {
    const result = await adapter.execute(query);
    const count = Number(result.rows[0]?.count || 0);

    if (count > 0) {
      warnings.push(
        `Found ${count} records in ${config.table} with ${config.dateField} outside business hours`
      );
    }

    return {
      passed: true, // Just a warning
      errors,
      warnings
    };

  } catch (error) {
    errors.push(`Business hours validation failed: ${error}`);
    return { passed: false, errors, warnings };
  }
}

/**
 * Helper: Common date validation rules builder
 */
export function createCommonDateRules(tables: {
  [table: string]: { before: string; after: string }[]
}): DateRuleConfig[] {
  const rules: DateRuleConfig[] = [];

  for (const [table, dateRules] of Object.entries(tables)) {
    for (const rule of dateRules) {
      rules.push({
        table,
        before: rule.before,
        after: rule.after,
        allowEqual: false
      });
    }
  }

  return rules;
}
