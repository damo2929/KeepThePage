#!/bin/bash
# Stamp manifest.json with a datetime version.
#
# Chrome requires `version` to be 1-4 dot-separated integers, each 0-65535,
# with no leading zeros — so a full timestamp (202609221645) is rejected.
# Encoding used: 0.1.MMDD.HHMM   e.g. 2026-09-22 16:45 -> 0.1.922.1645
# The complete datetime goes in `version_name`, which is free-form and is what
# chrome://extensions displays.
#
# Caveat: MMDD carries no year, so January of next year (0.1.105.x) sorts lower
# than December of this one (0.1.1231.x). Chrome does not enforce increasing
# versions for unpacked extensions, so this only matters if it is ever packed.
set -euo pipefail
cd "$(dirname "$0")"

MMDD=$(date +%-m%d)
HHMM=$((10#$(date +%H%M)))
VERSION="0.1.${MMDD}.${HHMM}"
VERSION_NAME="0.1 ($(date '+%Y-%m-%d %H:%M'))"

python3 - "$VERSION" "$VERSION_NAME" <<'PY'
import json, sys
p = 'manifest.json'
m = json.load(open(p))
m['version'] = sys.argv[1]
m['version_name'] = sys.argv[2]
# keep version/version_name near the top for readability
order = ['manifest_version','name','version','version_name','description',
         'permissions','declarative_net_request','content_scripts']
out = {k: m[k] for k in order if k in m}
out.update({k: v for k, v in m.items() if k not in out})
json.dump(out, open(p,'w'), indent=2)
open(p,'a').write('\n')
print('version      :', out['version'])
print('version_name :', out['version_name'])

# portal-early.js stamps the running build into data-ktp-early so a diagnosis
# cannot be read off the wrong version. Keep it in step here, or a test fails.
import re
q = 'portal-early.js'
src = open(q).read()
new = re.sub(r"const VERSION = '\d+';",
             "const VERSION = '%s';" % out['version'].rsplit('.', 1)[-1], src)
if new != src:
    open(q, 'w').write(new)
    print('portal-early :', out['version'].rsplit('.', 1)[-1])
PY
