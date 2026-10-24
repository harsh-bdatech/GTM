// Run people search for one ICP and write the result to people-latest.json.
//   node src/bin/people.js            (LinkAssist ICP, 12 searches)
//   PEOPLE_MAX_QUERIES=30 node src/bin/people.js

import { writeFile } from "node:fs/promises";

import { LINKASSIST_ICP } from "../icp/linkassist.js";
import { searchPeople } from "../sources/people/index.js";

const maxQueries = Number(process.env.PEOPLE_MAX_QUERIES || 12);

const { people, queryStats, counts } = await searchPeople(LINKASSIST_ICP, { maxQueries });

const order = { qualified: 0, review: 1, rejected: 2 };
people.sort((a, b) => order[a.fit.status] - order[b.fit.status]);

await writeFile("people-latest.json", JSON.stringify({ counts, queryStats, people }, null, 2));

console.log("");
console.log(`People found: ${people.length}`, counts);
console.log("Best searches (new people per search):");
for (const s of [...queryStats].sort((a, b) => b.newPeople - a.newPeople).slice(0, 5)) {
  console.log(`  ${s.newPeople}  ${s.query}`);
}
console.log("Saved to people-latest.json");
