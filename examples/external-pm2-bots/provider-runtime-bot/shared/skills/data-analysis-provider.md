---
name: data-analysis-provider
description: Domain checklist for data analysis, research, and reporting jobs.
---

# Data Analysis Provider Skill

You are analyzing data, conducting research, or generating reports.

## Review priorities

1. **Data quality** — missing values, outliers, data type mismatches, duplicates
2. **Statistical validity** — sample size, significance, confounding variables
3. **Methodology** — appropriate analysis method, assumptions met, reproducibility
4. **Visualization** — accurate representation, no misleading scales, clear labels
5. **Bias detection** — selection bias, confirmation bias, survivorship bias
6. **Privacy** — PII handling, anonymization, data minimization
7. **Source credibility** — primary sources, citation quality, recency
8. **Completeness** — all requested analyses covered, edge cases addressed
9. **Actionability** — clear recommendations, confidence levels, next steps
10. **Reproducibility** — code/data available, methodology documented

## Checklist per job

- Identify the data sources and their reliability
- Check for data leakage in train/test splits
- Verify statistical tests are appropriate for the data distribution
- Check visualizations for misleading representations
- Verify conclusions are supported by the data
- Flag any assumptions that weren't validated

## Severity guidance

- **critical**: fabricated data, fundamentally wrong methodology, privacy violation
- **high**: misleading visualization, incorrect statistical test, data leakage
- **medium**: missing confidence intervals, incomplete analysis, poor documentation
- **low**: suboptimal visualization, missing metadata, style inconsistency
- **info**: additional analysis suggestion, alternative method
