/**
 * Data Quality Tools - Main Entry Point
 *
 * Export all validation functions and utilities for programmatic use.
 */

// Core validation functions
export { validateReferentialIntegrity, detectRelationships, findOrphanedRecords } from './validate-referential-integrity';
export { validateDateSequences, validateSequentialProgression, validateBusinessHours, createCommonDateRules } from './validate-date-sequences';
export { validateCalculatedFields, validatePercentageSum, validateProgressRange, validateDerivedNotExceedsBase } from './validate-calculated-fields';
export { analyzeNulls, generateNullReport, findRecordsWithMostNulls, suggestDefaults, findAlwaysNullFields } from './analyze-nulls';
export { validateBusinessRules, createStageConsistencyRule, createValueRangeRule, createConditionalRequirementRule, validateEnumValues, validateUniqueness } from './validate-business-rules';

// Report generation
export { generateQualityReport, exportReportHTML, exportReportJSON } from './generate-quality-report';

// Database adapters
export { createAdapter, NeonAdapter, NeonPoolAdapter, DrizzleAdapter, PostgresAdapter, MySQLAdapter, SQLiteAdapter, AdapterSetupError } from './adapters';

// Types
export type {
  ValidationResult,
  ValidationSummary,
  QualityReport,
  DataQualityConfig,
  RelationshipConfig,
  DateRuleConfig,
  CalculationConfig,
  NullAnalysisConfig,
  BusinessRuleConfig,
  DatabaseAdapter
} from './types';

/**
 * Quick validation runner - validates everything with minimal config
 */
import { generateQualityReport } from './generate-quality-report';
import { createAdapter } from './adapters';
import type { DataQualityConfig } from './types';

export async function quickValidate(
  connectionString: string,
  options?: {
    type?: 'neon' | 'postgres' | 'mysql' | 'sqlite';
    autoDetectRelationships?: boolean;
  }
): Promise<void> {
  const adapter = createAdapter({
    type: options?.type || 'neon',
    connectionString
  });

  const config: DataQualityConfig = {
    database: {
      type: options?.type || 'neon',
      connectionString
    },
    validations: {
      referentialIntegrity: true,
      dateSequences: true,
      calculatedFields: true,
      nullAnalysis: true,
      businessRules: true
    }
  };

  // Auto-detect relationships if requested
  if (options?.autoDetectRelationships) {
    const { detectRelationships } = await import('./validate-referential-integrity');
    config.relationships = await detectRelationships(adapter);
  }

  const report = await generateQualityReport(adapter, config);
  await adapter.disconnect();

  return;
}
