const test = require('node:test');
const assert = require('node:assert/strict');

const {
  bearerToken,
  authenticateAdminRequest,
  handleAdminSession,
  handleAdminLogout,
} = require('../lib/admin-auth.cjs');

function fakeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

function fakeRequest({
  method = 'POST',
  authorization = '',
} = {}) {
  return {
    method,
    get(name) {
      if (String(name).toLowerCase() === 'authorization') {
        return authorization;
      }

      return '';
    },
  };
}

function fakeDb(profile = { role: 'admin', status: 'active' }) {
  const audits = [];

  return {
    audits,
    collection(name) {
      if (name === 'users') {
        return {
          doc() {
            return {
              async get() {
                return {
                  exists: Boolean(profile),
                  data() {
                    return profile;
                  },
                };
              },
            };
          },
        };
      }

      if (name === 'adminSecurityAudit') {
        return {
          async add(value) {
            audits.push(value);
            return { id: 'audit-1' };
          },
        };
      }

      throw new Error('Unexpected collection: ' + name);
    },
  };
}

function fakeAuth(decoded) {
  return {
    calls: [],
    async verifyIdToken(token, checkRevoked) {
      this.calls.push({ token, checkRevoked });

      if (token === 'invalid') {
        const error = new Error('invalid');
        error.code = 'auth/id-token-revoked';
        throw error;
      }

      return decoded;
    },
  };
}

function passwordAdmin(overrides = {}) {
  return {
    uid: 'admin-1',
    email: 'admin@example.test',
    email_verified: true,
    firebase: {
      sign_in_provider: 'password',
    },
    ...overrides,
  };
}

test('bearerToken extracts a Firebase bearer token', () => {
  const request = fakeRequest({
    authorization: 'Bearer abc.def.ghi',
  });

  assert.equal(bearerToken(request), 'abc.def.ghi');
});

test('authenticateAdminRequest returns 401 without token', async () => {
  const response = fakeResponse();
  const db = fakeDb();
  const auth = fakeAuth(passwordAdmin());

  const result = await authenticateAdminRequest({
    request: fakeRequest(),
    response,
    auth,
    db,
    auditAction: 'admin_session',
  });

  assert.equal(result, null);
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.ok, false);
  assert.equal(auth.calls.length, 0);
  assert.equal(db.audits[0].reason, 'missing_token');
});

test('authenticateAdminRequest checks revocation and rejects an invalid token', async () => {
  const response = fakeResponse();
  const db = fakeDb();
  const auth = fakeAuth(passwordAdmin());

  const result = await authenticateAdminRequest({
    request: fakeRequest({
      authorization: 'Bearer invalid',
    }),
    response,
    auth,
    db,
    auditAction: 'admin_session',
  });

  assert.equal(result, null);
  assert.equal(response.statusCode, 401);
  assert.deepEqual(auth.calls[0], {
    token: 'invalid',
    checkRevoked: true,
  });
});

test('authenticateAdminRequest refuses a non-password provider', async () => {
  const response = fakeResponse();
  const db = fakeDb();
  const auth = fakeAuth(
    passwordAdmin({
      firebase: {
        sign_in_provider: 'google.com',
      },
    })
  );

  const result = await authenticateAdminRequest({
    request: fakeRequest({
      authorization: 'Bearer valid',
    }),
    response,
    auth,
    db,
    auditAction: 'admin_session',
  });

  assert.equal(result, null);
  assert.equal(response.statusCode, 403);
  assert.equal(db.audits[0].reason, 'provider_not_allowed');
});

test('authenticateAdminRequest requires a verified email', async () => {
  const response = fakeResponse();
  const db = fakeDb();
  const auth = fakeAuth(
    passwordAdmin({
      email_verified: false,
    })
  );

  const result = await authenticateAdminRequest({
    request: fakeRequest({
      authorization: 'Bearer valid',
    }),
    response,
    auth,
    db,
    auditAction: 'admin_session',
  });

  assert.equal(result, null);
  assert.equal(response.statusCode, 403);
  assert.equal(db.audits[0].reason, 'email_not_verified');
});

test('authenticateAdminRequest refuses an authenticated user without admin role', async () => {
  const response = fakeResponse();
  const db = fakeDb({
    role: 'reader',
    status: 'active',
  });
  const auth = fakeAuth(passwordAdmin());

  const result = await authenticateAdminRequest({
    request: fakeRequest({
      authorization: 'Bearer valid',
    }),
    response,
    auth,
    db,
    auditAction: 'admin_session',
  });

  assert.equal(result, null);
  assert.equal(response.statusCode, 403);
  assert.equal(db.audits[0].reason, 'admin_role_missing');
});

test('authenticateAdminRequest returns an authorized password admin', async () => {
  const response = fakeResponse();
  const db = fakeDb();
  const auth = fakeAuth(passwordAdmin());

  const result = await authenticateAdminRequest({
    request: fakeRequest({
      authorization: 'Bearer valid',
    }),
    response,
    auth,
    db,
    auditAction: 'admin_session',
  });

  assert.equal(result.uid, 'admin-1');
  assert.equal(result.adminProfile.role, 'admin');
  assert.equal(response.statusCode, 200);
  assert.equal(db.audits[0].outcome, 'granted');
  assert.equal(db.audits[0].uid, 'admin-1');
});

test('handleAdminSession returns only the minimal admin session profile', async () => {
  const response = fakeResponse();
  const db = fakeDb();
  const auth = fakeAuth(passwordAdmin());

  await handleAdminSession({
    request: fakeRequest({
      authorization: 'Bearer valid',
    }),
    response,
    auth,
    db,
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    ok: true,
    session: {
      uid: 'admin-1',
      email: 'admin@example.test',
      role: 'admin',
      provider: 'password',
      emailVerified: true,
    },
  });
  assert.equal(response.headers['Cache-Control'], 'no-store');
});

test('handleAdminLogout records a successful logout event', async () => {
  const response = fakeResponse();
  const db = fakeDb();
  const auth = fakeAuth(passwordAdmin());

  await handleAdminLogout({
    request: fakeRequest({
      authorization: 'Bearer valid',
    }),
    response,
    auth,
    db,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);

  const logout = db.audits.find(
    (event) => event.action === 'admin_logout'
  );

  assert.ok(logout);
  assert.equal(logout.outcome, 'success');
  assert.equal(logout.uid, 'admin-1');
});
