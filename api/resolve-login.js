function toSafeString(value) {
  if (value == null) return '';
  return String(value);
}

function normalizeIdentifier(value) {
  return toSafeString(value).trim().toLowerCase();
}

function sendJson(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.status(status).send(JSON.stringify(payload));
}

function readIdentifier(body) {
  if (!body) return '';
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed?.identifier || '';
    } catch (_error) {
      return '';
    }
  }
  return body.identifier || '';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  const supabaseUrl = toSafeString(process.env.SUPABASE_URL).trim();
  const serviceRoleKey = toSafeString(process.env.SUPABASE_SERVICE_ROLE_KEY).trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return sendJson(res, 503, { error: 'resolver_unavailable' });
  }

  const identifier = normalizeIdentifier(readIdentifier(req.body));
  if (!identifier) {
    return sendJson(res, 400, { error: 'missing_identifier' });
  }

  try {
    const url = new URL('/rest/v1/profiles', supabaseUrl);
    url.searchParams.set('select', 'email');
    url.searchParams.set('limit', '1');
    url.searchParams.set('or', `(email.ilike.${identifier},username.ilike.${identifier})`);

    const response = await fetch(url, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`
      }
    });

    if (!response.ok) {
      return sendJson(res, 502, { error: 'resolver_failed' });
    }

    const rows = await response.json();
    const email = normalizeIdentifier(Array.isArray(rows) ? rows[0]?.email : '');
    return sendJson(res, 200, { email });
  } catch (_error) {
    return sendJson(res, 500, { error: 'resolver_failed' });
  }
};
