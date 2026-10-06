/**
 * Business Rules Validator
 *
 * Validates domain-specific business logic constraints.
 * Highly configurable to support any business rules.
 */

import type { ValidationResult, BusinessRuleConfig, DatabaseAdapter } from './types';

export interface BusinessRulesConfig {
  rules: BusinessRuleConfig[];
  adapter: DatabaseAdapter;
}

export async function validateBusinessRules(
  config: BusinessRulesConfig
): Promise<ValidationResult> {
  console.log('Validating Business Rules...');

  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    for (const rule of config.rules) {
      const result = await validateSingleRule(rule, config.adapter);

      if (result.errors.length > 0) {
        errors.push(...result.errors);
      }
      if (result.warnings.length > 0) {
        warnings.push(...result.warnings);
      }
    }

    if (errors.length === 0) {
      console.log(`   ✅ All ${config.rules.length} business rule(s) validated`);
    } else {
      console.log(`   ❌ ${errors.length} business rule violation(s) found`);
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings
    };

  } catch (error) {
    errors.push(`Business rules validation failed: ${error}`);
    return { passed: false, errors, warnings };
  }
}

async function validateSingleRule(
  rule: BusinessRuleConfig,
  adapter: DatabaseAdapter
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Build the WHERE clause
    const whereClause = rule.condition ? `WHERE (${rule.condition})` : '';

    // Check required fields
    if (rule.requireFields && rule.requireFields.length > 0) {
      for (const field of rule.requireFields) {
        const query = `
          SELECT COUNT(*) AS count
          FROM ${rule.table}
          ${whereClause}
            ${rule.condition ? 'AND' : 'WHERE'} ${field} IS NULL
        `;

        const result = await adapter.execute(query);
        const count = Number(result.rows[0].count);

        if (count > 0) {
          const message = rule.errorMessage ||
            `Rule "${rule.name}": Found ${count} records where required field ${field} is null`;
          errors.push(message);
        }
      }
    }

    // Check forbidden fields
    if (rule.forbidFields && rule.forbidFields.length > 0) {
      for (const field of rule.forbidFields) {
        const query = `
          SELECT COUNT(*) AS count
          FROM ${rule.table}
          ${whereClause}
            ${rule.condition ? 'AND' : 'WHERE'} ${field} IS NOT NULL
        `;

        const result = await adapter.execute(query);
        const count = Number(result.rows[0].count);

        if (count > 0) {
          const message = rule.errorMessage ||
            `Rule "${rule.name}": Found ${count} records where forbidden field ${field} is not null`;
          errors.push(message);
        }
      }
    }

    // Custom validator
    if (rule.customValidator) {
      const query = `SELECT * FROM ${rule.table} ${whereClause}`;
      const result = await adapter.execute(query);

      for (const row of result.rows) {
        if (!rule.customValidator(row)) {
          errors.push(
            rule.errorMessage ||
            `Rule "${rule.name}": Custom validation failed for record ${row.id}`
          );
        }
      }
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings
    };

  } catch (error) {
    errors.push(`Rule "${rule.name}" validation failed: ${error}`);
    return { passed: false, errors, warnings };
  }
}

/**
 * Helper: Common business rules builders
 */

export function createStageConsistencyRule(config: {
  table: string;
  stageField: string;
  stageRequirements: {
    stage: string;
    requireFields?: string[];
    forbidFields?: string[];
  }[];
}): BusinessRuleConfig[] {
  return config.stageRequirements.map(req => ({
    name: `${config.table}_${req.stage}_consistency`,
    table: config.table,
    condition: `${config.stageField} = '${req.stage}'`,
    requireFields: req.requireFields,
    forbidFields: req.forbidFields,
    errorMessage: `Records in stage "${req.stage}" must meet field requirements`
  }));
}

