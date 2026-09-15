# stunning-bassoon

SOP-guided insurance claims support agent take-home.

The implementation keeps workflow authority in ordinary code and uses a model for the jobs where language understanding and natural phrasing are useful.

## Workflow

```text
caller turn
-> structured language observation
-> merge durable session facts
-> deterministic SOP controller
-> bounded response plan / grounding
-> natural-language phrasing
```

The business workflow is:

```text
VERIFY_ID -> RESOLVE_INTENT -> PROCESS_CASE -> POST_PROCESS
```

Core rules:

- useful facts are remembered whenever the caller provides them, even when they belong to a later phase;
- claim details stay unavailable until identity is verified with at least three distinct matching PII fields;
- the model may interpret language and phrase responses, but cannot directly advance the SOP phase;
- case answers are grounded in the verified caller's selected claim and relevant guidance;
- post-processing asks the caller to explicitly send or skip an email summary;
- out-of-scope questions are redirected without throwing away useful in-scope facts from the same turn.

## Run the demo

Node 22+ is enough; there are no runtime package dependencies.

```bash
export OPENAI_API_KEY=...
export OPENAI_MODEL=...
npm start
```

Open `http://localhost:3000`.

The page contains the text conversation plus a live SOP panel showing phase, verified identity fields, remembered case hints, claim access, case resolution, irrelevant-question retries, human escalation state, and post-process email consent. Email delivery is simulated as a grounded preview after explicit send consent.

`OPENAI_BASE_URL` is optional. The model adapter uses the Responses API with a strict JSON-schema observation pass, then a separate phrasing pass over a controller-produced response plan. The model never receives authoritative claim data during `VERIFY_ID`.

### Docker

```bash
docker build -t stunning-bassoon .
docker run --rm -p 3000:3000 \
  -e OPENAI_API_KEY \
  -e OPENAI_MODEL \
  stunning-bassoon
```

## Test and evaluate

```bash
npm test
npm run eval
```

`npm test` covers the controller, model boundary, selected-claim grounding, representative guard, POST_PROCESS consent, and HTTP demo path without a live key.

`npm run eval` prints an inspectable transition timeline for deterministic assessment scenarios: the supplied Margaret case, cross-turn memory, mismatched PII, aliases, national-ID last four, angry refusal, mixed/out-of-scope turns, repeated irrelevant questions, ambiguous case selection, pre-verification prompt injection, representative handling, and post-process skip.

An optional live-model probe uses the same real adapter:

```bash
OPENAI_API_KEY=... OPENAI_MODEL=... npm run eval:live
```

It probes the model-dependent interpretation cases separately so normal CI never makes paid external calls.

## Deliberate boundary

The supplied `representatives.json` identifies David Chen as Margaret Chen's son, but the assignment does not define how a representative proves authority to access a policyholder's claim. The harness therefore fails closed: a representative caller stays behind the claim-data gate and is offered a human transfer instead of inheriting authority from knowledge of Margaret's PII.

The supplied `consent_scenarios.json` is retained as fixture data. The requested POST_PROCESS email choice is implemented as direct explicit send/skip consent; no separate polling meaning is inferred from that fixture without a business rule defining it.

## Work

- #1 deterministic SOP controller and cross-phase memory
- #2 bounded model interpretation and grounded responses
- #3 chat demo and inspectable SOP state
- #4 adversarial scenario evals

The repository is intentionally small. Prefer explicit behavior and executable scenarios over framework layers.
