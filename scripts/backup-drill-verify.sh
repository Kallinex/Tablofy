#!/bin/bash
# Prints a comparable fingerprint of a database so the backup drill can diff a
# source against its restore. Uses exact COUNT(*) rather than pg_stat estimates
# because a freshly restored database has no statistics collected yet.
DB="$1"
PSQL="psql -U tablofy -d $DB -Atc"

echo "tables=$($PSQL "select count(*) from information_schema.tables where table_schema='public'")"
echo "indexes=$($PSQL "select count(*) from pg_indexes where schemaname='public'")"
echo "fk=$($PSQL "select count(*) from information_schema.table_constraints where constraint_type='FOREIGN KEY' and table_schema='public'")"
echo "unique=$($PSQL "select count(*) from information_schema.table_constraints where constraint_type='UNIQUE' and table_schema='public'")"
echo "check=$($PSQL "select count(*) from information_schema.table_constraints where constraint_type='CHECK' and table_schema='public'")"
echo "sequences=$($PSQL "select count(*) from information_schema.sequences where sequence_schema='public'")"
echo "views=$($PSQL "select count(*) from information_schema.views where table_schema='public'")"
echo "triggers=$($PSQL "select count(*) from information_schema.triggers where trigger_schema='public'")"

echo "-- exact per-table row counts (only tables with rows) --"
$PSQL "
select coalesce(string_agg(rel || '=' || cnt, '|' order by rel), 'none')
from (
  select c.relname as rel,
         (xpath('/row/cnt/text()',
            query_to_xml(format('select count(*) as cnt from public.%I', c.relname),
                         false, true, '')))[1]::text::bigint as cnt
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
) t
where cnt > 0"

echo "-- data fingerprint (md5 of every row of every populated table) --"
$PSQL "
select 'fingerprint=' || md5(coalesce(string_agg(h, '|' order by h), ''))
from (
  select md5(t::text) as h from tenants t
  union all select md5(r::text) from restaurants r
  union all select md5(b::text) from branches b
  union all select md5(u::text) from users u
  union all select md5(s::text) from subscriptions s
) x"

echo "-- schema fingerprint (every column definition) --"
$PSQL "
select 'schema=' || md5(coalesce(string_agg(c, E'\n' order by c), ''))
from (
  select table_name||'.'||column_name||':'||data_type||
         ':'||coalesce(character_maximum_length::text,'')||
         ':'||is_nullable as c
  from information_schema.columns
  where table_schema='public'
) x"

echo "-- constraint fingerprint (every constraint definition) --"
$PSQL "
select 'constraints=' || md5(coalesce(string_agg(c, E'\n' order by c), ''))
from (
  select table_name||'.'||constraint_name||':'||constraint_type as c
  from information_schema.table_constraints
  where table_schema='public'
) x"
