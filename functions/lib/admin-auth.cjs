function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function bearerToken(request) {
  const header = text(request?.get?.('authorization'));

  if (!header.toLowerCase().startsWith('bearer ')) return '';
  return header.slice(7).trim();
}

async function writeAdminAuditEvent({
  db,
  action,
  outcome,
  uid = null,
  reason = null,
} = {}) {
  if (!db?.collection || !action || !outcome) return;

  try {
    await db.collection('adminSecurityAudit').add({
      action: text(action).slice(0, 64),
      outcome: text(outcome).slice(0, 32),
      uid: text(uid).slice(0, 128) || null,
      reason: text(reason).slice(0, 128) || null,
      occurredAt: new Date(),
      schemaVersion: 'adminSecurityAudit.v1',
    });
  } catch (error) {
    console.error('adminSecurityAudit write failed', {
      name: error?.name || 'Error',
      message: String(error?.message || error).slice(0, 200),
    });
  }
}

function deny(response, status, error) {
  response.set?.('Cache-Control', 'no-store');
  response.status(status).json({
    ok: false,
    error,
  });
}

async function authenticateAdminRequest({
  request,
  response,
  auth,
  db,
  requiredProvider = 'password',
  requireEmailVerified = true,
  auditAction = null,
} = {}) {
  const token = bearerToken(request);

  if (!token) {
    if (auditAction) {
      await writeAdminAuditEvent({
        db,
        action: auditAction,
        outcome: 'denied',
        reason: 'missing_token',
      });
    }

    deny(response, 401, 'Authentification requise');
    return null;
  }

  let decoded;

  try {
    decoded = await auth.verifyIdToken(token, true);
  } catch (error) {
    if (auditAction) {
      await writeAdminAuditEvent({
        db,
        action: auditAction,
        outcome: 'denied',
        reason: error?.code || 'invalid_token',
      });
    }

    deny(response, 401, 'Session invalide ou expirée');
    return null;
  }

  const provider = text(decoded?.firebase?.sign_in_provider);

  if (requiredProvider && provider !== requiredProvider) {
    if (auditAction) {
      await writeAdminAuditEvent({
        db,
        action: auditAction,
        outcome: 'denied',
        uid: decoded.uid,
        reason: 'provider_not_allowed',
      });
    }

    deny(response, 403, 'Droits administrateur requis');
    return null;
  }

  if (requireEmailVerified && decoded.email_verified !== true) {
    if (auditAction) {
      await writeAdminAuditEvent({
        db,
        action: auditAction,
        outcome: 'denied',
        uid: decoded.uid,
        reason: 'email_not_verified',
      });
    }

    deny(response, 403, 'Droits administrateur requis');
    return null;
  }

  const userSnap = await db
    .collection('users')
    .doc(decoded.uid)
    .get();

  const profile = userSnap.exists ? userSnap.data() || {} : null;
  const disabled =
    profile?.status === 'disabled' ||
    profile?.disabled === true ||
    profile?.active === false;

  if (!profile || profile.role !== 'admin' || disabled) {
    if (auditAction) {
      await writeAdminAuditEvent({
        db,
        action: auditAction,
        outcome: 'denied',
        uid: decoded.uid,
        reason: disabled ? 'admin_disabled' : 'admin_role_missing',
      });
    }

    deny(response, 403, 'Droits administrateur requis');
    return null;
  }

  if (auditAction) {
    await writeAdminAuditEvent({
      db,
      action: auditAction,
      outcome: 'granted',
      uid: decoded.uid,
      reason: 'password_auth',
    });
  }

  return {
    ...decoded,
    adminProfile: {
      role: 'admin',
      status: profile.status || 'active',
    },
  };
}

async function handleAdminSession({
  request,
  response,
  auth,
  db,
} = {}) {
  if (request?.method === 'OPTIONS') {
    response.status(204).send('');
    return;
  }

  if (request?.method !== 'POST') {
    response.set?.('Allow', 'POST, OPTIONS');
    deny(response, 405, 'Méthode non autorisée');
    return;
  }

  const decoded = await authenticateAdminRequest({
    request,
    response,
    auth,
    db,
    requiredProvider: 'password',
    requireEmailVerified: true,
    auditAction: 'admin_session',
  });

  if (!decoded) return;

  response.set?.('Cache-Control', 'no-store');
  response.status(200).json({
    ok: true,
    session: {
      uid: decoded.uid,
      email: decoded.email || null,
      role: 'admin',
      provider: decoded?.firebase?.sign_in_provider || null,
      emailVerified: decoded.email_verified === true,
    },
  });
}

async function handleAdminLogout({
  request,
  response,
  auth,
  db,
} = {}) {
  if (request?.method === 'OPTIONS') {
    response.status(204).send('');
    return;
  }

  if (request?.method !== 'POST') {
    response.set?.('Allow', 'POST, OPTIONS');
    deny(response, 405, 'Méthode non autorisée');
    return;
  }

  const decoded = await authenticateAdminRequest({
    request,
    response,
    auth,
    db,
    requiredProvider: 'password',
    requireEmailVerified: true,
  });

  if (!decoded) return;

  await writeAdminAuditEvent({
    db,
    action: 'admin_logout',
    outcome: 'success',
    uid: decoded.uid,
    reason: 'user_initiated',
  });

  response.set?.('Cache-Control', 'no-store');
  response.status(200).json({
    ok: true,
  });
}

module.exports = {
  bearerToken,
  writeAdminAuditEvent,
  authenticateAdminRequest,
  handleAdminSession,
  handleAdminLogout,
};
