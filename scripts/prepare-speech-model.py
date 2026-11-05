"""Prepare pinned official SenseVoice/Silero models and sherpa-onnx for Android."""
import hashlib
from pathlib import Path
import shutil
import sys
import tarfile

MODEL = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17'
INPUTS = [
    ('SenseVoice archive', '7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e'),
    ('sherpa-onnx AAR', '07e042d97f3a6bd5b7fe74d4eef0513dc01a714b16c15a903250095aba43a575'),
    ('Silero VAD', '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6'),
]
if len(sys.argv) != 4:
    raise SystemExit('Usage: prepare-speech-model.py <sensevoice-int8.tar.bz2> <sherpa-onnx-static-link-onnxruntime-2.0.1.aar> <silero_vad.onnx>\nSee modules/expo-robot-speech/README.md for official download URLs.')
paths = [Path(p) for p in sys.argv[1:]]
for path, (label, digest) in zip(paths, INPUTS):
    checksum = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            checksum.update(chunk)
    if checksum.hexdigest() != digest:
        raise SystemExit(f'{label} SHA256 mismatch: {path}')

android = Path(__file__).resolve().parent.parent / 'modules/expo-robot-speech/android'
target = android / 'src/main/assets/speech'
target.mkdir(parents=True, exist_ok=True)
with tarfile.open(paths[0], 'r:bz2') as source:
    for name in ('model.int8.onnx', 'tokens.txt'):
        with source.extractfile(f'{MODEL}/{name}') as data, (target / name).open('wb') as destination:
            shutil.copyfileobj(data, destination)
shutil.copyfile(paths[2], target / 'silero_vad.onnx')
libs = android / 'libs'
libs.mkdir(exist_ok=True)
shutil.copyfile(paths[1], libs / 'sherpa-onnx-2.0.1.aar')
# Old weights are generated build inputs and must not remain in the new APK.
shutil.rmtree(android / 'src/main/assets/model-cn', ignore_errors=True)
print(f'Prepared SenseVoice INT8 + Silero VAD: {target}')
