#!/usr/bin/env bash
# up → rollback(역순) → up 을 적용해 migration과 rollback이 서로 맞는지 확인한다.
set -euo pipefail
shopt -s nullglob
up=(src/database/init.d/*.sql)
if [ ${#up[@]} -eq 0 ]; then
  echo "::notice::src/database/init.d에 migration이 없어 건너뜁니다."
  exit 0
fi
mapfile -t down < <(printf '%s\n' src/database/rollback/*.sql | sort -r)
apply() { for f in "$@"; do echo "apply $f"; psql -v ON_ERROR_STOP=1 -q -f "$f"; done; }
apply "${up[@]}"
psql -At -c "select count(*) || ' tables' from information_schema.tables where table_schema='public'"
apply "${down[@]}"
left=$(psql -At -c "select count(*) from information_schema.tables where table_schema='public'")
if [ "$left" -ne 0 ]; then echo "::error::rollback 후 테이블 ${left}개가 남았습니다."; exit 1; fi
apply "${up[@]}"
