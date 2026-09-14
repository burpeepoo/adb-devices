import assert from "node:assert/strict";
import test from "node:test";

import { HttpLogParser, buildNetworkCaptureExport } from "../src/networkInspector.ts";
import type { NetworkLogLine } from "../src/networkInspector.ts";

function lines(messages: string[], tid = "20", pid = "10"): NetworkLogLine[] {
  return messages.map((message, index) => ({
    timestamp: `09-11 10:00:00.${String(index).padStart(3, "0")}`,
    pid,
    tid,
    message,
  }));
}

test("captures Calendar-shaped BODY logs incrementally with masked credentials", () => {
  const parser = new HttpLogParser("session-a");
  const url = "https://user:URL_SECRET@example.test/calendar?access_token=QUERY_SECRET&day=Friday";
  parser.ingest(lines([
    `--> POST ${url}`,
    "Content-Type: application/json; charset=utf-8",
    "Authorization: Bearer HEADER_SECRET",
    "",
    '{"title":"Lunch","password":"BODY_SECRET"}',
    "--> END POST (40-byte body)",
  ]));
  const pending = parser.snapshot().requests[0];
  assert.equal(pending.state, "pending");
  assert.equal(pending.responseBody.state, "pending");
  assert.equal(pending.url, "https://example.test/calendar?access_token=%5BREDACTED%5D&day=Friday");
  assert.deepEqual(JSON.parse(pending.requestBody.text), { title: "Lunch", password: "[REDACTED]" });
  assert.equal(pending.requestHeaders[1].value, "[REDACTED]");

  parser.ingest(lines([
    `<-- 200 ${url} (1053ms)`,
    "Content-Type: application/json",
    "Set-Cookie: session=COOKIE_SECRET",
    "",
    '{"ok":true}',
    "<-- END HTTP (1056ms, 11-byte body)",
  ]));
  const snapshot = parser.snapshot();
  const request = snapshot.requests[0];
  assert.equal(request.id, pending.id);
  assert.equal(request.id, "session-a:1");
  assert.equal(request.state, "complete");
  assert.equal(request.statusCode, 200);
  assert.equal(request.durationMs, 1056);
  assert.deepEqual(JSON.parse(request.responseBody.text), { ok: true });
  assert.equal(request.responseBody.state, "complete");
  assert.equal(request.responseBody.bytes, 11);
  assert.equal(snapshot.ignoredLines, 0);
  assert.doesNotMatch(JSON.stringify(snapshot), /URL_SECRET|QUERY_SECRET|HEADER_SECRET|BODY_SECRET|COOKIE_SECRET/);
});

test("reassembles logger-chunked JSON responses before masking and exporting", () => {
  const parser = new HttpLogParser("chunked-response");
  const response = JSON.stringify({ instructions: "a".repeat(5_400), token: "CHUNK_SECRET", success: true });
  parser.ingest(lines([
    "--> GET https://example.test/meals", "--> END GET",
    "<-- 200 https://example.test/meals (489ms)", "Content-Type: application/json", "",
    response.slice(0, 4_000),
  ]));
  assert.equal(parser.snapshot().requests[0].responseBody.state, "withheld");
  parser.ingest(lines([response.slice(4_000), `<-- END HTTP (${Buffer.byteLength(response)}-byte body)`]));
  const snapshot = parser.snapshot();
  const request = snapshot.requests[0];
  assert.equal(request.statusCode, 200);
  assert.equal(request.responseBody.state, "complete");
  assert.equal(request.responseBody.bytes, Buffer.byteLength(response));
  assert.deepEqual(JSON.parse(request.responseBody.text), {
    instructions: "a".repeat(5_400), token: "[REDACTED]", success: true,
  });
  assert.deepEqual(request.warnings, []);
  const exported = buildNetworkCaptureExport({
    session_id: "chunked-response", device_serial: "test-device", package_name: "test.app", pid: "10", started_at_ms: 1,
  }, snapshot, { droppedLines: 0, status: "stopped", exportedAtMs: 2 });
  assert.equal(JSON.parse(exported).requests[0].responseBody.state, "complete");
  assert.doesNotMatch(exported, /CHUNK_SECRET/);
});

