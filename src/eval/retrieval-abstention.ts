import { tokenize } from '../retrieval/bm25.js';
import {
  evaluateRetrievalQuality,
  evaluateRetrievalRankings,
  RetrievalFixtureSchema,
} from './retrieval-quality.js';
import type {
  RetrievalFixture,
  RetrievalQualityReport,
  RetrievalRanking,
} from './retrieval-quality.js';

export const COVERAGE_THRESHOLDS = [0.25, 0.5, 0.75, 1] as const;
export type CoverageThreshold = typeof COVERAGE_THRESHOLDS[number];

export interface CoverageDecision {
  query_id: string;
  outcome: 'retained' | 'below-coverage-threshold'
    | 'no-baseline-hits' | 'no-query-tokens';
  matched_tokens: number;
  query_tokens: number;
  coverage: number | null;
}

export interface CoverageResult {
  rankings: RetrievalRanking[];
  decisions: CoverageDecision[];
}

export type CoverageSelection =
  | { status: 'selected'; threshold: CoverageThreshold }
  | { status: 'no_eligible_candidate'; threshold: null };

export interface AcceptanceCheck {
  name: string;
  status: 'pass' | 'fail' | 'not_evaluable';
  baseline: number | null;
  candidate: number | null;
  reason: string;
}

export interface AcceptanceResult {
  status: 'pass' | 'fail' | 'not_evaluable' | 'not_run';
  checks: AcceptanceCheck[];
  reason: string;
}

export interface TuningTrial {
  threshold: CoverageThreshold;
  metrics: RetrievalQualityReport['by_split']['tuning'];
  eligible: boolean;
  reasons: string[];
}

export interface AbstentionExperiment {
  schema_version: 1;
  policy: {
    id: 'top-result-query-token-coverage';
    thresholds: readonly CoverageThreshold[];
    selection_split: 'tuning';
  };
  baseline: RetrievalQualityReport;
  tuning_trials: TuningTrial[];
  selection: CoverageSelection;
  candidate: RetrievalQualityReport | null;
  decisions: CoverageDecision[] | null;
  holdout_acceptance: AcceptanceResult;
}

type SplitMetrics = RetrievalQualityReport['by_split']['tuning'];
type AnswerableCategory = 'exact-identifier' | 'paraphrase' | 'ambiguous';
type QualityMetric = 'recall_at_5' | 'mrr_at_5';
type QualityMetricLabel = 'Recall@5' | 'MRR@5';
type FalsePositiveReduction = 'strict' | 'half';

const ANSWERABLE_CATEGORIES: readonly AnswerableCategory[] = [
  'exact-identifier',
  'paraphrase',
  'ambiguous',
];

function cloneRankings(rankings: readonly RetrievalRanking[]): RetrievalRanking[] {
  return rankings.map(ranking => ({
    query_id: ranking.query_id,
    hits: ranking.hits.map(hit => ({ id: hit.id, score: hit.score })),
  }));
}

function rankingsFromReport(report: RetrievalQualityReport): RetrievalRanking[] {
  return report.queries.map(query => ({
    query_id: query.query_id,
    hits: query.hits.map(hit => ({ id: hit.id, score: hit.score })),
  }));
}

function evaluateBaseline(
  fixture: RetrievalFixture,
  baselineRankings: readonly RetrievalRanking[] | undefined,
): RetrievalQualityReport {
  return baselineRankings === undefined
    ? evaluateRetrievalQuality(fixture)
    : evaluateRetrievalRankings(
      fixture,
      cloneRankings(baselineRankings),
      'identifier-aware-bm25',
    );
}

function metricCheck(
  category: AnswerableCategory,
  metric: QualityMetric,
  label: QualityMetricLabel,
  baseline: SplitMetrics,
  candidate: SplitMetrics,
): AcceptanceCheck {
  const baselineMetrics = baseline.by_category[category];
  const candidateMetrics = candidate.by_category[category];
  const baselineValue = baselineMetrics[metric];
  const candidateValue = candidateMetrics[metric];
  const baselineDenominator = baselineMetrics.answerable_queries;
  const candidateDenominator = candidateMetrics.answerable_queries;
  const name = `${category} ${label}`;
  if (baselineValue === null || candidateValue === null
    || baselineDenominator === 0 || candidateDenominator === 0) {
    return {
      name,
      status: 'not_evaluable',
      baseline: baselineValue,
      candidate: candidateValue,
      reason: `Both reports require ${category} answerable queries; baseline has ${baselineDenominator}, candidate has ${candidateDenominator}.`,
    };
  }
  const passes = candidateValue >= baselineValue;
  return {
    name,
    status: passes ? 'pass' : 'fail',
    baseline: baselineValue,
    candidate: candidateValue,
    reason: passes
      ? `Candidate ${label} ${candidateValue} across ${candidateDenominator} ${category} answerable queries is not below baseline ${baselineValue} across ${baselineDenominator}.`
      : `Candidate ${label} ${candidateValue} across ${candidateDenominator} ${category} answerable queries is below baseline ${baselineValue} across ${baselineDenominator}.`,
  };
}

