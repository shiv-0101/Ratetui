#!/usr/bin/env node

/**
 * Dependency Vulnerability Scanner
 * 
 * Checks for known vulnerabilities in npm dependencies.
 * Based on TRD section 14 Dependency Management requirements.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  // Severity threshold - exit with error if vulnerabilities at or above this level
  minSeverity: process.env.VULN_MIN_SEVERITY || 'moderate', // low, moderate, high, critical
  
  // Fail build on vulnerabilities
  failOnVulnerabilities: process.env.VULN_FAIL_BUILD !== 'false', // default: true
  
  // Allow specific vulnerabilities (by advisory ID) - use sparingly and document why
  allowedAdvisories: (process.env.VULN_ALLOWED || '').split(',').filter(Boolean),
  
  // Output formats
  outputFormats: ['console', 'json'], // console, json, html
  
  // Report directory
  reportDir: path.join(__dirname, '..', 'security-reports'),
};

// Severity levels (ordered by priority)
const SEVERITY_LEVELS = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

/**
 * Color codes for console output
 */
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

/**
 * Run npm audit and parse results
 * @returns {Object} Audit results
 */
const runNpmAudit = () => {
  try {
    console.log(`${COLORS.cyan}Running npm audit...${COLORS.reset}`);
    
    // Run npm audit with JSON output
    const auditOutput = execSync('npm audit --json', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    return JSON.parse(auditOutput);
  } catch (error) {
    // npm audit returns exit code 1 if vulnerabilities found
    if (error.stdout) {
      try {
        return JSON.parse(error.stdout);
      } catch (parseError) {
        console.error(`${COLORS.red}Failed to parse npm audit output${COLORS.reset}`);
        console.error(error.stdout);
        process.exit(1);
      }
    }
    
    console.error(`${COLORS.red}npm audit failed:${COLORS.reset}`, error.message);
    process.exit(1);
  }
};

/**
 * Filter vulnerabilities by severity threshold
 * @param {Object} auditData - npm audit results
 * @returns {Object} Filtered vulnerabilities
 */
const filterBySeverity = (auditData) => {
  const minLevel = SEVERITY_LEVELS[CONFIG.minSeverity] || 0;
  const filtered = {
    vulnerabilities: {},
    totalCount: 0,
    severityCounts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 },
  };
  
  if (!auditData.vulnerabilities) {
    return filtered;
  }
  
  for (const [pkg, vulnData] of Object.entries(auditData.vulnerabilities)) {
    const severity = vulnData.severity || 'info';
    const level = SEVERITY_LEVELS[severity] || 0;
    
    if (level >= minLevel) {
      // Check if advisory is in allowed list
      const vias = vulnData.via || [];
      const advisoryIds = vias
        .filter(v => typeof v === 'object' && v.source)
        .map(v => String(v.source));
      
      const isAllowed = advisoryIds.some(id => CONFIG.allowedAdvisories.includes(id));
      
      if (!isAllowed) {
        filtered.vulnerabilities[pkg] = vulnData;
        filtered.severityCounts[severity]++;
        filtered.totalCount++;
      }
    }
  }
  
  return filtered;
};

/**
 * Format console output
 * @param {Object} auditData - npm audit results
 * @param {Object} filtered - Filtered vulnerabilities
 */