test("reconstructs chunked request JSON while preserving real newlines, Unicode and other threads", () => {
  const parser = new HttpLogParser("multiline-chunks");
  const note = "汉😀".repeat(8) + "a".repeat(5_000) + "\\\"tail";
  const payload = JSON.stringify({ note, password: "MULTILINE_SECRET" }, null, 2);
  const messages = payload.split("\n").flatMap((line) => {
    const fragments: string[] = [];
    for (let offset = 0; offset < line.length; offset += 4_000) fragments.push(line.slice(offset, offset + 4_000));
    return fragments;
  });
  parser.ingest(lines(["--> POST https://example.test/long", "Content-Type: application/json", "", ...messages.slice(0, 2)]));
  parser.ingest(lines([
    "--> GET https://example.test/other", "--> END GET",
    "<-- 200 https://example.test/other (1ms)", "", '{"other":true}', "<-- END HTTP (14-byte body)",
  ], "21"));
  parser.ingest(lines([...messages.slice(2), `--> END POST (${Buffer.byteLength(payload)}-byte body)`]));
  const [long, other] = parser.snapshot().requests;
  assert.equal(long.requestBody.state, "complete");
  assert.equal(long.requestBody.bytes, Buffer.byteLength(payload));
  assert.deepEqual(JSON.parse(long.requestBody.text), { note, password: "[REDACTED]" });
  assert.deepEqual(JSON.parse(other.responseBody.text), { other: true });
  assert.doesNotMatch(JSON.stringify(parser.snapshot()), /MULTILINE_SECRET/);
});

test("keeps a real newline at a 4000-character boundary when its declared length includes it", () => {
  const parser = new HttpLogParser("real-newline");
  const firstLine = `{"note":"${"a".repeat(3_989)}",`;
  assert.equal(firstLine.length, 4_000);
  const secondLine = '"ok":true}';
  const payload = `${firstLine}\n${secondLine}`;
  parser.ingest(lines([
    "--> GET https://example.test/multiline", "--> END GET",
    "<-- 200 https://example.test/multiline (1ms)", "", firstLine, secondLine,
    `<-- END HTTP (${Buffer.byteLength(payload)}-byte body)`,
  ]));
  const request = parser.snapshot().requests[0];
  assert.equal(request.responseBody.state, "complete");
  assert.equal(request.responseBody.bytes, Buffer.byteLength(payload));
  assert.deepEqual(JSON.parse(request.responseBody.text), { note: "a".repeat(3_989), ok: true });
  assert.deepEqual(request.warnings, []);
});

test("does not repair missing, unsupported or unconfirmed body fragments", () => {
  const payload = JSON.stringify({ note: "a".repeat(5_400), password: "LOST_FRAGMENT_SECRET" });
  for (const [name, fragments, end] of [
    ["short", [payload.slice(0, 4_000), payload.slice(4_050)], `<-- END HTTP (${Buffer.byteLength(payload)}-byte body)`],
    ["unknown-boundary", [payload.slice(0, 3_000), payload.slice(3_000)], `<-- END HTTP (${Buffer.byteLength(payload)}-byte body)`],
    ["no-byte-count", [payload.slice(0, 4_000), payload.slice(4_000)], "<-- END HTTP"],
    ["no-end", [payload.slice(0, 4_000), payload.slice(4_000)], ""],
  ] as const) {
    const parser = new HttpLogParser(name);
    parser.ingest(lines([
      `--> GET https://example.test/${name}`, "--> END GET",
      `<-- 200 https://example.test/${name} (1ms)`, "", ...fragments,
      ...(end ? [end] : []),
    ]));
    parser.finish("Capture interrupted");
    assert.equal(parser.snapshot().requests[0].responseBody.state, "withheld", name);
    assert.doesNotMatch(JSON.stringify(parser.snapshot()), /LOST_FRAGMENT_SECRET/);
  }
});