function identifierTopOneCheck(
  baseline: SplitMetrics,
  candidate: SplitMetrics,
): AcceptanceCheck {
  const baselineMetrics = baseline.by_category['exact-identifier'];
  const candidateMetrics = candidate.by_category['exact-identifier'];
  const baselineValue = baselineMetrics.exact_top1_accuracy;
  const candidateValue = candidateMetrics.exact_top1_accuracy;
  const baselineDenominator = baselineMetrics.exact_identifier_queries;
  const candidateDenominator = candidateMetrics.exact_identifier_queries;
  const name = 'exact-identifier top-one accuracy';
  if (baselineValue === null || candidateValue === null
    || baselineDenominator === 0 || candidateDenominator === 0) {
    return {
      name,
      status: 'not_evaluable',
      baseline: baselineValue,
      candidate: candidateValue,
      reason: `Both reports require exact-identifier queries; baseline has ${baselineDenominator}, candidate has ${candidateDenominator}.`,
    };
  }
  const passes = candidateValue >= baselineValue;
  return {
    name,
    status: passes ? 'pass' : 'fail',
    baseline: baselineValue,
    candidate: candidateValue,
    reason: passes
      ? `Candidate top-one accuracy ${candidateValue} across ${candidateDenominator} exact-identifier queries is not below baseline ${baselineValue} across ${baselineDenominator}.`
      : `Candidate top-one accuracy ${candidateValue} across ${candidateDenominator} exact-identifier queries is below baseline ${baselineValue} across ${baselineDenominator}.`,
  };
}

function noAnswerReductionCheck(
  baseline: SplitMetrics,
  candidate: SplitMetrics,
  requiredReduction: FalsePositiveReduction,
): AcceptanceCheck {
  const baselineMetrics = baseline.by_category['no-good-answer'];
  const candidateMetrics = candidate.by_category['no-good-answer'];
  const baselineValue = baselineMetrics.no_answer_false_positives;
  const candidateValue = candidateMetrics.no_answer_false_positives;
  const baselineDenominator = baselineMetrics.no_answer_queries;
  const candidateDenominator = candidateMetrics.no_answer_queries;
  const name = 'no-good-answer false-positive count';
  if (baselineDenominator === 0 || candidateDenominator === 0) {
    return {
      name,
      status: 'not_evaluable',
      baseline: baselineValue,
      candidate: candidateValue,
      reason: `Both reports require no-good-answer queries; baseline has ${baselineDenominator}, candidate has ${candidateDenominator}.`,
    };
  }
  if (baselineValue === 0) {
    return {
      name,
      status: 'not_evaluable',
      baseline: baselineValue,
      candidate: candidateValue,
      reason: `Baseline false positives must be greater than zero; baseline is ${baselineValue} of ${baselineDenominator}.`,
    };
  }
  if (requiredReduction === 'strict') {
    const passes = candidateValue < baselineValue;
    return {
      name,
      status: passes ? 'pass' : 'fail',
      baseline: baselineValue,
      candidate: candidateValue,
      reason: passes
        ? `Candidate false positives ${candidateValue} of ${candidateDenominator} are strictly fewer than baseline ${baselineValue}.`
        : `Candidate false positives ${candidateValue} of ${candidateDenominator} are not strictly fewer than baseline ${baselineValue}.`,
    };
  }
  const passes = 2 * candidateValue <= baselineValue;
  return {
    name,
    status: passes ? 'pass' : 'fail',
    baseline: baselineValue,
    candidate: candidateValue,
    reason: passes
      ? `Candidate false positives ${candidateValue} of ${candidateDenominator} satisfy 2 * ${candidateValue} <= ${baselineValue}.`
      : `Candidate false positives ${candidateValue} of ${candidateDenominator} do not satisfy 2 * ${candidateValue} <= ${baselineValue}.`,
  };
}

