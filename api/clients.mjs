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
      // Additional people in a client's workspace. `id` is the workspace (its owning client account).
      if (input.action === 'member') {
        if (!check(await db.from('portal_clients').select('id').eq('id', userId).maybeSingle()))
          throw new HttpError(400, 'Choose a client workspace.');
        if (!['read_only', 'full'].includes(input.access)) throw new HttpError(400, 'Choose an access level.');
        const email = requiredText(input.email, 'email', 254).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Invalid email.');
        const name = requiredText(input.display_name, 'name', 120);
        const initial = password(input.password);
        const { data, error } = await db.auth.admin.createUser({ email, password: initial, email_confirm: true });
        if (error || !data.user)
          throw new HttpError(409, 'Account could not be created. The email may already be registered.');
        try {
          check(await db.rpc('portal_add_member', { user_id: data.user.id, contact: name, workspace: userId, level: input.access }));
        } catch (error) {
          await db.auth.admin.deleteUser(data.user.id);
          throw error;
        }
        return res.status(201).json({ id: data.user.id });
      }
      // Change or remove a member's access. Removal takes effect on the member's next request.
      if (input.action === 'member_access') {
        const workspace = id(input.workspace_id);
        if (input.access === 'remove') {
          check(await db.from('portal_workspace_members').delete().eq('workspace_id', workspace).eq('user_id', userId));
          check(await db.from('portal_profiles').update({ sessions_invalid_before: Math.floor(Date.now() / 1000) }).eq('id', userId));
        } else if (['read_only', 'full'].includes(input.access)) {
          check(await db.from('portal_workspace_members').update({ access: input.access }).eq('workspace_id', workspace).eq('user_id', userId));
        } else throw new HttpError(400, 'Choose an access level.');
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