test("does not use a request-start size as proof of a missing request END marker", () => {
  const parser = new HttpLogParser("missing-request-end");
  const payload = JSON.stringify({ note: "a".repeat(5_400), password: "NO_END_SECRET" });
  parser.ingest(lines([
    `--> POST https://example.test/request (${Buffer.byteLength(payload)}-byte body)`,
    "Content-Type: application/json", "", payload.slice(0, 4_000), payload.slice(4_000),
    "<-- 200 https://example.test/request (1ms)", "<-- END HTTP (0-byte body)",
  ]));
  const request = parser.snapshot().requests[0];
  assert.equal(request.requestBody.state, "withheld");
  assert.match(request.warnings.join(" "), /Request END marker was not captured/);
  assert.doesNotMatch(JSON.stringify(request), /NO_END_SECRET/);
});

test("keeps overlapping threads, processes, and successive requests on one thread separate", () => {
  const parser = new HttpLogParser("parallel");
  parser.ingest(lines(["--> GET https://example.test/first", "--> END GET"], "20", "10"));
  parser.ingest(lines(["--> GET https://example.test/second", "--> END GET"], "21", "10"));
  parser.ingest(lines(["--> GET https://example.test/other-process", "--> END GET"], "20", "11"));
  parser.ingest(lines(["<-- 404 https://example.test/second (2ms)", "", '{"route":2}', "<-- END HTTP (11-byte body)"], "21", "10"));
  parser.ingest(lines(["<-- 200 https://example.test/first (7ms)", "", '{"route":1}', "<-- END HTTP (11-byte body)"], "20", "10"));
  parser.ingest(lines(["<-- 201 https://example.test/other-process (3ms)", "<-- END HTTP"], "20", "11"));
  parser.ingest(lines(["--> GET https://example.test/third", "--> END GET", "<-- 204 https://example.test/third (9ms)", "<-- END HTTP (0-byte body)"], "20", "10"));
  const requests = parser.snapshot().requests;
  assert.deepEqual(requests.map((request) => request.statusCode), [200, 404, 201, 204]);
  assert.deepEqual(requests.map((request) => request.state), ["complete", "complete", "complete", "complete"]);
  assert.equal(JSON.parse(requests[0].responseBody.text).route, 1);
  assert.equal(JSON.parse(requests[1].responseBody.text).route, 2);
  assert.equal(requests[3].id, "parallel:4");
  assert.equal(requests[3].requestBody.state, "not_captured");
  assert.deepEqual(requests[3].responseBody, { text: "", bytes: 0, state: "complete" });
});

test("marks any shortage against an explicit body length as truncated", () => {
  const parser = new HttpLogParser("short-body");
  parser.ingest(lines([
    "--> GET https://example.test/partial", "--> END GET",
    "<-- 200 https://example.test/partial (1ms)", "", '{"ok":true}',
    "<-- END HTTP (13-byte body)",
  ]));
  const request = parser.snapshot().requests[0];
  assert.equal(request.state, "complete");
  assert.equal(request.responseBody.state, "truncated");
  assert.equal(request.responseBody.bytes, 13);
  assert.match(request.warnings.join(" "), /shorter/);
});

