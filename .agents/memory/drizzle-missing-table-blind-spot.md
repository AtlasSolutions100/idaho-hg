---
name: Drizzle missing-table blind spot
description: A schema-push edge case where an entirely absent table was not detected until the table itself existed
---

Rule: do not trust a successful “No changes detected” result when API startup reports a missing relation. Verify the expected table and columns through `information_schema`, and confirm the development-to-production schema diff before republishing.

**Why:** the schema exporter included a new table, but the first push reported no changes while the table was absent. After safely creating that table from its declared schema, the next push detected and applied the remaining additive columns.

**How to apply:** for this contradiction, compare the live development schema with the declared Drizzle schema. Apply only the verified, non-destructive missing definition, rerun the normal push, then ensure the publish diff contains no removals or truncations.