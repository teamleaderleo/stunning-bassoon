# stunning-bassoon

SOP-guided insurance claims support agent take-home.

The implementation keeps workflow authority in ordinary code and uses a model for the jobs where language understanding and natural phrasing are useful.

## Workflow

```text
caller turn
-> bounded dialogue context + structured language observation
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
- turn interpretation gets only bounded dialogue context: current phase, previous assistant message, remembered semantic state, and consent state;
- case answers are grounded in the verified caller's selected claim and relevant guidance;
- ambiguous verified cases expose bounded candidate summaries so the agent can ask a targeted clarification;
- post-processing asks the caller to explicitly send or skip an email summary;
- out-of-scope questions are redirected without throwing away useful in-scope facts from the same turn.

## Run the demo

Node 22+ is enough; there are no runtime package dependencies.

```bash
export MODEL_API_KEY=... # Your OpenCode Go API key
export MODEL_BASE_URL=https://opencode.ai/zen/go/v1
export MODEL_ID=muse-spark-1.3-contributor
npm start
```

Open `http://localhost:3000`.

The page contains the text conversation plus a live SOP panel showing phase, verified identity fields, remembered case hints, claim access, case resolution, irrelevant-question retries, human escalation state, and post-process email consent. Email delivery is simulated as a grounded preview after explicit send consent.

Configuration uses `MODEL_API_KEY`, `MODEL_BASE_URL`, and `MODEL_ID`. The old `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL` remain fallbacks; `MODEL_*` takes precedence. Without a base URL, the adapter retains the original `https://api.openai.com/v1` default. `.env` files are not loaded automatically: export variables or use `node --env-file=.env src/server.js`. Never commit credentials or local env files.

The model adapter uses the Responses API with a strict JSON-schema observation pass, then a separate phrasing pass over a controller-produced response plan. The observation pass receives the previous assistant turn so short replies such as `4472`, `yes`, or `the denied one` can be interpreted in context. `VERIFY_ID` context contains no authoritative claim records.

### OpenCode Go model contract

The [OpenCode Go endpoint documentation](https://opencode.ai/docs/go/#endpoints) lists `muse-spark-1.3-contributor` and the alternative `gpt-5.6-luna` at `POST https://opencode.ai/zen/go/v1/responses`. Use the bare model ID, without the OpenCode CLI's `opencode-go/` prefix. Requests use `Authorization: Bearer <MODEL_API_KEY>`, JSON bodies, `instructions`, and `input` messages containing `input_text`. Observation requests add `text.format` with `type: json_schema`, `strict: true`, and the observation schema; phrasing requests omit that format. Both send `store: false`. The adapter identifies itself and supplies a stable `x-opencode-session` per demo conversation.

Every observation is also validated locally against all fields, types, enums, required keys, ranges and unknown-key restrictions before it can enter session state. Invalid JSON, refusals, incomplete responses and HTTP failures fail closed. Requests time out after 60 seconds; there are no automatic paid retries or silent model switches. To select Luna explicitly, change only `MODEL_ID=gpt-5.6-luna`.

[Go usage and privacy documentation](https://opencode.ai/docs/go/) describes Go as intended for coding-agent traffic. This insurance take-home harness is a different workload; successful probes do not establish production-use eligibility. Muse Contributor permits training on prompts/completions and is not zero-retention; `store: false` does not opt out of those terms. Keep this demo to synthetic fixtures. Luna is listed as not used for training, with up to 30-day abuse-monitoring retention. Muse availability also depends on region.

### Docker

```bash
docker build -t stunning-bassoon .
docker run --rm -p 3000:3000 \
  -e MODEL_API_KEY \
  -e MODEL_BASE_URL \
  -e MODEL_ID \
  stunning-bassoon
```

## Test and evaluate

```bash
npm test
npm run eval
```

`npm test` covers the controller, model boundary, bounded dialogue context, selected-claim grounding, representative guard, POST_PROCESS consent, and HTTP demo path without a live key.

`npm run eval` prints an inspectable transition timeline for deterministic assessment scenarios: the supplied Margaret case, cross-turn memory, mismatched PII, aliases, national-ID last four, angry refusal, mixed/out-of-scope turns, repeated irrelevant questions, ambiguous case selection, pre-verification prompt injection, representative handling, and post-process skip.

An optional live-model probe uses the same real adapter:

```bash
npm run eval:live # Uses the MODEL_* variables exported above
```

It probes the model-dependent interpretation cases separately so normal CI never makes paid external calls. Muse Spark 1.3 Contributor passed all five live scenarios on 2026-09-14 with this strict schema request format and plain-text phrasing; no JSON fallback was needed. This is a bounded compatibility probe, not a guarantee of extraction accuracy on arbitrary caller turns.

## Deliberate boundary

The supplied `representatives.json` identifies David Chen as Margaret Chen's son, but the assignment does not define how a representative proves authority to access a policyholder's claim. The harness therefore fails closed: a representative caller stays behind the claim-data gate and is offered a human transfer instead of inheriting authority from knowledge of Margaret's PII.

The supplied `consent_scenarios.json` is retained as fixture data. The requested POST_PROCESS email choice is implemented as direct explicit send/skip consent; no separate polling meaning is inferred from that fixture without a business rule defining it.

## Work

- #1 deterministic SOP controller and cross-phase memory
- #2 bounded model interpretation and grounded responses
- #3 chat demo and inspectable SOP state
- #4 adversarial scenario evals
- #9 bounded dialogue context for terse follow-ups

The repository is intentionally small. Prefer explicit behavior and executable scenarios over framework layers.
