// Rule-based fit check for a person found in search results. No LLM needed.
// Returns qualified | review | rejected, with the reasons that decided it.

const INDIA_PLACES = [
  "india", "bengaluru", "bangalore", "mumbai", "delhi", "new delhi", "pune",
  "hyderabad", "chennai", "gurugram", "gurgaon", "noida", "ahmedabad",
  "kolkata", "jaipur", "kochi", "chandigarh", "indore", "lucknow",
  "coimbatore", "nagpur", "surat", "bhubaneswar", "thane", "navi mumbai",
];

const EXCLUDE_PATTERNS = [
  /\bstudent\b/i, /\bintern(ship)?\b/i, /\baspiring\b/i, /\bfresher\b/i,
  /\bopen to work\b/i, /\blooking for (a )?(job|opportunit)/i, /\bseeking\b/i,
  /\bjob seeker\b/i,
];

// Employees of large firms rarely buy for themselves.
const LARGE_EMPLOYERS = [
  "tcs", "tata consultancy", "infosys", "wipro", "accenture", "cognizant",
  "hcl", "tech mahindra", "deloitte", "capgemini", "ibm", "amazon", "google",
  "microsoft", "ey", "kpmg", "pwc", "genpact", "reliance",
];

function escape(word) {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWord(text, word) {
  return new RegExp(`(^|[^a-z])${escape(word.toLowerCase())}([^a-z]|$)`, "i").test(text);
}

export function evaluatePerson(person, icp = {}) {
  const reasons = [];
  const evidence = [];
  const roleText = [person.headline, person.snippet].filter(Boolean).join(" ").toLowerCase();
  const placeText = [person.location, person.snippet, person.headline].filter(Boolean).join(" ").toLowerCase();
  const companyText = String(person.company || "").toLowerCase();

  if (!person.fullName) {
    return { status: "review", reasons: ["name not found in search result"], evidence };
  }

  const excluded = EXCLUDE_PATTERNS.find((pattern) => pattern.test(roleText));
  if (excluded) {
    return { status: "rejected", reasons: [`excluded: ${excluded.source}`], evidence };
  }

  const bigEmployer = LARGE_EMPLOYERS.find((name) => hasWord(companyText, name));
  if (bigEmployer) {
    return { status: "rejected", reasons: [`works at a large company (${bigEmployer})`], evidence };
  }

  const roles = (icp.search_roles || icp.buyer_roles || []).map(String);
  const role = roles.find((r) => hasWord(roleText, r));
  if (role) evidence.push(`role: ${role}`);
  else reasons.push("role not matched");

  const place = INDIA_PLACES.find((p) => hasWord(placeText, p));
  if (place) evidence.push(`location: ${place}`);
  else reasons.push("location unknown");

  const terms = (icp.discovery_terms || []).map(String);
  const businessType = terms.find((t) => hasWord(`${roleText} ${companyText}`, t));
  if (businessType) evidence.push(`business: ${businessType}`);

  if (person.signals?.some((s) => s.type === "post_topic")) {
    evidence.push("posted on a buyer topic");
  }

  // Role and location both confirmed → qualified. One missing → review.
  if (role && place) return { status: "qualified", reasons, evidence };
  if (role || place) return { status: "review", reasons, evidence };
  return { status: "rejected", reasons, evidence };
}
