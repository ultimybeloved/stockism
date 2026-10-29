# Restore the database

Two kinds of backup exist. Use the right one.

| Backup | What it holds | Kept | Restore with |
|---|---|---|---|
| Firestore managed backup (set up 2026-10-29) | The whole database, every collection | 7 daily copies | `firebase firestore:backups:restore` (below) |
| `backupMarketData` (`functions/src/admin/adminBackups.ts`) | Market prices and the top 100 users only | See its retention job | Admin panel, `restoreBackup` |

The live database also has delete protection on, so it can't be deleted by
accident. Turning it off needs
`firebase firestore:databases:update "(default)" --delete-protection DISABLED`.

## Restoring a managed backup

A restore never overwrites the live database. It writes a new database, which
you check before pointing anything at it.

```sh
npx firebase firestore:backups:list
npx firebase firestore:databases:restore \
  --database restored-YYYYMMDD \
  --backup projects/stockism-abb28/locations/nam5/backups/<BACKUP_ID>
```

Then read the restored database (for example with a script using the
service-account key and `getFirestore(app, 'restored-YYYYMMDD')`) and copy back
only what was lost. Delete the restored database when done, since it is billed
like the live one.

## Checking the schedule

```sh
npx firebase firestore:backups:schedules:list --database "(default)"
```

It should show one schedule: `DAILY`, retention `604800s` (7 days). Cost at
0.9 GB of data is well under $1 a month.
