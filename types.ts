/**
 * Shared types for data quality validation tools
 */

export interface ValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
  details?: any;
}

export interface ValidationSummary {
  totalChecks: number;
  passed: number;
  failed: number;
  warnings: number;
  results: Record<string, ValidationResult>;
  score?: number;
  timestamp: Date;
}

export interface RelationshipConfig {
  child: string;
  parent: string;
  foreignKey: string;
  required?: boolean;
}

export interface DateRuleConfig {
  table: string;
  before: string;
  after: string;
  allowEqual?: boolean;
  errorMessage?: string;
}

export interface CalculationConfig {
  table: string;
  field: string;
  calculation: 'SUM' | 'COUNT' | 'AVG' | 'MAX' | 'MIN';
  sourceTable: string;
  sourceField: string;
  parentKey?: string; // column in table that sourceTable.joinKey points at (default: id)
  joinKey?: string; // column in sourceTable that points at table (default: id)
  filter?: string;
  tolerance?: number; // For floating point comparisons
}

export interface NullAnalysisConfig {
  tables: string[];
  requiredFields?: Record<string, string[]>;
  optionalFields?: Record<string, string[]>;
  completenessThreshold?: number; // Percentage (default: 95)
}

export interface BusinessRuleConfig {
  name: string;
  table: string;
  condition?: string;
  requireFields?: string[];
  forbidFields?: string[];
  customValidator?: (row: any) => boolean;
  errorMessage?: string;
}

export interface DataQualityConfig {
  database: {
    type: 'neon' | 'drizzle' | 'postgres' | 'mysql' | 'sqlite';
    connectionString?: string;
  };
  validations: {
    referentialIntegrity?: boolean;
    dateSequences?: boolean;
    calculatedFields?: boolean;
    nullAnalysis?: boolean;
    businessRules?: boolean;
  };
  relationships?: RelationshipConfig[];
  dateRules?: DateRuleConfig[];
  calculations?: CalculationConfig[];
  nullAnalysis?: NullAnalysisConfig;
  businessRules?: BusinessRuleConfig[];
}

export interface QualityReport {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  timestamp: Date;
  summary: ValidationSummary;
  recommendations: string[];
  trends?: {
    previousScore?: number;
    change?: number;
    trend: 'improving' | 'declining' | 'stable';
  };
}

export interface DatabaseAdapter {
  execute: (query: string) => Promise<any>;
  select: (table: string, where?: any) => Promise<any[]>;
  disconnect: () => Promise<void>;
}
