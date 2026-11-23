# Install the standalone Relay Android app

The current package is Relay-0.2-offline-android.apk, version 0.2.0. It is a 3.32 GB experimental Android app containing its vision model. It does not need this computer, a running service, Expo Go, an account, an API key or an Internet connection to inspect photographs.

## Install on the Galaxy S26 Ultra

1. Have approximately **12 GB of free storage** before copying/installing the package. The installed app and prepared model use approximately 6.7 GB; Android also needs space to stage the installer. The copied APK itself takes another 3.32 GB until you delete that installer file.
2. Copy the APK to the phone, open it in **My Files**, and select **Install**. Follow Android's prompt to allow installation from that source if needed. An existing Relay installation can be updated using the same signing certificate; do not uninstall it if you want to retain its records.
3. Open Relay, start a gear check and choose or take one photograph. Select **Analyze these photos on this phone**, then **Review the evidence**.
4. First use prepares and verifies the bundled model. Keep Relay open and follow its progress percentage. Subsequent checks reuse those files. No model download occurs.

You can disconnect the cable after transferring or installing the APK. Airplane mode is supported. Delete the copied installer afterward if you want to recover its storage; do not clear Relay's app data, which removes its saved records.

The old `relay-round04-android.apk` is the computer-dependent 0.1 client and remains archived only. Install the new package above.

## Optional USB installer

The existing **Install Relay on Android.cmd** launcher now invokes the standalone installer. This is an optional way to install the APK from Windows; USB is not a runtime dependency. The installer verifies the release hash, selects one attached physical phone by default and installs while retaining app data. It creates no port forwarding and checks no computer API.

If more than one phone is attached, run:

```powershell
.\scripts\install-android.ps1 -DeviceSerial YOUR_PHONE_SERIAL
```

USB installation requires Android's normal USB-debugging authorization. Manual installation through My Files does not require USB debugging. See [Android's device connection documentation](https://developer.android.com/tools/adb#Enabling).

## Everyday use and limits

Drafts and saved briefs remain on the phone. A cancelled or failed review does not become a completed assessment. Known crash/protective-damage history retains its exclusion precedence. Photos can show visible surface damage; they do not establish crash history, hidden condition or protective performance.

The smaller 0.8B and 2B models introduced measured mistakes, so this build carries the larger reference model. It is not yet the completed tiny-specialist architecture. Ordinary-wear false alarms and subtle missed defects remain possible.

The package contains ARM64 and x86_64 native code. The model path requires at least 8 GB nominal device memory and sufficient available memory. This is an experimental local test-key release, not a Play Store release. Physical S26 Ultra performance and its GPU driver have not been measured in this workspace. Native emulator evidence, exact hashes and observed limitations are in [the verification record](../15-testing-and-qa/phone-offline-02.md) and the adjacent APK integrity JSON.

If Android reports insufficient storage, free space and retry without uninstalling Relay. If the engine cannot finish, keep the photo, close other memory-heavy apps and retry one clear photograph. Review any findings against the source image.
