import { AuditLog } from '../models/index.js';

export async function writeAudit(req, action, entity, entityId = '', before = null, after = null) {
  const safeSnapshot = (value) => {
    if (!value) return undefined;
    const copy = JSON.parse(JSON.stringify(value));
    for (const key of ['password', 'passwordHash', 'token', 'jwt', 'secret', 'apiKey']) delete copy[key];
    return copy;
  };
  await AuditLog.create({ actor: req.user?._id || null, actorRole: req.user?.role || 'system', action, entity, entityId: String(entityId || ''), before: safeSnapshot(before), after: safeSnapshot(after), ip: req.ip });
}
