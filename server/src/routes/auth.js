import { Router } from 'express';
import * as auth from '../services/auth.js';
import { seedDemo } from '../demoData.js';

const r = Router();
/** Tên thiết bị do app gửi lên (VD: "iPhone · Safari"), dùng cho danh sách thiết bị */
const device = (req) => req.headers?.['x-device'] || req.headers?.['user-agent']?.slice(0, 80);
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((d) => d !== undefined && res.json(d)).catch(next);

r.post('/register', h((req) => auth.register(req.body, seedDemo, device(req))));
r.post('/login', h((req) => auth.login(req.body, device(req))));
r.post('/forgot', h((req) => auth.forgotPassword(req.body)));
r.post('/reset', h((req) => auth.resetPassword(req.body)));
r.get('/me', auth.requireAuth, h((req) => auth.publicUser(req.user)));
r.put('/me', auth.requireAuth, h((req) => auth.updateProfile(req.user, req.body)));
r.post('/me/password', auth.requireAuth, h((req) => auth.changePassword(req.user, req.body)));
r.post('/logout', auth.requireAuth, h(async (req) => { await auth.logout(req.user); return { ok: true }; }));
r.get('/sessions', auth.requireAuth, h((req) => auth.listSessions(req.user)));
r.delete('/sessions/:id', auth.requireAuth, h((req) => auth.revokeSession(req.user, req.params.id)));
r.post('/sessions/logout-others', auth.requireAuth, h((req) => auth.revokeOtherSessions(req.user)));
r.delete('/me', auth.requireAuth, h(async (req) => { await auth.deleteAccount(req.user); return { ok: true }; }));

export default r;
