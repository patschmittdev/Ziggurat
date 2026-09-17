import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COVERAGE_THRESHOLDS,
  applyCoveragePolicy,
  evaluateAbstentionExperiment,
  evaluateHoldoutAcceptance,
  selectCoverageThreshold,
} from '../src/eval/retrieval-abstention.js';
import type {
  RetrievalFixture,
  RetrievalRanking,
} from '../src/eval/retrieval-quality.js';
import { evaluateRetrievalRankings } from '../src/eval/retrieval-quality.js';

const policyFixture: RetrievalFixture = {
  schema_version: 1,
  corpus_revision: 'coverage-unit',
  query_revision: 'coverage-unit',
  description: 'Coverage arithmetic only, not experiment evidence.',
  documents: [
    { id: 'water', title: 'Water register', body: 'Irrigation roots.' },
    { id: 'path', title: 'Garden path', body: 'Gravel access route.' },
    { id: 'cplusplus', title: 'C++ guide', body: 'Compiler notes.' },
  ],
  queries: [
    {
      id: 'boundary',
      split: 'tuning',
      category: 'no-good-answer',
      query: 'water billing',
      relevant_ids: [],
    },
    {
      id: 'duplicate',
      split: 'tuning',
      category: 'no-good-answer',
      query: 'water water roots absent',
      relevant_ids: [],
    },
    {
      id: 'identifier',
      split: 'tuning',
      category: 'no-good-answer',
      query: 'C++ absent',
      relevant_ids: [],
    },
    {
      id: 'empty',
      split: 'tuning',
      category: 'no-good-answer',
      query: 'garden gravel',
      relevant_ids: [],
    },
    {
      id: 'tokenless',
      split: 'tuning',
      category: 'no-good-answer',
      query: '---',
      relevant_ids: [],
    },
  ],
};

const policyRankings: RetrievalRanking[] = [
  {
    query_id: 'boundary',
    hits: [{ id: 'water', score: 7 }, { id: 'path', score: 2 }],
  },
  {
    query_id: 'duplicate',
    hits: [{ id: 'water', score: 6 }],
  },
  {
    query_id: 'identifier',
    hits: [{ id: 'cplusplus', score: 5 }],
  },
  {
    query_id: 'empty',
    hits: [],
  },
  {
    query_id: 'tokenless',
    hits: [{ id: 'path', score: 4 }],
  },
];

test('abstention policy: coverage boundaries preserve rankings and scores', () => {
  const original = structuredClone(policyRankings);
  const retained = applyCoveragePolicy(policyFixture, policyRankings, 0.5);
  const rejected = applyCoveragePolicy(policyFixture, policyRankings, 0.75);

  assert.deepEqual(retained.rankings, [
    policyRankings[0],
    policyRankings[1],
    policyRankings[2],
    policyRankings[3],
    { query_id: 'tokenless', hits: [] },
  ]);
  assert.deepEqual(rejected.rankings, [
    { query_id: 'boundary', hits: [] },
    { query_id: 'duplicate', hits: [] },
    { query_id: 'identifier', hits: [] },
    { query_id: 'empty', hits: [] },
    { query_id: 'tokenless', hits: [] },
  ]);
  assert.deepEqual(policyRankings, original);
  assert.notStrictEqual(retained.rankings, policyRankings);
  assert.notStrictEqual(retained.rankings[0]!.hits, policyRankings[0]!.hits);
  assert.throws(
    () => applyCoveragePolicy(policyFixture, policyRankings, 0.6 as 0.5),
    /Unsupported coverage threshold/u,
  );
  assert.deepEqual(COVERAGE_THRESHOLDS, [0.25, 0.5, 0.75, 1]);
});

test('abstention policy: repeated and absent tokens use the full distinct denominator', () => {
  const result = applyCoveragePolicy(policyFixture, policyRankings, 0.5);

  assert.deepEqual(result.decisions, [
    {
      query_id: 'boundary',
      outcome: 'retained',
      matched_tokens: 1,
      query_tokens: 2,
      coverage: 0.5,
    },
    {
      query_id: 'duplicate',
      outcome: 'retained',
      matched_tokens: 2,
      query_tokens: 3,
      coverage: 2 / 3,
    },
    {
      query_id: 'identifier',
      outcome: 'retained',
      matched_tokens: 1,
      query_tokens: 2,
      coverage: 0.5,
    },
    {
      query_id: 'empty',
      outcome: 'no-baseline-hits',
      matched_tokens: 0,
      query_tokens: 2,
      coverage: null,
    },
    {
      query_id: 'tokenless',
      outcome: 'no-query-tokens',
      matched_tokens: 0,
      query_tokens: 0,
      coverage: null,
    },
  ]);
});

