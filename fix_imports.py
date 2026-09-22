import os
import re

def fix_file(filepath):
    if 'utils/sentry.ts' in filepath.replace('\\', '/'):
        return
        
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    if 'normalizeError' not in content:
        return
    if 'import { normalizeError }' in content or 'import {normalizeError}' in content or 'import { ..., normalizeError' in content or 'import { captureUIError, captureApiError, normalizeError }' in content:
        return

    # Calculate relative path to src/utils/sentry
    dir_path = os.path.dirname(filepath)
    src_utils_sentry = os.path.abspath('mobile/src/utils/sentry.ts')
    rel_path = os.path.relpath(src_utils_sentry, dir_path)
    rel_path = rel_path.replace('\\', '/').replace('.ts', '')
    if not rel_path.startswith('.'):
        rel_path = './' + rel_path

    # Let's add a new import at the top
    import_statement = f"import {{ normalizeError }} from '{rel_path}';\n"
    
    # find last import
    lines = content.split('\n')
    last_import_idx = 0
    for i, line in enumerate(lines):
        if line.startswith('import '):
            last_import_idx = i
            
    lines.insert(last_import_idx + 1, import_statement.strip())
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'Fixed {filepath}')

for app_dir in ['mobile', 'admin']:
    for root, _, files in os.walk(app_dir):
        if 'node_modules' in root or '.expo' in root:
            continue
        for file in files:
            if file.endswith(('.ts', '.tsx')):
                fix_file(os.path.join(root, file))
