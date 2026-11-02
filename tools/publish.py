"""Run just before publishing a version: python tools/publish.py --now, then commit.

Checks VERSION in sw.js matches the newest version in whatsnew.js and that sw.js lists
every file, then stamps versions with no time yet in PUBLISHED with the time now.
"""
import os
import re
import sys
from datetime import datetime, timezone

whatsnew = open('whatsnew.js', encoding='utf-8').read()
worker = open('sw.js', encoding='utf-8').read()
number = lambda version: [int(part) for part in version.split('.')]
versions = re.findall(r"^  '(\d+\.\d+\.\d+)': \[", whatsnew, re.M)
newest = max(versions, key=number)
worker_version = re.search(r"const VERSION = '([^']+)'", worker).group(1)
if worker_version != newest:
    sys.exit(f'sw.js VERSION is {worker_version} but whatsnew.js has {newest}')
files = [name for name in os.listdir('.') if name.endswith(('.js', '.css', '.json', '.html', '.svg')) and name != 'sw.js'] + [f'assets/rewards/{name}' for name in os.listdir('assets/rewards')]
missing = [name for name in files if f"'{name}'" not in worker]
if missing:
    sys.exit(f'Missing from SHELL in sw.js: {missing}')

start = whatsnew.index('const PUBLISHED = {')
stamped = re.findall(r"'(\d+\.\d+\.\d+)':", whatsnew[start:whatsnew.index('};', start)])
if '--now' in sys.argv:
    time_now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    new_lines = ''.join(f"  '{version}': '{time_now}',\n" for version in sorted(set(versions) - set(stamped), key=number, reverse=True))
    head = start + len('const PUBLISHED = {\n')
    open('whatsnew.js', 'w', encoding='utf-8').write(whatsnew[:head] + new_lines + whatsnew[head:])
    print(f'Stamped: {new_lines.strip() or "nothing new"}')
print(f'OK: version {newest}')
