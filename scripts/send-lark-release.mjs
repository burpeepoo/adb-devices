import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

const LARK_BASE_URL = process.env.LARK_BASE_URL || "https://open.feishu.cn";
const REQUIRED_ENVS = [
  "LARK_APP_ID",
  "LARK_APP_SECRET",
  "LARK_RECEIVE_ID",
  "LARK_RECEIVE_ID_TYPE",
];
const TARGET_EXTENSIONS = new Set([".dmg", ".exe"]);

function env(name) {
  return process.env[name]?.trim() || "";
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

async function collectReleaseFiles(paths) {
  const files = new Map();

  async function visit(path) {
    const absolutePath = resolve(path);
    const entryStat = await stat(absolutePath);

    if (entryStat.isDirectory()) {
      if (absolutePath.toLowerCase().endsWith(".app")) return;

      const entries = await readdir(absolutePath);
      await Promise.all(entries.map((entry) => visit(join(absolutePath, entry))));
      return;
    }

    if (!entryStat.isFile()) return;

    const extension = extname(absolutePath).toLowerCase();
    if (!TARGET_EXTENSIONS.has(extension)) return;
    if (entryStat.size <= 0) return;

    files.set(absolutePath, {
      path: absolutePath,
      name: basename(absolutePath),
      size: entryStat.size,
    });
  }

  for (const path of paths) {
    await visit(path);
  }

  return [...files.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function parseLarkResponse(response, action) {
  const text = await response.text();
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${action} failed: HTTP ${response.status} ${text}`);
  }

  if (!response.ok || payload.code !== 0) {
    const message = payload.msg || payload.message || text;
    throw new Error(`${action} failed: HTTP ${response.status}, code ${payload.code}, ${message}`);
  }

  return payload;
}

async function getTenantAccessToken() {
  const response = await fetch(`${LARK_BASE_URL}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: env("LARK_APP_ID"),
      app_secret: env("LARK_APP_SECRET"),
    }),
  });
  const payload = await parseLarkResponse(response, "Get tenant access token");
  return payload.tenant_access_token;
}

async function sendMessage(token, message) {
  const response = await fetch(
    `${LARK_BASE_URL}/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(
      env("LARK_RECEIVE_ID_TYPE"),
    )}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        receive_id: env("LARK_RECEIVE_ID"),
        msg_type: message.type,
        content: JSON.stringify(message.content),
      }),
    },
  );

  await parseLarkResponse(response, `Send ${message.type} message`);
}

async function uploadFile(token, file) {
  const buffer = await readFile(file.path);
  const form = new FormData();
  form.append("file_type", "stream");
  form.append("file_name", file.name);
  form.append("file", new Blob([buffer]), file.name);

  const response = await fetch(`${LARK_BASE_URL}/open-apis/im/v1/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const payload = await parseLarkResponse(response, `Upload ${file.name}`);
  return payload.data.file_key;
}

function buildReleaseText(files) {
  const repo = env("GITHUB_REPOSITORY") || "local";
  const ref = env("GITHUB_REF_NAME") || env("GITHUB_SHA") || "manual";
  const runUrl =
    env("GITHUB_SERVER_URL") && env("GITHUB_REPOSITORY") && env("GITHUB_RUN_ID")
      ? `${env("GITHUB_SERVER_URL")}/${env("GITHUB_REPOSITORY")}/actions/runs/${env("GITHUB_RUN_ID")}`
      : "";
  const fileLines = files.map((file) => `- ${file.name} (${formatBytes(file.size)})`).join("\n");

  return [
    `ADB Manager release artifacts are ready.`,
    `Repository: ${repo}`,
    `Ref: ${ref}`,
    runUrl ? `Run: ${runUrl}` : "",
    `Files:\n${fileLines}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function main() {
  const inputs = process.argv.slice(2);
  if (inputs.length === 0) {
    throw new Error("Pass at least one release artifact file or directory.");
  }

  const files = await collectReleaseFiles(inputs);
  if (files.length === 0) {
    throw new Error("No .dmg or .exe release artifacts were found.");
  }

  if (env("LARK_DRY_RUN") === "true") {
    console.log(buildReleaseText(files));
    console.log("Dry run only. No Feishu messages were sent.");
    return;
  }

  const missingEnvs = REQUIRED_ENVS.filter((name) => !env(name));
  if (missingEnvs.length > 0) {
    console.log(`Skip Lark delivery. Missing env/secrets: ${missingEnvs.join(", ")}`);
    return;
  }

  const token = await getTenantAccessToken();
  await sendMessage(token, { type: "text", content: { text: buildReleaseText(files) } });

  for (const file of files) {
    const fileKey = await uploadFile(token, file);
    await sendMessage(token, { type: "file", content: { file_key: fileKey } });
    console.log(`Sent ${file.name} to Lark.`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
