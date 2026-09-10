import type { Asset } from "./library.js";

function text(html: string) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
export function kenneyAsset(
  id: string,
  name: string,
  kind: string,
  tags: string[] = [],
): Asset {
  return {
    provider: "kenney",
    id,
    name,
    kind,
    tags,
    sourceUrl: `https://kenney.nl/assets/${id}`,
    license: "CC0-1.0",
    licenseUrl: "https://kenney.nl/support",
    credit: "Assets by Kenney",
  };
}
export function parseKenneySearch(html: string) {
  const rows: Asset[] = [];
  const matches = [
    ...html.matchAll(
      /<h2\b[^>]*>\s*<a\b[^>]*href=['"]https:\/\/kenney\.nl\/assets\/([a-z0-9-]+)['"][^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi,
    ),
  ];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!,
      tail = html.slice(
        m.index! + m[0].length,
        matches[i + 1]?.index ?? m.index! + m[0].length + 1000,
      );
    const category = tail.match(
      /assets\/(?:category:|\?category=)(2D|3D|Audio|Textures)/i,
    )?.[1];
    const kind =
      category === "3D"
        ? "models"
        : category === "Audio"
          ? "audio"
          : category === "Textures"
            ? "textures"
            : "sprites";
    rows.push(kenneyAsset(m[1]!, text(m[2]!), kind));
  }
  if (!rows.length && !/No (?:results|assets)|search/i.test(html))
    throw new Error("Kenney catalog markup changed; inspect the website.");
  return rows;
}
export function parseKenneyPage(id: string, html: string) {
  const name = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const url = html.match(
    /href=['"](https:\/\/kenney\.nl\/media\/pages\/assets\/[^'"]+\.zip)['"]/i,
  )?.[1];
  // Require both the canonical site's asset page and its explicit CC0 license declaration.
  if (
    !name ||
    !url ||
    !/creativecommons\.org\/publicdomain\/zero\/1\.0/i.test(html)
  )
    throw new Error(
      "Kenney asset page has no verified CC0 ZIP download; inspect the source manually.",
    );
  const kind = html.match(/assets\/category:(2D|3D|Audio|Textures)/i)?.[1];
  const tags = [...html.matchAll(/assets\/tag:([^'"<>]+)/gi)]
    .map((m) => decodeURIComponent(m[1]!))
    .slice(0, 30);
  return {
    asset: kenneyAsset(
      id,
      text(name),
      kind === "3D"
        ? "models"
        : kind === "Audio"
          ? "audio"
          : kind === "Textures"
            ? "textures"
            : tags.includes("interface")
              ? "ui"
              : "sprites",
      tags,
    ),
    url,
  };
}
