#!/usr/bin/env bash
# up → rollback(역순) → up 을 적용해 migration과 rollback이 서로 맞는지 확인한다.
set -euo pipefail
shopt -s nullglob
up=(src/database/init.d/*.sql)
if [ ${#up[@]} -eq 0 ]; then
  echo "::notice::src/database/init.d에 migration이 없어 건너뜁니다."
  exit 0
fi

# up과 rollback은 같은 파일 이름으로 1:1 짝을 이뤄야 한다. 빠진 짝이 있으면 실행 전에 실패한다.
missing=0
down=()
for f in "${up[@]}"; do
  r="src/database/rollback/$(basename "$f")"
  if [ ! -f "$r" ]; then echo "::error file=$f::짝이 되는 rollback 파일 $r 이 없습니다."; missing=1; fi
  down=("$r" "${down[@]}")
done
for r in src/database/rollback/*.sql; do
  u="src/database/init.d/$(basename "$r")"
  if [ ! -f "$u" ]; then echo "::error file=$r::짝이 되는 up migration $u 이 없습니다."; missing=1; fi
done
if [ "$missing" -ne 0 ]; then exit 1; fi

apply() { for f in "$@"; do echo "apply $f"; psql -v ON_ERROR_STOP=1 -q -f "$f"; done; }
apply "${up[@]}"
psql -At -c "select count(*) || ' tables' from information_schema.tables where table_schema='public'"
apply "${down[@]}"
left=$(psql -At -c "select count(*) from information_schema.tables where table_schema='public'")
if [ "$left" -ne 0 ]; then echo "::error::rollback 후 테이블 ${left}개가 남았습니다."; exit 1; fi
apply "${up[@]}"
