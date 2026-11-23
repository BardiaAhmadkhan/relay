"""Export a clean, reproducible managed iOS build kit. No signing material, model weights or organizer photos."""
import json,hashlib,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/relay-v4-event'
README="""# Relay Field Desk: iOS build on a Mac

This is the mobile application source for the event profile. The separately delivered ios-export contains compiled Hermes bytecode and fonts/images. The Windows exhibition laptop did not sign or run an iPhone app.

On a Mac with Xcode, its command-line tools, CocoaPods, and Node 22.13+ (the exhibition uses Node 24), extract this archive into an empty directory. Run these commands from the extracted root.

```sh
npm ci
cd app
export RELAY_MOBILE_PROFILE=event
export EXPO_PUBLIC_RELAY_EVENT_DESK=1
export EXPO_PUBLIC_RELAY_V4_API_URL=http://127.0.0.1:8794
npx expo prebuild --platform ios --no-install
(cd ios && pod install)
npx expo run:ios
```

The loopback address is for a simulator with the Relay event API reachable on its host. The existing event laptop exposes a separate private desk. A physical iPhone needs an appropriate signing identity and a qualified connection to the backend. This archive contains no backend keys, real item data or app-store credentials. App ID: ca.relaygearlab.fielddesk. The older Android offline profile is outside this build.

"""
def main():
    files=['package.json','package-lock.json','tsconfig.json','app/package.json','app/app.json','app/app.config.js','app/metro.config.js','app/react-native.config.js','app/tsconfig.json','app/App.tsx','app/index.ts','app/assets/editorial-jacket.jpg','assets/brand/relay-icon.png','scripts/mobile-client.mjs']
    for group in ('app/src','app/plugins','packages'):
        for f in sorted((ROOT/group).rglob('*')):
            if f.is_file() and f.suffix.lower() in ('.ts','.tsx','.mjs','.js','.cjs','.json','.mts'):files.append(f.relative_to(ROOT).as_posix())
    archive=OUT/'Relay-Field-Desk-iOS-Source.zip'
    with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=8) as z:
        z.writestr('BUILD.md',README)
        for f in sorted(set(files)):z.write(ROOT/f,f)
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        assert not any(n.startswith(('data/','collab/','.cache/')) or Path(n).name.startswith('.env') or n.endswith(('.gguf','.onnx','.safetensors','.p8','.p12','.pem','.keystore')) for n in z.namelist())
        print(archive.name,archive.stat().st_size,len(z.namelist()),hashlib.sha256(archive.read_bytes()).hexdigest())
if __name__=='__main__':main()
