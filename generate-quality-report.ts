/**
 * Data Quality Report Generator
 *
 * Comprehensive data quality assessment with scoring and reporting.
 * Runs all validation checks and generates actionable reports.
 */

import type {
  ValidationResult,
  ValidationSummary,
  QualityReport,
  DataQualityConfig,
  DatabaseAdapter
} from './types';

import { validateReferentialIntegrity } from './validate-referential-integrity';
import { validateDateSequences } from './validate-date-sequences';
import { validateCalculatedFields } from './validate-calculated-fields';
import { analyzeNulls } from './analyze-nulls';
import { validateBusinessRules } from './validate-business-rules';

export async function generateQualityReport(
  adapter: DatabaseAdapter,
  config: DataQualityConfig
): Promise<QualityReport> {
  console.log('\n🔍 Generating Data Quality Report...\n');
  console.log('='.repeat(80));

  const results: Record<string, ValidationResult> = {};
  const startTime = Date.now();

  // Run enabled validations
  if (config.validations.referentialIntegrity && config.relationships) {
    console.log('\n1. Running Referential Integrity Checks...');
    results.referentialIntegrity = await validateReferentialIntegrity({
      relationships: config.relationships,
      adapter
    });
  }

  if (config.validations.dateSequences && config.dateRules) {
    console.log('\n2. Running Date Sequence Checks...');
    results.dateSequences = await validateDateSequences({
      rules: config.dateRules,
      adapter
    });
  }

  if (config.validations.calculatedFields && config.calculations) {
    console.log('\n3. Running Calculated Field Checks...');
    results.calculatedFields = await validateCalculatedFields({
      calculations: config.calculations,
      adapter
    });
  }

  if (config.validations.nullAnalysis && config.nullAnalysis) {
    console.log('\n4. Running Null/Completeness Analysis...');
    results.nullAnalysis = await analyzeNulls(adapter, config.nullAnalysis);
  }

  if (config.validations.businessRules && config.businessRules) {
    console.log('\n5. Running Business Rules Validation...');
    results.businessRules = await validateBusinessRules({
      rules: config.businessRules,
      adapter
    });
  }

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  // Calculate summary
  const summary: ValidationSummary = {
    totalChecks: Object.keys(results).length,
    passed: Object.values(results).filter(r => r.passed).length,
    failed: Object.values(results).filter(r => !r.passed).length,
    warnings: Object.values(results).reduce((sum, r) => sum + r.warnings.length, 0),
    results,
    timestamp: new Date()
  };

  // Calculate quality score
  const score = calculateQualityScore(summary);
  const grade = getGrade(score);

  // Generate recommendations
  const recommendations = generateRecommendations(summary);

  const report: QualityReport = {
    score,
    grade,
    timestamp: new Date(),
    summary,
    recommendations
  };

  // Print report
  printReport(report, duration);

  return report;
}

function calculateQualityScore(summary: ValidationSummary): number {
  const weights: Record<string, number> = {
    referentialIntegrity: 25,
    dateSequences: 20,
    calculatedFields: 25,
    nullAnalysis: 15,
    businessRules: 15
  };

  let totalWeight = 0;
  let earnedScore = 0;

  for (const [category, result] of Object.entries(summary.results)) {
    const weight = weights[category] || 10;
    totalWeight += weight;

    if (result.passed) {
      // Full points if passed
      earnedScore += weight;
    } else if (result.warnings.length > 0 && result.errors.length === 0) {
      // Partial points if only warnings
      earnedScore += weight * 0.7;
    } else if (result.errors.length > 0) {
      // Partial points based on error count
      const penalty = Math.min(result.errors.length * 0.1, 0.5);
      earnedScore += weight * (1 - penalty);
    }
  }

  return totalWeight > 0 ? Math.round((earnedScore / totalWeight) * 100) : 0;
}

function getGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function generateRecommendations(summary: ValidationSummary): string[] {
  const recommendations: string[] = [];

  for (const [category, result] of Object.entries(summary.results)) {
    if (!result.passed) {
      // Add category-specific recommendations
      switch (category) {
        case 'referentialIntegrity':
          recommendations.push('Clean up orphaned records or add missing parent references');
          recommendations.push('Consider adding foreign key constraints if not present');
          break;

        case 'dateSequences':
          recommendations.push('Review and fix date sequence violations');
          recommendations.push('Add database constraints to prevent invalid date sequences');
          break;

        case 'calculatedFields':
          recommendations.push('Update calculated fields to match source data');
          recommendations.push('Consider using database triggers to auto-update calculated fields');
          break;

        case 'nullAnalysis':
          recommendations.push('Populate required fields with appropriate values');
          recommendations.push('Add NOT NULL constraints to enforce data completeness');
          break;

        case 'businessRules':
          recommendations.push('Review business logic violations and update records');
          recommendations.push('Add application-level validation to prevent future violations');
          break;
      }
    }

    // Add warning-based recommendations
    if (result.warnings.length > 0) {
      recommendations.push(`Review ${result.warnings.length} warning(s) in ${category}`);
    }
  }

  // General recommendations
  if (summary.failed > 0) {
    recommendations.push('Schedule regular data quality checks');
    recommendations.push('Document exceptions where rules are intentionally violated');
  }

  return [...new Set(recommendations)]; // Remove duplicates
}

function printReport(report: QualityReport, duration: string): void {
  console.log('\n' + '='.repeat(80));
  console.log('DATA QUALITY REPORT');
  console.log('='.repeat(80));

  console.log(`\nGenerated: ${report.timestamp.toLocaleString()}`);
  console.log(`Duration: ${duration}s`);

  console.log('\n' + '-'.repeat(80));
  console.log('OVERALL QUALITY SCORE');
  console.log('-'.repeat(80));

  const scoreIcon = report.grade === 'A' ? '🎉' :
                    report.grade === 'B' ? '✅' :
                    report.grade === 'C' ? '⚠️' : '❌';

  console.log(`\n${scoreIcon} Score: ${report.score}/100 (Grade: ${report.grade})`);

  console.log('\n' + '-'.repeat(80));
  console.log('VALIDATION SUMMARY');
  console.log('-'.repeat(80));

  console.log(`\nTotal Checks: ${report.summary.totalChecks}`);
  console.log(`✅ Passed: ${report.summary.passed}`);
  console.log(`❌ Failed: ${report.summary.failed}`);
  console.log(`⚠️  Warnings: ${report.summary.warnings}`);

  // Print details for each validation
  console.log('\n' + '-'.repeat(80));
  console.log('DETAILED RESULTS');
  console.log('-'.repeat(80));

  for (const [category, result] of Object.entries(report.summary.results)) {
    const icon = result.passed ? '✅' : '❌';
    const categoryName = category.replace(/([A-Z])/g, ' $1').trim();

    console.log(`\n${icon} ${categoryName.toUpperCase()}`);

    if (result.errors.length > 0) {
      console.log('\n  Errors:');
      result.errors.forEach(error => console.log(`    - ${error}`));
    }

    if (result.warnings.length > 0) {
      console.log('\n  Warnings:');
      result.warnings.slice(0, 5).forEach(warning => console.log(`    - ${warning}`));
      if (result.warnings.length > 5) {
        console.log(`    ... and ${result.warnings.length - 5} more warnings`);
      }
    }

    if (result.passed && result.warnings.length === 0) {
      console.log('  All checks passed!');
    }
  }

  // Print recommendations
  if (report.recommendations.length > 0) {
    console.log('\n' + '-'.repeat(80));
    console.log('RECOMMENDATIONS');
    console.log('-'.repeat(80));

    report.recommendations.forEach((rec, i) => {
      console.log(`\n${i + 1}. ${rec}`);
    });
  }

  console.log('\n' + '='.repeat(80));

  if (report.grade === 'A') {
    console.log('🎉 EXCELLENT! Your data quality is top-notch!');
  } else if (report.grade === 'B') {
    console.log('✅ GOOD! Minor improvements needed.');
  } else if (report.grade === 'C') {
    console.log('⚠️  FAIR! Several issues need attention.');
  } else {
    console.log('❌ NEEDS IMPROVEMENT! Address critical issues.');
  }

  console.log('='.repeat(80) + '\n');
}

