#!/usr/bin/env bash
# Who holds the box's Postgres connections. Piped to `bash -s` as root.
# MODE=read (default) prints counts only. MODE=reap also terminates client
# backends that have sat `idle` longer than IDLE_MIN minutes (never active
# queries, never replication or the postgres superuser), so a pool that leaked
# connections cannot keep every other app out ("sorry, too many clients").
# PUBLIC LOGS: database/role names and counts only. No query text, no env.
set -uo pipefail
MODE="${1:-read}"; IDLE_MIN="${2:-10}"
case "$IDLE_MIN" in ''|*[!0-9]*) IDLE_MIN=10 ;; esac
q() { sudo -u postgres psql -qtAX -F ' | ' -c "$1" </dev/null; }
echo "=== settings"; q "select name, setting from pg_settings where name in ('max_connections','superuser_reserved_connections','idle_in_transaction_session_timeout','idle_session_timeout')"
echo "=== total client backends"; q "select count(*) from pg_stat_activity where backend_type='client backend'"
echo "=== by database | role | state | count | oldest state age (min)"
q "select coalesce(datname,'-'), coalesce(usename,'-'), coalesce(state,'-'), count(*), round(max(extract(epoch from now()-state_change))/60) from pg_stat_activity where backend_type='client backend' group by 1,2,3 order by 4 desc"
echo "=== by application_name (top 20)"
q "select coalesce(nullif(application_name,''),'(none)'), coalesce(datname,'-'), count(*) from pg_stat_activity where backend_type='client backend' group by 1,2 order by 3 desc limit 20"
if [ "$MODE" = "reap" ]; then
  echo "=== reaping client backends idle > ${IDLE_MIN} min"
  q "select coalesce(datname,'-'), count(*) filter (where pg_terminate_backend(pid)) from pg_stat_activity where backend_type='client backend' and state='idle' and usename <> 'postgres' and now()-state_change > interval '${IDLE_MIN} minutes' group by 1 order by 2 desc"
  echo "=== total after"; q "select count(*) from pg_stat_activity where backend_type='client backend'"
fi
