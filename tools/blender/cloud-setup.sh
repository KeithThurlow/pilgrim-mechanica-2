#!/bin/sh
# Blender for cloud sessions and any machine without Blender installed (2026-11-13): the `bpy` Python module from
# PyPI in a virtualenv at .blender-cloud/ (not in git), run through tools/blender/blender-bpy. After this,
# `node tools/blender/run.mjs <script.py> -- args` works as on Keith's PC. About 400 MB, one minute.
#   sh tools/blender/cloud-setup.sh
# The module is Blender 5.3 (Keith's PC has 4.4): the kit's scripts run on both; the Rampart export comes out the
# same (34,638 tris, the GLB within 1 KB of the committed one). Cycles on the CPU renders; EEVEE and Workbench don't
# (no GPU here), so shot scripts must set the engine to CYCLES when BLENDER_CLOUD is set.
set -e
here="$(cd "$(dirname "$0")/../.." && pwd)"
python3 -m venv "$here/.blender-cloud"
"$here/.blender-cloud/bin/pip" install -q "bpy==5.3.0" numpy
"$here/.blender-cloud/bin/python" -c "import bpy; print('bpy', bpy.app.version_string, 'ready')"