const printConsoleReport = (auditData, filtered) => {
  console.log('\n' + '='.repeat(80));
  console.log(`${COLORS.cyan}DEPENDENCY VULNERABILITY SCAN REPORT${COLORS.reset}`);
  console.log('='.repeat(80));
  
  // Metadata
  console.log(`\nAudit Run: ${new Date().toISOString()}`);
  console.log(`Dependencies: ${auditData.metadata?.dependencies || 'Unknown'}`);
  console.log(`Severity Threshold: ${CONFIG.minSeverity}`);
  
  // Summary
  console.log('\n' + '-'.repeat(80));
  console.log('SUMMARY');
  console.log('-'.repeat(80));
  
  const { severityCounts } = filtered;
  console.log(`${COLORS.red}Critical: ${severityCounts.critical}${COLORS.reset}`);
  console.log(`${COLORS.red}High:     ${severityCounts.high}${COLORS.reset}`);
  console.log(`${COLORS.yellow}Moderate: ${severityCounts.moderate}${COLORS.reset}`);
  console.log(`${COLORS.yellow}Low:      ${severityCounts.low}${COLORS.reset}`);
  console.log(`${COLORS.gray}Info:     ${severityCounts.info}${COLORS.reset}`);
  console.log(`\nTotal vulnerabilities (>= ${CONFIG.minSeverity}): ${filtered.totalCount}`);
  
  // Detailed vulnerabilities
  if (filtered.totalCount > 0) {
    console.log('\n' + '-'.repeat(80));
    console.log('VULNERABILITIES');
    console.log('-'.repeat(80));
    
    for (const [pkg, vulnData] of Object.entries(filtered.vulnerabilities)) {
      const severity = vulnData.severity || 'info';
      const color = severity === 'critical' || severity === 'high' ? COLORS.red : COLORS.yellow;
      
      console.log(`\n${color}[${severity.toUpperCase()}]${COLORS.reset} ${pkg}`);
      console.log(`  Range: ${vulnData.range || 'Unknown'}`);
      
      // Extract details from via
      const vias = vulnData.via || [];
      vias.forEach(via => {
        if (typeof via === 'object') {
          console.log(`  ${via.title || 'No title'}`);
          if (via.url) console.log(`  ${COLORS.cyan}${via.url}${COLORS.reset}`);
          if (via.source) console.log(`  Advisory: ${via.source}`);
        }
      });
      
      // Show fix if available
      if (vulnData.fixAvailable) {
        const fix = vulnData.fixAvailable;
        if (typeof fix === 'object') {
          console.log(`  ${COLORS.green}Fix: Update to ${fix.name}@${fix.version}${COLORS.reset}`);
        } else {
          console.log(`  ${COLORS.green}Fix available${COLORS.reset}`);
        }
      } else {
        console.log(`  ${COLORS.yellow}No fix available${COLORS.reset}`);
      }
    }
  }
  
  console.log('\n' + '='.repeat(80));
  
  // Result
  if (filtered.totalCount === 0) {
    console.log(`${COLORS.green}✓ No vulnerabilities found (>= ${CONFIG.minSeverity})${COLORS.reset}`);
  } else {
    console.log(`${COLORS.red}✗ Found ${filtered.totalCount} vulnerabilities (>= ${CONFIG.minSeverity})${COLORS.reset}`);
    if (CONFIG.failOnVulnerabilities) {
      console.log(`${COLORS.red}Build will fail due to vulnerabilities${COLORS.reset}`);
    }
  }
  
  console.log('='.repeat(80) + '\n');
};

/**
 * Save JSON report
 * @param {Object} auditData - npm audit results
 * @param {Object} filtered - Filtered vulnerabilities
 */
const saveJsonReport = (auditData, filtered) => {
  if (!fs.existsSync(CONFIG.reportDir)) {
    fs.mkdirSync(CONFIG.reportDir, { recursive: true });
  }
  
  const reportPath = path.join(
    CONFIG.reportDir,
    `vulnerability-scan-${Date.now()}.json`
  );
  
  const report = {
    timestamp: new Date().toISOString(),
    config: CONFIG,
    summary: {
      totalDependencies: auditData.metadata?.dependencies || 0,
      totalVulnerabilities: filtered.totalCount,
      severityCounts: filtered.severityCounts,
    },
    vulnerabilities: filtered.vulnerabilities,
    fullAuditData: auditData,
  };
  
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`${COLORS.cyan}JSON report saved: ${reportPath}${COLORS.reset}`);
};

/**
 * Main execution
 */
const main = () => {
  console.log(`${COLORS.cyan}Dependency Vulnerability Scanner${COLORS.reset}`);
  console.log(`${COLORS.gray}Checking for known vulnerabilities in npm packages...${COLORS.reset}\n`);
  
  // Run audit
  const auditData = runNpmAudit();
  
  // Filter by severity
  const filtered = filterBySeverity(auditData);
  
  // Generate reports
  if (CONFIG.outputFormats.includes('console')) {
    printConsoleReport(auditData, filtered);
  }
  
  if (CONFIG.outputFormats.includes('json')) {
    saveJsonReport(auditData, filtered);
  }
  
  // Exit with appropriate code
  if (CONFIG.failOnVulnerabilities && filtered.totalCount > 0) {
    process.exit(1);
  }
  
  process.exit(0);
};

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = {
  runNpmAudit,
  filterBySeverity,
  printConsoleReport,
  saveJsonReport,
};
