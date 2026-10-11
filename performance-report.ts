/**
 * Performance Report Generator
 * 
 * Generates performance reports from bot harness output:
 * - Latency tables (p50/p95/p99)
 * - Drift results
 * - Test conditions documentation
 */

import fs from 'fs'
import path from 'path'

interface LatencyStats {
  p50: number
  p95: number
  p99: number
  max: number
  mean: number
  min: number
  count: number
}

interface PerformanceReport {
  testName: string
  scenario: 'latency' | 'drift' | 'concurrency'
  viewers: number
  commands: number
  durationMs: number
  latency: LatencyStats
  drift?: {
    maxBeforeCorrection: number
    steadyState: number
    threshold: number
  }
  testConditions: {
    hardware: string
    os: string
    nodeVersion: string
    networkType: 'localhost' | 'LAN' | 'Wi-Fi'
    commandRate: number
    payloadSize: number
    clockSync: boolean
  }
  results: {
    latencyTargetMet: boolean
    driftTargetMet: boolean
    notes: string[]
  }
}

class PerformanceReportGenerator {
  private reports: PerformanceReport[] = []

  addReport(report: PerformanceReport) {
    this.reports.push(report)
  }

  generateHtmlReport(outputPath: string): string {
    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Watch Party Performance Report</title>
      <style>
        body { font-family: system-ui, -apple-system, sans-serif; margin: 40px; line-height: 1.6; }
        .container { max-width: 1200px; margin: 0 auto; }
        h1, h2, h3 { color: #333; }
        .metric { font-size: 24px; font-weight: bold; color: #0f0; }
        .target { color: #f00; }
        .pass { color: #0f0; }
        .fail { color: #f00; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f5f5f5; }
        .badge { padding: 4px 8px; border-radius: 4px; font-size: 12px; }
        .badge-pass { background-color: #0f0; color: #fff; }
        .badge-fail { background-color: #f00; color: #fff; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Watch Party Performance Report</h1>
    `

    // Summary section
    html += '<h2>Summary</h2>'
    html += '<p>Generated from automated benchmark harness</p>'
    
    // Latency table
    html += '<h2>Latency Results</h2>'
    html += '<table>'
    html += '<tr><th>Test</th><th>p50 (ms)</th><th>p95 (ms)</th><th>p99 (ms)</th><th>Max (ms)</th><th>Target (ms)</th><th>Status</th></tr>'
    
    for (const report of this.reports) {
      const p95Met = report.latencyTargetMet ? '✓ Pass' : '✗ Fail'
      html += `<tr>`
      html += `<td>${report.testName}</td>`
      html += `<td>${report.latency.p50}</td>`
      html += `<td>${report.latency.p95}</td>`
      html += `<td>${report.latency.p99}</td>`
      html += `<td>${report.latency.max}</td>`
      html += `<td>≤250</td>`
      html += `<td><span class="badge ${report.latencyTargetMet ? 'badge-pass' : 'badge-fail'}">${p95Met}</span></td>`
      html += `</tr>`
    }
    
    html += '</table>'
    
    // Drift results (if any)
    if (this.reports.some(r => r.drift)) {
      html += '<h2>Drift Results</h2>'
      html += '<table>'
      html += '<tr><th>Test</th><th>Max Before Correction (ms)</th><th>Steady-State (ms)</th><th>Threshold (ms)</th><th>Target (ms)</th><th>Status</th></tr>'
      
      for (const report of this.reports) {
        if (report.drift) {
          const driftMet = report.drift.steadyState <= 500 ? '✓ Pass' : '✗ Fail'
          html += `<tr>`
          html += `<td>${report.testName}</td>`
          html += `<td>${report.drift.maxBeforeCorrection}</td>`
          html += `<td>${report.drift.steadyState}</td>`
          html += `<td>${report.drift.threshold}</td>`
          html += `<td>≤500</td>`
          html += `<td><span class="badge ${report.drift.steadyState <= 500 ? 'badge-pass' : 'badge-fail'}">${driftMet}</span></td>`
          html += `</tr>`
        }
      }
      
      html += '</table>'
    }
    
    // Test conditions
    html += '<h2>Test Conditions</h2>'
    html += '<table>'
    html += '<tr><th>Parameter</th><th>Value</th></tr>'
    
    // Use conditions from first report as template (all should be consistent)
    const firstReport = this.reports[0]
    if (firstReport) {
      html += `<tr><td>Hardware</td><td>${firstReport.testConditions.hardware}</td></tr>`
      html += `<tr><td>OS</td><td>${firstReport.testConditions.os}</td></tr>`
      html += `<tr><td>Node.js Version</td><td>${firstReport.testConditions.nodeVersion}</td></tr>`
      html += `<tr><td>Network Type</td><td>${firstReport.testConditions.networkType}</td></tr>`
      html += `<tr><td>Command Rate</td><td>${firstReport.testConditions.commandRate}/s</td></tr>`
      html += `<tr><td>Payload Size</td><td>${firstReport.testConditions.payloadSize} bytes</td></tr>`
      html += `<tr><td>Clock Sync</td><td>${firstReport.testConditions.clockSync ? 'Enabled' : 'Disabled'}</td></tr>`
    }
    
    html += '</table>'
    
    // Results and notes
    html += '<h2>Results</h2>'
    html += '<ul>'
    for (const report of this.reports) {
      html += `<li><strong>${report.testName}</strong>:`
      html += report.results.latencyTargetMet ? ' Latency target met' : ' Latency target NOT met'
      html += report.results.driftTargetMet ? ' | Drift target met' : ' | Drift target NOT met'
      html += `</li>`
    }
    html += '</ul>'
    
    html += '<p><em>Report generated by Watch Party Performance Report Generator</em></p>'
    html += '</div></body></html>'
    
    return html
  }

  generateMarkdownReport(outputPath: string): string {
    let md = '# Watch Party Performance Report\n\n'
    
    md += '## Summary\n\n'
    md += 'Generated from automated benchmark harness\n\n'
    
    md += '## Latency Results\n\n'
    md += '| Test | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) | Target (ms) | Status |\n'
    md += '|------|----------|----------|----------|----------|-------------|-------|\n'
    
    for (const report of this.reports) {
      const p95Status = report.latencyTargetMet ? 'Pass' : 'Fail'
      md += `| ${report.testName} | ${report.latency.p50} | ${report.latency.p95} | ${report.latency.p99} | ${report.latency.max} | ≤250 | ${p95Status} |\n`
    }
    
    md += '\n## Drift Results\n\n'
    
    const driftReports = this.reports.filter(r => r.drift)
    if (driftReports.length > 0) {
      md += '| Test | Max Before Correction (ms) | Steady-State (ms) | Threshold (ms) | Target (ms) | Status |\n'
      md += '|------|--------------------------|-------------------|----------------|-------------|-------|\n'
      
      for (const report of driftReports) {
        const driftStatus = report.drift.steadyState <= 500 ? 'Pass' : 'Fail'
        md += `| ${report.testName} | ${report.drift.maxBeforeCorrection} | ${report.drift.steadyState} | ${report.drift.threshold} | ≤500 | ${driftStatus} |\n`
      }
    } else {
      md += '*No drift measurements recorded*\n'
    }
    
    md += '\n## Test Conditions\n\n'
    const firstReport = this.reports[0]
    if (firstReport) {
      md += `**Hardware**: ${firstReport.testConditions.hardware}\n\n`
      md += `**OS**: ${firstReport.testConditions.os}\n\n`
      md += `**Node.js Version**: ${firstReport.testConditions.nodeVersion}\n\n`
      md += `**Network Type**: ${firstReport.testConditions.networkType}\n\n`
      md += `**Command Rate**: ${firstReport.testConditions.commandRate}/s\n\n`
      md += `**Payload Size**: ${firstReport.testConditions.payloadSize} bytes\n\n`
      md += `**Clock Sync**: ${firstReport.testConditions.clockSync ? 'Enabled' : 'Disabled'}\n\n`
    }
    
    md += '## Results\n\n'
    for (const report of this.reports) {
      const latencyStatus = report.results.latencyTargetMet ? '✓' : '✗'
      const driftStatus = report.results.driftTargetMet ? '✓' : '✗'
      md += `- **${report.testName}**: Latency ${latencyStatus} | Drift ${driftStatus}\n`
    }
    
    md += '\n---\n*Report generated by Watch Party Performance Report Generator*\n'
    
    return md
  }

  saveReports(outputDir: string): void {
    // Ensure directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }
    
    // Save HTML report
    const htmlPath = path.join(outputDir, 'performance-report.html')
    const htmlContent = this.generateHtmlReport(htmlPath)
    fs.writeFileSync(htmlPath, htmlContent)
    
    // Save Markdown report
    const mdPath = path.join(outputDir, 'performance-report.md')
    const mdContent = this.generateMarkdownReport(mdPath)
    fs.writeFileSync(mdPath, mdContent)
    
    console.log(`Reports saved to ${outputDir}/`)
    console.log(`  - performance-report.html`)
    console.log(`  - performance-report.md`)
  }
}

export { PerformanceReportGenerator, LatencyStats }