function rankingsFor(
  fixture: RetrievalFixture,
  hitsByQuery: Record<string, readonly string[]>,
): RetrievalRanking[] {
  return fixture.queries.map(query => ({
    query_id: query.id,
    hits: (hitsByQuery[query.id] ?? []).map((id, index) => ({ id, score: 10 - index })),
  }));
}

const experimentFixture: RetrievalFixture = {
  schema_version: 1,
  corpus_revision: 'selection-unit',
  query_revision: 'selection-unit',
  description: 'Small split fixture for coverage selection behavior.',
  documents: [
    { id: 'tuning-exact-doc', title: 'EX-100 manual', body: 'Exact identifier.' },
    { id: 'tuning-para-doc', title: 'Rainwater storage', body: 'Collection notes.' },
    { id: 'tuning-amb-a', title: 'Garden route north', body: 'Shared path.' },
    { id: 'tuning-amb-b', title: 'Garden route south', body: 'Shared path.' },
    { id: 'none-doc', title: 'Alpha beta gamma delta', body: 'Reference text.' },
    { id: 'holdout-exact-doc', title: 'H-100 manual', body: 'Exact identifier.' },
    { id: 'holdout-para-doc', title: 'Vegetable rainfall', body: 'Collection notes.' },
    { id: 'holdout-amb-a', title: 'Orchard route west', body: 'Shared path.' },
    { id: 'holdout-amb-b', title: 'Orchard route east', body: 'Shared path.' },
  ],
  queries: [
    {
      id: 'tuning-exact',
      split: 'tuning',
      category: 'exact-identifier',
      query: 'EX-100 manual omitted',
      relevant_ids: ['tuning-exact-doc'],
    },
    {
      id: 'tuning-para',
      split: 'tuning',
      category: 'paraphrase',
      query: 'rainwater storage',
      relevant_ids: ['tuning-para-doc'],
    },
    {
      id: 'tuning-amb',
      split: 'tuning',
      category: 'ambiguous',
      query: 'garden route',
      relevant_ids: ['tuning-amb-a', 'tuning-amb-b'],
    },
    {
      id: 'tuning-none-one',
      split: 'tuning',
      category: 'no-good-answer',
      query: 'alpha',
      relevant_ids: [],
    },
    {
      id: 'tuning-none-two',
      split: 'tuning',
      category: 'no-good-answer',
      query: 'alpha beta gamma delta epsilon',
      relevant_ids: [],
    },
    {
      id: 'tuning-none-three',
      split: 'tuning',
      category: 'no-good-answer',
      query: 'alpha beta gamma delta epsilon zeta eta theta iota kappa',
      relevant_ids: [],
    },
    {
      id: 'tuning-none-four',
      split: 'tuning',
      category: 'no-good-answer',
      query: 'alpha epsilon zeta eta theta',
      relevant_ids: [],
    },
    {
      id: 'tuning-none-five',
      split: 'tuning',
      category: 'no-good-answer',
      query: 'alpha epsilon zeta eta theta iota kappa lambda mu nu',
      relevant_ids: [],
    },
    {
      id: 'holdout-exact',
      split: 'holdout',
      category: 'exact-identifier',
      query: 'H-100',
      relevant_ids: ['holdout-exact-doc'],
    },
    {
      id: 'holdout-para',
      split: 'holdout',
      category: 'paraphrase',
      query: 'vegetable rainfall',
      relevant_ids: ['holdout-para-doc'],
    },
    {
      id: 'holdout-amb',
      split: 'holdout',
      category: 'ambiguous',
      query: 'orchard route',
      relevant_ids: ['holdout-amb-a', 'holdout-amb-b'],
    },
    {
      id: 'holdout-none',
      split: 'holdout',
      category: 'no-good-answer',
      query: 'alpha epsilon zeta eta theta',
      relevant_ids: [],
    },
  ],
};

