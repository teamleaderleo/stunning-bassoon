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
export MODEL_REASONING_EFFORT=low
npm start
```

Open `http://localhost:3000`.

The page contains the text conversation plus a live SOP panel showing phase, verified identity fields, remembered case hints, claim access, case resolution, irrelevant-question retries, human escalation state, and post-process email consent. Email delivery is simulated as a grounded preview after explicit send consent.

Configuration uses `MODEL_API_KEY`, `MODEL_BASE_URL`, `MODEL_ID`, and optional `MODEL_REASONING_EFFORT`. Supported reasoning values are `none`, `minimal`, `low`, `medium`, `high`, and `xhigh`; use `provider-default` or omit the variable to leave reasoning unspecified. The old `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL` remain fallbacks; `MODEL_*` takes precedence. Without a base URL, the adapter retains the original `https://api.openai.com/v1` default. `.env` files are not loaded automatically: export variables or use `node --env-file=.env src/server.js`. Never commit credentials or local env files.

The model adapter uses the Responses API with a strict JSON-schema observation pass, then a separate phrasing pass over a controller-produced response plan. The observation pass receives the previous assistant turn so short replies such as `4472`, `yes`, or `the denied one` can be interpreted in context. `VERIFY_ID` context contains no authoritative claim records.

### OpenCode Go model contract

The [OpenCode Go endpoint documentation](https://opencode.ai/docs/go/#endpoints) lists `muse-spark-1.3-contributor` and the alternative `gpt-5.6-luna` at `POST https://opencode.ai/zen/go/v1/responses`. Use the bare model ID, without the OpenCode CLI's `opencode-go/` prefix. Requests use `Authorization: Bearer <MODEL_API_KEY>`, JSON bodies, `instructions`, and `input` messages containing `input_text`. Observation requests add `text.format` with `type: json_schema`, `strict: true`, and the observation schema; phrasing requests omit that format. Both send `store: false`. When configured, reasoning is sent as `reasoning.effort`. The adapter identifies itself and supplies a stable `x-opencode-session` per demo conversation.

Every observation is also validated locally against all fields, types, enums, required keys, ranges and unknown-key restrictions before it can enter session state. Invalid JSON, refusals, incomplete responses and HTTP failures fail closed. Requests time out after 60 seconds; there are no automatic paid retries or silent model switches. To select Luna explicitly, change only `MODEL_ID=gpt-5.6-luna`.

[Go usage and privacy documentation](https://opencode.ai/docs/go/) describes Go as intended for coding-agent traffic. This insurance take-home harness is a different workload; successful probes do not establish production-use eligibility. Muse Contributor permits training on prompts/completions and is not zero-retention; `store: false` does not opt out of those terms. Keep this demo to synthetic fixtures. Luna is listed as not used for training, with up to 30-day abuse-monitoring retention. Muse availability also depends on region.

### Docker

```bash
docker build -t stunning-bassoon .
docker run --rm -p 3000:3000 \
  -e MODEL_API_KEY \
  -e MODEL_BASE_URL \
  -e MODEL_ID \
  -e MODEL_REASONING_EFFORT \
  stunning-bassoon
```

## Test and evaluate

```bash
npm test
npm run eval
```

`npm test` covers the controller, model boundary, bounded dialogue context, selected-claim grounding, representative guard, POST_PROCESS consent, and HTTP demo path without a live key.

`npm run eval` prints an inspectable transition timeline for deterministic assessment scenarios: the supplied Margaret case, cross-turn memory, mismatched PII, aliases, national-ID last four, angry refusal, mixed/out-of-scope turns, repeated irrelevant questions, ambiguous case selection, pre-verification prompt injection, representative handling, and post-process skip.

An optional live-model suite uses the same real adapter:

```bash
npm run eval:live # Uses the MODEL_* variables exported above
```

The live suite is intentionally outside normal CI so CI never makes paid external calls. It runs model-dependent conversational scenarios including prompt injection, emotional/refusal turns, mixed scope, aliases, representative fail-closed handling, repeated irrelevant-question escalation, terse `4472` verification, ambiguous January-claim clarification, a normal open auto claim, unsupported-data refusal, POST_PROCESS skip consent, and mid-conversation claim retargeting. Multi-turn scenarios preserve the previous assistant response so they exercise the same bounded dialogue context as the browser.

Successful runs print one compact line per scenario. Failures print the user/assistant transcript plus final phase, selected claim, handoff/email state, and response-plan task. Set `LIVE_EVAL_VERBOSE=1` to print every transcript. Set `LIVE_EVAL_AS_OF_DATE=YYYY-MM-DD` to override the default reproducible fixture date (`2026-09-15`). Set `LIVE_EVAL_SCENARIO=<id>` to run only one scenario and `LIVE_EVAL_OUTPUT=<path.json>` to write a machine-readable result.

### Parallel GitHub live eval

GitHub Actions has a separate opt-in `live-eval` workflow. It never runs on pushes or pull requests. The paid path is authorized only for the repository owner `teamleaderleo`.

Before using it, add the OpenCode Go key as a repository Actions secret named `MODEL_API_KEY` under GitHub repository settings. The key is never accepted through workflow inputs, issue text, or committed files.

Two queue paths are available:

1. Comment exactly `/run-live-eval` on issue #30. This is the connector-friendly path; comments from any GitHub identity other than `teamleaderleo` do not reach the paid jobs.
2. Use **Actions -> live-eval -> Run workflow** as `teamleaderleo` to override the model, reasoning effort, or deterministic as-of date.

A queued run fans all live scenarios out with a 13-way matrix (`fail-fast: false`), so independent scenarios can execute concurrently. Each matrix job uploads one JSON result. The aggregate job downloads all scenario results, builds `summary.json` and `summary.md`, and uploads a combined `live-eval-report` artifact. GitHub downloads that artifact as a zip containing the summaries and per-scenario JSON transcripts/results. The aggregate summary is also posted back to issue #30 with a link to the Actions run.

If any scenario fails, the report artifact is still produced and the overall workflow ends failed after aggregation, so failures remain inspectable instead of disappearing with the first error.

Muse Spark 1.3 Contributor passed the original five compatibility probes on 2026-09-14 with this strict schema request format and plain-text phrasing; no JSON fallback was needed. Live evals are compatibility/behavior probes, not a guarantee of extraction accuracy on arbitrary caller turns.

## Deliberate boundary

The supplied `representatives.json` identifies David Chen as Margaret Chen's son, but the assignment does not define how a representative proves authority to access a policyholder's claim. The harness therefore fails closed: a representative caller stays behind the claim-data gate and is offered a human transfer instead of inheriting authority from knowledge of Margaret's PII.

The supplied `consent_scenarios.json` is retained as fixture data. The requested POST_PROCESS email choice is implemented as direct explicit send/skip consent; no separate polling meaning is inferred from that fixture without a business rule defining it.

## Work

- #1 deterministic SOP controller and cross-phase memory
- #2 bounded model interpretation and grounded responses
- #3 chat demo and inspectable SOP state
- #4 adversarial scenario evals
- #9 bounded dialogue context for terse follow-ups
- #28 expanded live conversational QA
- #31 parallel authorized live-eval workflow and report artifact

The repository is intentionally small. Prefer explicit behavior and executable scenarios over framework layers.
