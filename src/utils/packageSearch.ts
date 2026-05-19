export const normalizePackageQuery = (value: string) =>
  value
    .toLowerCase()
    .replace(/\.apk$/, "")
    .replace(/[_-]+/g, ".")
    .replace(/[^a-z0-9.]+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\./, "")
    .replace(/\.$/, "");

const packageTokens = (value: string) =>
  normalizePackageQuery(value)
    .split(".")
    .filter((token) => token.length > 1 && !/^\d+$/.test(token) && !/^v\d+$/.test(token));

export const packageMatchScore = (query: string, pkg: string) => {
  const normalizedQuery = normalizePackageQuery(query);
  const normalizedPkg = normalizePackageQuery(pkg);
  if (!normalizedQuery || !normalizedPkg) return 0;
  if (normalizedPkg === normalizedQuery) return 1000;
  if (normalizedPkg.startsWith(normalizedQuery)) return 900 - (normalizedPkg.length - normalizedQuery.length);
  if (normalizedPkg.includes(normalizedQuery)) return 800 - normalizedPkg.indexOf(normalizedQuery);

  const queryTokens = packageTokens(normalizedQuery);
  const pkgTokens = packageTokens(normalizedPkg);
  if (queryTokens.length === 0 || pkgTokens.length === 0) return 0;

  let score = 0;
  for (const token of queryTokens) {
    if (pkgTokens.includes(token)) {
      score += 120;
    } else if (pkgTokens.some((pkgToken) => pkgToken.includes(token) || token.includes(pkgToken))) {
      score += 60;
    }
  }

  const lastToken = queryTokens[queryTokens.length - 1];
  if (lastToken) {
    if (pkgTokens.includes(lastToken)) score += 120;
    if (normalizedPkg.endsWith(`.${lastToken}`)) score += 160;
  }

  const includedTokenCount = queryTokens.filter((token) => normalizedPkg.includes(token)).length;
  score += Math.round((includedTokenCount / queryTokens.length) * 80);
  return score;
};

export const rankedPackages = (packages: string[], query: string, limit = 30) => {
  const normalizedQuery = normalizePackageQuery(query);
  if (normalizedQuery.length < 2 || limit <= 0) return [];

  const best: { pkg: string; score: number }[] = [];

  for (const pkg of packages) {
    const score = packageMatchScore(normalizedQuery, pkg);
    if (score <= 0) continue;

    const next = { pkg, score };
    const insertIndex = best.findIndex(
      (item) => score > item.score || (score === item.score && pkg.localeCompare(item.pkg) < 0),
    );

    if (insertIndex === -1) {
      if (best.length < limit) {
        best.push(next);
      }
    } else {
      best.splice(insertIndex, 0, next);
      if (best.length > limit) {
        best.pop();
      }
    }
  }

  return best.map((item) => item.pkg);
};
