"""Stage a static Pages artifact; management scripts and workflow files are excluded."""
import pathlib
import shutil

root = pathlib.Path(__file__).resolve().parents[1]
target = root / 'public-site'
target.mkdir(exist_ok=True)
for name in ('index.html', 'app.js', 'style.css', 'config.js', 'data.json', 'favicon.svg', '.nojekyll'):
    if (root / name).is_file():
        shutil.copy2(root / name, target / name)
shutil.copytree(root / 'assets', target / 'assets', dirs_exist_ok=True)
print('Static website staged; public furniture and photos are served by Pages.')
