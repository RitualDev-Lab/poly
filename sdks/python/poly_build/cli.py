import os
import sys
import platform
import subprocess
import urllib.request
import tarfile
import zipfile
import shutil
from pathlib import Path

VERSION = "0.6.2"
REPO = "RitualDev-Lab/poly"


def get_platform_asset():
    system = platform.system().lower()
    machine = platform.machine().lower()

    if system == "linux":
        if machine in ("arm64", "aarch64"):
            return "poly-linux-arm64.tar.gz", "tar.gz", "poly"
        return "poly-linux-x64.tar.gz", "tar.gz", "poly"
    elif system == "darwin":
        if machine in ("arm64", "aarch64"):
            return "poly-darwin-arm64.tar.gz", "tar.gz", "poly"
        return "poly-darwin-x64.tar.gz", "tar.gz", "poly"
    elif system == "windows":
        return "poly-windows-x64.zip", "zip", "poly.exe"
    else:
        raise RuntimeError(f"Unsupported operating system: {system}")


def get_binary_path():
    asset_name, archive_type, binary_name = get_platform_asset()
    cache_dir = Path.home() / ".poly" / "bin" / VERSION
    cache_dir.mkdir(parents=True, exist_ok=True)
    binary_path = cache_dir / binary_name

    if not binary_path.exists():
        url = f"https://github.com/{REPO}/releases/download/v{VERSION}/{asset_name}"
        sys.stderr.write(f"poly: downloading native standalone binary ({asset_name})...\n")
        archive_path = cache_dir / asset_name
        try:
            req = urllib.request.Request(url, headers={"User-Agent": f"poly-build/{VERSION}"})
            with urllib.request.urlopen(req) as resp, open(archive_path, "wb") as f:
                shutil.copyfileobj(resp, f)

            if archive_type == "tar.gz":
                with tarfile.open(archive_path, "r:gz") as tar:
                    tar.extractall(cache_dir)
            elif archive_type == "zip":
                with zipfile.ZipFile(archive_path, "r") as z:
                    z.extractall(cache_dir)

            if archive_path.exists():
                archive_path.unlink()

            if os.name != "nt":
                binary_path.chmod(0o755)
        except Exception as e:
            if archive_path.exists():
                archive_path.unlink()
            raise RuntimeError(f"Failed to download and unpack poly native binary: {e}")

    return binary_path


def main():
    try:
        bin_path = get_binary_path()
        args = [str(bin_path)] + sys.argv[1:]
        proc = subprocess.run(args)
        sys.exit(proc.returncode)
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as err:
        sys.stderr.write(f"poly error: {err}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
