#!/usr/bin/env node

/**
 * Data Quality CLI
 *
 * Command-line interface for running data quality validations.
 *
 * Usage:
 *   npx tsx cli.ts --config config.json
 *   npx tsx cli.ts --only referential-integrity
 *   npx tsx cli.ts --generate-report --output report.html
 */

import * as fs from 'fs';
import * as path from 'path';
import type { DataQualityConfig } from './types';
import { AdapterSetupError, createAdapter } from './adapters';
import { generateQualityReport, exportReportHTML, exportReportJSON } from './generate-quality-report';

interface CLIOptions {
  config?: string;
  only?: string;
  output?: string;
  format?: 'json' | 'html' | 'console';
  help?: boolean;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--config':
      case '-c':
        options.config = args[++i];
        break;

      case '--only':
      case '-o':
        options.only = args[++i];
        break;

      case '--output':
        options.output = args[++i];
        break;

      case '--format':
      case '-f':
        options.format = args[++i] as 'json' | 'html' | 'console';
        break;

      case '--help':
      case '-h':
        options.help = true;
        break;
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Data Quality Validation CLI

Usage:
  npx tsx cli.ts [options]

Options:
  -c, --config <file>     Path to configuration JSON file (default: data-quality-config.json)
  -o, --only <check>      Run only specific validation (referential-integrity, date-sequences, etc.)
  --output <file>         Output file path for report
  -f, --format <format>   Output format: json, html, console (default: console)
  -h, --help              Show this help message

Examples:
  # Run all validations with default config
  npx tsx cli.ts

  # Run with custom config
  npx tsx cli.ts --config ./my-config.json

  # Run only referential integrity check
  npx tsx cli.ts --only referential-integrity

  # Generate HTML report
  npx tsx cli.ts --format html --output report.html

  # Generate JSON report
  npx tsx cli.ts --format json --output report.json

Available Validations:
  - referential-integrity
  - date-sequences
  - calculated-fields
  - null-analysis
  - business-rules
`);
}

class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

async function loadConfig(configPath?: string): Promise<DataQualityConfig> {
  const defaultPaths = [
    'data-quality-config.json',
    './config/data-quality.json',
    './.claude/data-quality-config.json'
  ];

  const pathsToTry = configPath ? [configPath] : defaultPaths;

  for (const p of pathsToTry) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf-8');
      const config = JSON.parse(content);

      // Replace environment variable placeholders
      if (config.database.connectionString?.startsWith('process.env.')) {
        const envVar = config.database.connectionString.replace('process.env.', '');
        const value = process.env[envVar];
        if (value === undefined || value === '') {
          throw new ConfigError(
            `The config reads the connection string from the environment variable ${envVar}, which is not set. Set it and run again.`
          );
        }
        config.database.connectionString = value;
      }

      return config;
    }
  }

  if (configPath) {
    throw new ConfigError(`Config file not found: ${configPath}`);
  }

  throw new ConfigError(
    'No config file found. Looked for data-quality-config.json, config/data-quality.json and .claude/data-quality-config.json. Pass one with --config.'
  );
}

async function run(): Promise<void> {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  try {
    console.log('🔧 Loading configuration...\n');
    const config = await loadConfig(options.config);

    // Filter validations if --only specified
    if (options.only) {
      const validationMap: Record<string, keyof typeof config.validations> = {
        'referential-integrity': 'referentialIntegrity',
        'date-sequences': 'dateSequences',
        'calculated-fields': 'calculatedFields',
        'null-analysis': 'nullAnalysis',
        'business-rules': 'businessRules'
      };

      const validation = validationMap[options.only];
      if (!validation) {
        console.error(`❌ Unknown validation: ${options.only}`);
        console.log('Run with --help to see available validations');
        process.exit(1);
      }

      // Disable all except the specified one
      config.validations = {
        referentialIntegrity: false,
        dateSequences: false,
        calculatedFields: false,
        nullAnalysis: false,
        businessRules: false,
        [validation]: true
      };
    }

    // Create database adapter
    console.log('🔌 Connecting to database...\n');
    const adapter = createAdapter({
      type: config.database.type,
      connectionString: config.database.connectionString
    });

    // Run validations
    const report = await generateQualityReport(adapter, config);

    // Output report
    const format = options.format || 'console';
    const output = options.output;

    if (format === 'html' && output) {
      exportReportHTML(report, output);
    } else if (format === 'json' && output) {
      exportReportJSON(report, output);
    } else if (output) {
      // Auto-detect format from extension
      const ext = path.extname(output).toLowerCase();
      if (ext === '.html') {
        exportReportHTML(report, output);
      } else if (ext === '.json') {
        exportReportJSON(report, output);
      } else {
        console.warn('⚠️  Unknown file extension, using JSON format');
        exportReportJSON(report, output);
      }
    }

    // Disconnect
    await adapter.disconnect();

    // Exit with appropriate code
    const exitCode = report.summary.failed > 0 ? 1 : 0;
    process.exit(exitCode);

  } catch (error) {
    if (error instanceof AdapterSetupError || error instanceof ConfigError) {
      console.error(`\n❌ Error: ${error.message}`);
    } else {
      console.error('\n❌ Error:', error);
    }
    process.exit(1);
  }
}

run();
