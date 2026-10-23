// Builds many short, different searches from the ICP instead of one long
// sentence. Each search combines a role, a business type and a city (profiles),
// or a role and a buyer phrase (posts).

const DEFAULT_CITIES = [
  "Bengaluru", "Mumbai", "Delhi", "Pune", "Hyderabad", "Chennai",
  "Gurugram", "Noida", "Ahmedabad", "Kolkata", "Jaipur", "Kochi",
];

const DEFAULT_ROLES = ["Founder", "Co-Founder", "CEO", "Owner", "Consultant", "Coach"];

function list(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item).trim())
    .filter(Boolean);
}

// Round-robin over the combinations so the first N searches already vary
// in role, business type and city, instead of exhausting one role first.
// Every combination appears exactly once, in a fixed shuffled order, so the
// first few searches already differ in role, business type and city.
// The seed keeps the order the same on every run (useful for caching and
// comparing runs).
function interleave(a, b, c, seed = 42) {
  const out = [];
  for (const x of a) for (const y of b) for (const z of c) out.push([x, y, z]);
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function buildPeopleQueries(icp = {}) {
  const roles = list(icp.search_roles).length ? list(icp.search_roles) : DEFAULT_ROLES;
  const types = list(icp.discovery_terms).length ? list(icp.discovery_terms) : list(icp.company_types);
  const cities = list(icp.cities).length ? list(icp.cities) : DEFAULT_CITIES;
  const phrases = list(icp.signal_phrases);
  const country = list(icp.geography)[0] || "India";

  const profileQueries = interleave(roles, types.length ? types : ["B2B"], cities).map(
    ([role, type, city]) => ({
      kind: "profile",
      query: `site:linkedin.com/in "${role}" "${type}" "${city}"`,
      facets: { role, type, city },
    }),
  );

  const postQueries = [];
  for (const phrase of phrases) {
    for (const role of roles.slice(0, 3)) {
      postQueries.push({
        kind: "post",
        query: `site:linkedin.com/posts "${role}" "${phrase}" ${country}`,
        facets: { role, phrase },
      });
    }
  }

  // Alternate: two profile searches, then one post search.
  const out = [];
  let p = 0;
  let q = 0;
  while (p < profileQueries.length || q < postQueries.length) {
    if (p < profileQueries.length) out.push(profileQueries[p++]);
    if (p < profileQueries.length) out.push(profileQueries[p++]);
    if (q < postQueries.length) out.push(postQueries[q++]);
  }

  const seen = new Set();
  return out.filter(({ query }) => (seen.has(query) ? false : (seen.add(query), true)));
}