const experimentRankings = rankingsFor(experimentFixture, {
  'tuning-exact': ['tuning-exact-doc'],
  'tuning-para': ['tuning-para-doc'],
  'tuning-amb': ['tuning-amb-a', 'tuning-amb-b'],
  'tuning-none-one': ['none-doc'],
  'tuning-none-two': ['none-doc'],
  'tuning-none-three': ['none-doc'],
  'tuning-none-four': ['none-doc'],
  'tuning-none-five': ['none-doc'],
  'holdout-exact': ['holdout-exact-doc'],
  'holdout-para': ['holdout-para-doc'],
  'holdout-amb': ['holdout-amb-a', 'holdout-amb-b'],
  'holdout-none': ['none-doc'],
});

const tuningFixture: RetrievalFixture = {
  ...experimentFixture,
  queries: experimentFixture.queries.filter(query => query.split === 'tuning'),
};
const tuningRankings = experimentRankings.filter(ranking =>
  tuningFixture.queries.some(query => query.id === ranking.query_id));

test('abstention selection: holdout changes cannot affect selection', () => {
  const original = structuredClone(experimentRankings);
  const initial = evaluateAbstentionExperiment(experimentFixture, experimentRankings);
  const changedHoldoutFixture: RetrievalFixture = {
    ...experimentFixture,
    query_revision: 'changed-holdout-only',
    queries: experimentFixture.queries.map(query => {
      if (query.split === 'tuning') return query;
      const relevant_ids = query.category === 'ambiguous'
        ? ['none-doc', 'tuning-amb-a']
        : query.category === 'no-good-answer' ? [] : ['none-doc'];
      return { ...query, query: `changed ${query.id}`, relevant_ids };
    }),
  };
  const changedHoldoutRankings = experimentRankings.map(ranking => {
    const query = experimentFixture.queries.find(item => item.id === ranking.query_id)!;
    return query.split === 'holdout'
      ? { query_id: ranking.query_id, hits: [...ranking.hits].reverse() }
      : { query_id: ranking.query_id, hits: ranking.hits.map(hit => ({ ...hit })) };
  });
  const changed = evaluateAbstentionExperiment(changedHoldoutFixture, changedHoldoutRankings);

  assert.deepEqual(initial.selection, { status: 'selected', threshold: 0.5 });
  assert.deepEqual(changed.selection, initial.selection);
  assert.deepEqual(changed.tuning_trials, initial.tuning_trials);
  assert.deepEqual(experimentRankings, original);
  assert.deepEqual(initial, evaluateAbstentionExperiment(experimentFixture, experimentRankings));
  assert.throws(
    () => selectCoverageThreshold(experimentFixture, experimentRankings),
    /tuning/u,
  );
});

test('abstention selection: ties favor the least restrictive eligible threshold', () => {
  const { selection, trials } = selectCoverageThreshold(tuningFixture, tuningRankings);
  const tuningBaseline = evaluateRetrievalRankings(
    tuningFixture,
    tuningRankings,
    'selection-tuning-baseline',
  ).by_split.tuning.by_category['no-good-answer'];
  const strictReduction = trials.find(trial => trial.threshold === 0.25)!;

  assert.deepEqual(selection, { status: 'selected', threshold: 0.5 });
  assert.equal(tuningBaseline.no_answer_false_positives, 5);
  assert.equal(strictReduction.metrics.by_category['no-good-answer'].no_answer_false_positives, 3);
  assert(2 * strictReduction.metrics.by_category['no-good-answer'].no_answer_false_positives
    > tuningBaseline.no_answer_false_positives);
  assert.equal(strictReduction.eligible, true);
  assert.equal(trials.find(trial => trial.threshold === 0.5)!.eligible, true);
  assert.equal(trials.find(trial => trial.threshold === 0.75)!.eligible, true);
});

test('abstention selection: fewer tuning false positives outrank a lower eligible threshold', () => {
  const betterHigherFixture: RetrievalFixture = {
    ...tuningFixture,
    query_revision: 'selection-fewer-false-positives',
    queries: [
      ...tuningFixture.queries,
      {
        id: 'tuning-none-half',
        split: 'tuning',
        category: 'no-good-answer',
        query: 'alpha beta epsilon zeta',
        relevant_ids: [],
      },
    ],
  };
  const betterHigherRankings: RetrievalRanking[] = [
    ...tuningRankings,
    { query_id: 'tuning-none-half', hits: [{ id: 'none-doc', score: 10 }] },
  ];
  const { selection, trials } = selectCoverageThreshold(betterHigherFixture, betterHigherRankings);
  const lowerThreshold = trials.find(trial => trial.threshold === 0.5)!;
  const higherThreshold = trials.find(trial => trial.threshold === 0.75)!;

  assert.equal(lowerThreshold.eligible, true);
  assert.equal(higherThreshold.eligible, true);
  assert.equal(
    lowerThreshold.metrics.by_category['no-good-answer'].no_answer_false_positives,
    3,
  );
  assert.equal(
    higherThreshold.metrics.by_category['no-good-answer'].no_answer_false_positives,
    2,
  );
  assert.deepEqual(selection, { status: 'selected', threshold: 0.75 });
});

