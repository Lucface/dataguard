/**
 * Null/Empty Field Analyzer
 *
 * Analyzes data completeness and identifies missing required fields.
 * Provides insights on null patterns and suggests improvements.
 */

import type { ValidationResult, NullAnalysisConfig, DatabaseAdapter } from './types';

export interface NullAnalysisResult extends ValidationResult {
  completenessScore?: number;
  fieldAnalysis?: FieldNullAnalysis[];
}

export interface FieldNullAnalysis {
  table: string;
  field: string;
  nullCount: number;
  emptyCount: number;
  totalCount: number;
  completeness: number;
  required: boolean;
}

export async function analyzeNulls(
  adapter: DatabaseAdapter,
  config: NullAnalysisConfig
): Promise<NullAnalysisResult> {
  console.log('Analyzing Null/Empty Fields...');

  const errors: string[] = [];
  const warnings: string[] = [];
  const fieldAnalysis: FieldNullAnalysis[] = [];

  const threshold = config.completenessThreshold || 95;

  try {
    for (const table of config.tables) {
      // Get all columns for this table
      const columns = await getTableColumns(adapter, table);
      if (columns.length === 0) {
        errors.push(`Could not read the columns of ${table}`);
        continue;
      }

      for (const column of columns) {
        const analysis = await analyzeField(
          adapter,
          table,
          column.name,
          column.type,
          config.requiredFields?.[table]?.includes(column.name) || false
        );

        fieldAnalysis.push(analysis);

        // Check if required field has nulls
        if (analysis.required && (analysis.nullCount > 0 || analysis.emptyCount > 0)) {
          errors.push(
            `Required field ${table}.${column.name} has ${analysis.nullCount + analysis.emptyCount} null/empty values`
          );
        }

        // Check if completeness is below threshold
        if (analysis.completeness < threshold) {
          const message = `Field ${table}.${column.name} is only ${analysis.completeness.toFixed(1)}% complete (threshold: ${threshold}%)`;

          if (analysis.required) {
            errors.push(message);
          } else {
            warnings.push(message);
          }
        }
      }
    }

    // Calculate overall completeness score
    const completenessScore = fieldAnalysis.length > 0
      ? fieldAnalysis.reduce((sum, f) => sum + f.completeness, 0) / fieldAnalysis.length
      : errors.length > 0 ? 0 : 100;

    console.log(`   Overall Data Completeness: ${completenessScore.toFixed(1)}%`);

    if (errors.length === 0) {
      console.log(`   ✅ All required fields populated`);
    } else {
      console.log(`   ❌ ${errors.length} null/empty field error(s) found`);
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings,
      completenessScore,
      fieldAnalysis
    };

  } catch (error) {
    errors.push(`Null analysis failed: ${error}`);
    return { passed: false, errors, warnings };
  }
}

async function getTableColumns(adapter: DatabaseAdapter, table: string): Promise<Array<{ name: string; type: string }>> {
  for (const schemaCondition of [' AND table_schema = current_schema()', '']) {
    const query = `
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = '${table}'${schemaCondition}
      ORDER BY ordinal_position
    `;

    try {
      const result = await adapter.execute(query);
      if (result.rows.length === 0) continue;
      const columns = result.rows.map((row: { column_name: string; data_type: string }) => ({
        name: row.column_name,
        type: row.data_type
      }));
      if (schemaCondition) return columns;
      const seen = new Set<string>();
      return columns.filter(column => {
        if (seen.has(column.name)) return false;
        seen.add(column.name);
        return true;
      });
    } catch {
      // Try the next column metadata query.
    }
  }

  try {
    const result = await adapter.execute(`SELECT name, type FROM pragma_table_info('${table}')`);
    return result.rows.map((row: { name: string; type: string }) => ({
      name: row.name,
      type: row.type
    }));
  } catch (error) {
    console.warn(`Could not get columns for ${table}:`, error);
    return [];
  }
}

async function analyzeField(
  adapter: DatabaseAdapter,
  table: string,
  field: string,
  type: string,
  required: boolean
): Promise<FieldNullAnalysis> {
  const emptyExpression = /char|text|clob|string/i.test(type)
    ? `SUM(CASE WHEN ${field} = '' THEN 1 ELSE 0 END)`
    : '0';
  const query = `
    SELECT
      COUNT(*) as total_count,
      SUM(CASE WHEN ${field} IS NULL THEN 1 ELSE 0 END) as null_count,
      ${emptyExpression} as empty_count
    FROM ${table}
  `;

  const result = await adapter.execute(query);
  const row = result.rows[0];

  const totalCount = Number(row.total_count);
  const nullCount = Number(row.null_count ?? 0);
  const emptyCount = Number(row.empty_count ?? 0);
  const completeCount = totalCount - nullCount - emptyCount;
  const completeness = totalCount > 0 ? (completeCount / totalCount) * 100 : 100;

  return {
    table,
    field,
    nullCount,
    emptyCount,
    totalCount,
    completeness,
    required
  };
}