function nonRegressionChecks(
  baseline: SplitMetrics,
  candidate: SplitMetrics,
  requiredReduction: FalsePositiveReduction,
): AcceptanceCheck[] {
  return [
    ...ANSWERABLE_CATEGORIES.flatMap(category => [
      metricCheck(category, 'recall_at_5', 'Recall@5', baseline, candidate),
      metricCheck(category, 'mrr_at_5', 'MRR@5', baseline, candidate),
    ]),
    identifierTopOneCheck(baseline, candidate),
    noAnswerReductionCheck(baseline, candidate, requiredReduction),
  ];
}

function acceptanceFromChecks(checks: AcceptanceCheck[]): AcceptanceResult {
  if (checks.some(check => check.status === 'fail')) {
    return {
      status: 'fail',
      checks,
      reason: 'One or more acceptance checks failed.',
    };
  }
  if (checks.some(check => check.status === 'not_evaluable')) {
    return {
      status: 'not_evaluable',
      checks,
      reason: 'One or more acceptance checks are not evaluable.',
    };
  }
  return {
    status: 'pass',
    checks,
    reason: 'All acceptance checks passed.',
  };
}

export function applyCoveragePolicy(
  fixture: RetrievalFixture,
  rankings: readonly RetrievalRanking[],
  threshold: CoverageThreshold,
): CoverageResult {
  if (!COVERAGE_THRESHOLDS.includes(threshold)) {
    throw new Error(`Unsupported coverage threshold: ${threshold}`);
  }
  const parsedFixture = RetrievalFixtureSchema.parse(fixture);
  const parsedRankings = cloneRankings(rankings);
  evaluateRetrievalRankings(parsedFixture, parsedRankings, 'coverage-policy-validation');

  const documentTokens = new Map(parsedFixture.documents.map(document => [
    document.id,
    new Set(tokenize(`${document.title} ${document.body}`)),
  ]));
  const queries = new Map(parsedFixture.queries.map(query => [query.id, query]));
  const decisions: CoverageDecision[] = [];
  const resultRankings = parsedRankings.map(ranking => {
    const query = queries.get(ranking.query_id);
    if (query === undefined) {
      throw new Error(`Missing query for ranking ${ranking.query_id}`);
    }
    const queryTokens = new Set(tokenize(query.query));
    if (queryTokens.size === 0) {
      decisions.push({
        query_id: query.id,
        outcome: 'no-query-tokens',
        matched_tokens: 0,
        query_tokens: 0,
        coverage: null,
      });
      return { query_id: ranking.query_id, hits: [] };
    }
    const topHit = ranking.hits[0];
    if (topHit === undefined) {
      decisions.push({
        query_id: query.id,
        outcome: 'no-baseline-hits',
        matched_tokens: 0,
        query_tokens: queryTokens.size,
        coverage: null,
      });
      return { query_id: ranking.query_id, hits: [] };
    }
    const topDocumentTokens = documentTokens.get(topHit.id);
    if (topDocumentTokens === undefined) {
      throw new Error(`Missing document for ranking ${ranking.query_id}`);
    }
    const matchedTokens = [...queryTokens].filter(token => topDocumentTokens.has(token)).length;
    const coverage = matchedTokens / queryTokens.size;
    const retained = coverage >= threshold;
    decisions.push({
      query_id: query.id,
      outcome: retained ? 'retained' : 'below-coverage-threshold',
      matched_tokens: matchedTokens,
      query_tokens: queryTokens.size,
      coverage,
    });
    return retained
      ? {
        query_id: ranking.query_id,
        hits: ranking.hits.map(hit => ({ id: hit.id, score: hit.score })),
      }
      : { query_id: ranking.query_id, hits: [] };
  });

  return { rankings: resultRankings, decisions };
}