export function createValueRangeRule(config: {
  table: string;
  field: string;
  min?: number;
  max?: number;
  allowNull?: boolean;
}): BusinessRuleConfig {
  return {
    name: `${config.table}_${config.field}_range`,
    table: config.table,
    customValidator: row => {
      const value = row[config.field];
      if (value === null || value === undefined) {
        return config.allowNull === true;
      }
      const n = Number(value);
      return (config.min === undefined || n >= config.min) &&
        (config.max === undefined || n <= config.max);
    },
    errorMessage: `Field ${config.field} must be between ${config.min} and ${config.max}`
  };
}

export function createConditionalRequirementRule(config: {
  table: string;
  name: string;
  whenCondition: string;
  requireFields: string[];
}): BusinessRuleConfig {
  return {
    name: config.name,
    table: config.table,
    condition: config.whenCondition,
    requireFields: config.requireFields,
    errorMessage: `When ${config.whenCondition}, fields ${config.requireFields.join(', ')} are required`
  };
}

export function createMutualExclusivityRule(config: {
  table: string;
  name: string;
  fields: string[];
}): BusinessRuleConfig {
  // Only one of the specified fields should be non-null
  const nonNullChecks = config.fields.map(f => `${f} IS NOT NULL`).join(' + ');

  return {
    name: config.name,
    table: config.table,
    customValidator: (row: any) => {
      const nonNullCount = config.fields.filter(f => row[f] !== null).length;
      return nonNullCount <= 1;
    },
    errorMessage: `Only one of ${config.fields.join(', ')} should be set`
  };
}

export function createStatusProgressionRule(config: {
  table: string;
  statusField: string;
  validTransitions: { from: string; to: string[] }[];
}): BusinessRuleConfig {
  // This would require status history - placeholder for concept
  return {
    name: `${config.table}_status_progression`,
    table: config.table,
    customValidator: (row: any) => {
      // Would need to check history table to validate transitions
      return true;
    },
    errorMessage: 'Invalid status progression'
  };
}

/**
 * Helper: Validate enum values
 */
export async function validateEnumValues(
  adapter: DatabaseAdapter,
  config: {
    table: string;
    field: string;
    allowedValues: string[];
  }
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const allowedValuesStr = config.allowedValues.map(v => `'${v}'`).join(', ');

  const query = `
    SELECT DISTINCT ${config.field}
    FROM ${config.table}
    WHERE ${config.field} IS NOT NULL
      AND ${config.field} NOT IN (${allowedValuesStr})
    LIMIT 10
  `;

  try {
    const result = await adapter.execute(query);

    if (result.rows.length > 0) {
      const invalidValues = result.rows.map((r: any) => r[config.field]).join(', ');
      errors.push(
        `Field ${config.table}.${config.field} has invalid values: ${invalidValues}. ` +
        `Allowed: ${config.allowedValues.join(', ')}`
      );
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings
    };

  } catch (error) {
    errors.push(`Enum validation failed: ${error}`);
    return { passed: false, errors, warnings };
  }
}

/**
 * Helper: Validate uniqueness constraints
 */
export async function validateUniqueness(
  adapter: DatabaseAdapter,
  config: {
    table: string;
    fields: string[];
    allowNull?: boolean;
  }
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const fieldsList = config.fields.join(', ');
  const nullClause = config.allowNull
    ? ''
    : `WHERE ${config.fields.map(f => `${f} IS NOT NULL`).join(' AND ')}`;

  const query = `
    SELECT ${fieldsList}, COUNT(*) as count
    FROM ${config.table}
    ${nullClause}
    GROUP BY ${fieldsList}
    HAVING COUNT(*) > 1
    LIMIT 10
  `;

  try {
    const result = await adapter.execute(query);

    if (result.rows.length > 0) {
      errors.push(
        `Found ${result.rows.length} duplicate combinations in ${config.table} for fields: ${fieldsList}`
      );

      result.rows.slice(0, 3).forEach((row: any) => {
        const values = config.fields.map(f => `${f}=${row[f]}`).join(', ');
        errors.push(`  Example: ${values} (${row.count} occurrences)`);
      });
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings
    };

  } catch (error) {
    errors.push(`Uniqueness validation failed: ${error}`);
    return { passed: false, errors, warnings };
  }
}
