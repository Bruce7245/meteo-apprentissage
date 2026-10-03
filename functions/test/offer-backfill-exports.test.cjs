const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexPath = path.join(__dirname, "..", "index.js");
const source = fs.readFileSync(indexPath, "utf8");

for (const functionName of [
  "startOfferBackfillJobHttp",
  "resumeOfferBackfillJob",
  "getOfferBackfillJobStatusHttp",
]) {
  test(`Firebase entrypoint exports ${functionName}`, () => {
    assert.match(
      source,
      new RegExp(
        `exports\\.${functionName}\\s*=\\s*lbaDailyOffers\\.${functionName}`
      )
    );
  });
}
