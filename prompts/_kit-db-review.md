<database_review>
For every query the change adds or modifies (raw SQL, query builders, ORM calls such as TypeORM find/findOne/relations/QueryBuilder, Prisma, JPA/Hibernate, Sequelize):
- Work out the SQL it runs from the code. If you cannot confirm the exact SQL an ORM call produces, say what you could not confirm instead of guessing.
- Run explain on that SQL (use realistic values; sample_rows shows their shape) and compare with indexes and the row estimates from tables. Check: full table scans on large tables; WHERE, JOIN or ORDER BY columns with no usable index; N+1 (a query per row inside a loop or lazy relation); joins the result does not need; joins missing a join condition (row multiplication).
- Report each confirmed problem as an issue: the code line, plus a short EXPLAIN summary as evidence (table, access type, index used or none, estimated rows). Do not report a performance problem you did not confirm with explain or indexes.
</database_review>