export function selectCoverageThreshold(
  tuningFixture: RetrievalFixture,
  tuningRankings: readonly RetrievalRanking[],
): { selection: CoverageSelection; trials: TuningTrial[] } {
  const parsedFixture = RetrievalFixtureSchema.parse(tuningFixture);
  if (parsedFixture.queries.some(query => query.split !== 'tuning')) {
    throw new Error('Coverage threshold selection accepts tuning queries only.');
  }
  const baselineRankings = cloneRankings(tuningRankings);
  const baseline = evaluateRetrievalRankings(
    parsedFixture,
    baselineRankings,
    'coverage-policy-tuning-baseline',
  );
  const trials = COVERAGE_THRESHOLDS.map(threshold => {
    const policy = applyCoveragePolicy(parsedFixture, baselineRankings, threshold);
    const candidate = evaluateRetrievalRankings(
      parsedFixture,
      policy.rankings,
      `coverage-policy-${threshold}`,
    );
    const checks = nonRegressionChecks(
      baseline.by_split.tuning,
      candidate.by_split.tuning,
      'strict',
    );
    return {
      threshold,
      metrics: candidate.by_split.tuning,
      eligible: checks.every(check => check.status === 'pass'),
      reasons: checks
        .filter(check => check.status !== 'pass')
        .map(check => check.reason),
    };
  });
  const selected = trials
    .filter(trial => trial.eligible)
    .sort((left, right) => {
      const falsePositiveDifference =
        left.metrics.by_category['no-good-answer'].no_answer_false_positives
        - right.metrics.by_category['no-good-answer'].no_answer_false_positives;
      return falsePositiveDifference || left.threshold - right.threshold;
    })[0];
  return {
    selection: selected === undefined
      ? { status: 'no_eligible_candidate', threshold: null }
      : { status: 'selected', threshold: selected.threshold },
    trials,
  };
}

export function evaluateHoldoutAcceptance(
  baseline: RetrievalQualityReport,
  candidate: RetrievalQualityReport | null,
): AcceptanceResult {
  if (candidate === null) {
    return {
      status: 'not_run',
      checks: [],
      reason: 'No candidate was selected for holdout evaluation.',
    };
  }
  return acceptanceFromChecks(nonRegressionChecks(
    baseline.by_split.holdout,
    candidate.by_split.holdout,
    'half',
  ));
}

export function evaluateAbstentionExperiment(
  fixture: RetrievalFixture,
  baselineRankings?: readonly RetrievalRanking[],
): AbstentionExperiment {
  const parsedFixture = RetrievalFixtureSchema.parse(fixture);
  const tuningQueries = parsedFixture.queries.filter(query => query.split === 'tuning');
  if (tuningQueries.length === 0) {
    const baseline = evaluateBaseline(parsedFixture, baselineRankings);
    const reason = 'No tuning queries are available for threshold selection.';
    return {
      schema_version: 1,
      policy: {
        id: 'top-result-query-token-coverage',
        thresholds: COVERAGE_THRESHOLDS,
        selection_split: 'tuning',
      },
      baseline,
      tuning_trials: COVERAGE_THRESHOLDS.map(threshold => ({
        threshold,
        metrics: structuredClone(baseline.by_split.tuning),
        eligible: false,
        reasons: [reason],
      })),
      selection: { status: 'no_eligible_candidate', threshold: null },
      candidate: null,
      decisions: null,
      holdout_acceptance: {
        status: 'not_run',
        checks: [],
        reason,
      },
    };
  }
  const tuningFixture: RetrievalFixture = {
    ...parsedFixture,
    queries: tuningQueries,
  };
  const tuningQueryIds = new Set(tuningQueries.map(query => query.id));
  const tuningRankings = baselineRankings === undefined
    ? rankingsFromReport(evaluateRetrievalQuality(tuningFixture))
    : cloneRankings(baselineRankings).filter(ranking => tuningQueryIds.has(ranking.query_id));
  const { selection, trials } = selectCoverageThreshold(tuningFixture, tuningRankings);
  const baseline = evaluateBaseline(parsedFixture, baselineRankings);
  if (selection.status === 'no_eligible_candidate') {
    return {
      schema_version: 1,
      policy: {
        id: 'top-result-query-token-coverage',
        thresholds: COVERAGE_THRESHOLDS,
        selection_split: 'tuning',
      },
      baseline,
      tuning_trials: trials,
      selection,
      candidate: null,
      decisions: null,
      holdout_acceptance: {
        status: 'not_run',
        checks: [],
        reason: 'No eligible coverage threshold was selected from tuning results.',
      },
    };
  }
  const baselineRows = rankingsFromReport(baseline);
  const coverage = applyCoveragePolicy(parsedFixture, baselineRows, selection.threshold);
  const candidate = evaluateRetrievalRankings(
    parsedFixture,
    coverage.rankings,
    `${baseline.implementation}+top-result-query-token-coverage`,
  );
  return {
    schema_version: 1,
    policy: {
      id: 'top-result-query-token-coverage',
      thresholds: COVERAGE_THRESHOLDS,
      selection_split: 'tuning',
    },
    baseline,
    tuning_trials: trials,
    selection,
    candidate,
    decisions: coverage.decisions,
    holdout_acceptance: evaluateHoldoutAcceptance(baseline, candidate),
  };
}
