import urllib.parse

def published_installer_url(repository, tag, uploaded_asset):
    """Draft browser_download_url can contain an untagged-* temporary tag."""
    name = uploaded_asset['name']
    return f'https://github.com/{repository}/releases/download/{tag}/' + urllib.parse.quote(name, safe='')
