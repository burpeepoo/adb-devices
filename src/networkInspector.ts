export interface NetworkLogLine {
  timestamp: string;
  pid: string;
  tid: string;
  message: string;
}

export interface NetworkCaptureInfo {
  session_id: string;
  device_serial: string;
  package_name: string;
  pid: string;
  started_at_ms: number;
}

interface NetworkHeader {
  name: string;
  value: string;
}

interface NetworkBody {
  text: string;
  state: "pending" | "complete" | "omitted" | "not_captured" | "truncated" | "withheld";
  bytes: number | null;
}

export interface NetworkRequest {
  id: string;
  pid: string;
  tid: string;
  startedAt: string;
  method: string;
  url: string;
  statusCode: number | null;
  durationMs: number | null;
  state: "pending" | "complete" | "failed" | "incomplete";
  requestHeaders: NetworkHeader[];
  responseHeaders: NetworkHeader[];
  requestBody: NetworkBody;
  responseBody: NetworkBody;
  error: string | null;
  warnings: string[];
}

export interface NetworkParserSnapshot {
  requests: NetworkRequest[];
  droppedRequests: number;
  ignoredLines: number;
}

const MAX_REQUESTS = 500;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_TOTAL_BODY_BYTES = 4 * 1024 * 1024;
const MAX_HEADERS = 100;
const MAX_HEADER_BYTES = 4096;
const MAX_URL_LENGTH = 8192;
// OkHttp's Android logger splits each original line at 4000 UTF-16 code units.
const ANDROID_LOG_CHUNK_LENGTH = 4000;
const REDACTED = "[REDACTED]";
const WITHHELD_BODY = "[Body withheld: incomplete, malformed, or unstructured content]";
const TRACKING_GAP_WARNING = "Request tracking gap on this thread; matching is disabled until a new capture.";
const TRACKING_LIMIT_WARNING = "Request tracking limit was reached; matching is disabled until a new capture.";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const sensitiveNames = new Set([
  "auth", "authorization", "proxyauthorization", "credential", "credentials",
  "key", "apikey", "xapikey", "token", "accesstoken", "refreshtoken", "idtoken",
  "password", "passwd", "passphrase", "pwd", "secret", "clientsecret", "cookie",
  "setcookie", "session", "sessionid", "jwt", "signature", "sig", "csrf", "xsrf",
]);

function sensitiveName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return sensitiveNames.has(normalized)
    || /(?:token|secret|password|credential|apikey|authorization|cookie|signature)$/.test(normalized);
}

function redactUrl(input: string): string {
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "[URL unavailable]";
    url.username = "";
    url.password = "";
    const entries = [...url.searchParams.entries()];
    url.search = "";
    for (const [key, value] of entries) {
      const oauthField = /^(?:code|state|auth_?code|authorization_?code)$/i.test(key);
      url.searchParams.append(key, sensitiveName(key) || oauthField ? REDACTED : redactText(value));
    }
    if (url.hash) url.hash = REDACTED;
    return url.toString();
  } catch {
    // Keeping an invalid URL can leak a partially captured userinfo/query secret.
    return "[URL unavailable]";
  }
}

function redactText(input: string): string {
  // Fail closed for unstructured credential assignments, including unterminated
  // strings. Regex replacement of just a guessed value is unsafe after log loss.
  const assignments = input.matchAll(/(?:^|[^a-z0-9_.-])["']?([a-z][a-z0-9_.-]{0,127})["']?\s*[:=]/gi);
  for (const match of assignments) {
    if (sensitiveName(match[1])) return "[Text withheld: credential field]";
  }
  return input
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => redactUrl(url))
    .replace(/\b(Bearer|Basic)\s+[^\s,;"']+/gi, `$1 ${REDACTED}`)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED);
}

function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      sensitiveName(key) ? REDACTED : redactJson(item),
    ]));
  }
  return typeof value === "string" ? redactText(value) : value;
}

function redactBody(text: string, headers: NetworkHeader[]): string {
  if (!text) return "";
  if (text === WITHHELD_BODY) return text;
  try {
    return JSON.stringify(redactJson(JSON.parse(text)));
  } catch {
    const contentType = headers.find((header) => header.name.toLowerCase() === "content-type")?.value ?? "";
    if (/application\/x-www-form-urlencoded/i.test(contentType) && !/[\r\n]/.test(text)) {
      const fields = text.split("&");
      try {
        const pairs = fields.map((field) => {
          const separator = field.indexOf("=");
          if (separator < 1) throw new Error("Incomplete form field");
          const key = decodeURIComponent(field.slice(0, separator).replace(/\+/g, " "));
          const value = decodeURIComponent(field.slice(separator + 1).replace(/\+/g, " "));
          return [key, sensitiveName(key) ? REDACTED : redactText(value)];
        });
        return new URLSearchParams(pairs).toString();
      } catch {
        return WITHHELD_BODY;
      }
    }
    // Calendar's verified payloads are JSON. Opaque and malformed payloads stay
    // withheld rather than promising that a partial credential was masked.
    return WITHHELD_BODY;
  }
}

