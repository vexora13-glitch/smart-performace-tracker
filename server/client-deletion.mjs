import { check } from './runtime.mjs';
import { HttpError, id } from './validation.mjs';

// Enumerate each directory before removing anything: deleting during offset pagination skips files.
async function emptyPrefix(bucket, prefix) {
  const entries = [];
  for (let offset = 0; ; offset += 100) {
    const page = check(
      await bucket.list(prefix, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }),
    );
    entries.push(...page);
    if (page.length < 100) break;
  }
  const paths = [];
  for (const entry of entries) {
    const path = `${prefix}/${entry.name}`;
    if (entry.id) paths.push(path);
    else await emptyPrefix(bucket, path);
  }
  for (let offset = 0; offset < paths.length; offset += 100)
    check(await bucket.remove(paths.slice(offset, offset + 100)));
}

export async function deleteClients(db, input) {
  if (
    input.confirm !== 'DELETE' ||
    !Array.isArray(input.ids) ||
    !input.ids.length ||
    input.ids.length > 1000
  )
    throw new HttpError(400, 'Select clients and confirm permanent deletion.');
  const ids = [...new Set(input.ids.map((value) => id(value).toLowerCase()))];
  const begun = await db.rpc('portal_begin_client_deletion', { client_ids: ids });
  if (begun.error?.code === '22023') throw new HttpError(400, 'Choose existing client workspaces.');
  check(begun);
  const deleted = [];
  const failed = [];
  for (const client of ids) {
    try {
      // Include orphaned and quarantined objects, not just files with database metadata.
      for (const name of ['portal-private', 'vexbot-private'])
        await emptyPrefix(db.storage.from(name), client);
      check(await db.rpc('portal_finish_client_deletion', { client }));
      const removed = await db.auth.admin.deleteUser(client);
      if (removed.error && removed.error.status !== 404 && removed.error.code !== 'user_not_found')
        throw new Error('Account deletion failed');
      check(await db.from('portal_client_deletions').delete().eq('client_id', client));
      deleted.push(client);
    } catch {
      failed.push(client);
    }
  }
  return { deleted, failed };
}
