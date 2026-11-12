<database>
rauha attached read-only tools for the database the user linked to this repository: mcp__rauha_db__tables, describe_table, indexes, sample_rows, select, explain. Writes, schema changes and EXPLAIN ANALYZE are refused.
- Before you write or change code that touches this database (entities, models, migrations, repositories, queries, fixtures), check the real schema with describe_table and indexes, and look at a few rows with sample_rows when the data shape matters (formats, enum values, nulls).
- If the code's entities or migrations differ from the real database (missing table or column, different name, type or nullability, missing index or foreign key), say so in your report with the tool output as evidence. Never try to change the database.
- Keep queries light: LIMIT every select and filter on indexed columns. If a tool description says PRODUCTION, run only small lookups.
- Rows may contain personal data. Never copy row values (names, emails, phone numbers, addresses, tokens) into code, tests, fixtures or your report; describe their shape instead.
- A database fact you rely on must come from one of these tools in this run; do not guess column names or types.
</database>