const acceptanceFixture: RetrievalFixture = {
  schema_version: 1,
  corpus_revision: 'acceptance-unit',
  query_revision: 'acceptance-unit',
  description: 'Count boundary fixture for acceptance behavior.',
  documents: [
    { id: 'exact-doc', title: 'Exact record', body: 'Identifier text.' },
    { id: 'para-doc', title: 'Rainwater storage', body: 'Collection notes.' },
    { id: 'amb-a', title: 'Garden route north', body: 'Shared path.' },
    { id: 'amb-b', title: 'Garden route south', body: 'Shared path.' },
    { id: 'none-doc', title: 'Unrelated reference', body: 'No answer.' },
  ],
  queries: [
    {
      id: 'exact',
      split: 'holdout',
      category: 'exact-identifier',
      query: 'exact record',
      relevant_ids: ['exact-doc'],
    },
    {
      id: 'para',
      split: 'holdout',
      category: 'paraphrase',
      query: 'rainwater storage',
      relevant_ids: ['para-doc'],
    },
    {
      id: 'amb',
      split: 'holdout',
      category: 'ambiguous',
      query: 'garden route',
      relevant_ids: ['amb-a', 'amb-b'],
    },
    ...['one', 'two', 'three', 'four', 'five'].map(id => ({
      id: `none-${id}`,
      split: 'holdout' as const,
      category: 'no-good-answer' as const,
      query: `unknown ${id}`,
      relevant_ids: [],
    })),
  ],
};

const answerableHits = {
  exact: ['exact-doc'],
  para: ['para-doc'],
  amb: ['amb-a', 'amb-b'],
};
const acceptanceBaseline = evaluateRetrievalRankings(acceptanceFixture, rankingsFor(acceptanceFixture, {
  ...answerableHits,
  'none-one': ['none-doc'],
  'none-two': ['none-doc'],
  'none-three': ['none-doc'],
  'none-four': ['none-doc'],
  'none-five': ['none-doc'],
}), 'acceptance-baseline');

