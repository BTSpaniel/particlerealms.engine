### Backup restore authority boundary

Portable and native `/user` backups include checksummed files, but their
ordinary merge and replace restore paths never import
`/user/live-patches/**` or `/user/preferences/permissions.json`. Replace mode
preserves the active kernel-owned records while removing and restoring ordinary
user data. Preview and restore results expose `protectedEntries` and
`protectedSkipped`; replace receipts also expose `preservedProtectedEntries`.
Restoring those control records requires a separate kernel-authorized recovery
workflow.