test("supports BASIC and omitted body variants without inventing unlogged bodies", () => {
  const parser = new HttpLogParser("variants");
  parser.ingest(lines([
    "--> POST https://example.test/basic (144-byte body)",
    "<-- 200 OK https://example.test/basic (12ms, 256-byte body)",
    "--> POST https://example.test/binary",
    "--> END POST (binary 17-byte body omitted)",
    "<-- 200 https://example.test/binary (2ms)",
    "<-- END HTTP (encoded body omitted)",
    "--> GET https://example.test/unknown",
    "<-- 200 https://example.test/unknown (1ms, unknown-length body)",
  ]));
  const [basic, binary, unknown] = parser.snapshot().requests;
  assert.equal(basic.state, "complete");
  assert.deepEqual(basic.requestBody, { text: "", bytes: 144, state: "not_captured" });
  assert.deepEqual(basic.responseBody, { text: "", bytes: 256, state: "not_captured" });
  assert.equal(binary.requestBody.state, "omitted");
  assert.equal(binary.requestBody.bytes, 17);
  assert.equal(binary.responseBody.state, "omitted");
  assert.equal(unknown.state, "complete");
  assert.equal(unknown.responseBody.state, "not_captured");
});

test("records transport failures and never pairs orphan or mismatched responses", () => {
  const parser = new HttpLogParser("errors");
  parser.ingest(lines([
    "<-- 200 https://example.test/orphan (1ms)",
    "<-- END HTTP",
    "--> GET https://example.test/failed",
    "--> END GET",
    "<-- HTTP FAILED: java.io.IOException: timeout https://example.test/failed?token=ERROR_SECRET",
    "--> GET https://example.test/expected",
    "--> END GET",
    "<-- 200 https://example.test/someone-else (2ms)",
    "Content-Type: application/json", "", '{"mustNotAttach":true}', "<-- END HTTP",
  ]));
  const snapshot = parser.snapshot();
  assert.equal(snapshot.requests.length, 2);
  assert.equal(snapshot.requests[0].state, "failed");
  assert.equal(snapshot.requests[0].statusCode, null);
  assert.equal(snapshot.requests[0].responseBody.state, "not_captured");
  assert.doesNotMatch(snapshot.requests[0].error!, /ERROR_SECRET/);
  assert.equal(snapshot.requests[1].state, "incomplete");
  assert.equal(snapshot.requests[1].statusCode, null);
  assert.equal(snapshot.requests[1].responseBody.text, "");
  assert.ok(snapshot.ignoredLines >= 7);
});

test("quarantines nested same-thread requests without affecting other threads", () => {
  const parser = new HttpLogParser("nested");
  parser.ingest(lines([
    "--> GET https://example.test/one", "--> END GET",
    "--> GET https://example.test/two", "--> END GET",
    "<-- 200 https://example.test/two (1ms)", "<-- END HTTP",
    "<-- 200 https://example.test/one (2ms)", "<-- END HTTP",
    "--> GET https://example.test/three", "--> END GET",
    "<-- 200 https://example.test/three (1ms)", "<-- END HTTP",
  ]));
  parser.ingest(lines([
    "--> GET https://example.test/other-thread", "--> END GET",
    "<-- 200 https://example.test/other-thread (1ms)", "<-- END HTTP",
  ], "21"));
  const requests = parser.snapshot().requests;
  assert.deepEqual(requests.map((request) => request.state), ["incomplete", "incomplete", "incomplete", "complete"]);
  assert.deepEqual(requests.slice(0, 3).map((request) => request.statusCode), [null, null, null]);
  assert.match(requests[0].warnings.join(" "), /Overlapping/);
});

