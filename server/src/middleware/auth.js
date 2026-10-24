import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';
import { HttpError, asyncHandler } from '../utils/httpError.js';

const signingSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new HttpError(500, 'Server authentication is not configured. Set JWT_SECRET to a random value of at least 32 characters.');
  return secret;
};

export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = req.cookies?.hcm_token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  if (!token) throw new HttpError(401, 'Please sign in to continue.');
  let decoded;
  try { decoded = jwt.verify(token, signingSecret(), { algorithms: ['HS256'] }); }
  catch { throw new HttpError(401, 'Your session is invalid or has expired. Please sign in again.'); }
  const user = await User.findById(decoded.sub).select('+passwordHash');
  if (!user || !user.active) throw new HttpError(401, 'This account is unavailable. Please contact an administrator.');
  req.user = user;
  const originalPath = req.originalUrl.split('?')[0];
  if (user.mustChangePassword && !['/api/auth/change-password', '/api/auth/logout', '/api/auth/me'].includes(originalPath)) {
    throw new HttpError(403, 'You must change your temporary password before continuing.', { code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  next();
});

export function allowRoles(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return next(new HttpError(403, 'You do not have permission to perform this action.'));
    next();
  };
}

export function createToken(user) {
  return jwt.sign({ sub: user._id.toString() }, signingSecret(), { expiresIn: process.env.JWT_EXPIRES_IN || '8h', algorithm: 'HS256' });
}

export function setAuthCookie(res, token) {
  res.cookie('hcm_token', token, { httpOnly: true, secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 8 * 60 * 60 * 1000 });
}