test('abstention acceptance: exact count boundaries and category regressions', () => {
  const twoFalsePositives = evaluateRetrievalRankings(acceptanceFixture, rankingsFor(acceptanceFixture, {
    ...answerableHits,
    'none-one': ['none-doc'],
    'none-two': ['none-doc'],
  }), 'two-false-positives');
  const threeFalsePositives = evaluateRetrievalRankings(acceptanceFixture, rankingsFor(acceptanceFixture, {
    ...answerableHits,
    'none-one': ['none-doc'],
    'none-two': ['none-doc'],
    'none-three': ['none-doc'],
  }), 'three-false-positives');
  const accepted = evaluateHoldoutAcceptance(acceptanceBaseline, twoFalsePositives);
  const rejected = evaluateHoldoutAcceptance(acceptanceBaseline, threeFalsePositives);
  const acceptedNoAnswer = accepted.checks.find(check =>
    check.name === 'no-good-answer false-positive count');
  const rejectedNoAnswer = rejected.checks.find(check =>
    check.name === 'no-good-answer false-positive count');

  assert.equal(accepted.status, 'pass');
  assert.deepEqual(acceptedNoAnswer, {
    name: 'no-good-answer false-positive count',
    status: 'pass',
    baseline: 5,
    candidate: 2,
    reason: 'Candidate false positives 2 of 5 satisfy 2 * 2 <= 5.',
  });
  assert.equal(rejected.status, 'fail');
  assert.equal(rejectedNoAnswer!.status, 'fail');
  assert.equal(rejectedNoAnswer!.baseline, 5);
  assert.equal(rejectedNoAnswer!.candidate, 3);

  const regressionFixture: RetrievalFixture = {
    ...acceptanceFixture,
    query_revision: 'category-regression',
    documents: [
      ...acceptanceFixture.documents,
      { id: 'exact-two-doc', title: 'Exact two', body: 'Identifier text.' },
      { id: 'exact-three-doc', title: 'Exact three', body: 'Identifier text.' },
      { id: 'other-doc', title: 'Other record', body: 'No relevance.' },
    ],
    queries: [
      {
        id: 'exact-one',
        split: 'holdout',
        category: 'exact-identifier',
        query: 'exact record',
        relevant_ids: ['exact-doc'],
      },
      {
        id: 'exact-two',
        split: 'holdout',
        category: 'exact-identifier',
        query: 'exact two',
        relevant_ids: ['exact-two-doc'],
      },
      {
        id: 'exact-three',
        split: 'holdout',
        category: 'exact-identifier',
        query: 'exact three',
        relevant_ids: ['exact-three-doc'],
      },
      {
        id: 'paraphrase',
        split: 'holdout',
        category: 'paraphrase',
        query: 'rainwater storage',
        relevant_ids: ['para-doc'],
      },
      {
        id: 'ambiguous',
        split: 'holdout',
        category: 'ambiguous',
        query: 'garden route',
        relevant_ids: ['amb-a', 'amb-b'],
      },
      {
        id: 'no-answer',
        split: 'holdout',
        category: 'no-good-answer',
        query: 'unknown',
        relevant_ids: [],
      },
    ],
  };
  const regressionBaseline = evaluateRetrievalRankings(regressionFixture, rankingsFor(regressionFixture, {
    'exact-one': ['other-doc'],
    'exact-two': ['other-doc'],
    'exact-three': ['other-doc'],
    paraphrase: ['para-doc'],
    ambiguous: ['amb-a', 'amb-b'],
    'no-answer': ['none-doc'],
  }), 'regression-baseline');
  const unchangedIdentifier = evaluateRetrievalRankings(regressionFixture, rankingsFor(regressionFixture, {
    'exact-one': ['other-doc'],
    'exact-two': ['other-doc'],
    'exact-three': ['other-doc'],
    paraphrase: ['para-doc'],
    ambiguous: ['amb-a', 'amb-b'],
  }), 'unchanged-identifier');
  const regressionCandidate = evaluateRetrievalRankings(regressionFixture, rankingsFor(regressionFixture, {
    'exact-one': ['exact-doc'],
    'exact-two': ['exact-two-doc'],
    'exact-three': ['exact-three-doc'],
    paraphrase: ['other-doc'],
    ambiguous: ['amb-a', 'amb-b'],
  }), 'regression-candidate');
  const unchangedResult = evaluateHoldoutAcceptance(regressionBaseline, unchangedIdentifier);
  const regression = evaluateHoldoutAcceptance(regressionBaseline, regressionCandidate);
  const identifierCheck = unchangedResult.checks.find(check =>
    check.name === 'exact-identifier top-one accuracy');

  assert(regressionCandidate.summary.recall_at_5! > regressionBaseline.summary.recall_at_5!);
  assert.equal(unchangedResult.status, 'pass');
  assert.deepEqual(identifierCheck, {
    name: 'exact-identifier top-one accuracy',
    status: 'pass',
    baseline: 0,
    candidate: 0,
    reason: 'Candidate top-one accuracy 0 across 3 exact-identifier queries is not below baseline 0 across 3.',
  });
  assert.equal(regression.status, 'fail');
  assert.equal(regression.checks.find(check =>
    check.name === 'paraphrase Recall@5')!.status, 'fail');
  assert.equal(regression.checks.find(check =>
    check.name === 'paraphrase MRR@5')!.status, 'fail');

  const partialFixture: RetrievalFixture = {
    ...regressionFixture,
    query_revision: 'partial-category-regression',
    queries: regressionFixture.queries.filter(query => query.category !== 'ambiguous'),
  };
  const partialBaseline = evaluateRetrievalRankings(partialFixture,
    regressionBaseline.queries
      .filter(query => query.category !== 'ambiguous')
      .map(query => ({ query_id: query.query_id, hits: query.hits })),
    'partial-baseline');
  const partialCandidate = evaluateRetrievalRankings(partialFixture,
    regressionCandidate.queries
      .filter(query => query.category !== 'ambiguous')
      .map(query => ({ query_id: query.query_id, hits: query.hits })),
    'partial-candidate');
  const partialResult = evaluateHoldoutAcceptance(partialBaseline, partialCandidate);

  assert.equal(partialResult.status, 'fail');
  assert.equal(partialResult.checks.find(check =>
    check.name === 'ambiguous Recall@5')!.status, 'not_evaluable');
  assert.equal(partialResult.checks.find(check =>
    check.name === 'paraphrase Recall@5')!.status, 'fail');
});