test("a rejected oversized URL start leaves a tombstone rather than assigning its failure to an earlier request", () => {
  const parser = new HttpLogParser("url-gap");
  parser.ingest(lines([
    "--> GET https://example.test/before-gap", "--> END GET",
    `--> GET https://example.test/${"x".repeat(8_200)}`,
    "<-- HTTP FAILED: failure belongs to the rejected request",
    "--> GET https://example.test/after-gap", "--> END GET",
    "<-- 200 https://example.test/after-gap (1ms)", "<-- END HTTP",
  ]));
  parser.ingest(lines([
    "--> GET https://example.test/unaffected", "<-- 200 https://example.test/unaffected (1ms, 0-byte body)",
  ], "21"));
  const snapshot = parser.snapshot();
  assert.equal(snapshot.droppedRequests, 1);
  assert.deepEqual(snapshot.requests.map((request) => request.state), ["incomplete", "incomplete", "complete"]);
  assert.deepEqual(snapshot.requests.slice(0, 2).map((request) => [request.statusCode, request.error]), [[null, null], [null, null]]);
  assert.match(snapshot.requests[0].warnings.join(" "), /tracking gap/);

  const noPreviousRequest = new HttpLogParser("first-url-gap");
  noPreviousRequest.ingest(lines([
    `--> GET https://example.test/${"x".repeat(8_200)}`,
    "--> GET https://example.test/same-thread",
    "<-- 200 https://example.test/same-thread (1ms, 0-byte body)",
  ]));
  assert.equal(noPreviousRequest.snapshot().requests[0].state, "incomplete");
});

test("evicting a pending request keeps a tombstone against later same-thread same-URL responses", () => {
  const parser = new HttpLogParser("eviction-gap");
  parser.ingest(lines(["--> GET https://example.test/reused", "--> END GET"], "20"));
  for (let index = 0; index < 500; index += 1) {
    parser.ingest(lines([
      `--> GET https://example.test/filler/${index}`,
      `<-- 200 https://example.test/filler/${index} (1ms, 0-byte body)`,
    ], "21"));
  }
  assert.equal(parser.snapshot().droppedRequests, 1);
  parser.ingest(lines([
    "--> GET https://example.test/reused", "--> END GET",
    "<-- 200 https://example.test/reused (99ms)", "", '{"from":"old-request"}', "<-- END HTTP",
    "<-- HTTP FAILED: old request failure",
  ], "20"));
  const snapshot = parser.snapshot();
  assert.equal(snapshot.requests.length, 500);
  assert.equal(snapshot.droppedRequests, 2);
  const request = snapshot.requests.find((item) => item.tid === "20")!;
  assert.equal(request.id, "eviction-gap:502");
  assert.equal(request.state, "incomplete");
  assert.equal(request.statusCode, null);
  assert.equal(request.durationMs, null);
  assert.equal(request.error, null);
  assert.equal(request.responseBody.text, "");
  assert.match(request.warnings.join(" "), /tracking gap/);
});

test("saturating thread tracking disables matching instead of forgetting a blocked or pending lane", () => {
  for (const overflowPath of ["overflow", "x".repeat(8_200)]) {
    const parser = new HttpLogParser("lane-limit");
    for (let index = 0; index < 500; index += 1) {
      parser.ingest(lines([`--> GET https://example.test/${index}`, "--> END GET"], String(index)));
    }
    parser.ingest(lines([`--> GET https://example.test/${overflowPath}`, "--> END GET"], "new-thread"));
    parser.ingest(lines([
      "<-- HTTP FAILED: delayed failure",
      "--> GET https://example.test/0", "--> END GET",
      "<-- 200 https://example.test/0 (99ms, 0-byte body)",
    ], "0"));
    const snapshot = parser.snapshot();
    assert.equal(snapshot.requests.length, 500);
    assert.equal(snapshot.droppedRequests, 2);
    assert.ok(snapshot.requests.every((request) => request.state === "incomplete"));
    assert.ok(snapshot.requests.every((request) => request.statusCode === null && request.error === null));
    assert.ok(snapshot.requests.every((request) => request.warnings.some((warning) => /tracking limit/.test(warning))));
  }
});

