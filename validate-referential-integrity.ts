/**
 * Referential Integrity Validator
 *
 * Checks for orphaned records and broken foreign key relationships.
 * Works with any database schema by accepting configuration.
 */

import type { ValidationResult, RelationshipConfig, DatabaseAdapter } from './types';

export interface ReferentialIntegrityConfig {
  relationships: RelationshipConfig[];
  adapter: DatabaseAdapter;
}

export async function validateReferentialIntegrity(
  config: ReferentialIntegrityConfig
): Promise<ValidationResult> {
  console.log('Validating Referential Integrity...');

  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    for (const rel of config.relationships) {
      const query = `
        SELECT COUNT(*) as count
        FROM ${rel.child} c
        LEFT JOIN ${rel.parent} p ON c.${rel.foreignKey} = p.id
        WHERE p.id IS NULL AND c.${rel.foreignKey} IS NOT NULL
      `;

      const result = await config.adapter.execute(query);
      const orphanCount = Number(result.rows[0]?.count || 0);

      if (orphanCount > 0) {
        const message = `Found ${orphanCount} orphaned records in ${rel.child} (missing parent in ${rel.parent})`;

        if (rel.required !== false) {
          errors.push(message);
        } else {
          warnings.push(message);
        }
      }
    }

    if (errors.length === 0) {
      console.log(`   ✅ All ${config.relationships.length} relationship(s) validated`);
    } else {
      console.log(`   ❌ ${errors.length} referential integrity error(s) found`);
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings
    };

  } catch (error) {
    errors.push(`Referential integrity validation failed: ${error}`);
    return { passed: false, errors, warnings };
  }
}

/**
 * Helper: Find all orphaned records (returns actual rows, not just count)
 */
export async function findOrphanedRecords(
  config: ReferentialIntegrityConfig,
  relationship: RelationshipConfig,
  limit = 10
): Promise<any[]> {
  const query = `
    SELECT c.*
    FROM ${relationship.child} c
    LEFT JOIN ${relationship.parent} p ON c.${relationship.foreignKey} = p.id
    WHERE p.id IS NULL AND c.${relationship.foreignKey} IS NOT NULL
    LIMIT ${limit}
  `;

  const result = await config.adapter.execute(query);
  return result.rows || [];
}

/**
 * Helper: Auto-detect relationships from database schema (PostgreSQL)
 */
export async function detectRelationships(adapter: DatabaseAdapter): Promise<RelationshipConfig[]> {
  const query = `
    SELECT
      tc.table_name as child,
      ccu.table_name as parent,
      kcu.column_name as foreign_key
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
  `;

  try {
    const result = await adapter.execute(query);
    return result.rows.map((row: any) => ({
      child: row.child,
      parent: row.parent,
      foreignKey: row.foreign_key
    }));
  } catch (error) {
    console.warn('Could not auto-detect relationships:', error);
    return [];
  }
}
