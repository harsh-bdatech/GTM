// People search over public LinkedIn pages indexed by search engines, using
// the SearXNG instance the engine already runs. Returns one record per person
// (keyed by profile URL), each with its evidence and a rule-based fit status.

import { config } from "../../config.js";
import { searchChannel } from "../../channels/index.js";
import { getSearchCache, setSearchCache } from "../../storage/localStore.js";
import { buildPeopleQueries } from "./queries.js";
import { parseProfileResult, parsePostResult, resultKind } from "./parse.js";
import { evaluatePerson } from "./filter.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Searches on people change faster than company pages, so cache for 3 days.
const CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

function merge(existing, incoming) {
  if (!existing) return { ...incoming, signals: [...(incoming.signals || [])], foundBy: [...(incoming.foundBy || [])] };
  for (const field of ["fullName", "headline", "company", "location", "snippet"]) {
    if (!existing[field] && incoming[field]) existing[field] = incoming[field];
  }
  existing.signals.push(...(incoming.signals || []));
  existing.foundBy.push(...(incoming.foundBy || []));
  return existing;
}

async function cachedSearch(search, query, useCache) {
  const key = `people::${query}::${config.searxngEngines.join(",")}`;
  if (useCache) {
    const cache = await getSearchCache();
    const hit = cache[key];
    if (hit && Date.now() - new Date(hit.cachedAt).getTime() < CACHE_TTL_MS) {
      return { results: hit.results, fromCache: true };
    }
  }
  const results = await search({ query, page: 1, language: "en", limit: config.searchResultsPerQuery });
  if (useCache) await setSearchCache(key, { cachedAt: new Date().toISOString(), results });
  return { results, fromCache: false };
}

export async function searchPeople(icp, {
  maxQueries = 12,
  delayMs = config.searxngQueryDelayMs,
  search = (input) => searchChannel.run(input),
  useCache = !config.searxngBypassCache,
  log = console.log,
} = {}) {
  const queries = buildPeopleQueries(icp).slice(0, maxQueries);
  const people = new Map();
  const queryStats = [];

  for (let i = 0; i < queries.length; i++) {
    const { kind, query, facets } = queries[i];
    let results = [];
    let fromCache = false;
    try {
      ({ results, fromCache } = await cachedSearch(search, query, useCache));
    } catch (error) {
      log(`Search failed: ${query} (${error.message})`);
    }

    let newPeople = 0;
    for (const result of results) {
      const found = resultKind(result.url);
      const person = found === "profile" ? parseProfileResult(result)
        : found === "post" ? parsePostResult(result)
        : null;
      if (!person) continue;

      person.signals = found === "post"
        ? [{ type: "post_topic", evidenceUrl: result.url, excerpt: person.postExcerpt, phrase: facets.phrase }]
        : [{ type: "profile_match", evidenceUrl: result.url }];
      person.foundBy = [query];

      if (!people.has(person.profileUrl)) newPeople++;
      people.set(person.profileUrl, merge(people.get(person.profileUrl), person));
    }

    queryStats.push({ query, kind, results: results.length, newPeople, fromCache });
    log(`[people ${i + 1}/${queries.length}] ${results.length} results, ${newPeople} new people — ${query}`);

    if (!fromCache && i < queries.length - 1) await sleep(delayMs);
  }

  const evaluated = [...people.values()].map((person) => ({
    ...person,
    fit: evaluatePerson(person, icp),
  }));

  const counts = evaluated.reduce((acc, p) => ({ ...acc, [p.fit.status]: (acc[p.fit.status] || 0) + 1 }), {});
  return { people: evaluated, queryStats, counts };
}
