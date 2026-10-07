const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexPath = path.join(__dirname, '..', 'index.js');
const source = fs.readFileSync(indexPath, 'utf8');

let daily = {};
try {
  daily = require('../occupation-vigilance-daily.cjs');
} catch {
  daily = {};
}

test('Firebase entrypoints export scheduled and admin occupation vigilance runners', () => {
  assert.match(
    source,
    /exports\.buildDailyOccupationVigilance\s*=\s*onSchedule\(/
  );
  assert.match(
    source,
    /exports\.runOccupationVigilanceHttp\s*=\s*onRequest\(/
  );
  assert.match(
    source,
    /schedule:\s*['"]30 3 \* \* \*['"]/
  );
  assert.match(
    source,
    /timeZone:\s*['"]Europe\/Paris['"]/
  );
});

test('admin occupation vigilance handler refuses a missing or invalid key before execution', async () => {
  assert.equal(typeof daily.handleOccupationVigilanceAdminRequest, 'function');

  let executions = 0;
  const responses = [];

  function response() {
    return {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        responses.push({ status: this.statusCode, payload });
      },
    };
  }

  for (const providedKey of ['', 'wrong']) {
    const req = {
      query: { date: '2026-10-05' },
      get(name) {
        return name.toLowerCase() === 'x-admin-key' ? providedKey : '';
      },
    };

    await daily.handleOccupationVigilanceAdminRequest({
      request: req,
      response: response(),
      expectedAdminKey: 'correct-key',
      execute: async () => {
        executions += 1;
        return { status: 'published' };
      },
    });
  }

  assert.equal(executions, 0);
  assert.equal(responses.length, 2);
  assert.deepEqual(responses.map((item) => item.status), [403, 403]);
});

test('admin occupation vigilance handler validates date then executes exactly once', async () => {
  let executions = 0;
  const sent = [];
  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      sent.push({ status: this.statusCode, payload });
    },
  };

  await daily.handleOccupationVigilanceAdminRequest({
    request: {
      query: { date: '2026-10-05' },
      get: () => 'correct-key',
    },
    response,
    expectedAdminKey: 'correct-key',
    execute: async (date) => {
      executions += 1;
      assert.equal(date, '2026-10-05');
      return { status: 'published', runId: 'run-1' };
    },
  });

  assert.equal(executions, 1);
  assert.equal(sent[0].status, 200);
  assert.equal(sent[0].payload.ok, true);
});


test('scheduled occupation pipeline prepares context and history before calculating vigilance', () => {
  const marker = source.indexOf('// OCCUPATION_VIGILANCE_DAILY_V1');
  assert.notEqual(marker, -1);

  const block = source.slice(marker);
  const prepareIndex = block.indexOf('prepareOccupationVigilanceInputs');
  const executeIndex = block.indexOf('executeOccupationVigilanceForDate');

  assert.notEqual(prepareIndex, -1);
  assert.notEqual(executeIndex, -1);
  assert.ok(prepareIndex < executeIndex);
});