test("withheld plain-text and malformed JSON bodies never claim complete body availability", () => {
  const parser = new HttpLogParser("withheld");
  parser.ingest(lines([
    "--> GET https://example.test/plain", "--> END GET",
    "<-- 200 https://example.test/plain (1ms)", "Content-Type: text/plain", "", "ok", "<-- END HTTP (2-byte body)",
    "--> POST https://example.test/malformed", "Content-Type: application/json", "", '{"password":"SECRET', "--> END POST",
    "<-- 201 https://example.test/malformed (1ms)", "<-- END HTTP",
  ]));
  const snapshot = parser.snapshot();
  assert.equal(snapshot.requests[0].state, "complete");
  assert.equal(snapshot.requests[0].responseBody.state, "withheld");
  assert.equal(snapshot.requests[1].requestBody.state, "withheld");
  assert.match(snapshot.requests[0].warnings.join(" "), /response body was withheld/);
  assert.match(snapshot.requests[1].warnings.join(" "), /request body was withheld/);
  assert.doesNotMatch(JSON.stringify(snapshot), /SECRET/);
  const exported = JSON.parse(buildNetworkCaptureExport({
    session_id: "withheld", device_serial: "synthetic-device", package_name: "test.synthetic.app", pid: "10", started_at_ms: 100,
  }, snapshot, { droppedLines: 0, status: "stopped", exportedAtMs: 200 }));
  assert.equal(exported.requests[0].responseBody.state, "withheld");
  assert.equal(exported.requests[1].requestBody.state, "withheld");
  assert.match(exported.requests[0].warnings.join(" "), /response body was withheld/);
});

test("a pending malformed fragment can become a safely masked complete body in a later snapshot", () => {
  const parser = new HttpLogParser("pending-withheld");
  parser.ingest(lines([
    "--> POST https://example.test/incremental", "Content-Type: application/json", "", '{"password":',
  ]));
  const pending = parser.snapshot().requests[0];
  assert.equal(pending.state, "pending");
  assert.equal(pending.requestBody.state, "withheld");
  assert.match(pending.warnings.join(" "), /request body was pending before masking/);
  parser.ingest(lines(['"SYNTHETIC_SECRET"}', "--> END POST"]));
  const completedBody = parser.snapshot().requests[0];
  assert.equal(completedBody.requestBody.state, "complete");
  assert.deepEqual(JSON.parse(completedBody.requestBody.text), { password: "[REDACTED]" });
  assert.ok(!completedBody.warnings.some((warning) => /withheld|before masking/.test(warning)));
  assert.doesNotMatch(JSON.stringify(completedBody), /SYNTHETIC_SECRET/);
});

test("masks nested JSON, forms, malformed partial payloads and OAuth URL credentials", () => {
  const parser = new HttpLogParser("privacy");
  parser.ingest(lines([
    "--> POST https://example.test/callback?code=OAUTH_SECRET&state=CSRF_SECRET&view=month",
    "X-API-Key: API_SECRET",
    "Content-Type: application/json",
    "",
    '{"items":[{"accessToken":"NESTED_SECRET","ok":true}],"nested":{"client_secret":"CLIENT_SECRET"}}',
    "--> END POST",
    "<-- 200 https://example.test/callback?code=OAUTH_SECRET&state=CSRF_SECRET&view=month (1ms)",
    "Content-Type: application/json", "", '{"password":"PARTIAL_SECRET',
  ]));
  assert.doesNotMatch(JSON.stringify(parser.snapshot()), /OAUTH_SECRET|CSRF_SECRET|API_SECRET|NESTED_SECRET|CLIENT_SECRET|PARTIAL_SECRET/);
  parser.finish("Device disconnected");
  const request = parser.snapshot().requests[0];
  assert.equal(request.responseBody.state, "withheld");
  assert.match(request.warnings.join(" "), /response body was truncated before masking/);
  assert.match(request.responseBody.text, /withheld/);
  assert.deepEqual(JSON.parse(request.requestBody.text), {
    items: [{ accessToken: "[REDACTED]", ok: true }], nested: { client_secret: "[REDACTED]" },
  });

  const formParser = new HttpLogParser("forms");
  formParser.ingest(lines([
    "--> POST https://example.test/login", "Content-Type: application/x-www-form-urlencoded", "",
    "name=Kai&password=FORM_SECRET&api_key=API_FORM_SECRET", "--> END POST",
  ]));
  const form = new URLSearchParams(formParser.snapshot().requests[0].requestBody.text);
  assert.equal(form.get("name"), "Kai");
  assert.equal(form.get("password"), "[REDACTED]");
  assert.equal(form.get("api_key"), "[REDACTED]");

  const malformed = new HttpLogParser("malformed-form");
  malformed.ingest(lines([
    "--> POST https://example.test/login", "Content-Type: application/x-www-form-urlencoded", "",
    "password=FORM_PARTIAL_SECRET&name=%E", "--> END POST",
  ]));
  assert.doesNotMatch(JSON.stringify(malformed.snapshot()), /FORM_PARTIAL_SECRET/);
  assert.match(malformed.snapshot().requests[0].requestBody.text, /withheld/);
});

