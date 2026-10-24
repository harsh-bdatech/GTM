// Turns search-engine results that point at public LinkedIn pages into
// person records. We only read the result's title, URL and snippet;
// linkedin.com itself is never fetched.

const DASH_SPLIT = /\s+[-–—]\s+/;

// Canonical profile URL: https://www.linkedin.com/in/<slug>
export function normalizeLinkedInProfile(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
  const match = url.pathname.match(/^\/in\/([^/?#]+)/i);
  if (!match) return null;
  const slug = decodeURIComponent(match[1]).toLowerCase();
  return `https://www.linkedin.com/in/${slug}`;
}

// Post URLs look like /posts/<author-slug>_<words>-activity-<id>-<x>.
// Profile slugs never contain "_", so the author is everything before it.
export function authorFromPostUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
  const match = url.pathname.match(/^\/posts\/([^/_]+)_/i);
  if (!match) return null;
  return `https://www.linkedin.com/in/${decodeURIComponent(match[1]).toLowerCase()}`;
}

export function resultKind(rawUrl) {
  if (normalizeLinkedInProfile(rawUrl)) return "profile";
  if (authorFromPostUrl(rawUrl)) return "post";
  return null;
}

function clean(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s*(\.\.\.|…)\s*$/, "")
    .trim();
}

// Snippets often read "Founder at X · Experience: X · Location: Pune · 500+ connections"
function snippetField(snippet, label) {
  const match = String(snippet || "").match(
    new RegExp(`${label}:\\s*([^·|\\n]+)`, "i"),
  );
  return match ? clean(match[1]) : "";
}

// "Priya Sharma - Founder - BrightLeaf Digital | LinkedIn"
export function parseProfileResult(result) {
  const profileUrl = normalizeLinkedInProfile(result.url);
  if (!profileUrl) return null;

  const main = clean(String(result.title || "").split("|")[0]);
  const parts = main.split(DASH_SPLIT).map(clean).filter(Boolean);
  const fullName = parts[0] || "";
  if (!fullName || fullName.length > 80) return null;

  let headline = "";
  let company = "";
  if (parts.length >= 3) {
    headline = parts[1];
    company = parts.slice(2).join(" - ");
  } else if (parts.length === 2) {
    headline = parts[1];
  }

  const snippet = clean(result.content);
  const location = snippetField(snippet, "Location");
  const experience = snippetField(snippet, "Experience");

  return {
    profileUrl,
    fullName,
    headline,
    company: company || experience,
    location,
    snippet,
    evidenceUrl: result.url,
  };
}

// "Priya Sharma on LinkedIn: Most founders ignore personal branding..."
export function parsePostResult(result) {
  const profileUrl = authorFromPostUrl(result.url);
  if (!profileUrl) return null;

  const title = clean(result.title);
  const onLinkedIn = title.match(/^(.{2,80}?)\s+on LinkedIn:\s*(.*)$/i);
  const fullName = onLinkedIn ? clean(onLinkedIn[1]) : "";
  const excerpt = clean(onLinkedIn ? onLinkedIn[2] : title) || clean(result.content);

  return {
    profileUrl,
    fullName,
    headline: "",
    company: "",
    location: "",
    snippet: clean(result.content),
    evidenceUrl: result.url,
    postExcerpt: excerpt.slice(0, 500),
  };
}
