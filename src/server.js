import { createServer as createHttpServer } from "node:http";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { runAgentTurn } from "./agent.js";
import { newSession, publicView } from "./controller.js";
import { loadFixtures } from "./data.js";
import { buildEmailPreview } from "./email.js";
import { createModel } from "./model.js";

const STATIC = new Map([
  ["/", ["../web/index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["../web/app.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["../web/style.css", "text/css; charset=utf-8"]],
]);

export function createDemoServer({ model, data = loadFixtures() } = {}) {
  const sessions = new Map();

  return createHttpServer(async (req, res) => {
    try {
      if (req.method === "GET" && STATIC.has(req.url)) {
        const [path, type] = STATIC.get(req.url);
        res.writeHead(200, { "content-type": type });
        res.end(readFileSync(new URL(path, import.meta.url)));
        return;
      }

      if (req.method === "POST" && req.url === "/api/session") {
        const id = randomUUID();
        const session = newSession();
        sessions.set(id, { session, turns: [], model: model ?? createModel({ sessionId: id }) });
        return json(res, 200, { sessionId: id, view: publicView(session, data) });
      }

      if (req.method === "POST" && req.url === "/api/chat") {
        const input = await readJson(req, 16 * 1024);
        const record = sessions.get(input.sessionId);
        if (!record) return json(res, 404, { error: "unknown session" });
        if (typeof input.text !== "string" || input.text.trim().length < 1 || input.text.length > 4_000) {
          return json(res, 400, { error: "text must be between 1 and 4000 characters" });
        }

        const result = await runAgentTurn({
          session: record.session,
          userText: input.text.trim(),
          data,
          model: record.model,
          previousAssistantText: record.turns.at(-1)?.assistant ?? null,
        });
        record.session = result.session;
        record.turns.push({
          user: input.text.trim(),
          assistant: result.text,
          observation: result.observation,
          events: result.events,
        });

        return json(res, 200, {
          text: result.text,
          events: result.events,
          view: result.view,
          emailPreview: buildEmailPreview(record.session, data, record.turns),
        });
      }

      json(res, 404, { error: "not found" });
    } catch (error) {
      console.error(error);
      json(res, 500, { error: "request failed" });
    }
  });
}

function json(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

async function readJson(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("request too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  createDemoServer().listen(port, () => {
    console.log(`stunning-bassoon listening on http://localhost:${port}`);
  });
}