test("masks escaped credential fields inside JSON header metadata", () => {
  const parser = new HttpLogParser("header-json");
  parser.ingest(lines([
    "--> GET https://example.test/metadata",
    'X-Metadata: {"p\\u0061ssword":"ESCAPED_HEADER_SECRET","version":1}',
    'X-Partial-Metadata: {"password":"MALFORMED_HEADER_SECRET',
    "--> END GET",
  ]));
  const snapshot = parser.snapshot();
  assert.doesNotMatch(JSON.stringify(snapshot), /ESCAPED_HEADER_SECRET|MALFORMED_HEADER_SECRET/);
  assert.deepEqual(JSON.parse(snapshot.requests[0].requestHeaders[0].value), { password: "[REDACTED]", version: 1 });
});

test("does not confirm a request body when its END marker is missing", () => {
  const parser = new HttpLogParser("missing-end");
  parser.ingest(lines([
    "--> POST https://example.test/post", "Content-Type: application/json", "", '{"a":1}',
    "<-- 201 https://example.test/post (2ms)", "<-- END HTTP",
  ]));
  const request = parser.snapshot().requests[0];
  assert.equal(request.state, "complete");
  assert.equal(request.requestBody.state, "truncated");
  assert.match(request.warnings.join(" "), /Request END/);
});

test("bounds retained requests, individual bodies, and total body memory", () => {
  const limited = new HttpLogParser("limits");
  limited.ingest(lines([
    "--> POST https://example.test/large", "Content-Type: application/json", "",
    `{"password":"OVERSIZE_SECRET","text":"${"a".repeat(70_000)}"}`,
    "--> END POST (70100-byte body)",
    "<-- 200 https://example.test/large (1ms)", "<-- END HTTP",
  ]));
  const large = limited.snapshot().requests[0];
  assert.equal(large.requestBody.state, "withheld");
  assert.match(large.warnings.join(" "), /memory limit/);
  assert.ok(Buffer.byteLength(large.requestBody.text) <= 65_536);
  assert.doesNotMatch(JSON.stringify(large), /OVERSIZE_SECRET/);

  const retained = new HttpLogParser("retained");
  for (let index = 0; index < 510; index += 1) {
    retained.ingest(lines([`--> GET https://example.test/${index}`, `<-- 200 https://example.test/${index} (1ms, 0-byte body)`]));
  }
  assert.equal(retained.snapshot().requests.length, 500);
  assert.equal(retained.snapshot().droppedRequests, 10);
  assert.equal(retained.snapshot().requests[0].id, "retained:11");

  const total = new HttpLogParser("total");
  for (let index = 0; index < 80; index += 1) {
    total.ingest(lines([
      `--> POST https://example.test/${index}`, "Content-Type: application/json", "",
      `{"data":"${"a".repeat(60_000)}"}`, "--> END POST",
      `<-- 200 https://example.test/${index} (1ms)`, "<-- END HTTP",
    ]));
  }
  const snapshot = total.snapshot();
  assert.equal(snapshot.requests.length, 80);
  assert.ok(snapshot.requests.some((request) => request.requestBody.state === "truncated"));
  assert.ok(snapshot.requests.every((request) => Buffer.byteLength(request.requestBody.text) <= 65_536));
});

