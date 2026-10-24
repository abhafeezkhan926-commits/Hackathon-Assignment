import mongoose from 'mongoose';

export function notFound(_req, res) { res.status(404).json({ ok: false, error: { message: 'API route not found.' } }); }

export function errorHandler(err, _req, res, _next) {
  if (res.headersSent) return;
  let status = err.status || 500;
  let message = err.message || 'An unexpected server error occurred.';
  let details = err.details;
  if (err instanceof mongoose.Error.ValidationError) {
    status = 422; message = 'Please correct the highlighted fields.';
    details = Object.fromEntries(Object.entries(err.errors).map(([key, value]) => [key, value.message]));
  } else if (err?.code === 11000) {
    status = 409; const field = Object.keys(err.keyPattern || {})[0] || 'value'; message = `${field} is already in use.`; details = { field };
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400; message = 'The supplied record ID is invalid.';
  } else if (err?.name === 'MulterError') {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400; message = err.code === 'LIMIT_FILE_SIZE' ? 'The file is too large.' : 'The uploaded file could not be accepted.';
  }
  if (status >= 500) console.error('[hcm-api]', err);
  res.status(status).json({ ok: false, error: { message: status >= 500 && process.env.NODE_ENV === 'production' ? 'An unexpected server error occurred.' : message, ...(details ? { details } : {}) } });
}
