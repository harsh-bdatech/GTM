import assert from "node:assert/strict";

import { LINKASSIST_ICP } from "../src/icp/linkassist.js";
import { buildPeopleQueries } from "../src/sources/people/queries.js";
import {
  normalizeLinkedInProfile,
  authorFromPostUrl,
  parseProfileResult,
  parsePostResult,
} from "../src/sources/people/parse.js";
import { evaluatePerson } from "../src/sources/people/filter.js";
import { searchPeople } from "../src/sources/people/index.js";

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`  PASS  ${name}`);
  } catch (error) {
    results.push(false);
    console.error(`  FAIL  ${name}\n        ${error.message}`);
  }
}

// Shaped like real search results for public LinkedIn pages.
const SAMPLE = {
  priya: {
    title: "Priya Sharma - Founder - BrightLeaf Digital | LinkedIn",
    url: "https://in.linkedin.com/in/Priya-Sharma-1a2b3c?originalSubdomain=in",
    content: "Founder at BrightLeaf Digital, a B2B marketing agency · Experience: BrightLeaf Digital · Location: Pune · 500+ connections on LinkedIn.",
  },
  priyaPost: {
    title: "Priya Sharma on LinkedIn: Personal branding is the cheapest client acquisition channel we have...",
    url: "https://www.linkedin.com/posts/priya-sharma-1a2b3c_personalbranding-activity-7254-abcd",
    content: "Personal branding is the cheapest client acquisition channel we have.",
  },
  student: {
    title: "Arjun Mehta - Student at IIT Bombay - IIT Bombay | LinkedIn",
    url: "https://www.linkedin.com/in/arjun-mehta",
    content: "Aspiring founder · Location: Mumbai",
  },
  bigco: {
    title: "Neha Rao – Consultant – Infosys | LinkedIn",
    url: "https://www.linkedin.com/in/neha-rao",
    content: "Consultant at Infosys · Location: Bengaluru",
  },
  noPlace: {
    title: "Karan Gill - Business Coach | LinkedIn",
    url: "https://www.linkedin.com/in/karan-gill",
    content: "I help agency owners grow.",
  },
  notLinkedIn: {
    title: "Top 10 marketing agencies in Pune",
    url: "https://example.com/blog/top-agencies",
    content: "",
  },
};

await test("profile URLs normalise to one canonical form", () => {
  assert.equal(
    normalizeLinkedInProfile("https://in.linkedin.com/in/Priya-Sharma-1a2b3c/?originalSubdomain=in"),
    "https://www.linkedin.com/in/priya-sharma-1a2b3c",
  );
  assert.equal(normalizeLinkedInProfile("https://example.com/in/x"), null);
  assert.equal(normalizeLinkedInProfile("https://www.linkedin.com/company/acme"), null);
});

await test("post URL gives the author's profile", () => {
  assert.equal(authorFromPostUrl(SAMPLE.priyaPost.url), "https://www.linkedin.com/in/priya-sharma-1a2b3c");
});

await test("profile result splits into name, headline, company, location", () => {
  const p = parseProfileResult(SAMPLE.priya);
  assert.equal(p.fullName, "Priya Sharma");
  assert.equal(p.headline, "Founder");
  assert.equal(p.company, "BrightLeaf Digital");
  assert.equal(p.location, "Pune");
});

await test("post result gives author name and excerpt", () => {
  const p = parsePostResult(SAMPLE.priyaPost);
  assert.equal(p.fullName, "Priya Sharma");
  assert.match(p.postExcerpt, /^Personal branding/);
});

await test("fit rules: qualified, rejected and review", () => {
  const icp = LINKASSIST_ICP;
  assert.equal(evaluatePerson(parseProfileResult(SAMPLE.priya), icp).status, "qualified");
  assert.equal(evaluatePerson(parseProfileResult(SAMPLE.student), icp).status, "rejected");
  assert.equal(evaluatePerson(parseProfileResult(SAMPLE.bigco), icp).status, "rejected");
  assert.equal(evaluatePerson(parseProfileResult(SAMPLE.noPlace), icp).status, "review");
});

await test("queries vary role, business type and city, and include post searches", () => {
  const queries = buildPeopleQueries(LINKASSIST_ICP);
  const first = queries.slice(0, 12);
  assert.ok(new Set(first.map((q) => q.facets.role)).size >= 4);
  assert.ok(first.some((q) => q.kind === "post"));
  assert.equal(new Set(queries.map((q) => q.query)).size, queries.length);
  assert.match(queries[0].query, /^site:linkedin\.com\/in "/);
});

await test("searchPeople merges a profile and a post into one person with both signals", async () => {
  const fakeSearch = async ({ query }) =>
    query.includes("/posts")
      ? [SAMPLE.priyaPost, SAMPLE.notLinkedIn]
      : [SAMPLE.priya, SAMPLE.student, SAMPLE.bigco, SAMPLE.noPlace];

  const { people, counts, queryStats } = await searchPeople(LINKASSIST_ICP, {
    maxQueries: 3,
    delayMs: 0,
    search: fakeSearch,
    useCache: false,
    log: () => {},
  });

  const priya = people.find((p) => p.profileUrl.endsWith("priya-sharma-1a2b3c"));
  assert.ok(priya, "Priya found");
  assert.deepEqual(priya.signals.map((s) => s.type).sort(), ["post_topic", "profile_match", "profile_match"]);
  assert.equal(priya.fit.status, "qualified");
  assert.ok(priya.fit.evidence.includes("posted on a buyer topic"));
  assert.equal(people.length, 4);
  assert.deepEqual(counts, { qualified: 1, rejected: 2, review: 1 });
  assert.equal(queryStats.length, 3);
});

const passed = results.filter(Boolean).length;
console.log(`\nPassed ${passed}/${results.length}`);
if (passed !== results.length) process.exitCode = 1;
