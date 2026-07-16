function getConfig() {
  const baseUrl = process.env.WP_BASE_URL;
  const username = process.env.WP_USERNAME;
  const appPassword = process.env.WP_APP_PASSWORD;
  const defaultCategoryId = Number(process.env.WP_DEFAULT_CATEGORY_ID ?? "6");

  if (!baseUrl || !username || !appPassword) {
    throw new Error("WP_BASE_URL, WP_USERNAME and WP_APP_PASSWORD must be set");
  }
  return { baseUrl: baseUrl.replace(/\/$/, ""), username, appPassword, defaultCategoryId };
}

function authHeader(): string {
  const { username, appPassword } = getConfig();
  // WordPress Application Passwords (core feature since 5.6): Basic Auth
  // with a generated, revocable app-specific password. Never the account's
  // real password, and never hardcoded like the old n8n credential.
  return `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`;
}

async function wpFetch(path: string, init: RequestInit) {
  const { baseUrl } = getConfig();
  const res = await fetch(`${baseUrl}/wp-json/wp/v2${path}`, {
    ...init,
    headers: { Authorization: authHeader(), ...init.headers },
  });
  if (!res.ok) {
    throw new Error(`WordPress API request failed: ${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.json();
}

async function downloadImage(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image ${url}: ${res.status} ${res.statusText}`);
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}

function extensionForContentType(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

export interface UploadedMedia {
  id: number;
  sourceUrl: string;
}

export async function uploadMedia(imageUrl: string, altText: string, titleForFilename: string): Promise<UploadedMedia> {
  const { buffer, contentType } = await downloadImage(imageUrl);
  const ext = extensionForContentType(contentType);
  const filename = `${titleForFilename
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80)}.${ext}`;

  const media = (await wpFetch("/media", {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename=${filename}`,
    },
    // Node's fetch accepts a Buffer at runtime, but TypeScript's DOM-derived
    // BodyInit type doesn't include Node's Buffer type directly, only plain
    // Uint8Array: an explicit view avoids a structural-typing mismatch.
    body: new Uint8Array(buffer),
  })) as { id: number; source_url: string };

  await wpFetch(`/media/${media.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      alt_text: altText,
      title: { raw: `${altText} - Poker - Beatdagame` },
      caption: { raw: altText },
      description: { raw: altText },
    }),
  });

  return { id: media.id, sourceUrl: media.source_url };
}

export interface CreatePostInput {
  title: string;
  bodyHtml: string;
  excerpt: string;
  sourceUrl: string;
  featuredMediaId: number;
  categoryId?: number;
}

export interface CreatedPost {
  id: number;
  url: string;
}

export async function createPost(input: CreatePostInput): Promise<CreatedPost> {
  const { defaultCategoryId } = getConfig();

  const disclosure =
    `<p style="line-height:12px;"><span style="font-size:10px;position:relative;top:-24px;left:10px;">` +
    `This content was AI generated based on the original article published on ${input.sourceUrl}. ` +
    `All credits for the original reporting belong to them.</span></p><br>`;

  const post = (await wpFetch("/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: input.title,
      content: disclosure + input.bodyHtml,
      status: "publish",
      excerpt: input.excerpt,
      categories: [input.categoryId ?? defaultCategoryId],
      featured_media: input.featuredMediaId,
    }),
  })) as { id: number; link: string };

  return { id: post.id, url: post.link };
}

/** Full publish flow: download+upload the generated image, then create the post. */
export async function publishArticleToWordPress(input: {
  title: string;
  bodyHtml: string;
  excerpt: string;
  sourceUrl: string;
  imageUrl: string;
}): Promise<CreatedPost> {
  const media = await uploadMedia(input.imageUrl, input.title, input.title);
  return createPost({
    title: input.title,
    bodyHtml: input.bodyHtml,
    excerpt: input.excerpt,
    sourceUrl: input.sourceUrl,
    featuredMediaId: media.id,
  });
}