function safeHeaderValue(name: string, value: string): string {
  if (sensitiveName(name)) return REDACTED;
  if (value === REDACTED || value === WITHHELD_BODY || value === "[Text withheld: credential field]") return value;
  if (/^\s*[\[{]/.test(value)) {
    return redactBody(value, []);
  }
  return redactText(value);
}

function safeHeaders(headers: NetworkHeader[]): NetworkHeader[] {
  return headers.map(({ name, value }) => ({ name, value: safeHeaderValue(name, value) }));
}

function utf8Prefix(text: string, maxBytes: number): string {
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) return text;
  let end = Math.max(0, maxBytes);
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return decoder.decode(bytes.subarray(0, end));
}

function safeBody(body: NetworkBody, raw: string, headers: NetworkHeader[]): NetworkBody {
  const masked = redactBody(raw, headers);
  if (masked === WITHHELD_BODY) return { ...body, text: masked, state: "withheld" };
  const text = utf8Prefix(masked, MAX_BODY_BYTES);
  return { ...body, text, state: text.length < masked.length ? "truncated" : body.state };
}

type Direction = "request" | "response";

function bodyDisplayWarnings(direction: Direction, original: NetworkBody, displayed: NetworkBody): string[] {
  if (displayed.state === "withheld") {
    const warnings = [`${direction} body was withheld because it could not be safely masked.`];
    if (original.state === "truncated") warnings.push(`${direction} body was truncated before masking.`);
    if (original.state === "pending") warnings.push(`${direction} body was pending before masking.`);
    return warnings;
  }
  if (displayed.state === "truncated" && original.state !== "truncated") {
    return [`${direction} body display was truncated after masking.`];
  }
  return [];
}

interface BodyBuffer {
  raw: string;
  byteLength: number;
  chunkBreaks: number[];
  previousLineLength: number;
  seen: boolean;
  inBody: boolean;
  ended: boolean;
}
interface RequestBuffer {
  record: NetworkRequest;
  rawUrl: string;
  phase: "request" | "waiting" | "response";
  request: BodyBuffer;
  response: BodyBuffer;
}

function emptyBodyBuffer(): BodyBuffer {
  return { raw: "", byteLength: 0, chunkBreaks: [], previousLineLength: 0, seen: false, inBody: false, ended: false };
}

function reassembleChunkedJson(body: BodyBuffer, declaredLength: number | null): string | null {
  // A 4000-character line can also end in a real newline. Only remove separators
  // when the logger's exact byte count accounts for every candidate boundary.
  if (declaredLength === null || body.chunkBreaks.length === 0
    || body.byteLength - declaredLength !== body.chunkBreaks.length) return null;
  const parts: string[] = [];
  let start = 0;
  for (const boundary of body.chunkBreaks) {
    parts.push(body.raw.slice(start, boundary));
    start = boundary + 1;
  }
  parts.push(body.raw.slice(start));
  const reconstructed = parts.join("");
  try {
    JSON.parse(reconstructed);
    return reconstructed;
  } catch {
    return null;
  }
}

function addWarning(record: NetworkRequest, warning: string): void {
  if (!record.warnings.includes(warning)) record.warnings.push(warning);
}

function declaredBytes(message: string): number | null {
  const match = message.match(/(?:\(|,\s*|\s)(\d+)-byte(?:\s|,)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

function duration(message: string): number | null {
  const match = message.match(/\((\d+(?:\.\d+)?)ms(?:,|\))/);
  return match ? Number(match[1]) : null;
}

/** Parses only synchronous OkHttp logger blocks; it does not capture packets. */
export class HttpLogParser {
  private readonly sessionId: string;
  private sequence = 0;
  private records: RequestBuffer[] = [];
  private readonly lanes = new Map<string, RequestBuffer | "ambiguous" | "gap">();
  private matchingDisabled = false;
  private totalBodyBytes = 0;
  private droppedRequests = 0;
  private ignoredLines = 0;
  private finished = false;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  ingest(lines: NetworkLogLine[]): void {
    if (this.finished) {
      this.ignoredLines += lines.length;
      return;
    }
    for (const line of lines) {
      for (const message of line.message.split(/\r?\n/)) this.ingestLine({ ...line, message });
    }
  }

  snapshot(): NetworkParserSnapshot {
    return {
      requests: this.records.map((buffer) => this.safeRecord(buffer)),
      droppedRequests: this.droppedRequests,
      ignoredLines: this.ignoredLines,
    };
  }

  finish(reason = "Capture stopped before all HTTP log blocks completed."): void {
    if (this.finished) return;
    this.finished = true;
    for (const buffer of this.records) {
      if (buffer.record.state === "pending") this.interrupt(buffer, redactText(reason));
    }
    this.lanes.clear();
  }

  private ingestLine(line: NetworkLogLine): void {
    const message = line.message;
    const key = `${line.pid}:${line.tid}`;
    const start = message.match(/^-->\s+([A-Z][A-Z0-9_-]*)\s+(https?:\/\/\S+)(?:\s+.*)?$/);
    if (start) {
      if (start[2].length > MAX_URL_LENGTH) {
        this.blockLaneForGap(key);
        this.droppedRequests += 1;
        this.ignoredLines += 1;
        return;
      }
      if (!this.matchingDisabled && !this.lanes.has(key) && this.lanes.size >= MAX_REQUESTS) {
        this.disableMatching();
      }
      const previous = this.lanes.get(key);
      const buffer = this.createRecord(line, start[1], start[2]);
      if (this.matchingDisabled) {
        this.interrupt(buffer, TRACKING_LIMIT_WARNING);
      } else if (previous === "gap") {
        this.interrupt(buffer, TRACKING_GAP_WARNING);
      } else if (previous) {
        const warning = "Overlapping request starts on one thread; matching is disabled for this thread until a new capture.";
        if (previous !== "ambiguous") this.interrupt(previous, warning);
        this.interrupt(buffer, warning);
        this.lanes.set(key, "ambiguous");
      } else {
        this.lanes.set(key, buffer);
        buffer.record.requestBody.bytes = declaredBytes(message);
      }
      return;
    }

    const buffer = this.lanes.get(key);
    if (!buffer || typeof buffer === "string") {
      this.ignoredLines += 1;
      return;
    }
    if (/^<--\s+HTTP FAILED:/.test(message)) {
      buffer.record.error = redactText(message.replace(/^<--\s+HTTP FAILED:\s*/, ""));
      buffer.record.state = "failed";
      this.finalizeUnavailableBodies(buffer);
      this.lanes.delete(key);
      return;
    }
    const response = message.match(/^<--\s+(\d{3})\s+(?:.*?\s+)?(https?:\/\/\S+)\s*(.*)$/);
    if (response) {
      if (buffer.phase === "response" || response[2] !== buffer.rawUrl) {
        this.interrupt(buffer, "Unmatched or duplicate response start; response was not attached to this request.");
        this.lanes.set(key, "ambiguous");
        this.ignoredLines += 1;
        return;
      }
      if (!buffer.request.ended) {
        if (buffer.request.seen || buffer.record.requestHeaders.length > 0) {
          addWarning(buffer.record, "Request END marker was not captured.");
        }
        this.endBody(buffer, "request", "");
        if (buffer.request.seen) buffer.record.requestBody.state = "truncated";
      }
      buffer.phase = "response";
      buffer.record.statusCode = Number(response[1]);
      buffer.record.durationMs = duration(response[3]);
      // BASIC logging has no following response block or END marker.
      if (/\d+-byte body\)/i.test(response[3]) || /unknown-length body\)/i.test(response[3])) {
        this.endBody(buffer, "response", response[3]);
        buffer.record.state = "complete";
        this.lanes.delete(key);
      }
      return;
    }
    const requestEnd = message.match(/^-->\s+END\s+(\S+)(?:\s|$)/);
    if (requestEnd) {
      if (buffer.phase !== "request" || requestEnd[1] !== buffer.record.method) {
        this.ignoredLines += 1;
        return;
      }
      this.endBody(buffer, "request", message);
      buffer.phase = "waiting";
      return;
    }
    if (/^<--\s+END HTTP(?:\s|$)/.test(message)) {
      if (buffer.phase !== "response") {
        this.ignoredLines += 1;
        return;
      }
      this.endBody(buffer, "response", message);
      buffer.record.durationMs = duration(message) ?? buffer.record.durationMs;
      buffer.record.state = "complete";
      this.lanes.delete(key);
      return;
    }
    if (buffer.phase === "waiting" || /^(?:-->|<--)/.test(message)) {
      this.ignoredLines += 1;
      return;
    }
    this.appendDetail(buffer, buffer.phase, message);
  }

  private createRecord(line: NetworkLogLine, method: string, rawUrl: string): RequestBuffer {
    const buffer: RequestBuffer = {
      record: {
        id: `${this.sessionId}:${++this.sequence}`,
        pid: line.pid,
        tid: line.tid,
        startedAt: line.timestamp,
        method,
        url: redactUrl(rawUrl),
        statusCode: null,
        durationMs: null,
        state: "pending",
        requestHeaders: [],
        responseHeaders: [],
        requestBody: { text: "", state: "pending", bytes: null },
        responseBody: { text: "", state: "pending", bytes: null },
        error: null,
        warnings: [],
      },
      rawUrl,
      phase: "request",
      request: emptyBodyBuffer(),
      response: emptyBodyBuffer(),
    };
    this.records.push(buffer);
    if (this.records.length > MAX_REQUESTS) {
      const removed = this.records.shift()!;
      this.totalBodyBytes -= removed.request.byteLength + removed.response.byteLength;
      const key = `${removed.record.pid}:${removed.record.tid}`;
      // A late response (including HTTP FAILED without a URL) can still belong
      // to an evicted pending request. Keep its lane blocked for this capture.
      if (this.lanes.get(key) === removed) this.lanes.set(key, "gap");
      this.droppedRequests += 1;
    }
    return buffer;
  }

  private blockLaneForGap(key: string): void {
    if (this.matchingDisabled) return;
    const previous = this.lanes.get(key);
    if (previous && typeof previous !== "string") this.interrupt(previous, TRACKING_GAP_WARNING);
    if (previous || this.lanes.size < MAX_REQUESTS) {
      this.lanes.set(key, "gap");
    } else {
      this.disableMatching();
    }
  }

  private disableMatching(): void {
    // Tombstones must not be evicted: forgetting one could attach an old
    // response to a new request on the same thread. Fail closed at the bound.
    this.matchingDisabled = true;
    for (const buffer of this.records) {
      if (buffer.record.state === "pending") this.interrupt(buffer, TRACKING_LIMIT_WARNING);
    }
    this.lanes.clear();
  }

  private appendDetail(buffer: RequestBuffer, direction: Direction, message: string): void {
    const body = buffer[direction];
    const headers = buffer.record[`${direction}Headers`];
    if (!body.inBody) {
      if (message.trim() === "") {
        body.inBody = true;
        return;
      }
      const header = message.match(/^([!#$%&'*+.^_`|~\w-]+):\s*(.*)$/);
      if (header) {
        if (headers.length >= MAX_HEADERS) {
          addWarning(buffer.record, `${direction} headers exceeded the ${MAX_HEADERS}-header limit.`);
          this.ignoredLines += 1;
        } else {
          const value = safeHeaderValue(header[1], header[2]);
          headers.push({ name: header[1], value: utf8Prefix(value, MAX_HEADER_BYTES) });
          if (encoder.encode(value).length > MAX_HEADER_BYTES) addWarning(buffer.record, "A header value was truncated.");
        }
        return;
      }
      body.inBody = true;
    }
    // Once a prefix is cut off, never append a later fragment if eviction frees
    // some global budget; joining across that gap would invent a payload.
    if (buffer.record[`${direction}Body`].state === "truncated") return;
    const addition = (body.seen ? "\n" : "") + message;
    const isChunkBoundary = body.seen && body.previousLineLength === ANDROID_LOG_CHUNK_LENGTH;
    body.seen = true;
    const room = Math.min(MAX_BODY_BYTES - body.byteLength, MAX_TOTAL_BODY_BYTES - this.totalBodyBytes);
    const text = utf8Prefix(addition, room);
    const bytes = encoder.encode(text).length;
    if (isChunkBoundary && text.length > 0) body.chunkBreaks.push(body.raw.length);
    body.raw += text;
    body.byteLength += bytes;
    body.previousLineLength = message.length;
    this.totalBodyBytes += bytes;
    if (bytes < encoder.encode(addition).length) {
      buffer.record[`${direction}Body`].state = "truncated";
      addWarning(buffer.record, `${direction} body exceeded a capture memory limit.`);
    }
  }

  private endBody(buffer: RequestBuffer, direction: Direction, marker: string): void {
    const stored = buffer[direction];
    const body = buffer.record[`${direction}Body`];
    stored.ended = true;
    body.bytes = declaredBytes(marker) ?? body.bytes;
    if (/body omitted/i.test(marker)) {
      body.state = "omitted";
      addWarning(buffer.record, `${direction} body was omitted by the HTTP logger.`);
      return;
    }
    if (body.state === "truncated") return;
    if (stored.seen) {
      const reconstructed = reassembleChunkedJson(stored, declaredBytes(marker));
      if (reconstructed !== null) {
        const bytes = encoder.encode(reconstructed).length;
        this.totalBodyBytes -= stored.byteLength - bytes;
        stored.raw = reconstructed;
        stored.byteLength = bytes;
        stored.chunkBreaks = [];
      }
      body.state = "complete";
      if (body.bytes !== null && body.bytes > stored.byteLength && !/gzipped/i.test(marker)) {
        body.state = "truncated";
        addWarning(buffer.record, `${direction} body is shorter than the logger's reported byte length.`);
      }
    } else {
      body.state = body.bytes === 0 ? "complete" : "not_captured";
    }
  }

  private finalizeUnavailableBodies(buffer: RequestBuffer): void {
    for (const direction of ["request", "response"] as const) {
      const body = buffer.record[`${direction}Body`];
      if (body.state === "pending") body.state = buffer[direction].seen ? "truncated" : "not_captured";
    }
  }

  private interrupt(buffer: RequestBuffer, reason: string): void {
    buffer.record.state = "incomplete";
    this.finalizeUnavailableBodies(buffer);
    addWarning(buffer.record, reason);
  }

  private safeRecord(buffer: RequestBuffer): NetworkRequest {
    const record = buffer.record;
    const requestHeaders = safeHeaders(record.requestHeaders);
    const responseHeaders = safeHeaders(record.responseHeaders);
    const requestBody = safeBody(record.requestBody, buffer.request.raw, requestHeaders);
    const responseBody = safeBody(record.responseBody, buffer.response.raw, responseHeaders);
    const warnings = [...new Set([
      ...record.warnings,
      ...bodyDisplayWarnings("request", record.requestBody, requestBody),
      ...bodyDisplayWarnings("response", record.responseBody, responseBody),
    ])];
    return {
      ...record,
      requestHeaders,
      responseHeaders,
      requestBody,
      responseBody,
      warnings,
    };
  }
}

export function buildNetworkCaptureExport(
  capture: NetworkCaptureInfo,
  snapshot: NetworkParserSnapshot,
  options: { droppedLines: number; status: string; exportedAtMs?: number },
): string {
  return JSON.stringify({
    schema: "cozyla.adb-manager.network-capture",
    schema_version: 1,
    source: "okhttp_logcat",
    capture: { ...capture },
    exported_at_ms: options.exportedAtMs ?? Date.now(),
    status: redactText(options.status),
    limits: {
      requests: MAX_REQUESTS,
      body_bytes: MAX_BODY_BYTES,
      total_body_bytes: MAX_TOTAL_BODY_BYTES,
      headers_per_direction: MAX_HEADERS,
    },
    redaction: {
      enabled: true,
      policy: "Credential headers, common secret fields, URL userinfo and secret query parameters are masked. Unstructured or malformed bodies are withheld.",
      limitations: "Application-specific secrets under unrecognized field names cannot be identified automatically.",
    },
    dropped_lines: options.droppedLines,
    dropped_requests: snapshot.droppedRequests,
    ignored_lines: snapshot.ignoredLines,
    warnings: options.droppedLines > 0 ? ["Log lines were lost; this export is incomplete."] : [],
    requests: snapshot.requests.map((record) => {
      const requestHeaders = safeHeaders(record.requestHeaders);
      const responseHeaders = safeHeaders(record.responseHeaders);
      const requestBody = safeBody(record.requestBody, record.requestBody.text, requestHeaders);
      const responseBody = safeBody(record.responseBody, record.responseBody.text, responseHeaders);
      return {
        ...record,
        url: redactUrl(record.url),
        requestHeaders,
        responseHeaders,
        requestBody,
        responseBody,
        error: record.error === null ? null : redactText(record.error),
        warnings: [...new Set([
          ...record.warnings.map(redactText),
          ...bodyDisplayWarnings("request", record.requestBody, requestBody),
          ...bodyDisplayWarnings("response", record.responseBody, responseBody),
        ])],
      };
    }),
  }, null, 2);
}
