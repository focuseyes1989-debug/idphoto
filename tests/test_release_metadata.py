import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('release_metadata', Path(__file__).parents[1] / 'scripts/release_metadata.py')
metadata = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metadata)

class ReleaseMetadataTests(unittest.TestCase):
    def test_uses_final_tag_and_server_normalized_name(self):
        asset = {'name': 'ID.Photo.Studio_0.1.3_x64-setup.exe',
                 'browser_download_url': 'https://github.com/owner/repo/releases/download/untagged-temporary/old-name.exe'}
        self.assertEqual(metadata.published_installer_url('owner/repo', 'v0.1.3', asset),
            'https://github.com/owner/repo/releases/download/v0.1.3/ID.Photo.Studio_0.1.3_x64-setup.exe')

    def test_encodes_asset_name_without_treating_it_as_a_path(self):
        self.assertTrue(metadata.published_installer_url('owner/repo', 'v1.0.0', {'name': 'a b#c.exe'}).endswith('/a%20b%23c.exe'))

if __name__ == '__main__':
    unittest.main()
