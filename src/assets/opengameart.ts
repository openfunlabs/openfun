import type { Asset } from "./library.js";

const text = (s: string) =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCodePoint(Math.min(Number(n), 0x10ffff)),
    )
    .replace(/\s+/g, " ")
    .trim();
function field(html: string, name: string) {
  const marker = `field-name-${name} `;
  const start = html.indexOf(marker);
  if (start < 0) return "";
  const end = html.indexOf('class="field field-name-', start + marker.length);
  return html.slice(start, end < 0 ? undefined : end);
}

/** Public Drupal pages, not an official API. Never follow preview or comment links as downloads. */
export function parseMusicSearch(html: string) {
  const results = [
    ...html.matchAll(
      /class="art-preview-title"[^>]*>\s*<a href="\/content\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,119})"[^>]*>([\s\S]*?)<\/a>/g,
    ),
  ].map((m) => ({
    provider: "opengameart",
    id: m[1]!,
    name: text(m[2]!),
    kind: "music",
    sourceUrl: `https://opengameart.org/content/${m[1]}`,
    licenseVerification:
      "Search is CC0-filtered; asset_info/download must verify the individual page.",
  }));
  if (!results.length && !/view-empty/.test(html))
    throw new Error(
      "OpenGameArt search markup was not recognized; no results were fabricated.",
    );
  return { results, hasNext: /class="pager-next"/.test(html) };
}
export function parseMusicPage(id: string, html: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(id))
    throw new Error("Invalid music ID.");
  if (
    !/href=['"]https?:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\//.test(
      field(html, "field-art-licenses"),
    )
  )
    throw new Error(
      "This music page does not offer verified CC0; automatic import is unavailable.",
    );
  if (!/>Music<\/a>/.test(field(html, "field-art-type")))
    throw new Error("This OpenGameArt entry is not music.");
  const name = text(
    field(html, "title").match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? "",
  );
  const credit = text(
    field(html, "author-submitter").match(/<a[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "",
  );
  if (!name || !credit)
    throw new Error("Music title/author metadata is missing.");
  const asset: Asset = {
    provider: "opengameart",
    id,
    name,
    kind: "music",
    tags: ["music"],
    sourceUrl: `https://opengameart.org/content/${id}`,
    license: "CC0-1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    credit,
  };
  const files = [
    ...field(html, "field-art-files").matchAll(/<a\b([^>]+)>/g),
  ].flatMap((m) => {
    const attrs = m[1]!;
    const raw = attrs.match(/href="([^"]+)"/)?.[1];
    const size = Number(attrs.match(/length=(\d+)/)?.[1]);
    if (!raw || !/\.(ogg|mp3|wav)(?:\?|$)/i.test(raw)) return [];
    const url = new URL(raw.replace(/&amp;/g, "&"));
    if (
      url.protocol !== "https:" ||
      url.host !== "opengameart.org" ||
      !url.pathname.startsWith("/sites/default/files/") ||
      url.username ||
      url.password
    )
      throw new Error("Music download is outside the supported official host.");
    const fid = attrs.match(/data-fid="(\d+)"/)?.[1];
    if (
      !fid ||
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      size > 32 * 1024 * 1024
    )
      return [];
    const ext = url.pathname.match(/\.(ogg|mp3|wav)$/i)?.[1]?.toLowerCase();
    return ext
      ? [
          {
            key: `file-${fid}`,
            path: `music-${fid}.${ext}`,
            url: url.toString(),
            size,
          },
        ]
      : [];
  });
  if (!files.length)
    throw new Error(
      "No supported individual music files below 32 MiB; choose another track. ZIP-only packs are not imported by this adapter.",
    );
  return { asset, files };
}