/**
 * Helper: Generate null analysis report
 */
export function generateNullReport(analysis: FieldNullAnalysis[]): string {
  const lines: string[] = [];

  lines.push('\n=== NULL/EMPTY FIELD ANALYSIS ===\n');

  // Group by table
  const byTable = new Map<string, FieldNullAnalysis[]>();
  for (const field of analysis) {
    if (!byTable.has(field.table)) {
      byTable.set(field.table, []);
    }
    byTable.get(field.table)!.push(field);
  }

  for (const [table, fields] of byTable.entries()) {
    lines.push(`\n${table}:`);
    lines.push('-'.repeat(60));

    // Sort by completeness (worst first)
    const sorted = fields.sort((a, b) => a.completeness - b.completeness);

    for (const field of sorted) {
      const icon = field.completeness === 100 ? '✅' : field.completeness >= 95 ? '⚠️' : '❌';
      const req = field.required ? '[REQUIRED]' : '';

      lines.push(
        `${icon} ${field.field.padEnd(25)} ${field.completeness.toFixed(1)}% complete ` +
        `(${field.nullCount + field.emptyCount} null/empty of ${field.totalCount}) ${req}`
      );
    }
  }

  return lines.join('\n');
}

/**
 * Helper: Find records with most null fields
 */
export async function findRecordsWithMostNulls(
  adapter: DatabaseAdapter,
  table: string,
  fields: string[],
  limit = 10
): Promise<any[]> {
  const nullChecks = fields.map(f => `CASE WHEN ${f} IS NULL THEN 1 ELSE 0 END`).join(' + ');

  const query = `
    SELECT
      *,
      (${nullChecks}) as null_count
    FROM ${table}
    ORDER BY null_count DESC
    LIMIT ${limit}
  `;

  try {
    const result = await adapter.execute(query);
    return result.rows;
  } catch (error) {
    console.warn(`Could not find records with most nulls:`, error);
    return [];
  }
}

/**
 * Helper: Suggest default values based on data patterns
 */
export async function suggestDefaults(
  adapter: DatabaseAdapter,
  table: string,
  field: string
): Promise<{ value: any; confidence: number }> {
  // Get mode (most common value) excluding nulls
  const query = `
    SELECT ${field} as value, COUNT(*) as frequency
    FROM ${table}
    WHERE ${field} IS NOT NULL AND ${field} != ''
    GROUP BY ${field}
    ORDER BY frequency DESC
    LIMIT 1
  `;

  try {
    const result = await adapter.execute(query);

    if (result.rows.length > 0) {
      const totalQuery = `SELECT COUNT(*) as total FROM ${table} WHERE ${field} IS NOT NULL`;
      const totalResult = await adapter.execute(totalQuery);
      const total = Number(totalResult.rows[0].total);

      const frequency = Number(result.rows[0].frequency);
      const confidence = (frequency / total) * 100;

      return {
        value: result.rows[0].value,
        confidence
      };
    }

    return { value: null, confidence: 0 };

  } catch (error) {
    console.warn(`Could not suggest default for ${table}.${field}:`, error);
    return { value: null, confidence: 0 };
  }
}

/**
 * Helper: Identify fields that are always null (candidates for removal)
 */
export async function findAlwaysNullFields(
  adapter: DatabaseAdapter,
  table: string
): Promise<string[]> {
  const columns = await getTableColumns(adapter, table);
  const alwaysNull: string[] = [];

  for (const column of columns) {
    const query = `
      SELECT SUM(CASE WHEN ${column.name} IS NOT NULL THEN 1 ELSE 0 END) as non_null_count
      FROM ${table}
    `;

    try {
      const result = await adapter.execute(query);
      const nonNullCount = Number(result.rows[0].non_null_count ?? 0);

      if (nonNullCount === 0) {
        alwaysNull.push(column.name);
      }
    } catch (error) {
      // Skip columns that cause errors (e.g., complex types)
      continue;
    }
  }

  return alwaysNull;
}
