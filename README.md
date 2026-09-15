# stunning-bassoon

SOP-guided insurance claims support agent take-home.

The implementation keeps workflow authority in ordinary code and uses a model for the jobs where language understanding and natural phrasing are useful.

## Workflow

```text
VERIFY_ID -> RESOLVE_INTENT -> PROCESS_CASE -> POST_PROCESS
```

Core rules:

- useful facts are remembered whenever the caller provides them, even when they belong to a later phase;
- claim details stay unavailable until identity is verified with at least three distinct matching PII fields;
- the model may interpret language and phrase responses, but cannot directly advance the SOP phase;
- case answers are grounded in the verified caller's claim data and relevant guidance;
- post-processing asks the caller to explicitly send or skip an email summary;
- out-of-scope questions are redirected without throwing away useful in-scope facts from the same turn.

## Work

- #1 deterministic SOP controller and cross-phase memory
- #2 bounded model interpretation and grounded responses
- #3 chat demo and inspectable SOP state
- #4 adversarial scenario evals

The repository is intentionally small. The first milestone is a pure, testable controller before any model or UI integration.
