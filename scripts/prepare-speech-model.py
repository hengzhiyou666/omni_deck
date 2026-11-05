"""Prepare the pinned official Vosk Chinese model for an offline Android build."""
import hashlib
from pathlib import Path
import sys
import zipfile

MODEL = 'vosk-model-small-cn-0.22'
SHA256 = '3af8b0e7e0f835ae9d414ce5df580237a3cfb08d586c9fbbb0f7ff29ad5b14ba'
if len(sys.argv) != 2:
    raise SystemExit(f'Usage: {sys.argv[0]} <{MODEL}.zip>\nDownload: https://alphacephei.com/vosk/models/{MODEL}.zip')
archive = Path(sys.argv[1])
if hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
    raise SystemExit('The speech model archive SHA256 does not match the official model.')
target = Path(__file__).resolve().parent.parent / 'modules/expo-robot-speech/android/src/main/assets/model-cn'
with zipfile.ZipFile(archive) as source:
    for entry in source.infolist():
        relative = Path(entry.filename).relative_to(MODEL)
        if entry.is_dir():
            continue
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(source.read(entry))
(target / 'uuid').write_text(MODEL + '\n')
print(f'Prepared {MODEL}: {target}')