test('abstention acceptance: missing denominators never pass', () => {
  const zeroBaseline = evaluateRetrievalRankings(acceptanceFixture, rankingsFor(acceptanceFixture, {
    ...answerableHits,
  }), 'zero-baseline');
  const zeroCandidate = evaluateRetrievalRankings(acceptanceFixture, rankingsFor(acceptanceFixture, {
    ...answerableHits,
  }), 'zero-candidate');
  const zeroResult = evaluateHoldoutAcceptance(zeroBaseline, zeroCandidate);
  const zeroNoAnswer = zeroResult.checks.find(check =>
    check.name === 'no-good-answer false-positive count');

  assert.equal(zeroResult.status, 'not_evaluable');
  assert.deepEqual(zeroNoAnswer, {
    name: 'no-good-answer false-positive count',
    status: 'not_evaluable',
    baseline: 0,
    candidate: 0,
    reason: 'Baseline false positives must be greater than zero; baseline is 0 of 5.',
  });

  const noHoldoutFixture: RetrievalFixture = {
    ...acceptanceFixture,
    query_revision: 'no-holdout',
    queries: acceptanceFixture.queries.map(query => ({ ...query, split: 'tuning' as const })),
  };
  const noHoldoutRankings = rankingsFor(noHoldoutFixture, {
    ...answerableHits,
    'none-one': ['none-doc'],
  });
  const noHoldoutBaseline = evaluateRetrievalRankings(
    noHoldoutFixture, noHoldoutRankings, 'no-holdout-baseline');
  const noHoldoutCandidate = evaluateRetrievalRankings(
    noHoldoutFixture, noHoldoutRankings, 'no-holdout-candidate');
  const noHoldoutResult = evaluateHoldoutAcceptance(noHoldoutBaseline, noHoldoutCandidate);

  assert.equal(noHoldoutResult.status, 'not_evaluable');
  assert(noHoldoutResult.checks.every(check => check.status === 'not_evaluable'));
});

test('abstention selection: no qualifying threshold remains an explicit negative result', () => {
  const noEligibleFixture: RetrievalFixture = {
    ...experimentFixture,
    query_revision: 'no-eligible',
    queries: experimentFixture.queries.map(query => query.split === 'tuning'
      && query.category === 'no-good-answer'
      ? { ...query, query: 'alpha' }
      : query),
  };
  const noEligible = evaluateAbstentionExperiment(noEligibleFixture, experimentRankings);

  assert.deepEqual(noEligible.selection, {
    status: 'no_eligible_candidate',
    threshold: null,
  });
  assert.equal(noEligible.tuning_trials.length, COVERAGE_THRESHOLDS.length);
  assert(noEligible.tuning_trials.every(trial => !trial.eligible && trial.reasons.length > 0));
  assert.equal(noEligible.candidate, null);
  assert.equal(noEligible.decisions, null);
  assert.equal(noEligible.holdout_acceptance.status, 'not_run');
  assert.match(noEligible.holdout_acceptance.reason, /No eligible coverage threshold/u);

  const noTuningFixture: RetrievalFixture = {
    ...experimentFixture,
    query_revision: 'no-tuning',
    queries: experimentFixture.queries.filter(query => query.split === 'holdout'),
  };
  const noTuningRankings = experimentRankings.filter(ranking =>
    noTuningFixture.queries.some(query => query.id === ranking.query_id));
  const noTuning = evaluateAbstentionExperiment(noTuningFixture, noTuningRankings);

  assert.deepEqual(noTuning.selection, {
    status: 'no_eligible_candidate',
    threshold: null,
  });
  assert.equal(noTuning.tuning_trials.length, COVERAGE_THRESHOLDS.length);
  assert(noTuning.tuning_trials.every(trial =>
    trial.reasons.includes('No tuning queries are available for threshold selection.')));
  assert.equal(noTuning.candidate, null);
  assert.equal(noTuning.decisions, null);
  assert.equal(noTuning.holdout_acceptance.status, 'not_run');
});
