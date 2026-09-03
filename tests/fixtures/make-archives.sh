#!/bin/sh
# Rebuild the tar.gz fixtures in this directory. Run it on a machine with GNU tar.
#
# These archives are COMMITTED rather than built during the test run, and that is the
# point. The first version of the tar tests shelled out to whatever `tar` the machine
# had; it passed on Ubuntu and failed on macOS and Windows, because `--transform` is GNU
# tar's and bsdtar spells it `-s`, and because a file mode set with chmod means nothing on
# Windows. The failures were about the test's tooling, not about the reader — which is the
# one thing a test must never be about.
#
# A committed archive fixes that in the direction that keeps the property: every platform
# now reads the SAME bytes, written by a real GNU tar, including the platforms where no
# GNU tar exists to write them. `release.tar.gz` is packed with llama.cpp's own command
# from .github/workflows/release.yml:
#
#   tar -czvf llama-<tag>-bin-ubuntu-x64.tar.gz --transform "s,^\.,llama-<tag>," -C ./build/bin .
#
# so its shape is the shape the provisioner will actually meet: everything flat under one
# `llama-<tag>/` directory, an executable server, and the SONAME symlink chains a real
# build/bin is full of.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# ---- release.tar.gz: the shape of a real llama.cpp CPU release ----------------------
mkdir -p "$work/bin"
cd "$work/bin"
printf 'ELF-ish bytes standing in for the server\n' > llama-server
printf 'the real shared object\n'                   > libggml-base.so.0.22.0
printf 'the other real shared object\n'             > libllama.so.0.3.0
printf 'Apache License 2.0 ...\n'                   > LICENSE
chmod 755 llama-server libggml-base.so.0.22.0 libllama.so.0.3.0
chmod 644 LICENSE
# The chains a build/bin actually carries: an unversioned name pointing at a major
# version pointing at the file. llama-server is linked against the middle one by SONAME.
ln -s libggml-base.so.0.22.0 libggml-base.so.0
ln -s libggml-base.so.0      libggml-base.so
ln -s libllama.so.0.3.0      libllama.so.0
ln -s libllama.so.0          libllama.so
tar -czf "$here/release.tar.gz" --transform "s,^\.,llama-v0.3.0," --owner=0 --group=0 --mtime=@0 -C "$work/bin" .

# ---- escaping-name.tar.gz: an entry that writes outside the destination -------------
cd "$work"
mkdir -p evil && printf 'pwned\n' > evil/passwd
tar -czf "$here/escaping-name.tar.gz" -P --owner=0 --group=0 --mtime=@0 \
  --transform "s,^evil,../../escaped," -C "$work" evil

# ---- escaping-link.tar.gz: an entry that POINTS outside it --------------------------
# The interesting one. The name is harmless, so a reader that only checks names lets it
# through; extracting it plants a link at ../../../etc/passwd, and the next archive to
# write through that name writes wherever it points.
mkdir -p "$work/link" && cd "$work/link"
ln -s ../../../etc/passwd innocent-looking-name
tar -czf "$here/escaping-link.tar.gz" --owner=0 --group=0 --mtime=@0 -C "$work" link

echo "wrote release.tar.gz, escaping-name.tar.gz, escaping-link.tar.gz"
