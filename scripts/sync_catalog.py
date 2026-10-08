"""Publish only public furniture and copy its photos into the static site.

No login password or persistent GitHub credential is needed. A failed download
leaves data.json unchanged; the existing published catalog remains usable.
"""
import argparse
import datetime
import json
import os
import pathlib
import re
import tempfile
import urllib.parse
import urllib.request

SOURCE = 'https://laoxie-furniture-admin.bben111.chatgpt.site'
PHOTO = re.compile(r'^/images/([a-f0-9-]{36})\.jpg$')
ASSET = re.compile(r'^assets/[\w/-]+\.(?:jpg|jpeg|png|webp)$')
HEADERS = {'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json,image/jpeg'}


class SameOriginRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlsplit(newurl)
        if parsed.scheme != 'https' or parsed.netloc != urllib.parse.urlsplit(SOURCE).netloc:
            raise ValueError('Cross-origin redirects are not permitted')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(opener, url, limit):
    with opener.open(urllib.request.Request(url, headers=HEADERS), timeout=30) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Source response exceeds the size limit')
    return data


def clean_catalog(payload):
    if not isinstance(payload.get('version'), int) or payload['version'] < 0:
        raise ValueError('Invalid catalog version')
    catalog = payload['catalog']
    if not isinstance(catalog.get('products'), list) or len(catalog['products']) > 500:
        raise ValueError('Invalid product list')
    store = {key: catalog['store'].get(key, '') for key in ('name', 'intro', 'phone', 'address', 'hours', 'hero')}
    if not all(isinstance(v, str) for v in store.values()) or not ASSET.fullmatch(store['hero']):
        raise ValueError('Invalid store information')
    public = []
    remotes = {}
    ids = set()
    for source in catalog['products']:
        if source.get('visible') is not True:
            continue
        p = {key: source[key] for key in ('id', 'name', 'category', 'material', 'description', 'length', 'width', 'height')}
        if not all(isinstance(p[key], str) for key in ('id', 'name', 'category', 'material', 'description')):
            raise ValueError('Invalid product text')
        if not re.fullmatch(r'[\w-]{1,100}', p['id']) or p['id'] in ids:
            raise ValueError('Invalid or duplicate product ID')
        ids.add(p['id'])
        if not all(isinstance(p[key], (int, float)) and 1 <= p[key] <= 2000 for key in ('length', 'width', 'height')):
            raise ValueError('Invalid product dimensions')
        p.update(visible=True, featured=bool(source.get('featured')), example=bool(source.get('example')), images=[])
        if not isinstance(source.get('images'), list) or not 1 <= len(source['images']) <= 5:
            raise ValueError('Invalid photo list')
        for image in source['images']:
            if not isinstance(image, str):
                raise ValueError('Invalid photo URL')
            if ASSET.fullmatch(image):
                p['images'].append(image)
                continue
            parsed = urllib.parse.urlsplit(image)
            match = PHOTO.fullmatch(parsed.path)
            if not match or parsed.scheme != 'https' or parsed.netloc != urllib.parse.urlsplit(SOURCE).netloc or parsed.query or parsed.fragment:
                raise ValueError('Only this store\'s uploaded photos are allowed')
            relative = 'assets/uploads/' + match.group(1) + '.jpg'
            remotes[relative] = image
            p['images'].append(relative)
        public.append(p)
    return {'store': store, 'products': public}, remotes


def sync(root, opener=None):
    root = pathlib.Path(root).resolve()
    opener = opener or urllib.request.build_opener(SameOriginRedirect())
    payload = json.loads(download(opener, SOURCE + '/api/catalog', 1024 * 1024))
    public, remotes = clean_catalog(payload)
    data_path = root / 'data.json'
    previous = json.loads(data_path.read_text(encoding='utf-8')) if data_path.is_file() else {}
    if previous.get('_publication', {}).get('version', -1) > payload['version']:
        raise ValueError('Refusing to replace the published catalog with an older version')
    # Stage every new photo before modifying the published catalog.
    scratch = pathlib.Path.cwd() / 'work' / 'catalog-sync'
    scratch.mkdir(parents=True, exist_ok=True)
    downloaded = 0
    with tempfile.TemporaryDirectory(dir=scratch) as temporary:
        pending = []
        for relative, remote in remotes.items():
            target = root / relative
            if target.is_file():
                existing = target.read_bytes()
                if 4 <= len(existing) <= 800000 and existing[:3] == b'\xff\xd8\xff':
                    continue
            data = download(opener, remote, 800000)
            if len(data) < 4 or data[:3] != b'\xff\xd8\xff':
                raise ValueError('Uploaded photo is not a JPEG')
            stage = pathlib.Path(temporary) / target.name
            stage.write_bytes(data)
            pending.append((stage, target))
        for stage, target in pending:
            target.parent.mkdir(parents=True, exist_ok=True)
            stage.replace(target)
            downloaded += 1
    previous_public = {k: previous.get(k) for k in ('store', 'products')}
    changed = previous_public != public or previous.get('_publication', {}).get('version') != payload['version'] or downloaded > 0
    if changed:
        public['_publication'] = {'version': payload['version'], 'updatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')}
        temporary_data = data_path.with_suffix('.json.tmp')
        temporary_data.write_text(json.dumps(public, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        temporary_data.replace(data_path)
    print(f'Public catalog: {len(public["products"])} products; {len(remotes)} mirrored photos; {downloaded} downloaded; changed={changed}')
    return changed


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default=str(pathlib.Path(__file__).resolve().parents[1]))
    args = parser.parse_args()
    changed = sync(args.root)
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as out:
            out.write('changed=' + str(changed).lower() + '\n')
