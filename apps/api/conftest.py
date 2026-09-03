import sys
from pathlib import Path
# Ensure apps/api is on sys.path for `import app.*` when running pytest from repo root or apps/api
api_path = Path(__file__).parent
if str(api_path) not in sys.path:
    sys.path.insert(0, str(api_path))
