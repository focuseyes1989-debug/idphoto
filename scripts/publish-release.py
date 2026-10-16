"""Publish signed installer assets using an existing Git credential-manager login.

Credentials stay in memory. The script never reads or uploads the signing key.
"""
import argparse
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from release_metadata import published_installer_url

parser = argparse.ArgumentParser()
parser.add_argument('--version', required=True)
parser.add_argument('--installer', type=Path, required=True)
parser.add_argument('--notes', type=Path, required=True)
parser.add_argument('--no-make-latest', action='store_true')
parser.add_argument('--repository', default='focuseyes1989-debug/idphoto')
args = parser.parse_args()
if args.repository != 'focuseyes1989-debug/idphoto':
    raise SystemExit('This publisher is scoped to focuseyes1989-debug/idphoto.')
installer = args.installer.resolve(strict=True)
signature = Path(str(installer) + '.sig')
if f'_{args.version}_' not in installer.name or not signature.is_file():
    raise SystemExit('Installer version or signature is missing.')
notes = args.notes.read_text(encoding='utf-8')
result = subprocess.run(['git', '-c', 'credential.interactive=never', 'credential', 'fill'],
    input='protocol=https\nhost=github.com\n\n', text=True, capture_output=True,
    env={**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'never'})
credential = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
token = credential.get('password')
if not token:
    raise SystemExit('Sign in to GitHub with Git Credential Manager before publishing.')
api = f'https://api.github.com/repos/{args.repository}'

def request(url, method='GET', data=None, content_type='application/json', missing=False):
    headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
               'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ID-Photo-Studio-Release'}
    if data is not None:
        headers['Content-Type'] = content_type
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=300) as response:
            body = response.read()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as error:
        if error.code == 404 and missing:
            return None
        message = json.loads(error.read()).get('message', str(error.code))
        raise RuntimeError(f'GitHub {method} failed ({error.code}): {message}') from None

def send(url, method, value):
    return request(url, method, json.dumps(value).encode())

repo = request(api)
if not repo.get('permissions', {}).get('push'):
    raise SystemExit('The signed-in GitHub account cannot publish to this repository.')
# GitHub cannot create a release in an empty repository. Bootstrap only an empty repo.
if not request(api + '/branches'):
    readme = ('# ID Photo Studio\n\nWindows ID photo editor. Signed installers and the '
              'online update feed are available in [Releases](https://github.com/focuseyes1989-debug/idphoto/releases).\n\n'
              'This repository currently hosts release binaries. Development source remains '
              'in the local workspace.\n')
    send(api + '/contents/README.md', 'PUT', {'message': 'Initialize ID Photo Studio releases',
        'content': base64.b64encode(readme.encode()).decode(), 'branch': repo['default_branch']})

tag = 'v' + args.version
release = request(api + '/releases/tags/' + tag, missing=True)
if release is None:
    release = send(api + '/releases', 'POST', {'tag_name': tag,
        'target_commitish': repo['default_branch'], 'name': 'ID Photo Studio ' + args.version,
        'body': notes, 'draft': True, 'prerelease': False})

folder = installer.parent
existing = {a['name']: a for a in request(api + f"/releases/{release['id']}/assets")}

def upload(path, replace_metadata=False):
    payload = path.read_bytes()
    digest = 'sha256:' + hashlib.sha256(payload).hexdigest()
    # GitHub normalizes spaces in uploaded asset names to periods.
    remote_name = path.name.replace(' ', '.')
    if remote_name in existing:
        a = existing[remote_name]
        if a.get('digest') == digest:
            return a
        if not replace_metadata:
            raise RuntimeError('An existing installer/signature differs: ' + remote_name)
        request(api + f"/releases/assets/{a['id']}", 'DELETE')
    elif not release['draft'] and not replace_metadata:
        raise RuntimeError('Refusing to add missing installer assets to an already published release.')
    url = release['upload_url'].split('{', 1)[0] + '?name=' + urllib.parse.quote(remote_name)
    saved = request(url, 'POST', payload, 'application/octet-stream')
    if saved.get('digest') and saved['digest'] != digest:
        raise RuntimeError('Uploaded asset digest differs: ' + path.name)
    print('Uploaded:', saved['name'], len(payload), 'bytes')
    return saved

installer_asset = upload(installer)
signature_asset = upload(signature)
manifest_path = folder / 'latest.json'
previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
manifest = {'version': args.version, 'notes': notes,
    'pub_date': previous.get('pub_date', datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')),
    'platforms': {'windows-x86_64': {'signature': signature.read_text().strip(),
        'url': published_installer_url(args.repository, tag, installer_asset)}}}
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
checksum = folder / 'SHA256SUMS.txt'
checksum.write_text(''.join(hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + name + '\n'
    for path, name in [(installer, installer_asset['name']), (signature, signature_asset['name']), (manifest_path, 'latest.json')]), encoding='utf-8')
# Publish the feed last so clients never receive an installer URL before its asset exists.
upload(checksum, replace_metadata=True)
upload(manifest_path, replace_metadata=True)
release = send(api + f"/releases/{release['id']}", 'PATCH', {'draft': False, 'make_latest': 'false' if args.no_make_latest else 'true'})
print('Published:', release['html_url'])
