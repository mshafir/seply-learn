# The Seply Learn desktop app

The desktop app opens Seply Learn in a window of its own. It uses `learn.seply.app` unless you choose another server, such as one you [host yourself](self-host.md). It is the same app you use in the browser: the server sends it, so it is always the server's current version.

Downloads are on [seply.app/desktop](https://seply.app/desktop/) and on the [desktop releases](https://github.com/mshafir/seply-learn/releases?q=desktop-v&expanded=true) page on GitHub. Spec: [10-desktop.md](spec/v1/10-desktop.md).

- [Which file to download](#which-file-to-download)
- [macOS](#macos)
- [Windows](#windows)
- [Linux](#linux)
- [Choosing a server](#choosing-a-server)
- [Updates](#updates)

## Which file to download

| System | File |
|---|---|
| macOS, Apple silicon or Intel | `Seply-Learn-<version>-mac-universal.dmg` |
| Windows 10 or 11 | `Seply-Learn-<version>-win-x64.exe`, or `-win-arm64.exe` on an Arm PC |
| Ubuntu, Debian and others that use `.deb` | `Seply-Learn-<version>-linux-amd64.deb`, or `-linux-arm64.deb` |
| Other Linux | `Seply-Learn-<version>-linux-x86_64.AppImage`, or `-linux-arm64.AppImage` |

These builds are not signed yet. Signing needs an Apple developer certificate and a Windows code signing certificate, and they come in a later release. Until then, your system warns you the first time you open the app. The steps below get past the warning once; after that the app opens normally.

## macOS

1. Open the `.dmg` and drag **Seply Learn** to **Applications**.
2. Open Seply Learn from Applications. macOS says it can't check the app for malicious software. Click **Done** (or **Cancel**).
3. Open **System Settings → Privacy & Security**. Near the bottom it says Seply Learn was blocked. Click **Open Anyway**, then **Open** and enter your password.

On macOS 14 or earlier you can instead right-click (or Control-click) the app in Applications, choose **Open**, and then **Open** again.

If you prefer the Terminal, this removes the download's quarantine flag, and then the app opens with no warning:

```sh
xattr -dr com.apple.quarantine "/Applications/Seply Learn.app"
```

## Windows

1. Run the `.exe`. Windows shows **Windows protected your PC** (SmartScreen).
2. Click **More info**, then **Run anyway**.

The installer needs no administrator rights. It installs for your user only, adds Seply Learn to the Start menu and opens it. To remove it, use **Settings → Apps → Installed apps**.

## Linux

**The `.deb`** (Ubuntu, Debian, Mint, Pop!_OS and others):

```sh
sudo apt install ./Seply-Learn-*-linux-amd64.deb
```

It adds Seply Learn to your applications menu and sets it up to open `seply://` links. This is the one to use on Ubuntu 24.04 or later: it installs the AppArmor profile Electron's sandbox needs there.

**The AppImage** runs without installing:

```sh
chmod +x Seply-Learn-*-linux-x86_64.AppImage
./Seply-Learn-*-linux-x86_64.AppImage
```

It needs FUSE 2: on Ubuntu 24.04 or later that is `sudo apt install libfuse2t64`, on older releases `libfuse2`. On Ubuntu 24.04 or later the AppImage may also stop at start-up with a sandbox error, because Ubuntu limits the user namespaces Electron's sandbox uses. Use the `.deb` there. An AppImage only opens `seply://` links (such as the one that finishes a Google sign-in) if a tool like AppImageLauncher has added it to your applications.

## Choosing a server

The app opens `https://learn.seply.app` the first time. To use another server, choose **Server…** in the menu (in the **Seply Learn** menu on macOS, the **File** menu on Windows and Linux) and enter its address. The app checks that it is a Seply Learn server before it switches. The address must use `https`, unless the server is on your own machine or your local network. The app remembers the server, and you can switch back at any time.

Signing in works as it does on the web. **Continue with Google** opens your browser, and the app finishes the sign-in when the browser hands you back. Email and password sign-in happens in the window.

## Updates

The app doesn't update itself yet. The web app inside it is always the server's current version, so you only need a new desktop build for changes to the window itself. When there is one, download it from [seply.app/desktop](https://seply.app/desktop/) and install it over the old one. Your server choice and sign-in are kept.
