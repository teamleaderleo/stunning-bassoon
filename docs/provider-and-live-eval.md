# Provider and live-eval notes

This document keeps provider compatibility, privacy, and paid live-eval details available without putting them in the evaluator's primary README path.

## Application configuration

The app uses provider-neutral environment variables:

```text
MODEL_API_KEY
MODEL_BASE_URL
MODEL_ID
MODEL_REASONING_EFFORT
```

Legacy `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL` values remain fallback inputs; `MODEL_*` takes precedence. When `MODEL_BASE_URL` is absent, the adapter defaults to `https://api.openai.com/v1`.

`.env` files are not loaded automatically by `npm start`. Export variables in the shell or use:

```bash
node --env-file=.env src/server.js
```

Supported reasoning values are `none`, `minimal`, `low`, `medium`, `high`, and `xhigh`. Use `provider-default` or leave `MODEL_REASONING_EFFORT` empty to omit the reasoning field.

## Tested OpenCode Go configuration

The submission's known-good example is:

```bash
MODEL_BASE_URL=https://opencode.ai/zen/go/v1
MODEL_ID=muse-spark-1.3-contributor
MODEL_REASONING_EFFORT=low
```

OpenCode Go also lists `gpt-5.6-luna` on the same endpoint. Use the bare model ID, without an OpenCode CLI provider prefix.

The adapter calls the Responses-style `/responses` endpoint with `Authorization: Bearer <MODEL_API_KEY>`, JSON request bodies, `store: false`, and a stable `x-opencode-session` header for OpenCode Go sessions. Observation calls use strict JSON-schema output; phrasing calls receive a deterministic response plan and return text.

Every observation is validated locally against required fields, types, enums, ranges, and unknown-key restrictions before it can enter session state. Invalid JSON, incomplete responses, provider refusals, and HTTP failures fail closed. Requests time out after 60 seconds. The app does not perform automatic paid retries or silently switch models.

## Privacy and synthetic fixtures

Use synthetic fixture data with this demo. Provider privacy and training terms vary by model and account. OpenCode's current Go documentation should be treated as the source of truth for retention, training, regional availability, and workload eligibility.

`store: false` is sent at the API layer; provider-level privacy terms remain separate from that request field.

## Live model evals

The same adapter can run the opt-in live suite:

```bash
npm run eval:live
```

Ordinary CI excludes paid external calls. The live suite exercises conversational behavior such as injection resistance, emotional/refusal turns, mixed scope, aliases, representative handling, irrelevant-turn escalation, terse verification, ambiguous claim clarification, unsupported-data refusal, claim retargeting, and post-process consent.

Useful controls:

```bash
LIVE_EVAL_VERBOSE=1
LIVE_EVAL_AS_OF_DATE=YYYY-MM-DD
LIVE_EVAL_SCENARIO=<id>
LIVE_EVAL_OUTPUT=<path.json>
```

Successful runs print one compact line per scenario. Failures print the transcript plus final phase, selected claim, handoff/email state, and response-plan task.

## GitHub paid live-eval workflow

`.github/workflows/live-eval.yml` is an explicit paid path and never runs on normal pushes or pull requests. It is authorized for the repository owner and reads the provider key from the repository Actions secret `MODEL_API_KEY`.

The existing queue path uses the exact `/run-live-eval` command on issue #30; the workflow can also be launched manually from GitHub Actions by the authorized owner. Scenario jobs run independently, upload JSON results, and aggregate a readable report artifact.

This workflow is retained as behavioral evidence and final-frozen-submission tooling. Presentation/setup-only changes should use deterministic CI instead of re-running the paid suite.

## Delivery decision

The submitted app keeps conversation state in process memory. Local Node and Docker delivery fit that model well. A public serverless deployment would need an explicit decision about shared session persistence and access/spend controls, so no Vercel deployment is part of this cleanup.
