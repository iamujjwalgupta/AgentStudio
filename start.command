#!/bin/bash
# ==============================================================================
# Agent Studio — Double-Clickable macOS Launcher
# Double-click this file in macOS Finder to launch Agent Studio.
# ==============================================================================

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
exec ./start.sh