/**
 * Export report to JSON
 */
export function exportReportJSON(report: QualityReport, filepath: string): void {
  const fs = require('fs');
  fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
  console.log(`✅ Report exported to ${filepath}`);
}

/**
 * Export report to HTML
 */
export function exportReportHTML(report: QualityReport, filepath: string): void {
  const html = generateHTMLReport(report);
  const fs = require('fs');
  fs.writeFileSync(filepath, html);
  console.log(`✅ Report exported to ${filepath}`);
}

function generateHTMLReport(report: QualityReport): string {
  const gradeColors: Record<string, string> = {
    'A': '#4CAF50',
    'B': '#8BC34A',
    'C': '#FFC107',
    'D': '#FF9800',
    'F': '#F44336'
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Data Quality Report</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .header {
      background: white;
      padding: 30px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .score {
      font-size: 72px;
      font-weight: bold;
      color: ${gradeColors[report.grade]};
      margin: 20px 0;
    }
    .grade {
      font-size: 48px;
      color: ${gradeColors[report.grade]};
    }
    .section {
      background: white;
      padding: 20px;
      margin-bottom: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .validation {
      margin: 15px 0;
      padding: 15px;
      border-left: 4px solid #ddd;
    }
    .validation.passed {
      border-left-color: #4CAF50;
      background: #f1f8f4;
    }
    .validation.failed {
      border-left-color: #F44336;
      background: #fef1f0;
    }
    .error {
      color: #d32f2f;
      margin: 5px 0;
    }
    .warning {
      color: #f57c00;
      margin: 5px 0;
    }
    .recommendation {
      background: #e3f2fd;
      padding: 10px;
      margin: 10px 0;
      border-radius: 4px;
      border-left: 4px solid #2196F3;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Data Quality Report</h1>
    <p>Generated: ${report.timestamp.toLocaleString()}</p>
    <div class="score">${report.score}/100</div>
    <div class="grade">Grade: ${report.grade}</div>
  </div>

  <div class="section">
    <h2>Summary</h2>
    <p><strong>Total Checks:</strong> ${report.summary.totalChecks}</p>
    <p><strong>✅ Passed:</strong> ${report.summary.passed}</p>
    <p><strong>❌ Failed:</strong> ${report.summary.failed}</p>
    <p><strong>⚠️ Warnings:</strong> ${report.summary.warnings}</p>
  </div>

  <div class="section">
    <h2>Validation Results</h2>
    ${Object.entries(report.summary.results).map(([category, result]) => `
      <div class="validation ${result.passed ? 'passed' : 'failed'}">
        <h3>${result.passed ? '✅' : '❌'} ${category.replace(/([A-Z])/g, ' $1').trim()}</h3>
        ${result.errors.length > 0 ? `
          <div class="errors">
            <strong>Errors:</strong>
            ${result.errors.map(e => `<div class="error">• ${e}</div>`).join('')}
          </div>
        ` : ''}
        ${result.warnings.length > 0 ? `
          <div class="warnings">
            <strong>Warnings:</strong>
            ${result.warnings.slice(0, 5).map(w => `<div class="warning">• ${w}</div>`).join('')}
          </div>
        ` : ''}
      </div>
    `).join('')}
  </div>

  ${report.recommendations.length > 0 ? `
    <div class="section">
      <h2>Recommendations</h2>
      ${report.recommendations.map(rec => `
        <div class="recommendation">${rec}</div>
      `).join('')}
    </div>
  ` : ''}
</body>
</html>
  `.trim();
}
