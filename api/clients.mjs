import { authenticate, check, database, method, respondError } from '../server/runtime.mjs';
import { clientInput, HttpError, id, password, requiredText } from '../server/validation.mjs';

export function createHandler(getDatabase = database) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    try {
      method(req, ['POST', 'PATCH']);
      const db = getDatabase();
      await authenticate(req, db, true);
      const input = req.body || {};
      if (req.method === 'POST') {
        const value = clientInput(input);
        const { data, error } = await db.auth.admin.createUser({
          email: value.email,
          password: value.password,
          email_confirm: true,
        });
        if (error || !data.user)
          throw new HttpError(
            409,
            'Account could not be created. Check the email and password; the email may already be registered.',
          );
        try {
          check(
            await db.rpc('portal_provision_client', {
              user_id: data.user.id,
              contact: value.display_name,
              company: value.company,
              email: value.email,
            }),
          );
        } catch (error) {
          // Compensate only for the new, unused account made by this request.
          await db.auth.admin.deleteUser(data.user.id);
          throw error;
        }
        return res.status(201).json({ id: data.user.id });
      }
      const userId = id(input.id);
      const target = check(
        await db.from('portal_profiles').select('role').eq('id', userId).single(),
      );
      if (target?.role !== 'client')
        throw new HttpError(400, 'Only client accounts can be managed here.');
      if (input.action === 'password') {
        const nextPassword = password(input.password);
        check(
          await db
            .from('portal_profiles')
            .update({ sessions_invalid_before: Math.floor(Date.now() / 1000) })
            .eq('id', userId),
        );
        check(await db.auth.admin.updateUserById(userId, { password: nextPassword }));
        return res.status(200).json({ ok: true });
      }
      if (input.action === 'status') {
        if (typeof input.active !== 'boolean') throw new HttpError(400, 'Invalid account status.');
        check(
          await db
            .from('portal_profiles')
            .update({
              active: input.active,
              ...(!input.active ? { sessions_invalid_before: Math.floor(Date.now() / 1000) } : {}),
            })
            .eq('id', userId),
        );
        return res.status(200).json({ ok: true });
      }
      if (input.action === 'details') {
        const company = requiredText(input.company, 'company', 160);
        const name = requiredText(input.display_name, 'contact name', 120);
        check(
          await db.rpc('portal_update_client', {
            user_id: userId,
            contact: name,
            company_name: company,
          }),
        );
        return res.status(200).json({ ok: true });
      }
      throw new HttpError(400, 'Unknown action.');
    } catch (error) {
      return respondError(res, error);
    }
  };
}
export default createHandler();
