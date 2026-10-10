'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeInseeCollectionJob,
  handleInseeCollectionStatus,
} = require('../lib/insee-admin-job-status.cjs');

function fakeResponse() {
  return {
    statusCode: 200, headers: {}, body: null,
    set(name, value) { this.headers[name] = value; return this; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
  };
}

function fakeRequest({ method = 'POST', token = 'valid' } = {}) {
  return {
    method,
    get(name) {
      return name.toLowerCase() === 'authorization'
        ? token ? 'Bearer ' + token : ''
        : '';
    },
  };
}

function fakeAuth(provider = 'password') {
  return {
    async verifyIdToken(value, checkRevoked) {
      assert.equal(value, 'valid');
      assert.equal(checkRevoked, true);
      return {
        uid: 'admin-user',
        email_verified: true,
        firebase: { sign_in_provider: provider },
      };
    },
  };
}

function fakeDb({ role = 'admin', status = 'active', exists = true } = {}) {
  const reads = [];
  return {
    reads,
    collection(name) {
      return {
        doc(id) {
          return {
            async get() {
              reads.push(name + '/' + id);
              if (name === 'users') {
                return {
                  exists: true,
                  data: () => ({ role, status }),
                };
              }
              if (name === 'adminJobs') {
                assert.equal(id, 'inseeNationalBackgroundJob');
                return {
                  exists,
                  data: () => ({
                    status: 'running',
                    currentDepartmentCode: '25',
                    currentPosition: 24,
                    endPosition: 101,
                    totalPages: 1,
                    totalReceived: 500,
                    completedDepartmentsCount: 0,
                    lastHeartbeatAt: { toDate: () => new Date('2026-10-10T11:27:00Z') },
                    cursor: 'VERY_PRIVATE',
                    leaseOwner: 'PRIVATE',
                    errorMessage: 'PRIVATE_DETAILS',
                    adminKey: 'SECRET',
                    sirets: ['12345678912345'],
                  }),
                };
              }
              throw Error('Unexpected collection');
            },
          };
        },
      };
    },
  };
}

test('sanitizer only returns allowed fields, not cursors or secrets', () => {
  const job = sanitizeInseeCollectionJob({
    status: 'running', currentDepartmentCode: '25',
    totalPages: 1, totalReceived: 500,
    nextCursor: 'secret-cursor', cursor: 'private',
    leaseOwner: 'secret', raw: { apiKey: 'secret' },
    errorMessage: 'Sensitive internal details',
  });
  assert.equal(job.totalPages, 1);
  assert.equal(job.totalReceived, 500);
  for (const key of ['cursor', 'nextCursor', 'leaseOwner', 'raw', 'errorMessage']) {
    assert.equal(Object.hasOwn(job, key), false);
  }
  assert.equal(JSON.stringify(job).includes('secret'), false);
});

test('unauthenticated request is denied without reading job', async () => {
  const response = fakeResponse();
  const db = fakeDb();
  await handleInseeCollectionStatus({
    request: fakeRequest({ token: '' }), response, auth: fakeAuth(), db,
  });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(db.reads, []);
});

test('non-admin account is denied before accessing job', async () => {
  const response = fakeResponse();
  const db = fakeDb({ role: 'reader' });
  await handleInseeCollectionStatus({
    request: fakeRequest(), response, auth: fakeAuth(), db,
  });
  assert.equal(response.statusCode, 403);
  assert.equal(db.reads.filter(value => value.startsWith('adminJobs/')).length, 0);
});

test('non-password provider cannot access collection data', async () => {
  const response = fakeResponse();
  const db = fakeDb();
  await handleInseeCollectionStatus({
    request: fakeRequest(), response, auth: fakeAuth('google.com'), db,
  });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(db.reads, []);
});

test('GET and other unsupported methods are denied', async () => {
  const response = fakeResponse();
  const db = fakeDb();
  await handleInseeCollectionStatus({
    request: fakeRequest({ method: 'GET' }), response, auth: fakeAuth(), db,
  });
  assert.equal(response.statusCode, 405);
  assert.deepEqual(db.reads, []);
});

test('verified password admin receives a minimal live job snapshot', async () => {
  const response = fakeResponse();
  const db = fakeDb();
  await handleInseeCollectionStatus({
    request: fakeRequest(), response, auth: fakeAuth(), db,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.job.totalReceived, 500);
  assert.equal(response.body.job.lastHeartbeatAt, '2026-10-10T11:27:00.000Z');
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
  assert.equal(db.reads.includes('adminJobs/inseeNationalBackgroundJob'), true);
  for (const term of ['VERY_PRIVATE', 'PRIVATE_DETAILS', 'SECRET', '12345678912345']) {
    assert.equal(JSON.stringify(response.body).includes(term), false);
  }
});

test('missing job is returned as no job without error', async () => {
  const response = fakeResponse();
  await handleInseeCollectionStatus({
    request: fakeRequest(), response, auth: fakeAuth(), db: fakeDb({ exists: false }),
  });
  assert.deepEqual(response.body, { ok: true, exists: false, job: null });
});