test("bounds the masked representation even when redaction expands many small values", () => {
  const parser = new HttpLogParser("expanded");
  parser.ingest(lines([
    "--> POST https://example.test/many-tokens", "Content-Type: application/json", "",
    `[${'{"token":1},'.repeat(4_000)}{"ok":true}]`, "--> END POST",
  ]));
  const snapshot = parser.snapshot();
  const body = snapshot.requests[0].requestBody;
  assert.ok(Buffer.byteLength(body.text) <= 65_536);
  assert.equal(body.state, "truncated");
  const exported = JSON.parse(buildNetworkCaptureExport({
    session_id: "expanded", device_serial: "synthetic-device", package_name: "test.synthetic.app", pid: "10", started_at_ms: 100,
  }, snapshot, { droppedLines: 0, status: "stopped", exportedAtMs: 200 }));
  assert.equal(exported.requests[0].requestBody.state, "withheld");
  assert.match(exported.requests[0].warnings.join(" "), /request body was truncated before masking/);
});

test("finalization is idempotent, snapshots are detached, and exports preserve loss and masking", () => {
  const parser = new HttpLogParser("export-session");
  parser.ingest(lines([
    "--> POST https://example.test/interrupted?token=EXPORT_URL_SECRET",
    "Authorization: EXPORT_HEADER_SECRET", "Content-Type: application/json", "", '{"token":"EXPORT_PARTIAL_SECRET',
  ]));
  parser.finish("Log lines lost");
  parser.finish("Second finalization must not replace the first reason");
  const snapshot = parser.snapshot();
  assert.equal(snapshot.requests[0].state, "incomplete");
  assert.equal(snapshot.requests[0].requestBody.state, "withheld");
  assert.equal(snapshot.requests[0].responseBody.state, "not_captured");
  assert.ok(snapshot.requests[0].warnings.includes("Log lines lost"));
  assert.match(snapshot.requests[0].warnings.join(" "), /request body was truncated before masking/);
  snapshot.requests[0].requestHeaders[0].value = "MUTATED_SECRET";
  snapshot.requests[0].requestBody.text = '{"password":"INJECTED_SECRET"}';
  snapshot.requests[0].warnings.push("Not in the parser");
  assert.equal(parser.snapshot().requests[0].requestHeaders[0].value, "[REDACTED]");
  assert.ok(parser.snapshot().requests[0].warnings.includes("Log lines lost"));
  assert.ok(!parser.snapshot().requests[0].warnings.includes("Not in the parser"));
  parser.ingest(lines(["--> GET https://example.test/too-late"]));
  assert.equal(parser.snapshot().requests.length, 1);
  assert.equal(parser.snapshot().ignoredLines, 1);

  const exported = buildNetworkCaptureExport({
    session_id: "export-session", device_serial: "synthetic-device", package_name: "test.synthetic.app", pid: "10", started_at_ms: 100,
  }, snapshot, { droppedLines: 3, status: "error", exportedAtMs: 200 });
  const payload = JSON.parse(exported);
  assert.equal(payload.schema_version, 1);
  assert.equal(payload.source, "okhttp_logcat");
  assert.equal(payload.capture.package_name, "test.synthetic.app");
  assert.equal(payload.exported_at_ms, 200);
  assert.equal(payload.status, "error");
  assert.equal(payload.dropped_lines, 3);
  assert.equal(payload.redaction.enabled, true);
  assert.equal(payload.limits.body_bytes, 65_536);
  assert.equal(payload.requests[0].state, "incomplete");
  assert.doesNotMatch(exported, /EXPORT_URL_SECRET|EXPORT_HEADER_SECRET|EXPORT_PARTIAL_SECRET|MUTATED_SECRET|INJECTED_SECRET/);
  assert.match(payload.warnings.join(" "), /incomplete/);
});
