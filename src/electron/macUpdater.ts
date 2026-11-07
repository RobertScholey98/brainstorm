import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BaseUpdater, DOWNLOAD_PROGRESS } from "electron-updater";
import type { DownloadExecutorResult, DownloadExecutorTask, DownloadUpdateOptions } from "electron-updater/out/AppUpdater";
import type { InstallOptions } from "electron-updater/out/BaseUpdater";
import { macZipFor } from "../core/appUpdate";

type DownloadOptions = Parameters<DownloadExecutorTask["task"]>[1];

/**
 * Runs after the app quits: unpacks the downloaded zip and swaps the new Brainstorm.app in for the running one. The pkg
 * hands the bundle to the user who installed it, so the swap needs no password; a bundle root still owns, from a pkg
 * older than that, goes through sudo when it needs none (CI) and macOS's administrator prompt otherwise. Either way it
 * reopens the app when asked, the old one if the swap failed. ~/Library/Logs/Brainstorm/update.log says what happened.
 */
const INSTALL_SCRIPT = `#!/bin/sh
pid=$1 zip=$2 app=$3 reopen=$4
log="$HOME/Library/Logs/Brainstorm/update.log"
mkdir -p "$(dirname "$log")"
exec >>"$log" 2>&1
echo "$(date '+%Y-%m-%d %H:%M:%S') updating $app from $zip"
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
stage=$(dirname "$0")
new="$stage/new/$(basename "$app")"
if ! ditto -x -k "$zip" "$stage/new" || [ ! -d "$new" ]; then
  echo "the zip holds no $(basename "$app")"
else
  # The copy lands beside the app first, so the swap is two renames and the app is never half there.
  cat >"$stage/swap.sh" <<'SWAP'
app=$1 new=$2 old="$1.replaced" incoming="$1.incoming"
rm -rf "$old" "$incoming"
ditto "$new" "$incoming" || { rm -rf "$incoming"; exit 1; }
mv "$app" "$old" || { rm -rf "$incoming"; exit 1; }
if mv "$incoming" "$app"; then rm -rf "$old"; else mv "$old" "$app"; rm -rf "$incoming"; exit 1; fi
xattr -dr com.apple.quarantine "$app" 2>/dev/null
exit 0
SWAP
  if /bin/sh "$stage/swap.sh" "$app" "$new" 2>/dev/null ||
    sudo -n /bin/sh "$stage/swap.sh" "$app" "$new" 2>/dev/null ||
    osascript -e "do shell script \\"/bin/sh '$stage/swap.sh' '$app' '$new'\\" with administrator privileges"; then
    echo "installed"
  else
    echo "couldn't replace $app"
  fi
fi
[ "$reopen" = 1 ] && open "$app"
rm -rf "$stage"
`;

/**
 * electron-updater's MacUpdater hands the zip to Squirrel.Mac, which installs only a build signed by the same Developer
 * ID, and the macOS builds are ad hoc signed. This one checks and downloads the same way, sha512 included, and installs
 * by swapping the bundle itself, as the Windows build's unsigned installer does without a signature check either.
 */
export class MacZipUpdater extends BaseUpdater {
  constructor() {
    super(null);
  }

  protected doDownloadUpdate(options: DownloadUpdateOptions): Promise<DownloadExecutorResult> {
    const { provider, info } = options.updateInfoAndProvider;
    const fileInfo = macZipFor(provider.resolveFiles(info), process.arch);
    if (fileInfo === null) return Promise.reject(new Error(`Brainstorm ${info.version} has no zip for this Mac (${process.arch}).`));
    // A private field in electron-updater's typings, which its own updaters download with.
    const http = (this as unknown as { httpExecutor: { download(url: URL, to: string, options: DownloadOptions): Promise<string> } }).httpExecutor;
    return this.executeDownload({
      fileExtension: "zip",
      fileInfo,
      downloadUpdateOptions: options,
      task: async (to, downloadOptions) => {
        if (this.listenerCount(DOWNLOAD_PROGRESS) > 0) downloadOptions.onProgress = (p) => this.emit(DOWNLOAD_PROGRESS, p);
        await http.download(fileInfo.url, to, downloadOptions);
      },
    });
  }

  protected doInstall(options: InstallOptions): boolean {
    const zip = this.installerPath;
    if (zip === null) {
      this.dispatchError(new Error("No update was downloaded."));
      return false;
    }
    // <bundle>/Contents/MacOS/<executable>
    const bundle = dirname(dirname(dirname(process.execPath)));
    if (!bundle.endsWith(".app")) {
      this.dispatchError(new Error(`Brainstorm isn't running from an app bundle (${bundle}).`));
      return false;
    }
    const stage = mkdtempSync(join(tmpdir(), "brainstorm-update-"));
    const script = join(stage, "install.sh");
    writeFileSync(script, INSTALL_SCRIPT, { mode: 0o755 });
    spawn("/bin/sh", [script, String(process.pid), zip, bundle, options.isForceRunAfter ? "1" : "0"], { detached: true, stdio: "ignore" }).unref();
    return true;
  }
}
