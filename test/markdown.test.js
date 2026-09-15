import test from "node:test";
import assert from "node:assert/strict";

import { renderMarkdown } from "../web/markdown.js";

test("renders common agent Markdown without exposing markup characters", () => {
  const html = renderMarkdown("The claim is **denied**.\n\nUse `CL-2048` when following up.");
  assert.equal(
    html,
    "<p>The claim is <strong>denied</strong>.</p><p>Use <code>CL-2048</code> when following up.</p>",
  );
});

test("renders unordered and ordered lists", () => {
  assert.equal(
    renderMarkdown("Missing items:\n- pathology report\n- office note\n\n1. Ask the provider\n2. Keep a copy"),
    "<p>Missing items:</p><ul><li>pathology report</li><li>office note</li></ul><ol><li>Ask the provider</li><li>Keep a copy</li></ol>",
  );
});

test("escapes raw HTML before applying Markdown", () => {
  const html = renderMarkdown("**Safe** <img src=x onerror=alert(1)> <script>alert('x')</script>");
  assert.match(html, /<strong>Safe<\/strong>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<img|<script/);
});

test("renders small headings and emphasis", () => {
  assert.equal(
    renderMarkdown("### Next step\n\n*Request* a human representative."),
    "<h3>Next step</h3><p><em>Request</em> a human representative.</p>",
  );
});
